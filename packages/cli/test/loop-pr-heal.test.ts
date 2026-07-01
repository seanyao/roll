/**
 * US-PORT-021 — PR-loop heal gate (prHealSelf) + rebase (prRebaseStale) ported
 * off bin/roll. The gate reuses the pure core verdict; these tests drive the
 * side-effect routing via injected deps (no git/gh/agent/fs).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type HealDeps,
  type RebaseDeps,
  isSandboxCommitBlock,
  prHealSelf,
  prHealWritableRoots,
  prRebaseStale,
  releaseHealLock,
  takeHealLock,
} from "../src/commands/loop-pr-heal.js";

function healDeps(over: Partial<HealDeps> = {}): { deps: HealDeps; calls: string[]; counts: Record<string, number> } {
  const calls: string[] = [];
  const counts: Record<string, number> = {};
  const deps: HealDeps = {
    healMax: () => 2,
    prHealCount: (num) => counts[num] ?? 0,
    setPrHealCount: (num, n) => {
      counts[num] = n;
      calls.push(`setCount:${num}=${n}`);
    },
    lock: () => ({ lockPresent: false, lockPidAlive: undefined }),
    reclaimLock: (num) => calls.push(`reclaim:${num}`),
    writeLock: (num) => calls.push(`writeLock:${num}`),
    alertHasKey: () => false,
    appendAlert: (line) => calls.push(`alert:${line}`),
    now: () => "2026-06-09T00:00:00Z",
    dispatchHeal: (num) => calls.push(`dispatch:${num}`),
    ...over,
  };
  return { deps, calls, counts };
}

describe("prHealSelf — heal gate (US-PORT-021)", () => {
  it("empty PR number → no-op", () => {
    const { deps, calls } = healDeps();
    prHealSelf("", "feat/x", "o/r", deps);
    expect(calls).toEqual([]);
  });

  it("heal disabled (healMax 0) → fix_forward signal, no dispatch", () => {
    const { deps, calls } = healDeps({ healMax: () => 0 });
    prHealSelf("12", "feat/x", "o/r", deps);
    expect(calls.some((c) => c.startsWith("alert:") && c.includes("auto-heal off"))).toBe(true);
    expect(calls.some((c) => c.startsWith("dispatch:"))).toBe(false);
  });

  it("a live lock → in-flight, no-op (no second heal)", () => {
    const { deps, calls } = healDeps({ lock: () => ({ lockPresent: true, lockPidAlive: true }) });
    prHealSelf("12", "feat/x", "o/r", deps);
    expect(calls).toEqual([]);
  });

  it("a dead lock is reclaimed, then the heal dispatches", () => {
    const { deps, calls } = healDeps({ lock: () => ({ lockPresent: true, lockPidAlive: false }) });
    prHealSelf("12", "feat/x", "o/r", deps);
    expect(calls).toContain("reclaim:12");
    expect(calls).toContain("dispatch:12");
  });

  it("budget exhausted (count >= max) → fix_forward signal, no dispatch", () => {
    const { deps, calls } = healDeps({ prHealCount: () => 2 });
    prHealSelf("12", "feat/x", "o/r", deps);
    expect(calls.some((c) => c.includes("budget exhausted"))).toBe(true);
    expect(calls.some((c) => c.startsWith("dispatch:"))).toBe(false);
  });

  it("under budget → persist count+1, take the lock, dispatch the heal", () => {
    const { deps, calls, counts } = healDeps({ prHealCount: () => 0 });
    prHealSelf("12", "feat/x", "o/r", deps);
    expect(counts["12"]).toBe(1);
    expect(calls).toContain("writeLock:12");
    expect(calls).toContain("dispatch:12");
  });

  it("ALERT is deduped — already-present key suppresses a second line", () => {
    const { deps, calls } = healDeps({ healMax: () => 0, alertHasKey: () => true });
    prHealSelf("12", "feat/x", "o/r", deps);
    expect(calls.some((c) => c.startsWith("alert:"))).toBe(false);
  });
});

function rebaseDeps(over: Partial<RebaseDeps> = {}): { deps: RebaseDeps; calls: string[] } {
  const calls: string[] = [];
  const deps: RebaseDeps = {
    isFork: () => false,
    fetch: () => calls.push("fetch"),
    resetToRemote: () => (calls.push("reset"), true),
    currentBranch: () => "main",
    rebaseOntoMain: () => (calls.push("rebase"), true),
    forcePush: () => (calls.push("push"), true),
    rebaseAbort: () => calls.push("abort"),
    restore: (b) => calls.push(`restore:${b}`),
    appendAlert: (line) => calls.push(`alert:${line}`),
    now: () => "2026-06-09T00:00:00Z",
    ...over,
  };
  return { deps, calls };
}

describe("prRebaseStale — rebase dance (US-PORT-021)", () => {
  it("fork PR → ALERT (no write access), no rebase", () => {
    const { deps, calls } = rebaseDeps({ isFork: () => true });
    prRebaseStale("12", "feat/x", deps);
    expect(calls.some((c) => c.includes("fork PR"))).toBe(true);
    expect(calls).not.toContain("rebase");
  });

  it("happy path: fetch → reset → rebase → force-push, restore, no ALERT", () => {
    const { deps, calls } = rebaseDeps();
    prRebaseStale("12", "feat/x", deps);
    expect(calls).toEqual(["fetch", "reset", "rebase", "push", "restore:main"]);
    expect(calls.some((c) => c.startsWith("alert:"))).toBe(false);
  });

  it("rebase conflict → abort + ALERT, branch restored", () => {
    const { deps, calls } = rebaseDeps({ rebaseOntoMain: () => false });
    prRebaseStale("12", "feat/x", deps);
    expect(calls).toContain("abort");
    expect(calls.some((c) => c.includes("rebase conflict"))).toBe(true);
    expect(calls).toContain("restore:main");
  });

  it("rebase ok but push fails → ALERT (push failed), no abort", () => {
    const { deps, calls } = rebaseDeps({ forcePush: () => false });
    prRebaseStale("12", "feat/x", deps);
    expect(calls.some((c) => c.includes("push failed"))).toBe(true);
    expect(calls).not.toContain("abort");
  });

  it("reset-to-remote failure → bail before rebase", () => {
    const { deps, calls } = rebaseDeps({ resetToRemote: () => false });
    prRebaseStale("12", "feat/x", deps);
    expect(calls).toEqual(["fetch"]); // bailed after reset failed — no rebase/push/alert
    expect(calls).not.toContain("rebase");
  });
});

describe("FIX-1065 — PR self-heal writable roots + failure classification", () => {
  function makeRepo(): { repo: string; wt: string; cleanup: () => void } {
    const root = mkdtempSync(join(tmpdir(), "roll-fix1065-"));
    const repo = join(root, "repo");
    const wt = join(root, "wt");
    mkdirSync(repo, { recursive: true });
    execFileSync("git", ["init", "--bare"], { cwd: repo });
    const clone = join(root, "clone");
    execFileSync("git", ["clone", repo, clone], { stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@roll.local"], { cwd: clone });
    execFileSync("git", ["config", "user.name", "Roll Test"], { cwd: clone });
    writeFileSync(join(clone, "file.txt"), "hello", "utf8");
    execFileSync("git", ["add", "."], { cwd: clone });
    execFileSync("git", ["commit", "-m", "init"], { cwd: clone });
    execFileSync("git", ["push", "origin", "HEAD:main"], { cwd: clone });
    execFileSync("git", ["branch", "feat/x"], { cwd: clone });
    execFileSync("git", ["push", "origin", "feat/x"], { cwd: clone });
    execFileSync("git", ["worktree", "add", wt, "origin/feat/x"], { cwd: clone });
    return {
      repo: clone,
      wt,
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
  }

  it("prHealWritableRoots grants worktree + linked gitdir + common dir, not main checkout code", () => {
    const { wt, repo, cleanup } = makeRepo();
    try {
      const roots = prHealWritableRoots(wt).map((p) => realpathSync(p));
      const gitDir = execFileSync("git", ["-C", wt, "rev-parse", "--path-format=absolute", "--git-dir"], { encoding: "utf8" }).trim();
      const commonDir = execFileSync("git", ["-C", wt, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
      expect(roots).toContain(realpathSync(wt));
      expect(roots).toContain(realpathSync(gitDir));
      expect(roots).toContain(realpathSync(commonDir));
      // The main checkout code root (the clone) is intentionally NOT writable.
      expect(roots).not.toContain(realpathSync(repo));
    } finally {
      cleanup();
    }
  });

  it("isSandboxCommitBlock recognises linked-worktree index.lock errors", () => {
    expect(isSandboxCommitBlock("fatal: Unable to create '/repo/.git/worktrees/pr-1125/index.lock': Operation not permitted")).toBe(true);
    expect(isSandboxCommitBlock("Seatbelt policy violation: allow_write missing /repo/.git/worktrees/pr-1125")).toBe(true);
    expect(isSandboxCommitBlock("sandbox denied: write to /repo/.git/worktrees/pr-1125/index.lock")).toBe(true);
  });

  it("isSandboxCommitBlock does not flag ordinary test failures or auth errors", () => {
    expect(isSandboxCommitBlock("Error: test failed with 1 failure")).toBe(false);
    expect(isSandboxCommitBlock("gh: Authentication failed (HTTP 401)")).toBe(false);
    expect(isSandboxCommitBlock("network error: connection refused")).toBe(false);
  });

  it("takeHealLock/releaseHealLock manage the per-PR lock file", () => {
    const prev = process.env["ROLL_LOOP_DIR"];
    const base = mkdtempSync(join(tmpdir(), "roll-heal-lock-"));
    process.env["ROLL_LOOP_DIR"] = base;
    try {
      const num = "1125";
      takeHealLock(num);
      const p = join(base, "heal", `pr-${num}.lock`);
      expect(existsSync(p)).toBe(true);
      expect(readFileSync(p, "utf8").trim()).toBe(String(process.pid));
      releaseHealLock(num);
      expect(existsSync(p)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env["ROLL_LOOP_DIR"];
      else process.env["ROLL_LOOP_DIR"] = prev;
      rmSync(base, { recursive: true, force: true });
    }
  });
});
