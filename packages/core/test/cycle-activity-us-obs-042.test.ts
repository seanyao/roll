/**
 * US-OBS-042 — Guide observable and gated TCR micro-step rhythm.
 *
 * Proves the activity analyzer:
 *   - active-zero-TCR cycles are NOT conflated with silent hangs;
 *   - bounded micro-step plans are parsed from stdout;
 *   - test:red / test:green transitions are detected;
 *   - green-uncommitted is advisory (surface only, no kill);
 *   - oversized-action is advisory (surface only, no auto-split).
 */
import { describe, expect, it } from "vitest";
import type { RollEvent } from "@roll/spec";
import { analyzeCycleActivity, cycleActivityFromEvents } from "../src/loop/cycle-activity.js";
import type { ActivitySignal } from "../src/loop/activity-signal.js";

const CYCLE_ID = "cycle-20260630-210059-58201";

describe("analyzeCycleActivity — US-OBS-042 active vs silent", () => {
  it("classifies active-zero-TCR as active when stdout/signals keep arriving", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      { type: "cycle:stdout", cycleId: CYCLE_ID, data: "heartbeat: building · still working (1) · 2m quiet · 0 tcr so far", ts: 120_000 },
      { type: "cycle:stdout", cycleId: CYCLE_ID, data: "tool_call: Edit · packages/core/src/parser.ts", ts: 130_000 },
      { type: "cycle:stdout", cycleId: CYCLE_ID, data: "tool_call: Edit · packages/core/src/ledger.ts", ts: 140_000 },
    ];
    const a = analyzeCycleActivity(events, CYCLE_ID, 200_000);
    expect(a.classification).toBe("active");
    expect(a.tcrCount).toBe(0);
    expect(a.quietSec).toBeLessThan(120);
  });

  it("still classifies as active when a test transition is recent", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      { type: "cycle:stdout", cycleId: CYCLE_ID, data: "test:red · parser fails", ts: 130_000 },
    ];
    const a = analyzeCycleActivity(events, CYCLE_ID, 200_000);
    expect(a.classification).toBe("active");
    expect(a.testTransition?.state).toBe("red");
  });

  it("classifies recent persisted signal writes as activity even with 0 TCR", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
    ];
    const activitySignals: ActivitySignal[] = [
      { ts: 950_000, cycleId: CYCLE_ID, seg: "build", kind: "tool_call", tier: "B", summary: "Edit parser.ts" },
    ];
    const a = analyzeCycleActivity(events, CYCLE_ID, 1_000_000, { activitySignals });
    expect(a.classification).toBe("active");
    expect(a.tcrCount).toBe(0);
  });

  it("classifies recent worktree changes as activity even with 0 TCR", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
    ];
    const a = analyzeCycleActivity(events, CYCLE_ID, 1_000_000, {
      worktreeDiff: { files: ["packages/core/src/parser.ts"], areas: ["parser"], changedAt: 980_000 },
    });
    expect(a.classification).toBe("active");
    expect(a.quietSec).toBe(20);
  });

  it("classifies truly silent cycle as silent after no-progress threshold", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
    ];
    const a = analyzeCycleActivity(events, CYCLE_ID, 1_000_000);
    expect(a.classification).toBe("silent");
    expect(a.quietSec).toBeGreaterThan(900);
  });

  it("classifies as ended once cycle:end is observed", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      {
        type: "cycle:end",
        cycleId: CYCLE_ID,
        outcome: "delivered",
        cost: { cycleId: CYCLE_ID, agent: "kimi", model: "k2.7", tokensIn: 1000, tokensOut: 500, estimatedCost: 0.1, revertCount: 0, effectiveCost: 0.1, currency: "USD" },
        ts: 200_000,
      },
    ];
    const a = analyzeCycleActivity(events, CYCLE_ID, 300_000);
    expect(a.classification).toBe("ended");
  });
});

describe("analyzeCycleActivity — micro-step plan", () => {
  it("parses a bounded micro-step plan from stdout", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      {
        type: "cycle:stdout",
        cycleId: CYCLE_ID,
        data: "micro-step: A1 parser+tests · evidence: unit tests green · scope: packages/core/src/parser.ts, packages/core/src/ledger.ts",
        ts: 60_000,
      },
    ];
    const a = analyzeCycleActivity(events, CYCLE_ID, 180_000);
    expect(a.microStep?.actionId).toBe("A1");
    expect(a.microStep?.expectedEvidence).toContain("unit tests green");
    expect(a.microStep?.fileAreaScope).toEqual([
      "packages/core/src/parser.ts",
      "packages/core/src/ledger.ts",
    ]);
  });

  it("falls back to action: prefix if micro-step: is absent", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      { type: "cycle:stdout", cycleId: CYCLE_ID, data: "action A1 parser+tests · evidence: tests green · scope: parser.ts", ts: 60_000 },
    ];
    const a = analyzeCycleActivity(events, CYCLE_ID, 180_000);
    expect(a.microStep?.actionId).toBe("A1");
  });
});

describe("analyzeCycleActivity — test transitions", () => {
  it("detects explicit test:red", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      { type: "cycle:stdout", cycleId: CYCLE_ID, data: "test:red · parser expected 3 got 5", ts: 120_000 },
    ];
    const a = analyzeCycleActivity(events, CYCLE_ID, 180_000);
    expect(a.testTransition?.state).toBe("red");
  });

  it("detects explicit test:green", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      { type: "cycle:stdout", cycleId: CYCLE_ID, data: "test:green · parser tests pass", ts: 120_000 },
    ];
    const a = analyzeCycleActivity(events, CYCLE_ID, 180_000);
    expect(a.testTransition?.state).toBe("green");
  });

  it("detects vitest failure output as red", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      { type: "cycle:stdout", cycleId: CYCLE_ID, data: " FAIL  packages/core/test/parser.test.ts > parser", ts: 120_000 },
    ];
    const a = analyzeCycleActivity(events, CYCLE_ID, 180_000);
    expect(a.testTransition?.state).toBe("red");
  });

  it("detects vitest pass output as green", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      { type: "cycle:stdout", cycleId: CYCLE_ID, data: " ✓ packages/core/test/parser.test.ts (3 tests)", ts: 120_000 },
    ];
    const a = analyzeCycleActivity(events, CYCLE_ID, 180_000);
    expect(a.testTransition?.state).toBe("green");
  });
});

describe("analyzeCycleActivity — green-uncommitted & oversized", () => {
  it("surfaces green-uncommitted when test:green is not followed by a tcr", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      { type: "cycle:stdout", cycleId: CYCLE_ID, data: "test:green · parser tests pass", ts: 120_000 },
    ];
    const a = analyzeCycleActivity(events, CYCLE_ID, 180_000);
    expect(a.greenUncommitted).toBeDefined();
    expect(a.greenUncommitted?.durationSec).toBe(60);
  });

  it("clears green-uncommitted after a tcr commit", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      { type: "cycle:stdout", cycleId: CYCLE_ID, data: "test:green · parser tests pass", ts: 120_000 },
      { type: "cycle:tcr", cycleId: CYCLE_ID, commitHash: "abc1234", message: "tcr: parser green", ts: 130_000 },
    ];
    const a = analyzeCycleActivity(events, CYCLE_ID, 200_000);
    expect(a.testTransition?.state).toBe("green");
    expect(a.greenUncommitted).toBeUndefined();
    expect(a.tcrCount).toBe(1);
  });

  it("surfaces oversized action when diff exceeds thresholds", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      { type: "cycle:stdout", cycleId: CYCLE_ID, data: "micro-step: A1 parser+tests · scope: parser", ts: 60_000 },
    ];
    const worktreeDiff = {
      files: Array.from({ length: 12 }, (_, i) => `packages/core/src/f${i}.ts`),
      areas: ["parser", "ledger", "currency", "cli"],
    };
    const a = analyzeCycleActivity(events, CYCLE_ID, 180_000, { worktreeDiff });
    expect(a.oversizedAction).toBeDefined();
    expect(a.oversizedAction?.filesTouched).toBe(12);
    expect(a.oversizedAction?.contractAreas).toBe(4);
  });

  it("does not surface oversized action when under thresholds", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      { type: "cycle:stdout", cycleId: CYCLE_ID, data: "micro-step: A1 parser+tests · scope: parser", ts: 60_000 },
    ];
    const worktreeDiff = {
      files: ["packages/core/src/parser.ts"],
      areas: ["parser"],
    };
    const a = analyzeCycleActivity(events, CYCLE_ID, 180_000, { worktreeDiff });
    expect(a.oversizedAction).toBeUndefined();
  });

  it("rebuilds advisory history from durable rhythm events", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      {
        type: "action:started",
        cycleId: CYCLE_ID,
        actionId: "A1",
        summary: "parser+tests",
        expectedEvidence: "unit tests green",
        fileAreaScope: ["packages/core/src/parser.ts"],
        ts: 60_000,
      },
      { type: "test:red", cycleId: CYCLE_ID, actionId: "A1", source: "vitest", summary: "parser fails", ts: 100_000 },
      { type: "test:green", cycleId: CYCLE_ID, actionId: "A1", source: "vitest", summary: "parser passes", ts: 120_000 },
      { type: "green-uncommitted", cycleId: CYCLE_ID, actionId: "A1", since: 120_000, durationSec: 60, ts: 180_000 },
      {
        type: "action:oversized",
        cycleId: CYCLE_ID,
        actionId: "A1",
        filesTouched: 12,
        contractAreas: 4,
        thresholdFiles: 10,
        thresholdAreas: 3,
        ts: 190_000,
      },
      { type: "cycle:tcr", cycleId: CYCLE_ID, commitHash: "abc1234", message: "tcr: parser green", ts: 200_000 },
    ];
    const a = analyzeCycleActivity(events, CYCLE_ID, 220_000);
    expect(a.microStep?.actionId).toBe("A1");
    expect(a.testTransition?.state).toBe("green");
    expect(a.greenUncommitted).toBeUndefined();
    expect(a.oversizedAction?.filesTouched).toBe(12);
    expect(a.history.map((h) => h.type)).toEqual([
      "action:started",
      "test:red",
      "test:green",
      "green-uncommitted",
      "action:oversized",
      "cycle:tcr",
    ]);
  });

  it("projects durable rhythm events into the cycle activity stream", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE_ID, storyId: "FIX-1050", agent: "kimi", model: "k2.7", ts: 1000 },
      { type: "action:started", cycleId: CYCLE_ID, actionId: "A1", summary: "parser+tests", expectedEvidence: "unit tests green", fileAreaScope: ["parser"], ts: 60_000 },
      { type: "test:red", cycleId: CYCLE_ID, actionId: "A1", source: "vitest", summary: "parser fails", ts: 100_000 },
      { type: "test:green", cycleId: CYCLE_ID, actionId: "A1", source: "vitest", summary: "parser passes", ts: 120_000 },
      { type: "green-uncommitted", cycleId: CYCLE_ID, actionId: "A1", since: 120_000, durationSec: 60, ts: 180_000 },
      { type: "action:oversized", cycleId: CYCLE_ID, actionId: "A1", filesTouched: 12, contractAreas: 4, thresholdFiles: 10, thresholdAreas: 3, ts: 190_000 },
      { type: "cycle:tcr", cycleId: CYCLE_ID, commitHash: "abc1234", message: "tcr: parser green", ts: 200_000 },
    ];
    const projected = cycleActivityFromEvents(events, CYCLE_ID);
    expect(projected.map((e) => e.kind)).toContain("state_change");
    expect(projected.map((e) => e.payload).map((p) => JSON.stringify(p)).join("\n")).toContain("green-uncommitted");
    expect(projected.map((e) => e.payload).map((p) => JSON.stringify(p)).join("\n")).toContain("action:oversized");
  });
});
