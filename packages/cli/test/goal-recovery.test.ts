/**
 * FIX-1049 — pure supervised-recovery logic: detect a no-progress stall from the
 * persisted goal + events, adjudicate whether a retry by the next Builder is
 * allowed/denied, and clear the stall for one more attempt without erasing other
 * cards' accounting.
 */
import { describe, expect, it } from "vitest";
import type { RollEvent, RollGoal } from "@roll/spec";
import {
  clearStallForRecovery,
  detectNoProgressStall,
  planNoProgressRecovery,
  type NoProgressStall,
} from "../src/lib/goal-recovery.js";

function goal(overrides: Partial<RollGoal>): RollGoal {
  return {
    schema: "goal.v1",
    scope: { kind: "cards", cards: ["REFACTOR-055"] },
    review: { mode: "auto" },
    limits: {},
    status: "paused",
    usage: { cycles: 2, costUsd: 0 },
    createdAt: "2026-06-30T00:00:00Z",
    updatedAt: "2026-06-30T01:00:00Z",
    ...overrides,
  };
}

const cycleStart = (cycleId: string, storyId: string, agent: string, ts: number): RollEvent => ({
  type: "cycle:start",
  cycleId,
  storyId,
  agent: agent as never,
  model: "m",
  ts,
});
const cycleEnd = (cycleId: string, outcome: string, ts: number): RollEvent =>
  ({ type: "cycle:end", cycleId, outcome: outcome as never, cost: {} as never, ts }) as RollEvent;

describe("detectNoProgressStall", () => {
  it("returns undefined for a non-paused or non-no-progress goal", () => {
    expect(detectNoProgressStall(undefined, [])).toBeUndefined();
    expect(detectNoProgressStall(goal({ status: "active" }), [])).toBeUndefined();
    expect(detectNoProgressStall(goal({ status: "paused", lastDecisionReason: "timebox" }), [])).toBeUndefined();
  });

  it("projects blocked card, streak, last builder from a no_progress_on_all_cards stop", () => {
    const g = goal({
      lastDecisionReason: "no_progress_on_all_cards",
      progress: { skippedCards: ["REFACTOR-055"], zeroStreaks: { "REFACTOR-055": 2 }, noProgressCycles: 2 },
    });
    const events: RollEvent[] = [
      cycleStart("c1", "REFACTOR-055", "agy", 1),
      cycleEnd("c1", "gave_up", 2),
      cycleStart("c2", "REFACTOR-055", "pi", 3),
      cycleEnd("c2", "blocked", 4),
    ];
    const stall = detectNoProgressStall(g, events);
    expect(stall).toBeDefined();
    expect(stall!.reason).toBe("no_progress_on_all_cards");
    expect(stall!.blockedCards).toEqual(["REFACTOR-055"]);
    expect(stall!.zeroStreaks).toEqual({ "REFACTOR-055": 2 });
    expect(stall!.noProgressCycles).toBe(2);
    expect(stall!.lastBuilder).toBe("pi");
    expect(stall!.lastCycleId).toBe("c2");
    expect(stall!.handoff).toBeUndefined();
  });

  it("detects a no_progress_breaker stop via the progress safety gate", () => {
    const g = goal({
      lastDecisionReason: "no_progress_breaker",
      safety: { lastGate: "progress", lastReason: "no_progress_breaker", lastAt: "x", lastReading: "3 >= 3" },
      progress: { noProgressCycles: 3 },
    });
    const stall = detectNoProgressStall(g, []);
    expect(stall?.reason).toBe("no_progress_breaker");
    expect(stall?.blockedCards).toEqual([]);
    expect(stall?.noProgressCycles).toBe(3);
  });

  it("carries a bounded handoff reference when the last cycle ended handoff_without_tcr", () => {
    const g = goal({
      lastDecisionReason: "no_progress_on_all_cards",
      progress: { skippedCards: ["REFACTOR-055"], noProgressCycles: 2 },
    });
    const events: RollEvent[] = [
      cycleStart("c2", "REFACTOR-055", "pi", 3),
      cycleEnd("c2", "handoff_without_tcr", 4),
    ];
    const stall = detectNoProgressStall(g, events);
    expect(stall?.handoff).toEqual({
      cycleId: "c2",
      kind: "zero_tcr_dirty_worktree",
      detail: "the failed cycle left a preserved worktree with no TCR commit; inspect it before the retry",
      worktreePath: ".roll/loop/worktrees/cycle-c2",
    });
  });
});

const baseStall: NoProgressStall = {
  reason: "no_progress_on_all_cards",
  blockedCards: ["REFACTOR-055"],
  zeroStreaks: { "REFACTOR-055": 2 },
  noProgressCycles: 2,
  lastBuilder: "pi",
  lastCycleId: "c2",
};

describe("planNoProgressRecovery", () => {
  it("ALLOWS recovery when a different eligible Builder exists", () => {
    const d = planNoProgressRecovery({ stall: baseStall, nextEligibleBuilder: "reasonix" });
    expect(d.decision).toBe("allowed");
    if (d.decision === "allowed") {
      expect(d.storyId).toBe("REFACTOR-055");
      expect(d.nextBuilder).toBe("reasonix");
      expect(d.lastBuilder).toBe("pi");
      expect(d.skippedBuilders).toEqual(["pi"]);
    }
  });

  it("DENIES when no eligible Builder can be resolved", () => {
    const d = planNoProgressRecovery({ stall: baseStall, nextEligibleBuilder: undefined });
    expect(d.decision).toBe("denied");
    if (d.decision === "denied") {
      expect(d.storyId).toBe("REFACTOR-055");
      expect(d.reason).toMatch(/no eligible Builder/i);
    }
  });

  it("DENIES a blind retry of the same Builder that just failed", () => {
    const d = planNoProgressRecovery({ stall: baseStall, nextEligibleBuilder: "pi" });
    expect(d.decision).toBe("denied");
    if (d.decision === "denied") expect(d.reason).toMatch(/no alternate Builder/i);
  });

  it("DENIES (asks) when multiple blocked cards and none named", () => {
    const stall: NoProgressStall = { ...baseStall, blockedCards: ["A", "B"], zeroStreaks: {} };
    const d = planNoProgressRecovery({ stall, nextEligibleBuilder: "reasonix" });
    expect(d.decision).toBe("denied");
    if (d.decision === "denied") expect(d.reason).toMatch(/name the card/i);
  });

  it("honors an explicit target card among multiple blocked cards", () => {
    const stall: NoProgressStall = { ...baseStall, blockedCards: ["A", "B"], zeroStreaks: {} };
    const d = planNoProgressRecovery({ stall, targetStoryId: "B", nextEligibleBuilder: "reasonix" });
    expect(d.decision).toBe("allowed");
    if (d.decision === "allowed") expect(d.storyId).toBe("B");
  });

  it("DENIES when the whole-goal breaker stopped with no specific blocked card", () => {
    const stall: NoProgressStall = { ...baseStall, blockedCards: [], zeroStreaks: {}, lastBuilder: undefined };
    const d = planNoProgressRecovery({ stall, nextEligibleBuilder: "reasonix" });
    expect(d.decision).toBe("denied");
    if (d.decision === "denied") expect(d.reason).toMatch(/no blocked card/i);
  });
});

describe("clearStallForRecovery", () => {
  it("drops the target's skip + streak and resets the whole-goal counter", () => {
    const next = clearStallForRecovery(
      { skippedCards: ["REFACTOR-055"], zeroStreaks: { "REFACTOR-055": 2 }, noProgressCycles: 2 },
      "REFACTOR-055",
    );
    expect(next).toBeUndefined(); // nothing else remains → no progress block
  });

  it("preserves other cards' accounting while freeing the target", () => {
    const next = clearStallForRecovery(
      { skippedCards: ["A", "B"], zeroStreaks: { A: 2, B: 1 }, noProgressCycles: 3 },
      "A",
    );
    expect(next).toEqual({ skippedCards: ["B"], zeroStreaks: { B: 1 } });
    expect(next?.noProgressCycles).toBeUndefined();
  });
});
