import { describe, expect, it } from "vitest";
import { buildLoopDigestModel, buildMorningReportModel } from "../src/index.js";
import type { RollEvent } from "@roll/spec";

describe("US-EVID-016 morning report model", () => {
  it("buildLoopDigestModel and buildMorningReportModel are the same function", () => {
    expect(buildLoopDigestModel).toBe(buildMorningReportModel);
  });

  it("summarizes cycles, delivered cards, corrections, pauses, alerts, and cost", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: "c1", storyId: "US-A", agent: "claude", model: "sonnet", ts: 10 },
      {
        type: "cycle:end",
        cycleId: "c1",
        outcome: "delivered",
        cost: { cycleId: "c1", agent: "claude", model: "sonnet", tokensIn: 10, tokensOut: 5, estimatedCost: 0.2, revertCount: 0, effectiveCost: 0.2 },
        ts: 20,
      },
      { type: "correction:action", storyId: "US-B", action: "return_story", signal: "regression", reason: "review-score", ts: 30 },
      { type: "correction:circuit_breaker", storyId: "US-B", signal: "regression", count: 3, threshold: 3, reason: "oscillation", ts: 40 },
      { type: "policy:safety_pause", loop: "ci", reason: "oscillation", ts: 41 },
      { type: "alert:notify", channel: "correction-circuit", message: "oscillation", ts: 42 },
    ];
    const model = buildLoopDigestModel(events, [], { windowStart: 0, windowEnd: 100 });
    expect(model).toMatchObject({
      cycles: 1,
      deliveredStories: ["US-A"],
      returnedStories: ["US-B"],
      corrections: 1,
      circuitBreakers: 1,
      paused: true,
      totalCostUsd: 0.2,
      alerts: ["oscillation"],
    });
  });

  it("uses the injected runs-row projection as a fallback when event story links are absent", () => {
    const base = Date.parse("2026-06-08T10:00:00Z") / 1000;
    const events: RollEvent[] = [
      {
        type: "cycle:end",
        cycleId: "c-run",
        outcome: "delivered",
        cost: { cycleId: "c-run", agent: "claude", model: "sonnet", tokensIn: 1, tokensOut: 1, estimatedCost: 0.01, revertCount: 0, effectiveCost: 0.01 },
        ts: base + 60,
      },
    ];
    const model = buildLoopDigestModel(events, [{ cycle_id: "c-run", story_id: "US-RUN", status: "done", cost_usd: 0.1, ts: "2026-06-08T10:00:00Z" }], {
      windowStart: Date.parse("2026-06-08T00:00:00Z") / 1000,
      windowEnd: Date.parse("2026-06-08T12:00:00Z") / 1000,
      runDelivered: (row) => row.status === "done",
    });
    expect(model.deliveredStories).toEqual(["US-RUN"]);
    expect(model.totalCostUsd).toBe(0.01);
    expect(model.degraded).toBe(false);
  });

  it("FIX-1202: skips legacy run rows without a parseable timestamp instead of treating them as in-window", () => {
    const base = Date.parse("2026-07-03T12:00:00Z") / 1000;
    const model = buildLoopDigestModel([], [{ story_id: "FIX-199", status: "done", cost_usd: 3.5 }], {
      windowStart: base - 12 * 60 * 60,
      windowEnd: base,
      runDelivered: (row) => row.status === "done",
    });

    expect(model.cycles).toBe(0);
    expect(model.deliveredStories).toEqual([]);
    expect(model.totalCostUsd).toBe(0);
    expect(model.degraded).toBe(false);
  });

  it("FIX-1202: degrades the contradictory case of zero cycles with delivered rows", () => {
    const base = Date.parse("2026-07-03T12:00:00Z") / 1000;
    const model = buildLoopDigestModel([], [{ cycle_id: "c-orphan", story_id: "FIX-1202", status: "done", ts: "2026-07-03T10:00:00Z" }], {
      windowStart: base - 12 * 60 * 60,
      windowEnd: base,
      runDelivered: (row) => row.status === "done",
    });

    expect(model.cycles).toBe(0);
    expect(model.deliveredStories).toEqual(["FIX-1202"]);
    expect(model.degraded).toBe(true);
    expect(model.degradedReasons).toEqual(["cycles_zero_with_delivered"]);
  });

  it("FIX-1202: counts delivered run rows by their own in-window timestamp, not cycle membership", () => {
    const base = Date.parse("2026-07-03T12:00:00Z") / 1000;
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: "c-current", storyId: "US-CURRENT", agent: "claude", model: "sonnet", ts: base - 120 },
    ];
    const model = buildLoopDigestModel(events, [{ cycle_id: "c-old", story_id: "FIX-OLD", status: "done", ts: "2026-07-03T10:00:00Z" }], {
      windowStart: base - 12 * 60 * 60,
      windowEnd: base,
      runDelivered: (row) => row.status === "done",
    });

    expect(model.cycles).toBe(1);
    expect(model.deliveredStories).toEqual(["FIX-OLD"]);
    expect(model.degraded).toBe(false);
  });

  it("FIX-1202: aggregates run-row cost by timestamp when no cycle:end cost exists", () => {
    const base = Date.parse("2026-07-03T12:00:00Z") / 1000;
    const model = buildLoopDigestModel([], [{ cycle_id: "c-cost", story_id: "FIX-COST", status: "failed", cost_usd: 0.42, ts: "2026-07-03T10:00:00Z" }], {
      windowStart: base - 12 * 60 * 60,
      windowEnd: base,
      runDelivered: (row) => row.status === "done",
    });

    expect(model.cycles).toBe(0);
    expect(model.deliveredStories).toEqual([]);
    expect(model.totalCostUsd).toBe(0.42);
    expect(model.degraded).toBe(false);
  });

  it("FIX-1202: accepts numeric epoch run timestamps in seconds and milliseconds", () => {
    const base = Date.parse("2026-07-03T12:00:00Z") / 1000;
    const model = buildLoopDigestModel(
      [{ type: "cycle:start", cycleId: "c-current", storyId: "US-CURRENT", agent: "claude", model: "sonnet", ts: base - 120 }],
      [
        { cycle_id: "c-sec", story_id: "FIX-SEC", status: "done", cost_usd: 0.1, ts: base - 60 },
        { cycle_id: "c-ms", story_id: "FIX-MS", status: "done", cost_usd: 0.2, ts: (base - 30) * 1000 },
      ],
      {
        windowStart: base - 12 * 60 * 60,
        windowEnd: base,
        runDelivered: (row) => row.status === "done",
      },
    );

    expect(model.deliveredStories).toEqual(["FIX-MS", "FIX-SEC"]);
    expect(model.totalCostUsd).toBeCloseTo(0.3);
    expect(model.degraded).toBe(false);
  });

  it("FIX-1202: handles an idle-only day as a clean digest with run-row cost", () => {
    const base = Date.parse("2026-07-03T12:00:00Z") / 1000;
    const model = buildLoopDigestModel([], [{ story_id: "IDLE", status: "idle", cost_usd: 0.2, ts: "2026-07-03T10:00:00Z" }], {
      windowStart: base - 12 * 60 * 60,
      windowEnd: base,
      runDelivered: (row) => row.status === "done",
    });

    expect(model.cycles).toBe(0);
    expect(model.deliveredStories).toEqual([]);
    expect(model.totalCostUsd).toBe(0.2);
    expect(model.degraded).toBe(false);
  });

  it("does not count local built as delivered", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: "c1", storyId: "US-BUILT", agent: "claude", model: "sonnet", ts: 10 },
      {
        type: "cycle:end",
        cycleId: "c1",
        outcome: "built",
        cost: { cycleId: "c1", agent: "claude", model: "sonnet", tokensIn: 1, tokensOut: 1, estimatedCost: 0.01, revertCount: 0, effectiveCost: 0.01 },
        ts: 20,
      },
    ];
    expect(buildLoopDigestModel(events, [], { windowStart: 0, windowEnd: 100 }).deliveredStories).toEqual([]);
  });
});
