import { describe, expect, it } from "vitest";
import { correctionCircuitVerdict, correctionSignals, parsePolicy } from "../src/index.js";
import type { RollEvent } from "@roll/spec";

const safety = parsePolicy("").loopSafety;

describe("US-EVID-016 correction circuit breaker", () => {
  it("pauses on three same-story repeated signals (merged into signal_repeat)", () => {
    // REFACTOR-069: same-card oscillation (C④) merged into signal_repeat (C⑤).
    // Same story, same signal, repeated 3+ times → trips as signal_repeat.
    const events: RollEvent[] = [
      { type: "correction:action", storyId: "US-A", action: "return_story", signal: "review-score regression", reason: "r1", ts: 10 },
      { type: "correction:action", storyId: "US-A", action: "route_adjust", signal: "review-score regression", reason: "r2", ts: 20 },
      { type: "correction:action", storyId: "US-A", action: "return_story", signal: "review-score regression", reason: "r3", ts: 30 },
    ];
    expect(correctionCircuitVerdict(events, safety, 30)).toMatchObject({
      action: "pause_and_notify",
      kind: "signal_repeat",
      storyId: "US-A",
      signal: "review-score regression",
      count: 3,
    });
  });

  it("different signals across stories do not falsely trip", () => {
    // Each story has a DIFFERENT signal — none repeats ≥3 times.
    const events: RollEvent[] = [
      { type: "correction:action", storyId: "US-A", action: "return_story", signal: "x", reason: "r1", ts: 10 },
      { type: "correction:action", storyId: "US-B", action: "return_story", signal: "y", reason: "r2", ts: 20 },
      { type: "correction:action", storyId: "US-A", action: "return_story", signal: "z", reason: "r3", ts: 30 },
    ];
    expect(correctionCircuitVerdict(events, safety, 30)).toEqual({ action: "continue" });
  });

  it("single-card signal repeat trips the breaker (oscillation merged into signal_repeat)", () => {
    // REFACTOR-069: single-card signal_repeat should trip just like multi-card.
    const events: RollEvent[] = [
      { type: "correction:action", storyId: "US-A", action: "open_fix", signal: "missing ac-map", reason: "r1", ts: 10 },
      { type: "correction:action", storyId: "US-A", action: "open_fix", signal: "missing ac-map", reason: "r2", ts: 20 },
      { type: "correction:action", storyId: "US-A", action: "open_fix", signal: "missing ac-map", reason: "r3", ts: 30 },
    ];
    expect(correctionCircuitVerdict(events, safety, 30)).toMatchObject({
      action: "pause_and_notify",
      kind: "signal_repeat",
      storyId: "US-A",
      signal: "missing ac-map",
      count: 3,
    });
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

  // FIX-1261: healed-card window cutoff — delivered/superseded cards' signals excluded.
  it("excludes correction signals from delivered cards", () => {
    const events: RollEvent[] = [
      { type: "cycle:terminal", cycleId: "c-healed", storyId: "FIX-1251", agent: "pi", model: "sonnet", outcome: "delivered", startedAt: 1, endedAt: 2, ts: 5 } as RollEvent,
      { type: "correction:action", storyId: "FIX-1251", cycleId: "c-healed", action: "alert_only", signal: "unknown_failure", reason: "old failure", ts: 3 },
      { type: "correction:action", storyId: "US-NEW", cycleId: "c-new", action: "open_fix", signal: "unknown_failure", reason: "new failure", ts: 10 },
    ];
    const signals = correctionSignals(events);
    // Only US-NEW's signal should remain; FIX-1251 is healed.
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ storyId: "US-NEW", signal: "unknown_failure" });
  });

  it("excludes attest:gate skipped signals from delivered cards", () => {
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: "c-healed", storyId: "FIX-1251", agent: "pi", model: "sonnet", ts: 1 },
      { type: "cycle:terminal", cycleId: "c-healed", storyId: "FIX-1251", agent: "pi", model: "sonnet", outcome: "delivered", startedAt: 1, endedAt: 2, ts: 5 } as RollEvent,
      { type: "attest:gate", cycleId: "c-healed", verdict: "skipped", reasons: ["no fresh acceptance report"], ts: 2 },
      { type: "cycle:start", cycleId: "c-new", storyId: "US-NEW", agent: "pi", model: "sonnet", ts: 3 },
      { type: "attest:gate", cycleId: "c-new", verdict: "skipped", reasons: ["no fresh acceptance report"], ts: 4 },
    ];
    const signals = correctionSignals(events);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ storyId: "US-NEW", cycleId: "c-new" });
  });

  it("excludes signals from delivery:reconciled superseded cards", () => {
    const events: RollEvent[] = [
      { type: "delivery:reconciled", cycleId: "c-sup", storyId: "FIX-OLD", state: "superseded", mergedBy: "runner", mergeCommit: "abc123", signal: "patch_id", ts: 5 } as RollEvent,
      { type: "correction:action", storyId: "FIX-OLD", cycleId: "c-sup", action: "alert_only", signal: "unknown_failure", reason: "old", ts: 3 },
      { type: "correction:action", storyId: "US-NEW", cycleId: "c-new", action: "open_fix", signal: "unknown_failure", reason: "new", ts: 10 },
    ];
    const signals = correctionSignals(events);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ storyId: "US-NEW" });
  });

  it("healed-card filter: circuit breaker does NOT trip when healed card's old signals would push count over threshold", () => {
    // FIX-1251 (delivered) has 2 old unknown_failure signals.
    // US-NEW has 1 unknown_failure. Total unknown_failure = 3 in window,
    // but FIX-1251's 2 signals are excluded → only 1 counts → no trip.
    const events: RollEvent[] = [
      { type: "cycle:terminal", cycleId: "c-healed", storyId: "FIX-1251", agent: "pi", model: "sonnet", outcome: "delivered", startedAt: 1, endedAt: 2, ts: 999 } as RollEvent,
      { type: "correction:action", storyId: "FIX-1251", cycleId: "c-healed", action: "alert_only", signal: "unknown_failure", reason: "old 1", ts: 10 },
      { type: "correction:action", storyId: "FIX-1251", cycleId: "c-healed", action: "alert_only", signal: "unknown_failure", reason: "old 2", ts: 20 },
      { type: "correction:action", storyId: "US-NEW", cycleId: "c-new", action: "open_fix", signal: "unknown_failure", reason: "new 1", ts: 30 },
    ];
    // Without heal filter: 3 unknown_failure in window → trip.
    // With heal filter: only 1 → continue.
    expect(correctionCircuitVerdict(events, safety, 30)).toEqual({ action: "continue" });
  });

  it("healed-card filter: still trips when NON-healed cards' signals reach threshold", () => {
    // Three DIFFERENT non-healed cards each have unknown_failure → should still trip.
    const events: RollEvent[] = [
      { type: "correction:action", storyId: "US-A", cycleId: "c1", action: "alert_only", signal: "unknown_failure", reason: "r1", ts: 10 },
      { type: "correction:action", storyId: "US-B", cycleId: "c2", action: "alert_only", signal: "unknown_failure", reason: "r2", ts: 20 },
      { type: "correction:action", storyId: "US-C", cycleId: "c3", action: "alert_only", signal: "unknown_failure", reason: "r3", ts: 30 },
    ];
    expect(correctionCircuitVerdict(events, safety, 30)).toMatchObject({
      action: "pause_and_notify",
      signal: "unknown_failure",
      count: 3,
    });
  });
});
