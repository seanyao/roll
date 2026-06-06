/**
 * Frozen-expectation test: @roll/core detectSignals.
 *
 * `detectSignals` was proven equal to the python oracle `lib/loop_result_eval.py`
 * (detect_signals) under diff-test (structural compare of the signal array). Per
 * US-PORT-009b the oracle is retired: the `python3` spawn is dropped and each
 * case asserts the detected-signal array against the frozen value captured while
 * the oracle agreed.
 *
 * Cases: clean 3-streak, sub-streak (no fire), unknown-gap survives, broken by a
 * good cycle, multi-dimension order, custom streak, result_eval wrapping, empty.
 */
import { describe, expect, it } from "vitest";
import { type EvalRecord, detectSignals } from "../src/index.js";

const low = (dim: string): EvalRecord => ({ dims: { [dim]: 0.0 } });
const good = (dim: string): EvalRecord => ({ dims: { [dim]: 1.0 } });
const unk = (dim: string): EvalRecord => ({ dims: { [dim]: "unknown" } });

const CASES: Array<{ name: string; records: EvalRecord[]; streak?: number; expected: unknown[] }> = [
  {
    name: "clean 3-streak fires",
    records: [low("outcome"), low("outcome"), low("outcome")],
    expected: [{ key: "lowdim:outcome", dim: "outcome", kind: "FIX", streak: 3, summary: "cycles keep failing to merge into main for 3 cycles in a row" }],
  },
  { name: "sub-streak (2) does not fire", records: [low("outcome"), low("outcome")], expected: [] },
  {
    name: "unknown gap skipped — streak survives",
    records: [low("correctness"), unk("correctness"), low("correctness"), low("correctness")],
    expected: [{ key: "lowdim:correctness", dim: "correctness", kind: "FIX", streak: 3, summary: "produced PRs keep failing CI for 3 cycles in a row" }],
  },
  { name: "broken by a known-good cycle", records: [low("outcome"), good("outcome"), low("outcome"), low("outcome")], expected: [] },
  {
    name: "multi-dimension fire in DIMENSIONS order",
    records: [
      { dims: { outcome: 0.0, quality: 0.0, scope_fidelity: 0.0 } },
      { dims: { outcome: 0.0, quality: 0.0, scope_fidelity: 0.0 } },
      { dims: { outcome: 0.0, quality: 0.0, scope_fidelity: 0.0 } },
    ],
    expected: [
      { key: "lowdim:outcome", dim: "outcome", kind: "FIX", streak: 3, summary: "cycles keep failing to merge into main for 3 cycles in a row" },
      { key: "lowdim:scope_fidelity", dim: "scope_fidelity", kind: "IDEA", streak: 3, summary: "cycles keep going idle or off-scope for 3 cycles in a row" },
      { key: "lowdim:quality", dim: "quality", kind: "FIX", streak: 3, summary: "cycles keep landing without test activity for 3 cycles in a row" },
    ],
  },
  {
    name: "custom streak 2",
    records: [low("efficiency"), low("efficiency")],
    streak: 2,
    expected: [{ key: "lowdim:efficiency", dim: "efficiency", kind: "IDEA", streak: 2, summary: "cycles keep blowing past their est_min budget for 2 cycles in a row" }],
  },
  {
    name: "full runs record wrapping (result_eval block)",
    records: [
      { result_eval: { score: 1, dims: { outcome: 0.0 } } },
      { result_eval: { score: 1, dims: { outcome: 0.0 } } },
      { result_eval: { score: 1, dims: { outcome: 0.0 } } },
    ],
    expected: [{ key: "lowdim:outcome", dim: "outcome", kind: "FIX", streak: 3, summary: "cycles keep failing to merge into main for 3 cycles in a row" }],
  },
  { name: "empty records", records: [], expected: [] },
];

describe("frozen: detectSignals == loop_result_eval.py detect_signals", () => {
  for (const { name, records, streak, expected } of CASES) {
    it(name, () => {
      const ts = JSON.parse(JSON.stringify(detectSignals(records, streak))) as unknown[];
      expect(ts).toEqual(expected);
    });
  }
});
