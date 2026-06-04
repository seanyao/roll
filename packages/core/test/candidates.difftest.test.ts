/**
 * diff-test: @roll/core detectSignals vs the frozen python oracle
 * `lib/loop_result_eval.py` (detect_signals).
 *
 * CLI contract (loop_result_eval.py:418-453): `python3 lib/loop_result_eval.py
 * --signals [--streak N] --facts '<json-array>'` reads an ordered (oldest→newest)
 * array of runs records and prints the detected signals as JSON (sort_keys=True).
 * We value-compare the parsed arrays.
 *
 * Cases: clean 3-streak, unknown-gap (skipped, streak survives), broken-by-good,
 * multi-dimension order, custom streak, sub-streak (no fire).
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type EvalRecord, detectSignals } from "../src/index.js";

const REPO = resolve(__dirname, "../../..");
const ORACLE = `${REPO}/lib/loop_result_eval.py`;

/** Spawn the python oracle's --signals path; return its parsed signal array. */
function pySignals(records: EvalRecord[], streak?: number): unknown[] {
  const args = [ORACLE, "--signals"];
  if (streak !== undefined) args.push("--streak", String(streak));
  args.push("--facts", JSON.stringify(records));
  return JSON.parse(execFileSync("python3", args, { encoding: "utf8" }).trim());
}

/** The py emits keys sorted; align object key order via JSON round-trip parse. */
function norm(arr: unknown[]): unknown[] {
  return JSON.parse(JSON.stringify(arr));
}

const low = (dim: string): EvalRecord => ({ dims: { [dim]: 0.0 } });
const good = (dim: string): EvalRecord => ({ dims: { [dim]: 1.0 } });
const unk = (dim: string): EvalRecord => ({ dims: { [dim]: "unknown" } });

const CASES: { name: string; records: EvalRecord[]; streak?: number }[] = [
  { name: "clean 3-streak fires", records: [low("outcome"), low("outcome"), low("outcome")] },
  { name: "sub-streak (2) does not fire", records: [low("outcome"), low("outcome")] },
  {
    name: "unknown gap skipped — streak survives",
    records: [low("correctness"), unk("correctness"), low("correctness"), low("correctness")],
  },
  {
    name: "broken by a known-good cycle",
    records: [low("outcome"), good("outcome"), low("outcome"), low("outcome")],
  },
  {
    name: "multi-dimension fire in DIMENSIONS order",
    records: [
      { dims: { outcome: 0.0, quality: 0.0, scope_fidelity: 0.0 } },
      { dims: { outcome: 0.0, quality: 0.0, scope_fidelity: 0.0 } },
      { dims: { outcome: 0.0, quality: 0.0, scope_fidelity: 0.0 } },
    ],
  },
  {
    name: "custom streak 2",
    records: [low("efficiency"), low("efficiency")],
    streak: 2,
  },
  {
    name: "full runs record wrapping (result_eval block)",
    records: [
      { result_eval: { score: 1, dims: { outcome: 0.0 } } },
      { result_eval: { score: 1, dims: { outcome: 0.0 } } },
      { result_eval: { score: 1, dims: { outcome: 0.0 } } },
    ],
  },
  { name: "empty records", records: [] },
];

describe("diff-test: detectSignals == loop_result_eval.py detect_signals", () => {
  for (const { name, records, streak } of CASES) {
    it(name, () => {
      const py = pySignals(records, streak);
      const ts = norm(detectSignals(records, streak ?? undefined) as unknown[]);
      expect(ts).toEqual(py);
    });
  }
});
