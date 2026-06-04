/**
 * Unit tests for the six-dimension eval rubric (US-CORE-012, port of
 * lib/loop_result_eval.py scoring half).
 */
import { describe, expect, it } from "vitest";
import { UNKNOWN, aggregate, roundHalfEven, scoreCycle, scoreDimensions } from "../src/index.js";

describe("scoreDimensions — per-dimension scorers", () => {
  it("all-known dims: merged, green CI, on-scope, tested, on-budget, clean", () => {
    const dims = scoreDimensions({
      status: "merged",
      ci: "green",
      routed_story: "US-1",
      built: ["US-1"],
      tcr_count: 2,
      duration_sec: 300,
      est_min: 10,
      alerts: [],
      orphans: [],
    });
    expect(dims).toEqual({
      outcome: 1.0,
      correctness: 1.0,
      scope_fidelity: 1.0,
      quality: 1.0,
      efficiency: 1.0,
      cleanliness: 1.0,
    });
  });

  it("outcome: no merged key and no status → unknown; merged flag honoured", () => {
    expect(scoreDimensions({}).outcome).toBe(UNKNOWN);
    expect(scoreDimensions({ merged: true }).outcome).toBe(1.0);
    expect(scoreDimensions({ merged: false }).outcome).toBe(0.0);
    expect(scoreDimensions({ status: "failed" }).outcome).toBe(0.0);
  });

  it("correctness: green/red vocab + unknown otherwise", () => {
    expect(scoreDimensions({ ci: "passing" }).correctness).toBe(1.0);
    expect(scoreDimensions({ ci: "failure" }).correctness).toBe(0.0);
    expect(scoreDimensions({ ci: "weird" }).correctness).toBe(UNKNOWN);
    expect(scoreDimensions({ ci: "" }).correctness).toBe(UNKNOWN);
    expect(scoreDimensions({}).correctness).toBe(UNKNOWN);
  });

  it("scope_fidelity: idle / no routed → 0; routed+built → 1; routed not built → 0", () => {
    expect(scoreDimensions({ status: "idle" }).scope_fidelity).toBe(0.0);
    expect(scoreDimensions({ routed_story: "US-1", built: ["US-1"] }).scope_fidelity).toBe(1.0);
    expect(scoreDimensions({ routed_story: "US-1", built: ["US-2"] }).scope_fidelity).toBe(0.0);
  });

  it("quality: missing tcr → unknown; 0 → 0; >=1 → 1; rework → 0.5", () => {
    expect(scoreDimensions({}).quality).toBe(UNKNOWN);
    expect(scoreDimensions({ tcr_count: 0 }).quality).toBe(0.0);
    expect(scoreDimensions({ tcr_count: 3 }).quality).toBe(1.0);
    expect(scoreDimensions({ tcr_count: 3, rework_fix: "FIX-9" }).quality).toBe(0.5);
  });

  it("efficiency: within budget → 1; over budget graded; 3x → 0.2 floor", () => {
    expect(scoreDimensions({ duration_sec: 300, est_min: 10 }).efficiency).toBe(1.0);
    // 2x over: 1 - (2-1)*0.4 = 0.6
    expect(scoreDimensions({ duration_sec: 1200, est_min: 10 }).efficiency).toBeCloseTo(0.6, 10);
    // 5x over → clamps to 0.2
    expect(scoreDimensions({ duration_sec: 3000, est_min: 10 }).efficiency).toBe(0.2);
    expect(scoreDimensions({ duration_sec: 300 }).efficiency).toBe(UNKNOWN);
    expect(scoreDimensions({ duration_sec: 300, est_min: 0 }).efficiency).toBe(UNKNOWN);
  });

  it("cleanliness: alerts or orphans → 0; else 1", () => {
    expect(scoreDimensions({}).cleanliness).toBe(1.0);
    expect(scoreDimensions({ alerts: ["a"] }).cleanliness).toBe(0.0);
    expect(scoreDimensions({ orphans: ["orphan"] }).cleanliness).toBe(0.0);
  });
});

describe("aggregate — renormalised 1..10 rollup", () => {
  it("all dims 1.0 → 10", () => {
    expect(aggregate({ outcome: 1, correctness: 1, scope_fidelity: 1, quality: 1, efficiency: 1, cleanliness: 1 })).toBe(10);
  });
  it("all dims 0.0 → 1", () => {
    expect(aggregate({ outcome: 0, correctness: 0, scope_fidelity: 0, quality: 0, efficiency: 0, cleanliness: 0 })).toBe(1);
  });
  it("all unknown → neutral 5", () => {
    expect(aggregate({ outcome: UNKNOWN, correctness: UNKNOWN })).toBe(5);
    expect(aggregate({})).toBe(5);
  });
  it("renormalises over known dims only (missing fact ≠ 0)", () => {
    // Only outcome (w3) known and = 1.0 → weighted 1.0 → score 10, NOT diluted
    // by the absent dims.
    expect(aggregate({ outcome: 1.0 })).toBe(10);
    // outcome=0 alone → 1.
    expect(aggregate({ outcome: 0.0 })).toBe(1);
  });
});

describe("roundHalfEven — Python3 round() banker's rounding", () => {
  it("rounds half to even", () => {
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(3.5)).toBe(4);
    expect(roundHalfEven(0.5)).toBe(0);
    expect(roundHalfEven(1.5)).toBe(2);
    expect(roundHalfEven(2.4)).toBe(2);
    expect(roundHalfEven(2.6)).toBe(3);
  });
});

describe("scoreCycle — full result_eval block", () => {
  it("stamps version + score + dims", () => {
    const ev = scoreCycle({ status: "merged", ci: "green" });
    expect(ev.version).toBe(1);
    expect(ev.score).toBeGreaterThanOrEqual(1);
    expect(ev.score).toBeLessThanOrEqual(10);
    expect(ev.dims.outcome).toBe(1.0);
  });
  it("failed-outcome zero-tcr cycle", () => {
    const ev = scoreCycle({ status: "failed", tcr_count: 0 });
    expect(ev.dims.outcome).toBe(0.0);
    expect(ev.dims.quality).toBe(0.0);
  });
});
