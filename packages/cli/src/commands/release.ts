/**
 * US-REL-007 — `roll release`: the ONLY release command.
 *
 * The default flow owns the whole release transaction, in order, every
 * irreversible step behind an earlier gate:
 *
 *   plan → fold-changelog → bump-version → package-gate → commit-push →
 *   open-pr → wait-merge → sync-main → consistency-gate → tag-push
 *
 * The old sub-surfaces (`ship`, `waiver`, `changelog`, `consistency`) are
 * GONE — not hidden, not redirected: they exit through the normal
 * unknown-route error. There is no public waiver path: shipping over a known
 * fail-level drift is blocked; fix the drift.
 *
 * It stops at the tag push (release.yml runs the remote gate + GitHub
 * Release); `npm publish` stays the owner's separate, 2FA-authenticated step.
 *
 * Machine entries (CI, not advertised):
 *   --gate-check   run the consistency gate only (release.yml's job)
 *   --json         print the computed plan as JSON
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { foldUnreleased, planRelease, type ReleaseDate, type ReleaseStep } from "@roll/core";
import { type Lang, resolveLang, t, v2Catalog, v3Catalog } from "@roll/spec";
import { c, renderState } from "../render.js";
import { runConsistencyCheck } from "../lib/release-consistency.js";
import { readConfirmLine } from "../lib/tty-confirm.js";

function label(lang: Lang, key: string, ...args: ReadonlyArray<string | number>): string {
  if (v3Catalog[key] !== undefined) return t(v3Catalog, lang, key, ...args);
  return t(v2Catalog, lang, key, ...args);
}

const REMOVED_ROUTES = new Set(["ship", "waiver", "changelog", "consistency", "tag", "publish"]);

/** Injectable seams — the transaction is unit-tested without git/gh/npm. */
export interface ReleaseFlowDeps {
  version: (cwd: string) => string;
  branch: (cwd: string) => string;
  clean: (cwd: string) => boolean;
  synced: (cwd: string) => boolean;
  tagExists: (cwd: string, tag: string) => boolean;
  readChangelog: (cwd: string) => string;
  writeChangelog: (cwd: string, text: string) => void;
  bumpVersion: (cwd: string, version: string) => void;
  packageGate: (cwd: string) => boolean;
  commitPush: (cwd: string, branch: string, message: string) => void;
  openPr: (cwd: string, branch: string, title: string) => string;
  /** Polls until the PR is merged (the PR lane usually merges it); false on timeout. */
  waitMerged: (cwd: string, prRef: string) => boolean;
  syncMain: (cwd: string) => boolean;
  consistencyGate: (cwd: string) => Promise<boolean> | boolean;
  tag: (cwd: string, tag: string, version: string) => void;
  pushTag: (cwd: string, tag: string) => void;
  confirm: (tag: string) => boolean;
  now: () => Date;
  /** Step progress sink (stdout in production; recorded in tests). */
  onStep?: (step: ReleaseStep, detail: string) => void;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}


// FIX-277: repos with a test-proof commit gate (roll itself) reject a commit
// whose proof is stale. In a roll-managed repo the proof is refreshed up front
// — no error-message sniffing. Any failure rolls the release branch back so an
// orderly abort leaves no stray branch behind.
export function commitPushWithGate(opts: {
  branch: string;
  message: string;
  rollManaged: boolean;
  exec: (cmd: string, args: string[]) => string;
}): void {
  const { branch, message, rollManaged, exec } = opts;
  const original = exec("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  exec("git", ["checkout", "-b", branch]);
  try {
    exec("git", ["add", "package.json", "CHANGELOG.md"]);
    if (rollManaged) exec("roll", ["test"]);
    exec("git", ["commit", "-m", message]);
    exec("git", ["push", "-u", "origin", branch]);
  } catch (e) {
    try {
      exec("git", ["checkout", original]);
      exec("git", ["branch", "-D", branch]);
    } catch {
      // best-effort rollback; the original failure is the one worth reporting
    }
    throw e;
  }
}

export function realReleaseDeps(): ReleaseFlowDeps {
  return {
    version: (cwd) => {
      try {
        const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { version?: unknown };
        return typeof pkg.version === "string" ? pkg.version : "";
      } catch {
        return "";
      }
    },
    branch: (cwd) => {
      try {
        return git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
      } catch {
        return "";
      }
    },
    clean: (cwd) => {
      try {
        return git(cwd, ["status", "--porcelain"]) === "";
      } catch {
        return false;
      }
    },
    synced: (cwd) => {
      try {
        git(cwd, ["fetch", "origin", "main"]);
        return git(cwd, ["rev-list", "--count", "HEAD..origin/main"]) === "0";
      } catch {
        return false;
      }
    },
    tagExists: (cwd, tagName) => {
      try {
        return git(cwd, ["tag", "-l", tagName]) !== "";
      } catch {
        return true; // unknowable → treat as a collision, never overwrite
      }
    },
    readChangelog: (cwd) => readFileSync(join(cwd, "CHANGELOG.md"), "utf8"),
    writeChangelog: (cwd, text) => writeFileSync(join(cwd, "CHANGELOG.md"), text, "utf8"),
    bumpVersion: (cwd, version) => {
      const path = join(cwd, "package.json");
      const pkg = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      pkg["version"] = version;
      writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    },
    packageGate: (cwd) => {
      try {
        execFileSync("npm", ["pack", "--dry-run"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
        return true;
      } catch {
        return false;
      }
    },
    commitPush: (cwd, branch, message) => {
      commitPushWithGate({
        branch,
        message,
        rollManaged: existsSync(join(cwd, ".roll")),
        exec: (cmd, args) =>
          execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600_000 }),
      });
    },
    openPr: (cwd, branch, title) => {
      const out = execFileSync(
        "gh",
        ["pr", "create", "--title", title, "--body", "Release PR — generated by `roll release` (US-REL-007).", "--head", branch],
        { cwd, encoding: "utf8" },
      ).trim();
      return out.split("\n").at(-1) ?? branch;
    },
    waitMerged: (cwd, prRef) => {
      const deadline = Date.now() + 20 * 60_000;
      while (Date.now() < deadline) {
        try {
          const state = execFileSync("gh", ["pr", "view", prRef, "--json", "state", "--jq", ".state"], { cwd, encoding: "utf8" }).trim();
          if (state === "MERGED") return true;
          if (state === "CLOSED") return false;
        } catch {
          /* transient gh error — keep polling */
        }
        execFileSync("sleep", ["20"]);
      }
      return false;
    },
    syncMain: (cwd) => {
      try {
        git(cwd, ["checkout", "main"]);
        git(cwd, ["pull", "--ff-only", "origin", "main"]);
        return true;
      } catch {
        return false;
      }
    },
    consistencyGate: async () => {
      const code = await runConsistencyCheck(["check"], "roll release");
      return code === 0;
    },
    tag: (cwd, tagName, version) => {
      git(cwd, ["tag", "-a", tagName, "-m", `release v${version}`]);
    },
    pushTag: (cwd, tagName) => {
      git(cwd, ["push", "origin", tagName]);
    },
    confirm: (tagName) => {
      process.stdout.write(`release ${tagName}? [y/N] `);
      const line = readConfirmLine();
      return line !== null && /^y(es)?$/i.test(line.trim());
    },
    now: () => new Date(),
  };
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface ReleaseRunResult {
  status: "released" | "aborted" | "dry-run";
  step?: ReleaseStep;
  reason?: string;
  tag?: string;
}

/**
 * The transaction. Fail-loud and partial-release-free: every abort happens
 * BEFORE the next irreversible step; nothing is tagged unless every gate
 * passed and the release PR is on main.
 */
export async function runReleaseFlow(cwd: string, deps: ReleaseFlowDeps, opts: { dryRun: boolean; yes: boolean }): Promise<ReleaseRunResult> {
  const step = (s: ReleaseStep, detail: string): void => deps.onStep?.(s, detail);
  const abort = (s: ReleaseStep, reason: string): ReleaseRunResult => ({ status: "aborted", step: s, reason });
  let current_step: ReleaseStep = "plan";
  try {
    return await runReleaseFlowInner(cwd, deps, opts, (s) => {
      current_step = s;
      return s;
    });
  } catch (e) {
    // FIX-277: a throwing dependency (hook-blocked commit, network failure…)
    // is an ORDERLY abort at the step it bit — never a raw stack mid-release.
    const msg = e instanceof Error ? e.message.split("\n").find((l) => l.trim() !== "") ?? "unknown failure" : String(e);
    return abort(current_step, `step dependency failed: ${msg.trim()}`);
  }
}

async function runReleaseFlowInner(
  cwd: string,
  deps: ReleaseFlowDeps,
  opts: { dryRun: boolean; yes: boolean },
  mark: (s: ReleaseStep) => ReleaseStep,
): Promise<ReleaseRunResult> {
  const step = (s: ReleaseStep, detail: string): void => deps.onStep?.(mark(s), detail);
  const abort = (s: ReleaseStep, reason: string): ReleaseRunResult => ({ status: "aborted", step: s, reason });

  // plan
  const current = deps.version(cwd);
  if (current === "") return abort("plan", "package.json version unreadable");
  if (deps.branch(cwd) !== "main") return abort("plan", "not on main");
  if (!deps.clean(cwd)) return abort("plan", "working tree dirty");
  if (!deps.synced(cwd)) return abort("plan", "main is behind origin — pull first");
  const d = deps.now();
  const date: ReleaseDate = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  const plan = planRelease({ currentVersion: current, date, changelogReady: true });
  if (deps.tagExists(cwd, plan.tag)) return abort("plan", `tag ${plan.tag} already exists`);
  step("plan", `${current} → ${plan.nextVersion} (${plan.tag})`);

  // fold-changelog (computed before any mutation)
  let changelog: string;
  try {
    changelog = deps.readChangelog(cwd);
  } catch {
    return abort("fold-changelog", "CHANGELOG.md unreadable");
  }
  const folded = foldUnreleased(changelog, plan.nextVersion, fmtDate(d));
  if (folded === null) return abort("fold-changelog", "Unreleased is empty — nothing to release");
  step("fold-changelog", `${folded.notes.split("\n").filter((l) => l.trim().startsWith("-")).length} entries`);

  if (opts.dryRun) return { status: "dry-run", tag: plan.tag };
  if (!opts.yes && !deps.confirm(plan.tag)) return abort("plan", "not confirmed");

  // mutations begin — still nothing irreversible until tag-push
  deps.writeChangelog(cwd, folded.text);
  deps.bumpVersion(cwd, plan.nextVersion);
  step("bump-version", plan.nextVersion);

  if (!deps.packageGate(cwd)) return abort("package-gate", "npm pack --dry-run failed");
  step("package-gate", "pack dry-run clean");

  const branch = `release/${plan.tag}`;
  mark("commit-push");
  deps.commitPush(cwd, branch, `Release: ${plan.tag}`);
  step("commit-push", branch);

  mark("open-pr");
  const prRef = deps.openPr(cwd, branch, `Release: ${plan.tag}`);
  step("open-pr", prRef);

  mark("wait-merge");
  if (!deps.waitMerged(cwd, prRef)) return abort("wait-merge", "release PR not merged (checks failed or timeout)");
  step("wait-merge", "merged");

  mark("sync-main");
  if (!deps.syncMain(cwd)) return abort("sync-main", "fast-forward to origin/main failed");
  step("sync-main", "main up to date");

  mark("consistency-gate");
  if (!(await deps.consistencyGate(cwd))) return abort("consistency-gate", "a consistency dimension is failing — fix the drift (no waiver path)");
  step("consistency-gate", "all dimensions pass");

  if (deps.tagExists(cwd, plan.tag)) return abort("tag-push", `tag ${plan.tag} appeared concurrently`);
  mark("tag-push");
  deps.tag(cwd, plan.tag, plan.nextVersion);
  deps.pushTag(cwd, plan.tag);
  step("tag-push", plan.tag);
  return { status: "released", tag: plan.tag };
}

export async function releaseCommand(args: string[], depsOverride?: ReleaseFlowDeps): Promise<number> {
  const noColor = args.includes("--no-color") || !process.stdout.isTTY || (process.env["NO_COLOR"] ?? "") !== "";
  renderState.useColor = !noColor;
  const lang = resolveLang({ rollLang: process.env["ROLL_LANG"], lcAll: process.env["LC_ALL"], lang: process.env["LANG"] });

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${label(lang, "releasev3.usage")}\n`);
    return 0;
  }

  // US-REL-007 AC2: the retired sub-routes die through the normal unknown-route
  // error — no redirect, no hidden logic.
  const sub = args.find((a) => !a.startsWith("-"));
  if (sub !== undefined && REMOVED_ROUTES.has(sub)) {
    process.stderr.write(
      lang === "zh"
        ? `[roll] roll release ${sub} 已移除——发布面只有一条命令：roll release（见 roll release --help）\n`
        : `[roll] roll release ${sub} was removed — the release surface is one command: roll release (see roll release --help)\n`,
    );
    return 1;
  }
  if (sub !== undefined) {
    process.stderr.write(`[roll] unknown release argument: ${sub}\n`);
    return 1;
  }

  // machine entry for CI (release.yml): gate only, exit code is the verdict.
  if (args.includes("--gate-check")) {
    return await runConsistencyCheck(["check"], "roll release");
  }

  const deps = depsOverride ?? realReleaseDeps();
  const cwd = process.cwd();

  if (args.includes("--json")) {
    const d = deps.now();
    const plan = planRelease({
      currentVersion: deps.version(cwd),
      date: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() },
      changelogReady: true,
    });
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return 0;
  }

  const dryRun = args.includes("--dry-run");
  const yes = args.includes("--yes");
  deps.onStep = (s, detail) => {
    process.stdout.write(`${c("green", "✓")} ${s.padEnd(17)} ${detail}\n`);
  };
  const res = await runReleaseFlow(cwd, deps, { dryRun, yes });
  if (res.status === "released") {
    process.stdout.write(
      lang === "zh"
        ? `\n${c("green", `✓ ${res.tag} 已打 tag 并推送`)} — release.yml 跑远端闸与 GitHub Release；npm publish 仍由你手动执行\n`
        : `\n${c("green", `✓ ${res.tag} tagged and pushed`)} — release.yml runs the remote gate + GitHub Release; npm publish stays yours\n`,
    );
    return 0;
  }
  if (res.status === "dry-run") {
    process.stdout.write(lang === "zh" ? `dry-run 通过：将发 ${res.tag}（未做任何改动）\n` : `dry-run clean: would release ${res.tag} (nothing changed)\n`);
    return 0;
  }
  process.stderr.write(
    lang === "zh"
      ? `${c("red", `✗ 发版在 ${res.step} 中止`)}：${res.reason}\n`
      : `${c("red", `✗ release aborted at ${res.step}`)}: ${res.reason}\n`,
  );
  return 1;
}
