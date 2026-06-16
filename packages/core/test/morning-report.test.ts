import { describe, expect, it } from "vitest";
import { buildMorningReportModel } from "../src/index.js";
import type { RollEvent } from "@roll/spec";

describe("US-EVID-016 morning report model", () => {
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
    const model = buildMorningReportModel(events, [], { windowStart: 0, windowEnd: 100 });
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
    const model = buildMorningReportModel([], [{ story_id: "US-RUN", status: "done", cost_usd: 0.1, ts: "2026-06-08T10:00:00Z" }], {
      windowStart: Date.parse("2026-06-08T00:00:00Z") / 1000,
      windowEnd: Date.parse("2026-06-08T12:00:00Z") / 1000,
      runDelivered: (row) => row.status === "done",
    });
    expect(model.deliveredStories).toEqual(["US-RUN"]);
    expect(model.totalCostUsd).toBe(0.1);
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
    expect(buildMorningReportModel(events, [], { windowStart: 0, windowEnd: 100 }).deliveredStories).toEqual([]);
  });
});
