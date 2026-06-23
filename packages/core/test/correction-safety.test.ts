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

  it("FIX-913: needs_review cycles' signals are excluded (preserved success ≠ failure, no false trip)", () => {
    // Mirror the cross-story signal-repeat case, but each cycle ended needs_review
    // (FIX-908 work-preservation: code committed + CI-green, attest artifact not yet
    // produced) → PRESERVED, not a failure → must NOT feed the breaker.
    const term = (cycleId: string, storyId: string): RollEvent =>
      ({ type: "cycle:terminal", cycleId, storyId, outcome: "needs_review", ts: 0 } as unknown as RollEvent);
    const events: RollEvent[] = [
      { type: "correction:action", storyId: "US-A", cycleId: "c1", action: "alert_only", signal: "unknown_failure", reason: "r1", ts: 10 },
      { type: "correction:action", storyId: "US-B", cycleId: "c2", action: "alert_only", signal: "unknown_failure", reason: "r2", ts: 20 },
      { type: "correction:action", storyId: "US-C", cycleId: "c3", action: "alert_only", signal: "unknown_failure", reason: "r3", ts: 30 },
      term("c1", "US-A"), term("c2", "US-B"), term("c3", "US-C"),
    ];
    expect(correctionSignals(events)).toEqual([]);
    expect(correctionCircuitVerdict(events, safety, 30)).toEqual({ action: "continue" });
  });

  it("FIX-913 control: real failures (cycles NOT needs_review) still trip the breaker", () => {
    const term = (cycleId: string, storyId: string): RollEvent =>
      ({ type: "cycle:terminal", cycleId, storyId, outcome: "failed", ts: 0 } as unknown as RollEvent);
    const events: RollEvent[] = [
      { type: "correction:action", storyId: "US-A", cycleId: "c1", action: "open_fix", signal: "unknown_failure", reason: "r1", ts: 10 },
      { type: "correction:action", storyId: "US-B", cycleId: "c2", action: "open_fix", signal: "unknown_failure", reason: "r2", ts: 20 },
      { type: "correction:action", storyId: "US-C", cycleId: "c3", action: "open_fix", signal: "unknown_failure", reason: "r3", ts: 30 },
      term("c1", "US-A"), term("c2", "US-B"), term("c3", "US-C"),
    ];
    expect(correctionCircuitVerdict(events, safety, 30)).toMatchObject({
      action: "pause_and_notify",
      kind: "signal_repeat",
      signal: "unknown_failure",
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
