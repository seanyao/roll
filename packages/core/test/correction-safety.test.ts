import { describe, expect, it } from "vitest";
import { correctionCircuitVerdict, correctionSignals, parsePolicy } from "../src/index.js";
import type { RollEvent } from "@roll/spec";

const safety = parsePolicy("").loopSafety;

describe("US-EVID-016 correction circuit breaker", () => {
  it("pauses on three consecutive same-story correction returns", () => {
    const events: RollEvent[] = [
      { type: "correction:action", storyId: "US-A", action: "return_story", signal: "review-score regression", reason: "r1", ts: 10 },
      { type: "correction:action", storyId: "US-A", action: "route_adjust", signal: "review-score regression", reason: "r2", ts: 20 },
      { type: "correction:action", storyId: "US-A", action: "return_story", signal: "review-score regression", reason: "r3", ts: 30 },
    ];
    expect(correctionCircuitVerdict(events, safety)).toMatchObject({
      action: "pause_and_notify",
      kind: "story_oscillation",
      storyId: "US-A",
      count: 3,
      threshold: 3,
    });
  });

  it("does not count another story inside the same-story consecutive streak", () => {
    const events: RollEvent[] = [
      { type: "correction:action", storyId: "US-A", action: "return_story", signal: "x", reason: "r1", ts: 10 },
      { type: "correction:action", storyId: "US-B", action: "return_story", signal: "y", reason: "r2", ts: 20 },
      { type: "correction:action", storyId: "US-A", action: "return_story", signal: "z", reason: "r3", ts: 30 },
    ];
    expect(correctionCircuitVerdict(events, safety)).toEqual({ action: "continue" });
  });

  it("pauses when the same failure signal repeats across stories in the window", () => {
    const events: RollEvent[] = [
      { type: "correction:action", storyId: "US-A", action: "open_fix", signal: "missing ac-map", reason: "r1", ts: 10 },
      { type: "correction:action", storyId: "US-B", action: "open_fix", signal: "missing ac-map", reason: "r2", ts: 20 },
      { type: "correction:action", storyId: "US-C", action: "open_fix", signal: "missing ac-map", reason: "r3", ts: 30 },
    ];
    expect(correctionCircuitVerdict(events, safety, 30)).toMatchObject({
      action: "pause_and_notify",
      kind: "signal_repeat",
      signal: "missing ac-map",
      count: 3,
    });
  });

  it("normalizes attest skipped reasons into failure signals", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: "c1", storyId: "US-A", agent: "claude", model: "sonnet", ts: 1 },
      { type: "attest:gate", cycleId: "c1", verdict: "skipped", reasons: ["No fresh acceptance report"], ts: 2 },
    ];
    expect(correctionSignals(events)).toEqual([
      {
        storyId: "US-A",
        cycleId: "c1",
        signal: "no fresh acceptance report",
        action: "attest_skipped",
        ts: 2,
        source: "attest",
      },
    ]);
  });
});
