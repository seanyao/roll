/**
 * `roll loop pr-inbox` — US-PORT-001: the TS runtime tick for the dedicated
 * PR loop (`com.roll.pr.<slug>`, 5-min cadence). This is the imperative SHELL
 * that finally drives the long-ported pure decision layer (core/pr-loop.ts):
 * it does the gh fan-out + git side-effects, while every routing decision comes
 * from {@link prInboxGate} / {@link selectPrAction} / {@link rebaseCircuitVerdict}
 * / {@link rebaseRecheckAction}. The v2 bash `_loop_pr_inbox` walk
 * (bin/roll 11968-12062) is retired as the runtime driver — the pr runner now
 * calls THIS (see buildPrRunnerScript).
 *
 * Walk (1:1 with the bash inbox, decisions delegated to pr-loop.ts):
 *   1. gh unavailable / no slug                  → idle `gh_unavailable` tick.
 *   2. `gh pr list --state open --json …` fails  → idle `gh_error`.
 *   3. empty / "[]" / zero-length                → idle `empty_response` /
 *      `no_open_prs` / `zero_prs` (via {@link prInboxGate}).
 *   4. per open PR: `gh pr view --json reviews,mergeStateStatus,statusCheckRollup,body,labels`
 *      → reduce {bot, ciState, mergeable} → {@link selectPrAction}:
 *        merge  → `gh pr merge --squash --delete-branch` (eager / bot-approved).
 *        alert  → bot CHANGES_REQUESTED ALERT row, skip.
 *        heal   → ci_red: hand to the bash heal helper (background agent dispatch;
 *                 its TS executor is a separate card — ci-loop.ts).
 *        rebase → stale: 24h circuit breaker (pure, TS) → bridged git rebase →
 *                 re-check → eager merge iff now clean ({@link rebaseRecheckAction}).
 *        skip   → no-op.
 *   5. terminal `acted` tick.
 *
 * DELIBERATE divergence from the v2 bash (whitelisted, like the US-LOOP-009
 * octal fix): the bash inbox swallowed the rebase-circuit result (`… || true`),
 * so a tripped breaker still rebased — defeating the breaker's whole purpose.
 * The TS tick HONORS the verdict: a tripped breaker writes the ALERT and skips
 * the rebase (the behaviour the breaker was designed for, and the contract the
 * pure {@link rebaseCircuitVerdict} already models).
 *
 * Lenient like the bash: any infra hiccup (gh missing, list error, a single PR
 * view failing) degrades to an idle/skip — never a non-zero exit — so the
 * scheduler keeps ticking.
 */
import {
  type CiRollupState,
  type MergeStateStatus,
  type PrTick,
  prActedTick,
  prIdleTick,
  prInboxGate,
  parseRebaseAttempts,
  rebaseCircuitVerdict,
  rebaseRecheckAction,
  reduceCiRollup,
  renderRebaseAttempts,
  selectPrAction,
} from "@roll/core";
import { gh, ghAvailable, ghRepoSlug, prMerge, remoteUrl } from "@roll/infra";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { prHealSelf, prRebaseStale } from "./loop-pr-heal.js";

// ─── reduced per-PR facts (the bash jq at bin/roll 11996-12007) ──────────────

/** The classifier inputs the walk reduces from one `pr view` payload. */
export interface PrViewFacts {
  bot: string;
  ciState: CiRollupState;
  mergeable: MergeStateStatus;
  manualMerge?: boolean;
}

/** The raw `gh pr view --json reviews,mergeStateStatus,statusCheckRollup,body,labels` shape. */
interface PrViewRaw {
  reviews?: Array<{ authorAssociation?: string; state?: string }>;
  mergeStateStatus?: string;
  statusCheckRollup?: Array<{ conclusion?: string | null }>;
  body?: string;
  labels?: Array<{ name?: string }>;
}

/**
 * Reduce one `pr view` payload to {bot, ciState, mergeable} — mirrors the jq at
 * bin/roll 11996-12007: bot review = last BOT/APP review's state; mergeable =
 * `mergeStateStatus`; ciState = {@link reduceCiRollup} over the rollup.
 */
export function reducePrView(raw: PrViewRaw): PrViewFacts {
  const reviews = raw.reviews ?? [];
  const botReviews = reviews.filter(
    (r) => r.authorAssociation === "BOT" || r.authorAssociation === "APP",
  );
  const lastBot = botReviews.length > 0 ? botReviews[botReviews.length - 1] : undefined;
  const rollup = (raw.statusCheckRollup ?? []).map((c) => c.conclusion ?? null);
  return {
    bot: lastBot?.state ?? "",
    ciState: reduceCiRollup(rollup),
    mergeable: raw.mergeStateStatus ?? "",
    manualMerge:
      (raw.body ?? "").includes("[roll:manual-merge]") ||
      (raw.labels ?? []).some((label) => label.name === "manual-merge" || label.name === "roll:manual-merge"),
  };
}

// ─── injectable deps (tests fake gh/git + fs + clock) ────────────────────────

export interface PrInboxDeps {
  /** `_gh_available` — gh binary on PATH. */
  ghAvailable: () => Promise<boolean>;
  /** `_gh_resolve` — owner/repo slug, or undefined (→ idle gh_unavailable). */
  resolveSlug: () => Promise<string | undefined>;
  /** `gh -R <slug> pr list --state open --json number,headRefName,author,title`. */
  listOpenPrs: (slug: string) => Promise<{ code: number; stdout: string }>;
  /** `gh -R <slug> pr view <num> --json …` → reduced facts, or undefined on failure (skip). */
  viewPr: (slug: string, num: string) => Promise<PrViewFacts | undefined>;
  /** `gh -R <slug> pr merge <num> --squash --delete-branch` → true on success. */
  merge: (slug: string, num: string) => Promise<boolean>;
  /** ci_red → hand to the (bash) heal helper; background, best-effort. */
  heal: (num: string, headRef: string, slug: string) => Promise<void>;
  /** 24h rebase circuit (pure verdict + state persistence + trip ALERT). */
  rebaseCircuitAllowed: (num: string) => boolean;
  /** Bridged git rebase dance → re-checked facts (or undefined on any failure). */
  rebaseStale: (num: string, headRef: string, slug: string) => Promise<PrViewFacts | undefined>;
  /** Append one ALERT line. */
  alert: (line: string) => void;
  /** Append a pr-tick.jsonl row (with rotation). */
  writeTick: (tick: PrTick) => void;
  info: (line: string) => void;
  warn: (line: string) => void;
}

// ─── the walk (decisions from pr-loop.ts; effects via deps) ───────────────────

/**
 * Walk the open PRs and route each — the TS port of `_loop_pr_inbox`. Returns
 * the tick it wrote, so callers (and tests) can assert the terminal outcome.
 */
export async function runPrInbox(deps: PrInboxDeps): Promise<PrTick> {
  if (!(await deps.ghAvailable())) return emit(deps, prIdleTick("gh_unavailable"));
  const slug = await deps.resolveSlug();
  if (slug === undefined || slug === "") return emit(deps, prIdleTick("gh_unavailable"));

  const list = await deps.listOpenPrs(slug);
  const stdout = (list.stdout ?? "").trim();
  let openCount = 0;
  if (list.code === 0 && stdout !== "" && stdout !== "[]") {
    try {
      const arr = JSON.parse(stdout) as unknown;
      openCount = Array.isArray(arr) ? arr.length : 0;
    } catch {
      openCount = 0;
    }
  }
  const gate = prInboxGate({ ghAvailable: true, listOk: list.code === 0, listStdout: stdout, openCount });
  if (gate !== undefined) return emit(deps, gate);

  const prs = JSON.parse(stdout) as Array<{ number?: number; headRefName?: string }>;
  for (const pr of prs) {
    const num = String(pr.number ?? "");
    if (num === "") continue;
    const headRef = pr.headRefName ?? "";

    const facts = await deps.viewPr(slug, num);
    if (facts === undefined) continue; // bash: view failure → i++; continue.

    const action = selectPrAction(facts);
    switch (action.kind) {
      case "merge":
        await doMerge(deps, slug, num);
        break;
      case "alert":
        deps.alert(`PR #${num}: bot review CHANGES_REQUESTED — loop PR rejected by GHA reviewer`);
        break;
      case "heal":
        await deps.heal(num, headRef, slug);
        break;
      case "rebase": {
        if (!deps.rebaseCircuitAllowed(num)) break; // tripped → ALERT written, skip.
        const rechecked = await deps.rebaseStale(num, headRef, slug);
        if (rechecked !== undefined) {
          const re = rebaseRecheckAction(rechecked.ciState, rechecked.mergeable, rechecked.manualMerge === true);
          if (re.kind === "merge") await doMerge(deps, slug, num);
        }
        break;
      }
      case "skip":
        break;
    }
  }
  return emit(deps, prActedTick());
}

function emit(deps: PrInboxDeps, tick: PrTick): PrTick {
  deps.writeTick(tick);
  return tick;
}

async function doMerge(deps: PrInboxDeps, slug: string, num: string): Promise<void> {
  if (await deps.merge(slug, num)) deps.info(`PR #${num}: CI green — merged`);
  else deps.warn(`PR #${num}: merge failed — left open`);
}

// ─── real deps (the production wiring) ────────────────────────────────────────

/** Runtime control-plane dir — `<project>/.roll/loop`, env-overridable (tests). */
function runtimeDir(): string {
  const override = (process.env["ROLL_PROJECT_RUNTIME_DIR"] ?? "").trim();
  if (override !== "") return override;
  return join(process.cwd(), ".roll", "loop");
}

/** `_LOOP_PROJ_SLUG` for ALERT/state filenames — ROLL_MAIN_SLUG override, else basename. */
function projSlug(): string {
  const override = (process.env["ROLL_MAIN_SLUG"] ?? "").trim();
  if (override !== "") return override;
  return process.cwd().split("/").filter(Boolean).pop() ?? "default";
}

function alertPath(): string {
  return join(runtimeDir(), `ALERT-${projSlug()}.md`);
}
function statePath(): string {
  return join(runtimeDir(), `state-${projSlug()}.yaml`);
}
function tickPath(): string {
  return join(runtimeDir(), "pr-tick.jsonl");
}

function pal(): { yellow: string; nc: string } {
  return (process.env["NO_COLOR"] ?? "") !== ""
    ? { yellow: "", nc: "" }
    : { yellow: "\x1b[0;33m", nc: "\x1b[0m" };
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Append a pr-tick row, then rotate to the last 500 lines (bin/roll 8033-8041). */
function writeTickFile(tick: PrTick): void {
  const file = tickPath();
  mkdirSync(dirname(file), { recursive: true });
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  appendFileSync(file, `${JSON.stringify({ ts, ...tick })}\n`);
  try {
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l !== "");
    if (lines.length > 500) writeFileSync(file, `${lines.slice(-500).join("\n")}\n`);
  } catch {
    /* rotation is best-effort */
  }
}

function appendAlert(line: string): void {
  const file = alertPath();
  mkdirSync(dirname(file), { recursive: true });
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  appendFileSync(file, `[${ts}] ${line}\n`);
}

/**
 * The 24h rebase circuit breaker — pure {@link rebaseCircuitVerdict} over the
 * timestamps parsed from the per-slug state file, persisting the pruned list
 * (and, when allowed, the new attempt). On a trip: write the ALERT block
 * (bin/roll 11816-11826) and return false.
 */
function rebaseCircuitAllowed(num: string): boolean {
  const state = statePath();
  let body = "";
  try {
    body = readFileSync(state, "utf8");
  } catch {
    /* no state yet */
  }
  const verdict = rebaseCircuitVerdict(parseRebaseAttempts(body, num), nowSec());
  writeRebaseAttempts(state, num, verdict.freshTimestamps);
  if (!verdict.allowed) {
    const file = alertPath();
    mkdirSync(dirname(file), { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    // bash `cat > "${_LOOP_ALERT}"` (bin/roll 11816) — OVERWRITE, not append.
    writeFileSync(
      file,
      [
        `# ALERT — PR rebase circuit breaker tripped`,
        ``,
        `**Time**: ${stamp}`,
        `**PR**: #${num}`,
        `**Reason**: PR #${num} rebased ${verdict.windowCount}× within 24h with no CI progress`,
        ``,
        `**Action required**:`,
        `- Check PR CI logs and workflow files for breakage`,
        `- Resolve manually, then: \`roll loop now\``,
        ``,
      ].join("\n"),
    );
    return false;
  }
  return true;
}

/**
 * Pure upsert of `pr_state.<pr>.attempts_at = "<value>"` into a loop-state YAML
 * body — mirrors the awk at bin/roll 11838-11871. Returns the new body (always
 * exactly one trailing newline). The single trailing-newline artifact of
 * `split("\n")` is stripped first so repeated upserts never accrete blank lines.
 */
export function upsertRebaseAttempts(stateBody: string, pr: string, value: string): string {
  const prKey = `"${pr}":`;
  const lines = stateBody.replace(/\n$/, "").split("\n").filter((l, i, a) => !(a.length === 1 && l === ""));
  const out: string[] = [];
  let inPr = false;
  let inTarget = false;
  let written = false;
  for (const line of lines) {
    if (/^pr_state:/.test(line)) {
      inPr = true;
      out.push(line);
      continue;
    }
    if (inPr && line.includes(prKey)) {
      inTarget = true;
      out.push(`  ${prKey}`);
      out.push(`    attempts_at: "${value}"`);
      written = true;
      continue;
    }
    if (inTarget && /attempts_at:/.test(line)) continue; // drop old value
    if (inTarget && /^[^\s]/.test(line)) inTarget = false;
    out.push(line);
  }
  if (!inPr) {
    out.push("pr_state:");
    out.push(`  ${prKey}`);
    out.push(`    attempts_at: "${value}"`);
  } else if (!written) {
    out.push(`  ${prKey}`);
    out.push(`    attempts_at: "${value}"`);
  }
  return `${out.join("\n")}\n`;
}

/** Persist `pr_state.<pr>.attempts_at` to the state file (via {@link upsertRebaseAttempts}). */
function writeRebaseAttempts(state: string, pr: string, timestamps: readonly number[]): void {
  mkdirSync(dirname(state), { recursive: true });
  let body = "";
  try {
    body = readFileSync(state, "utf8");
  } catch {
    /* fresh */
  }
  writeFileSync(state, upsertRebaseAttempts(body, pr, renderRebaseAttempts(timestamps)));
}

function realDeps(): PrInboxDeps {
  const { yellow, nc } = pal();
  return {
    ghAvailable: () => ghAvailable(),
    resolveSlug: async () => {
      if (!(await ghAvailable())) return undefined;
      const url = await remoteUrl(process.cwd());
      return ghRepoSlug(url);
    },
    listOpenPrs: async (slug) => {
      const r = await gh([
        "-R", slug, "pr", "list", "--state", "open",
        "--json", "number,headRefName,author,title",
      ]);
      return { code: r.code, stdout: r.stdout };
    },
    viewPr: async (slug, num) => {
      const r = await gh([
        "-R", slug, "pr", "view", num,
        "--json", "reviews,mergeStateStatus,statusCheckRollup,body,labels",
      ]);
      if (r.code !== 0 || r.stdout.trim() === "") return undefined;
      try {
        return reducePrView(JSON.parse(r.stdout) as PrViewRaw);
      } catch {
        return undefined;
      }
    },
    merge: async (slug, num) => (await prMerge(slug, num, "plain")).code === 0,
    heal: async (num, headRef, slug) => {
      // US-PORT-021: native TS gate; dispatches the heal detached, never blocks.
      prHealSelf(num, headRef, slug);
    },
    rebaseCircuitAllowed,
    rebaseStale: async (num, headRef, slug) => {
      prRebaseStale(num, headRef); // US-PORT-021: native TS rebase (was bridged bash)
      // Re-fetch the PR state after the rebase to decide an eager merge.
      const r = await gh(["-R", slug, "pr", "view", num, "--json", "mergeStateStatus,statusCheckRollup,body,labels"]);
      if (r.code !== 0 || r.stdout.trim() === "") return undefined;
      try {
        return reducePrView(JSON.parse(r.stdout) as PrViewRaw);
      } catch {
        return undefined;
      }
    },
    alert: appendAlert,
    writeTick: writeTickFile,
    info: (line) => process.stdout.write(`${yellow}[roll]${nc} ${line}\n`),
    warn: (line) => process.stdout.write(`${yellow}[roll]${nc} ${line}\n`),
  };
}

/**
 * `roll loop pr-inbox` — drive one PR-loop tick. Lenient: always exits 0 so the
 * scheduler keeps ticking (the bash inbox's `return 0` posture).
 */
export async function loopPrInboxCommand(_args: string[], deps: PrInboxDeps = realDeps()): Promise<number> {
  try {
    await runPrInbox(deps);
  } catch {
    /* lenient: any unexpected error degrades to a silent idle tick already
       written by runPrInbox's gates, or none — never break the scheduler. */
  }
  return 0;
}
