/**
 * PR-loop heal + rebase (US-PORT-021) — the last bin/roll runtime dependency in
 * the PR loop, ported off the bash engine.
 *
 *   prHealSelf      — the gate (reuses core prHealVerdict/healLockVerdict): lock
 *                     liveness + heal budget → ALERT / skip / dispatch. On
 *                     dispatch it persists the per-PR heal counter, takes the
 *                     lock, and launches the heal DETACHED via the hidden
 *                     `loop pr-heal-run` subcommand so the PR tick never blocks.
 *   runPrHeal       — the heal action (mirrors `_loop_pr_do_heal`): gather the
 *                     failing-CI context, check the PR branch out in a throwaway
 *                     worktree, hand the fix to the project agent, push back.
 *   prRebaseStale   — the rebase dance (mirrors `_loop_pr_rebase_stale`): refuse
 *                     forks, reset to origin, rebase onto main, force-with-lease,
 *                     ALERT on conflict / push failure.
 *
 * git/gh/fs/spawn are injectable so the gate + rebase decisions are unit-testable
 * without the real toolchain (the agent spawn itself is the one untested seam,
 * same posture as `slides new`).
 */
import {
  type HealLockState,
  ciRedAlertDedupKey,
  ciRedAlertLine,
  healLockVerdict,
  prHealVerdict,
  resolveHealMax,
} from "@roll/core";
import { ghRepoSlug } from "@roll/infra";
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { projectAgent } from "./agent-list.js";
import { stateGet, stateUpsert } from "./loop-cycle-gates.js";
import { healDir } from "./loop-maint.js";
import { slidesTextArgv } from "./slides/index.js";

// ─── per-project paths (mirror loop-pr-inbox: rt = <cwd>/.roll/loop) ──────────
function runtimeDir(): string {
  const o = (process.env["ROLL_PROJECT_RUNTIME_DIR"] ?? "").trim();
  return o !== "" ? o : join(process.cwd(), ".roll", "loop");
}
function projSlug(): string {
  const o = (process.env["ROLL_MAIN_SLUG"] ?? "").trim();
  return o !== "" ? o : (process.cwd().split("/").filter(Boolean).pop() ?? "default");
}
function statePath(): string {
  return join(runtimeDir(), `state-${projSlug()}.yaml`);
}
function alertPath(): string {
  return join(runtimeDir(), `ALERT-${projSlug()}.md`);
}
function lockPath(num: string): string {
  return join(healDir(), `pr-${num}.lock`);
}
function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ─── gate: prHealSelf ─────────────────────────────────────────────────────────

export interface HealDeps {
  healMax: () => number;
  prHealCount: (num: string) => number;
  setPrHealCount: (num: string, n: number) => void;
  lock: (num: string) => HealLockState;
  reclaimLock: (num: string) => void;
  writeLock: (num: string) => void;
  alertHasKey: (key: string) => boolean;
  appendAlert: (line: string) => void;
  now: () => string;
  /** Launch the heal action (default: detached `loop pr-heal-run`). */
  dispatchHeal: (num: string, headRef: string, slug: string) => void;
}

function realHealDeps(): HealDeps {
  const readState = (): string => {
    try {
      return readFileSync(statePath(), "utf8");
    } catch {
      return "";
    }
  };
  return {
    healMax: () => resolveHealMax(process.env["ROLL_LOOP_NO_HEAL"], process.env["ROLL_LOOP_HEAL_MAX"]),
    prHealCount: (num) => parseInt(stateGet(readState(), `heal_count.pr:${num}`) || "0", 10) || 0,
    setPrHealCount: (num, n) => {
      mkdirSync(dirname(statePath()), { recursive: true });
      writeFileSync(statePath(), stateUpsert(readState(), `heal_count.pr:${num}`, n));
    },
    lock: (num) => {
      const p = lockPath(num);
      if (!existsSync(p)) return { lockPresent: false, lockPidAlive: undefined };
      let alive: boolean | undefined;
      try {
        const pid = parseInt(readFileSync(p, "utf8").trim(), 10);
        alive = Number.isFinite(pid) ? ((): boolean => {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        })() : undefined;
      } catch {
        alive = undefined;
      }
      return { lockPresent: true, lockPidAlive: alive };
    },
    reclaimLock: (num) => rmSync(lockPath(num), { force: true }),
    writeLock: (num) => {
      mkdirSync(healDir(), { recursive: true });
      writeFileSync(lockPath(num), String(process.pid));
    },
    alertHasKey: (key) => {
      try {
        return readFileSync(alertPath(), "utf8").includes(key);
      } catch {
        return false;
      }
    },
    appendAlert: (line) => {
      mkdirSync(dirname(alertPath()), { recursive: true });
      appendFileSync(alertPath(), line + "\n");
    },
    now: nowIso,
    dispatchHeal: (num, headRef, slug) => {
      // Detached so the PR tick returns immediately (bash `( … ) & disown`).
      const bin = (process.env["ROLL_BIN"] ?? "").trim() || "roll";
      try {
        const child = spawn(bin, ["loop", "pr-heal-run", num, headRef, slug], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
      } catch {
        /* best-effort */
      }
    },
  };
}

/**
 * The red-PR heal gate (mirrors `_loop_pr_heal_self`). Reuses the pure core
 * verdict; performs the lock/counter/ALERT side effects and dispatches the
 * detached heal. Always returns (never blocks on the heal itself).
 */
export function prHealSelf(num: string, headRef: string, slug: string, deps: HealDeps = realHealDeps()): void {
  if (num === "") return;
  const lv = healLockVerdict(deps.lock(num));
  if (lv.kind === "reclaim") deps.reclaimLock(num);
  const verdict = prHealVerdict({
    pr: num,
    headRef,
    healMax: deps.healMax(),
    prHealCount: deps.prHealCount(num),
    lock: lv,
  });
  if (verdict.kind === "in_flight") return;
  if (verdict.kind === "alert") {
    const key = ciRedAlertDedupKey(num);
    if (!deps.alertHasKey(key)) deps.appendAlert(ciRedAlertLine(deps.now(), num, headRef, verdict.message));
    return;
  }
  // dispatch
  deps.setPrHealCount(num, verdict.nextCount);
  deps.writeLock(num);
  deps.dispatchHeal(num, headRef, slug);
}

// ─── heal action: runPrHeal (the detached worker) ─────────────────────────────

function git(args: string[], cwd?: string): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
function gh(args: string[]): string {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

/**
 * Run the actual heal (mirrors `_loop_pr_do_heal`): capture failing-CI context
 * to /tmp, check the PR branch out in a throwaway worktree, hand the minimal-fix
 * prompt to the project agent, and push back to the same branch if it produced
 * commits. Best-effort; cleans up its worktree. Returns the exit code.
 */
export function runPrHeal(num: string, headRef: string, slug: string): number {
  if (num === "" || headRef === "") return 1;
  const repo = slug || ghRepoSlug(git(["remote", "get-url", "origin"]) || undefined) || "";
  if (repo === "") return 1;

  const ctx = join(tmpdir(), `roll-heal-pr-${num}.log`);
  let ctxBody = `=== CI heal context: PR #${num} (${headRef}) ===\n\n${gh(["-R", repo, "pr", "checks", num])}`;
  const linkJson = gh(["-R", repo, "pr", "checks", num, "--json", "link", "--jq", '.[]|select(.state=="FAILURE")|.link']);
  const runId = (/runs\/(\d+)/.exec(linkJson) ?? [])[1];
  if (runId) ctxBody += `\n\n--- failing run log (tail) ---\n${gh(["-R", repo, "run", "view", runId, "--log-failed"]).split("\n").slice(-200).join("\n")}`;
  writeFileSync(ctx, ctxBody);

  const tmpRoot = mkdtempSync(join(tmpdir(), "roll-heal-"));
  const wt = join(tmpRoot, `pr-${num}`);
  try {
    execFileSync("git", ["fetch", "origin", headRef], { stdio: "ignore" });
    execFileSync("git", ["worktree", "add", wt, `origin/${headRef}`], { stdio: "ignore" });
  } catch {
    rmSync(tmpRoot, { recursive: true, force: true });
    return 1;
  }

  const agent = projectAgent() || "claude";
  const prompt =
    `[roll PR 自愈] PR #${num} (${headRef}) 的 CI 红了。失败上下文见 ${ctx}。` +
    `请只修使 CI 转绿所需的最小改动,保持 TCR 微提交节奏,改完直接 commit。不要改无关代码,不要反问。`;
  const argv = slidesTextArgv(agent, prompt);
  if (argv !== null) {
    try {
      execFileSync(argv.bin, argv.args, { cwd: wt, stdio: "ignore" });
    } catch {
      /* agent best-effort */
    }
  }
  // Push back to the same PR branch if the agent produced commits.
  if (git(["rev-list", `origin/${headRef}..HEAD`], wt) !== "") {
    try {
      execFileSync("git", ["push", "origin", `HEAD:${headRef}`], { cwd: wt, stdio: "ignore" });
    } catch {
      /* best-effort */
    }
  }
  try {
    execFileSync("git", ["worktree", "remove", "--force", wt], { stdio: "ignore" });
  } catch {
    /* best-effort */
  }
  rmSync(tmpRoot, { recursive: true, force: true });
  return 0;
}

// ─── rebase: prRebaseStale ────────────────────────────────────────────────────

export interface RebaseDeps {
  isFork: (num: string) => boolean;
  fetch: (headRef: string) => void;
  /** git checkout -B <headRef> origin/<headRef>; false on failure (abort all). */
  resetToRemote: (headRef: string) => boolean;
  currentBranch: () => string;
  /** git rebase origin/main; false on conflict (caller aborts). */
  rebaseOntoMain: (headRef: string) => boolean;
  /** git push --force-with-lease origin <headRef>; false on failure. */
  forcePush: (headRef: string) => boolean;
  rebaseAbort: () => void;
  restore: (branch: string) => void;
  appendAlert: (line: string) => void;
  now: () => string;
}

function realRebaseDeps(): RebaseDeps {
  return {
    isFork: (num) => {
      const repo = ghRepoSlug(git(["remote", "get-url", "origin"]) || undefined) || "";
      const json = repo ? gh(["-R", repo, "pr", "view", num, "--json", "isCrossRepository"]) : "";
      try {
        return (JSON.parse(json) as { isCrossRepository?: boolean }).isCrossRepository === true;
      } catch {
        return false;
      }
    },
    fetch: (headRef) => {
      try {
        execFileSync("git", ["fetch", "origin", headRef], { stdio: "ignore" });
      } catch {
        /* best-effort */
      }
    },
    resetToRemote: (headRef) => {
      try {
        execFileSync("git", ["checkout", "-B", headRef, `origin/${headRef}`], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    },
    currentBranch: () => git(["rev-parse", "--abbrev-ref", "HEAD"]),
    rebaseOntoMain: () => {
      try {
        execFileSync("git", ["rebase", "origin/main"], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    },
    forcePush: (headRef) => {
      try {
        execFileSync("git", ["push", "--force-with-lease", "origin", headRef], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    },
    rebaseAbort: () => {
      try {
        execFileSync("git", ["rebase", "--abort"], { stdio: "ignore" });
      } catch {
        /* best-effort */
      }
    },
    restore: (branch) => {
      if (branch !== "" && branch !== "HEAD") {
        try {
          execFileSync("git", ["checkout", branch], { stdio: "ignore" });
        } catch {
          /* best-effort */
        }
      }
    },
    appendAlert: (line) => {
      mkdirSync(dirname(alertPath()), { recursive: true });
      appendFileSync(alertPath(), line + "\n");
    },
    now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

/**
 * Rebase a stale same-repo PR onto origin/main (mirrors `_loop_pr_rebase_stale`).
 * Forks are refused (no write access → ALERT). On conflict the rebase is aborted
 * and an ALERT is written; on push failure an ALERT is written. The original
 * branch is restored regardless. Returns void; the caller re-reads PR facts.
 */
export function prRebaseStale(num: string, headRef: string, deps: RebaseDeps = realRebaseDeps()): void {
  if (num === "" || headRef === "") return;
  if (deps.isFork(num)) {
    deps.appendAlert(`[${deps.now()}] PR #${num}: fork PR — cannot rebase (no write access)`);
    return;
  }
  deps.fetch(headRef);
  if (!deps.resetToRemote(headRef)) return;
  const orig = deps.currentBranch();
  let rebaseOk = false;
  let pushOk = false;
  if (deps.rebaseOntoMain(headRef)) {
    rebaseOk = true;
    if (deps.forcePush(headRef)) pushOk = true;
  }
  deps.restore(orig);
  if (pushOk) return;
  if (!rebaseOk) {
    deps.rebaseAbort();
    deps.appendAlert(`[${deps.now()}] PR #${num}: rebase conflict on ${headRef} — please rebase manually`);
  } else {
    deps.appendAlert(`[${deps.now()}] PR #${num}: rebase succeeded but push failed on ${headRef} — please check manually`);
  }
}
