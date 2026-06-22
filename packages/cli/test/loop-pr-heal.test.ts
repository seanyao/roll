/**
 * US-PORT-021 — PR-loop heal gate (prHealSelf) + rebase (prRebaseStale) ported
 * off bin/roll. The gate reuses the pure core verdict; these tests drive the
 * side-effect routing via injected deps (no git/gh/agent/fs).
 */
import { describe, expect, it } from "vitest";
import {
  type HealDeps,
  type RebaseDeps,
  prHealSelf,
  prRebaseStale,
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
