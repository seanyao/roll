/**
 * GitHub module — TS I/O adapters that drive the `gh` CLI exactly as the v2 loop
 * does (US-INFRA-003).
 *
 * ─── DIVERGENCE FROM THE CARD (octokit → gh) ────────────────────────────────
 * The card text suggests an HTTP GitHub client (octokit). REJECTED for
 * BEHAVIORAL FIDELITY: v2 drives GitHub EXCLUSIVELY through the `gh` CLI
 * (`gh pr …`, `gh api …`, `gh run …`, `gh issue …`). Two reasons this is not
 * negotiable:
 *   1. Credential surface. `gh` resolves auth from the user's `gh auth` keyring
 *      / GH_TOKEN env the same way for every call; octokit would introduce a
 *      SECOND credential path (a PAT we'd have to source + store), changing the
 *      observable auth/permission boundary the user already trusts. v3 must keep
 *      the credential surface byte-identical to v2.
 *   2. Behavioral parity. The oracle's `--json <fields>` selections, `-q`/`--jq`
 *      filters, `--auto`/`--admin` merge modes, and exit-code handling are all
 *      `gh` semantics. Re-deriving them over REST risks silent drift (auto-merge
 *      is a GraphQL mutation; `pr checks` aggregates the checks API + statuses).
 * We therefore wrap `gh` via `execFile`, mirroring each invocation's exact argv,
 * `--json` field set, and output parsing. ZERO new runtime deps. Deliberate.
 *
 * ─── v2 oracle (frozen bash, bin/roll) — gh invocation inventory ─────────────
 *   helpers:
 *     - `_gh_repo_slug`            10971-10984  origin url → `owner/repo`
 *         (strips git@/ssh:///https:///http:// prefixes + trailing `.git`).
 *     - `_gh_available`            10987         `command -v gh`.
 *     - `_gh_resolve <out>`        10992-10998   available && slug, else fail.
 *   PR view (all `gh -R <slug> pr view <ref> --json <f> [-q <jq>]`):
 *     - 13529/13569/13669  `--json url -q .url`            → PR url (reuse probe).
 *     - 13570/13597/8871   `--json state -q .state`        → MERGED/CLOSED/OPEN.
 *     - 12114              `--json headRefName -q .headRefName`.
 *     - 12151              `--json autoMergeRequest -q .autoMergeRequest`.
 *     - 13744              `--json state,mergedAt,mergeCommit` (backfill).
 *     - 11895              `--json headRepository,headRepositoryOwner,isCrossRepository`.
 *     - 12040              `--json mergeStateStatus,statusCheckRollup`.
 *     - 6231               `--json title,body`              (PR review fetch).
 *   PR list (all `gh -R <slug> pr list …`):
 *     - 11034  `--head <b> --state open --json number`.
 *     - 11371  `--base main --state open --json number,title,headRefName`.
 *     - 11974  `--state open --json <self-merge field set>`.
 *     - 12543  `--state open --json headRefName --jq <startswith loop/>`.
 *     - 13139  `--state open --json title --jq '.[].title'`.
 *   PR create   13534/13673  `pr create --base main --head <b> --title --body`.
 *   PR merge    13541  `--auto --squash --delete-branch`,
 *               13680  `--admin --squash --delete-branch`,
 *               11587/11963/12015  `--squash --delete-branch` (plain).
 *   PR diff     12099  `pr diff <pr>`,  11381  `pr diff <pr> --name-only`.
 *   PR close    12082  `pr close <pr> --comment <reason>`.
 *   PR checks   11549  `pr checks <num>`,
 *               11551  `pr checks <num> --json link --jq '.[]|select(.state=="FAILURE")|.link'`.
 *   PR review   6240/6302  `pr review <num> --approve -b <body>`,
 *               6306       `pr review <num> --request-changes -b <body>`.
 *   run list    11024  `run list --commit <c> --json status,conclusion`,
 *               11238  `run list --commit <c> --json conclusion,status`,
 *               11326  `run list --commit <c> --json databaseId,conclusion,headBranch …`,
 *               11349  `run list --json databaseId,conclusion,headBranch -L 20`,
 *               11386/11388  `run list --branch <b> --json databaseId,conclusion`,
 *               14410  `run list --commit <c> --json status,conclusion,name`.
 *   run view    11330/11355/11555  `run view --log-failed <id>`,
 *               11396  `run view <id> --log-failed`.
 *   api         12553  `api repos/<slug>/contents/.roll/backlog.md?ref=<b>
 *                       -H "Accept: application/vnd.github.raw"` (raw file),
 *               1845   `api repos/<slug>/branches/main/protection --jq …`.
 *   issue       14334  `issue create --repo <r> --title --body --label`.
 *   repo        1841   `repo view --json owner,name --jq '.owner.login+"/"+.name'`.
 *
 * Where core/delivery/pr.ts already PLANS the publish sequence (planPublishPr /
 * planPublishDocPr emit {@link PublishStep}[]), THIS module is the EXECUTOR: it
 * provides {@link ExecGh}-compatible runners. `runPublishPlan` accepts a plan +
 * the reuse short-circuit the adapter owns (view → skip create) so the two
 * halves compose without core ever spawning a process.
 *
 * All wrappers are thin: they shell out and surface gh's exit status + parsed
 * stdout. Lenient wrappers (mirroring bash `|| true` / `|| echo ""`) swallow
 * failures exactly where the oracle does, and say so.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Result of a raw `gh` invocation. Mirrors {@link GitResult} shape in git.ts. */
export interface GhResult {
  /** Process exit code (0 = success). */
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run `gh <args>`. Never throws on a non-zero exit — returns the code + captured
 * streams so callers mirror bash's explicit `|| …` handling. Throws only on a
 * spawn failure (gh binary missing), which callers gate with {@link ghAvailable}
 * exactly as the oracle's `_gh_available` precondition does.
 */
export async function gh(args: readonly string[]): Promise<GhResult> {
  try {
    const { stdout, stderr } = await execFileAsync("gh", [...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    if (typeof err.code === "number") {
      return { code: err.code, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
    }
    if (err.stdout !== undefined || err.stderr !== undefined) {
      return { code: 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
    }
    throw e; // gh binary not found / unspawnable
  }
}

/**
 * Mirror `_gh_available` (bin/roll 10987): `command -v gh`. True iff a `gh`
 * binary is on PATH and runnable. Uses `gh --version` (exit 0) as the probe.
 */
export async function ghAvailable(): Promise<boolean> {
  try {
    await execFileAsync("gh", ["--version"], { encoding: "utf8" });
    return true;
  } catch (e) {
    // A non-ENOENT error means gh ran (exists) — treat as available.
    return (e as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

// ─── slug derivation (pure — mirrors _gh_repo_slug 10971-10984) ───────────────

/** Result of {@link ghRepoSlug}: the `owner/repo` slug, or undefined when the
 *  url is not a github remote (the oracle's `return 1`). */
export function ghRepoSlug(originUrl: string | undefined): string | undefined {
  if (originUrl === undefined) return undefined;
  let url = originUrl;
  if (url.startsWith("git@github.com:")) url = url.slice("git@github.com:".length);
  else if (url.startsWith("ssh://git@github.com/")) url = url.slice("ssh://git@github.com/".length);
  else if (url.startsWith("https://github.com/")) url = url.slice("https://github.com/".length);
  else if (url.startsWith("http://github.com/")) url = url.slice("http://github.com/".length);
  else return undefined; // bash `*) return 1`
  if (url.endsWith(".git")) url = url.slice(0, -".git".length);
  if (url === "") return undefined; // bash `[[ -z "$url" ]] && return 1`
  return url;
}

// ─── typed PR wrappers (gh -R <slug> pr …) ────────────────────────────────────

/** A PR's lifecycle state as `gh pr view --json state -q .state` reports it. */
export type GhPrState = "MERGED" | "CLOSED" | "OPEN" | "UNKNOWN" | string;

/**
 * `gh -R <slug> pr view <ref> --json url -q .url` (bin/roll 13529/13569/13669).
 * Returns the trimmed PR url, or "" on any failure (the oracle's `|| pr_url=""`
 * reuse probe — empty means "no open PR, create one").
 */
export async function prViewUrl(slug: string, ref: string): Promise<string> {
  const r = await gh(["-R", slug, "pr", "view", ref, "--json", "url", "-q", ".url"]);
  return r.code === 0 ? r.stdout.trim() : "";
}

/**
 * `gh -R <slug> pr view <ref> --json state -q .state` (bin/roll 13570/13597).
 * Returns the trimmed state, or "UNKNOWN" on failure — mirroring the oracle's
 * `|| echo "UNKNOWN"`.
 */
export async function prViewState(slug: string, ref: string): Promise<GhPrState> {
  const r = await gh(["-R", slug, "pr", "view", ref, "--json", "state", "-q", ".state"]);
  const s = r.stdout.trim();
  return r.code === 0 && s !== "" ? s : "UNKNOWN";
}

/**
 * `gh -R <slug> pr view <ref> --json headRefName -q .headRefName`
 * (bin/roll 12114). Returns the trimmed head branch, or undefined on failure
 * (the oracle treats a failed lookup as `return 0` / skip).
 */
export async function prViewHeadRef(slug: string, ref: string): Promise<string | undefined> {
  const r = await gh(["-R", slug, "pr", "view", ref, "--json", "headRefName", "-q", ".headRefName"]);
  if (r.code !== 0) return undefined;
  const v = r.stdout.trim();
  return v === "" ? undefined : v;
}

/**
 * `gh -R <slug> pr view <ref> --json autoMergeRequest -q .autoMergeRequest`
 * (bin/roll 12151). Returns true iff auto-merge is already armed — mirroring the
 * oracle's `[ -n "$am" ] && [ "$am" != "null" ]` test on the raw output.
 */
export async function prAutoMergeArmed(slug: string, ref: string): Promise<boolean> {
  const r = await gh([
    "-R", slug, "pr", "view", ref, "--json", "autoMergeRequest", "-q", ".autoMergeRequest",
  ]);
  if (r.code !== 0) return false;
  const am = r.stdout.trim();
  return am !== "" && am !== "null";
}

/** Parsed `--json state,mergedAt,mergeCommit` view (bin/roll 13744, backfill). */
export interface PrMergeInfo {
  state: GhPrState;
  mergedAt: string | undefined;
  mergeCommit: string | undefined;
}

/**
 * `gh -R <slug> pr view <ref> --json state,mergedAt,mergeCommit` (bin/roll
 * 13744). Returns undefined on failure (the oracle's `|| view_json=""` skip).
 * `mergeCommit` is GitHub's `{ oid }` object — we surface the oid string.
 */
export async function prViewMergeInfo(slug: string, ref: string): Promise<PrMergeInfo | undefined> {
  const r = await gh(["-R", slug, "pr", "view", ref, "--json", "state,mergedAt,mergeCommit"]);
  if (r.code !== 0 || r.stdout.trim() === "") return undefined;
  try {
    const j = JSON.parse(r.stdout) as {
      state?: string;
      mergedAt?: string | null;
      mergeCommit?: { oid?: string } | null;
    };
    return {
      state: j.state ?? "UNKNOWN",
      mergedAt: j.mergedAt == null ? undefined : j.mergedAt,
      mergeCommit: j.mergeCommit?.oid == null ? undefined : j.mergeCommit.oid,
    };
  } catch {
    return undefined;
  }
}

/** Inputs for {@link prCreate} — mirrors the oracle's create argv. */
export interface PrCreateInput {
  slug: string;
  head: string;
  title: string;
  body: string;
  /** Base branch; the oracle hardcodes `main`. */
  base?: string;
}

/**
 * `gh -R <slug> pr create --base main --head <head> --title <t> --body <b>`
 * (bin/roll 13534/13673). Returns the new PR url (trimmed stdout), or "" on
 * failure — mirroring the oracle's `|| pr_url=""` then the empty-url fatal gate.
 */
export async function prCreate(input: PrCreateInput): Promise<string> {
  const base = input.base ?? "main";
  const r = await gh([
    "-R", input.slug, "pr", "create",
    "--base", base, "--head", input.head,
    "--title", input.title, "--body", input.body,
  ]);
  return r.code === 0 ? r.stdout.trim() : "";
}

/** Merge mode the oracle arms a PR with. */
export type PrMergeMode = "auto" | "admin" | "plain";

/**
 * `gh -R <slug> pr merge <ref> [--auto|--admin] --squash --delete-branch`
 * (bin/roll 13541 auto / 13680 admin / 11587 plain). Returns the {@link GhResult}
 * so callers mirror the oracle's mode-specific fatality:
 *   - auto  (13541): failure NON-fatal (PR left open for a human).
 *   - admin (13680): failure FATAL (return 1, PR left open).
 *   - plain (11587/11963/12015): failure NON-fatal (next tick retries).
 * The wrapper does not decide fatality — it surfaces the code; callers branch.
 */
export async function prMerge(slug: string, ref: string, mode: PrMergeMode): Promise<GhResult> {
  const flags = mode === "auto" ? ["--auto"] : mode === "admin" ? ["--admin"] : [];
  return gh(["-R", slug, "pr", "merge", ref, ...flags, "--squash", "--delete-branch"]);
}

/**
 * `gh -R <slug> pr close <pr> --comment <reason>` (bin/roll 12082). Lenient:
 * the oracle runs it `|| true`, so we surface the code but callers ignore it.
 */
export async function prClose(slug: string, pr: string, reason: string): Promise<GhResult> {
  return gh(["-R", slug, "pr", "close", pr, "--comment", reason]);
}

/**
 * `gh -R <slug> pr diff <pr>` (bin/roll 12099). Returns the trimmed diff, or
 * undefined on failure — the oracle treats a failed diff as "not empty" (never
 * close a PR it couldn't inspect). Callers test emptiness of the defined value.
 */
export async function prDiff(slug: string, pr: string): Promise<string | undefined> {
  const r = await gh(["-R", slug, "pr", "diff", pr]);
  return r.code === 0 ? r.stdout : undefined;
}

/**
 * `gh -R <slug> pr diff <pr> --name-only` (bin/roll 11381). Returns the changed
 * file paths (one per line, blanks dropped), or undefined on failure (the oracle
 * substitutes `(unable to fetch)`; we report undefined and let the caller label).
 */
export async function prDiffNameOnly(slug: string, pr: string): Promise<string[] | undefined> {
  const r = await gh(["-R", slug, "pr", "diff", pr, "--name-only"]);
  if (r.code !== 0) return undefined;
  return r.stdout.split("\n").filter((l) => l !== "");
}

/** A PR review verdict the oracle posts. */
export type PrReviewVerdict = "approve" | "request-changes";

/**
 * `gh -R <slug> pr review <num> --approve|--request-changes -b <body>`
 * (bin/roll 6240/6302/6306). Lenient in the oracle (`|| true`); surfaced here.
 */
export async function prReview(
  slug: string,
  num: string,
  verdict: PrReviewVerdict,
  body: string,
): Promise<GhResult> {
  const flag = verdict === "approve" ? "--approve" : "--request-changes";
  return gh(["-R", slug, "pr", "review", num, flag, "-b", body]);
}

/**
 * `gh -R <slug> pr checks <num>` (bin/roll 11549) — the human-readable checks
 * table the heal path captures. Returns the {@link GhResult} (lenient `|| true`).
 */
export async function prChecks(slug: string, num: string): Promise<GhResult> {
  return gh(["-R", slug, "pr", "checks", num]);
}

/**
 * `gh -R <slug> pr checks <num> --json link --jq
 *  '.[]|select(.state=="FAILURE")|.link'` (bin/roll 11551). Returns the failing
 * check links (one per line), or [] on failure.
 */
export async function prFailingCheckLinks(slug: string, num: string): Promise<string[]> {
  const r = await gh([
    "-R", slug, "pr", "checks", num,
    "--json", "link", "--jq", '.[]|select(.state=="FAILURE")|.link',
  ]);
  if (r.code !== 0) return [];
  return r.stdout.split("\n").filter((l) => l !== "");
}

// ─── PR list wrappers (gh -R <slug> pr list …) ────────────────────────────────

/** Common gh pr-list JSON row shapes the oracle selects field subsets of. */
export interface PrListRow {
  number?: number;
  title?: string;
  headRefName?: string;
  isDraft?: boolean;
  mergeable?: string;
  mergeStateStatus?: string;
  autoMergeRequest?: unknown;
}

/**
 * `gh -R <slug> pr list --state open --json <fields> [--head <b>] [--base <b>]`
 * — the generic list executor. Returns the parsed rows, or [] on failure
 * (every oracle list site gates on emptiness / `|| echo "1"` fallbacks).
 *
 * @param fields  the exact `--json` field set (e.g. "number,headRefName,…").
 */
export async function prList(
  slug: string,
  fields: string,
  opts: { head?: string; base?: string } = {},
): Promise<PrListRow[]> {
  const args = ["-R", slug, "pr", "list", "--state", "open"];
  if (opts.head !== undefined) args.push("--head", opts.head);
  if (opts.base !== undefined) args.push("--base", opts.base);
  args.push("--json", fields);
  const r = await gh(args);
  if (r.code !== 0 || r.stdout.trim() === "") return [];
  try {
    const j = JSON.parse(r.stdout) as PrListRow[];
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

/**
 * `gh -R <slug> pr list --state open --json headRefName --jq
 *  '.[] | select(.headRefName | startswith("loop/")) | .headRefName'`
 * (bin/roll 12543). Returns the open `loop/*` branch names (blanks dropped).
 */
export async function prListLoopBranches(slug: string): Promise<string[]> {
  const r = await gh([
    "-R", slug, "pr", "list", "--state", "open",
    "--json", "headRefName",
    "--jq", '.[] | select(.headRefName | startswith("loop/")) | .headRefName',
  ]);
  if (r.code !== 0) return [];
  return r.stdout.split("\n").filter((l) => l !== "");
}

/**
 * `gh -R <slug> pr list --state open --json title --jq '.[].title'`
 * (bin/roll 13139). Returns the open PR titles (blanks dropped), [] on failure.
 */
export async function prListOpenTitles(slug: string): Promise<string[]> {
  const r = await gh([
    "-R", slug, "pr", "list", "--state", "open", "--json", "title", "--jq", ".[].title",
  ]);
  if (r.code !== 0) return [];
  return r.stdout.split("\n").filter((l) => l !== "");
}

// ─── gh run (CI) wrappers ─────────────────────────────────────────────────────

/** A `gh run list` row (the union of the field sets the oracle selects). */
export interface RunRow {
  databaseId?: number;
  status?: string;
  conclusion?: string | null;
  name?: string;
  headBranch?: string;
}

/**
 * `gh -R <slug> run list [--commit <c>|--branch <b>] --json <fields> [-L <n>]`
 * (bin/roll 11024/11238/11326/11349/11386/14410). Returns the parsed rows, or
 * [] on failure (every oracle CI probe treats a failed/empty list as "no runs").
 *
 * @param fields  the exact `--json` field set the call site uses.
 */
export async function runList(
  slug: string,
  fields: string,
  opts: { commit?: string; branch?: string; limit?: number } = {},
): Promise<RunRow[]> {
  const args = ["-R", slug, "run", "list"];
  if (opts.commit !== undefined) args.push("--commit", opts.commit);
  if (opts.branch !== undefined) args.push("--branch", opts.branch);
  args.push("--json", fields);
  if (opts.limit !== undefined) args.push("-L", String(opts.limit));
  const r = await gh(args);
  if (r.code !== 0 || r.stdout.trim() === "") return [];
  try {
    const j = JSON.parse(r.stdout) as RunRow[];
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

/**
 * `gh -R <slug> run view [--log-failed] <id>` (bin/roll 11330/11355/11396/11555).
 * Returns the {@link GhResult}; the oracle pipes stdout through head/tail and is
 * lenient (`|| true`), so we surface streams + code without trimming.
 */
export async function runViewLogFailed(slug: string, runId: string): Promise<GhResult> {
  return gh(["-R", slug, "run", "view", "--log-failed", runId]);
}

// ─── gh api / issue / repo wrappers ───────────────────────────────────────────

/**
 * `gh -R <slug> api repos/<slug>/contents/<path>?ref=<branch>
 *  -H "Accept: application/vnd.github.raw"` (bin/roll 12553). Fetches a file's
 * RAW content at a branch. Returns the content string, or undefined on failure
 * (the oracle `continue`s past a failed/empty fetch).
 */
export async function apiContentsRaw(
  slug: string,
  path: string,
  ref: string,
): Promise<string | undefined> {
  const r = await gh([
    "-R", slug, "api",
    `repos/${slug}/contents/${path}?ref=${ref}`,
    "-H", "Accept: application/vnd.github.raw",
  ]);
  if (r.code !== 0 || r.stdout === "") return undefined;
  return r.stdout;
}

/** Inputs for {@link issueCreate} — mirrors `gh issue create` argv. */
export interface IssueCreateInput {
  repo: string;
  title: string;
  body: string;
  labels: string;
}

/**
 * `gh issue create --repo <r> --title <t> --body <b> --label <l>`
 * (bin/roll 14334). NOTE the oracle uses `--repo` (long form), NOT `-R`, for
 * this call — mirrored exactly. Returns the {@link GhResult} (stdout is the new
 * issue url).
 */
export async function issueCreate(input: IssueCreateInput): Promise<GhResult> {
  return gh([
    "issue", "create",
    "--repo", input.repo,
    "--title", input.title,
    "--body", input.body,
    "--label", input.labels,
  ]);
}

/**
 * `gh repo view --json owner,name --jq '.owner.login + "/" + .name'`
 * (bin/roll 1841). Returns the trimmed `owner/repo`, or undefined on failure.
 * Used by the branch-protection inspector; distinct from {@link ghRepoSlug}
 * (which derives the slug from the git remote, gh's auto-detection bypassed).
 */
export async function repoViewSlug(): Promise<string | undefined> {
  const r = await gh(["repo", "view", "--json", "owner,name", "--jq", '.owner.login + "/" + .name']);
  if (r.code !== 0) return undefined;
  const v = r.stdout.trim();
  return v === "" ? undefined : v;
}

/**
 * `gh api repos/<slug>/branches/main/protection [--jq <filter>]` (bin/roll 1845).
 * Returns the {@link GhResult}; callers apply the jq filter the oracle uses to
 * read required-check names. Lenient probe (the oracle `2>/dev/null`s it).
 */
export async function apiBranchProtection(slug: string, jq?: string): Promise<GhResult> {
  const args = ["api", `repos/${slug}/branches/main/protection`];
  if (jq !== undefined) args.push("--jq", jq);
  return gh(args);
}

// ─── publish-plan executor (composes with core/delivery/pr.ts) ────────────────

/**
 * A single publish step as core's `planPublishPr` / `planPublishDocPr` emit it
 * (structurally compatible with @roll/core's `PublishStep`). We re-declare the
 * shape here so infra need not depend on core (core already depends on no infra;
 * keeping the arrow one-directional). `tool` is "git" or "gh".
 */
export interface PublishStepLike {
  kind: string;
  tool: "git" | "gh";
  argv: string[];
}

/** Outcome of {@link runPublishPlan}. */
export interface RunPublishResult {
  /** The PR url the plan resolved (from reuse `view` or fresh `create`). "" on
   *  failure to obtain one. */
  prUrl: string;
  /** True iff the publish succeeded enough to hand the PR to the merge path
   *  (push ok AND a PR url exists). Mirrors the oracle's `return 0` gate. */
  ok: boolean;
  /** Exit-class for the caller's tier ladder: 0 ok / 1 push|create fail /
   *  2 gh-missing. Mirrors `_loop_publish_pr`'s documented exit codes. */
  status: 0 | 1 | 2;
}

/**
 * Execute a publish PLAN built by core (`planPublishPr` / `planPublishDocPr`),
 * mirroring `_loop_publish_pr` (bin/roll 13516-13548) / `_loop_publish_doc_pr`
 * (13657-13687) control flow — the EXECUTOR side of the plan/execute split:
 *   0. gh missing → status 2 (the oracle's gh-unavailable fallback trigger).
 *   1. run the `git-push` step → non-zero exit ⇒ status 1.
 *   2. run the `gh-pr-view` step → non-empty url ⇒ REUSE (skip create).
 *   3. else run `gh-pr-create` → empty url ⇒ status 1.
 *   4. run the merge step (`gh-pr-merge-auto|admin`):
 *        - auto  : failure NON-fatal (status stays 0).
 *        - admin : failure FATAL → status 1 (oracle returns 1, PR left open).
 *
 * `git` steps run through the injected {@link RunStep} (so callers reuse the
 * git.ts runner); `gh` steps run through {@link gh}. Keeping the runner injected
 * keeps this unit-testable with a fake recording both tools' argv.
 */
export type RunStep = (tool: "git" | "gh", argv: readonly string[]) => Promise<GhResult>;

/** Default {@link RunStep}: git → execFile git, gh → {@link gh}. */
export const defaultRunStep: RunStep = async (tool, argv) => {
  if (tool === "gh") return gh(argv);
  try {
    const { stdout, stderr } = await execFileAsync("git", [...argv], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    if (typeof err.code === "number") {
      return { code: err.code, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
    }
    return { code: 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
};

export async function runPublishPlan(
  plan: readonly PublishStepLike[],
  opts: { ghAvailable?: () => Promise<boolean>; run?: RunStep } = {},
): Promise<RunPublishResult> {
  const isAvailable = opts.ghAvailable ?? ghAvailable;
  const run = opts.run ?? defaultRunStep;

  if (!(await isAvailable())) {
    return { prUrl: "", ok: false, status: 2 }; // gh missing → fallback trigger
  }

  const push = plan.find((s) => s.kind === "git-push");
  const view = plan.find((s) => s.kind === "gh-pr-view");
  const create = plan.find((s) => s.kind === "gh-pr-create");
  const merge = plan.find((s) => s.kind === "gh-pr-merge-auto" || s.kind === "gh-pr-merge-admin");

  if (push !== undefined) {
    const r = await run(push.tool, push.argv);
    if (r.code !== 0) return { prUrl: "", ok: false, status: 1 };
  }

  let prUrl = "";
  if (view !== undefined) {
    const r = await run(view.tool, view.argv);
    if (r.code === 0) prUrl = r.stdout.trim();
  }
  if (prUrl === "" && create !== undefined) {
    const r = await run(create.tool, create.argv);
    prUrl = r.code === 0 ? r.stdout.trim() : "";
    if (prUrl === "") return { prUrl: "", ok: false, status: 1 };
  }

  if (merge !== undefined) {
    const r = await run(merge.tool, merge.argv);
    // admin-merge failure is fatal (doc-pr); auto-merge failure is not.
    if (merge.kind === "gh-pr-merge-admin" && r.code !== 0) {
      return { prUrl, ok: false, status: 1 };
    }
  }

  return { prUrl, ok: prUrl !== "", status: 0 };
}
