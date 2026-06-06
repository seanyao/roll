/**
 * US-PORT-012 — the single signal口径 ("一处定义两处消费").
 *
 * `signals.ts` is the one place that decides "what is a turning-point signal".
 * Two consumers read it:
 *   - the acceptance-report timeline (transcript.ts, RollEvent stream)
 *   - the observation-window formatter (loop-fmt.ts, agent stream-json)
 * These pins guarantee the two never drift: the markers transcript.ts tags as
 * `signal` are EXACTLY the ones signalKindForMarker classifies, and the kinds
 * are a closed, shared set.
 */
import type { RollEvent } from "@roll/spec";
import { describe, expect, it } from "vitest";
import { SIGNAL_KINDS, signalKindForMarker } from "../src/loop/signals.js";
import { extractCycleSignals } from "../src/loop/transcript.js";

describe("signalKindForMarker — the shared taxonomy", () => {
  it("maps every turning-point marker to its kind", () => {
    expect(signalKindForMarker("tcr")).toBe("tcr");
    expect(signalKindForMarker("ci:pass")).toBe("ci");
    expect(signalKindForMarker("ci:fail")).toBe("ci");
    expect(signalKindForMarker("ci:rerun")).toBe("ci");
    expect(signalKindForMarker("peer:gate")).toBe("peer");
    expect(signalKindForMarker("attest:gate")).toBe("attest");
    expect(signalKindForMarker("pr:open")).toBe("pr");
    expect(signalKindForMarker("pr:merge")).toBe("pr");
    expect(signalKindForMarker("pr:close")).toBe("pr");
    expect(signalKindForMarker("pr:rebase")).toBe("pr");
    expect(signalKindForMarker("alert")).toBe("alert");
  });

  it("returns null for outline / non-signal markers", () => {
    expect(signalKindForMarker("cycle:start")).toBeNull();
    expect(signalKindForMarker("cycle:end")).toBeNull();
    expect(signalKindForMarker("phase:execute")).toBeNull();
    expect(signalKindForMarker("")).toBeNull();
    expect(signalKindForMarker("unknown")).toBeNull();
  });

  it("SIGNAL_KINDS is the closed set every classified kind belongs to", () => {
    for (const m of ["tcr", "ci:pass", "peer:gate", "attest:gate", "pr:merge", "alert"]) {
      const k = signalKindForMarker(m);
      expect(k).not.toBeNull();
      expect(SIGNAL_KINDS).toContain(k!);
    }
  });

  it("AC2 same-source: every transcript signal-layer entry maps to a non-null kind", () => {
    const CYCLE = "C";
    const events: RollEvent[] = [
      { type: "cycle:start", cycleId: CYCLE, storyId: "S", agent: "a", model: "m", ts: 1000 },
      { type: "cycle:tcr", cycleId: CYCLE, commitHash: "abcdef123", message: "tcr: x", ts: 1010 },
      { type: "ci:pass", prNumber: 1, ts: 1020 },
      { type: "ci:fail", prNumber: 1, failSummary: "boom", ts: 1025 },
      { type: "peer:gate", cycleId: CYCLE, verdict: "consulted", reasons: [], ts: 1030 },
      { type: "attest:gate", cycleId: CYCLE, verdict: "produced", reasons: [], ts: 1035 },
      { type: "pr:open", prNumber: 1, storyId: "S", ts: 1040 },
      { type: "pr:merge", prNumber: 1, storyId: "S", ts: 1050 },
      { type: "alert:notify", channel: "loop", message: "stuck", ts: 1060 },
      { type: "cycle:end", cycleId: CYCLE, outcome: "delivered", cost: { cycleId: CYCLE, agent: "a", model: "m", tokensIn: 0, tokensOut: 0, estimatedCost: 0, revertCount: 0, effectiveCost: 0 }, ts: 1070 },
    ];
    const { turningPoints } = extractCycleSignals(events, CYCLE);
    // every signal-layer marker the report surfaces is classifiable by the
    // shared taxonomy — the report and the watch window share one口径.
    for (const tp of turningPoints) {
      expect(signalKindForMarker(tp.marker)).not.toBeNull();
    }
    expect(turningPoints.length).toBeGreaterThan(0);
  });
});
