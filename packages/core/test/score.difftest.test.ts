/**
 * Frozen-expectation test: @roll/core scoreCycle.
 *
 * `scoreCycle` was proven equal to the python oracle `lib/loop_result_eval.py`
 * (score_cycle) under diff-test (structural compare of the result_eval block).
 * Per US-PORT-009b the oracle is retired: the `python3` spawn is dropped and
 * each case asserts the {version, score, dims} object against the frozen value
 * captured while the oracle agreed.
 *
 * Cases: all-known dims, missing dims (renormalise), failed/zero-tcr, red-idle
 * with orphan, graded-efficiency + rework, way-over-budget floor, drifted.
 */
import { describe, expect, it } from "vitest";
import { type EvalCycleFacts, scoreCycle } from "../src/index.js";

function tsScore(facts: EvalCycleFacts): { version: number; score: number; dims: Record<string, unknown> } {
  const ev = scoreCycle(facts);
  return { version: ev.version, score: ev.score, dims: { ...ev.dims } };
}

const CASES: Array<{ name: string; facts: EvalCycleFacts; expected: { version: number; score: number; dims: Record<string, unknown> } }> = [
  {
    name: "all-known dims (perfect cycle)",
    facts: { status: "merged", ci: "green", routed_story: "US-1", built: ["US-1"], tcr_count: 2, duration_sec: 300, est_min: 10, alerts: [], orphans: [] },
    expected: { version: 1, score: 10, dims: { outcome: 1, correctness: 1, scope_fidelity: 1, quality: 1, efficiency: 1, cleanliness: 1 } },
  },
  {
    name: "missing dims (renormalise) — empty facts",
    facts: {},
    expected: { version: 1, score: 4, dims: { outcome: "unknown", correctness: "unknown", scope_fidelity: 0, quality: "unknown", efficiency: "unknown", cleanliness: 1 } },
  },
  {
    name: "failed outcome, zero-tcr cycle",
    facts: { status: "failed", tcr_count: 0 },
    expected: { version: 1, score: 2, dims: { outcome: 0, correctness: "unknown", scope_fidelity: 0, quality: 0, efficiency: "unknown", cleanliness: 1 } },
  },
  {
    name: "red CI, idle, orphan present",
    facts: { status: "idle", ci: "red", orphans: ["orphan"] },
    expected: { version: 1, score: 1, dims: { outcome: 0, correctness: 0, scope_fidelity: 0, quality: "unknown", efficiency: "unknown", cleanliness: 0 } },
  },
  {
    name: "over-budget graded efficiency (2x) + rework quality",
    facts: { duration_sec: 1200, est_min: 10, tcr_count: 1, rework_fix: "FIX-9" },
    expected: { version: 1, score: 5, dims: { outcome: "unknown", correctness: "unknown", scope_fidelity: 0, quality: 0.5, efficiency: 0.6, cleanliness: 1 } },
  },
  {
    name: "way-over-budget efficiency floor (5x)",
    facts: { duration_sec: 3000, est_min: 10 },
    expected: { version: 1, score: 4, dims: { outcome: "unknown", correctness: "unknown", scope_fidelity: 0, quality: "unknown", efficiency: 0.2, cleanliness: 1 } },
  },
  {
    name: "routed but nothing built (drifted) + merged flag",
    facts: { merged: true, routed_story: "US-7", built: ["US-8"], ci: "success" },
    expected: { version: 1, score: 8, dims: { outcome: 1, correctness: 1, scope_fidelity: 0, quality: "unknown", efficiency: "unknown", cleanliness: 1 } },
  },
];

describe("frozen: scoreCycle == loop_result_eval.py score_cycle", () => {
  for (const { name, facts, expected } of CASES) {
    it(name, () => {
      expect(tsScore(facts)).toEqual(expected);
    });
  }
});
