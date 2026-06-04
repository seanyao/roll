/**
 * diff-test: @roll/core scoreCycle vs the frozen python oracle
 * `lib/loop_result_eval.py` (score_cycle / main).
 *
 * CLI contract (loop_result_eval.py:414-465): `python3 lib/loop_result_eval.py
 * --facts '<json>'` prints the result_eval block as JSON (sort_keys=True). We
 * value-compare the parsed object (not bytes — the py sorts keys and emits
 * `1.0` where JS would print `1`, so a structural compare is the faithful test).
 *
 * Cases per the card: all-known dims, missing dims (renormalise), failed
 * outcome, zero-tcr cycle — plus the graded-efficiency + rework paths.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type EvalCycleFacts, scoreCycle } from "../src/index.js";

const REPO = resolve(__dirname, "../../..");
const ORACLE = `${REPO}/lib/loop_result_eval.py`;

/** Spawn the python oracle on a facts object; return its parsed result_eval. */
function pyScore(facts: EvalCycleFacts): { version: number; score: number; dims: Record<string, unknown> } {
  const out = execFileSync("python3", [ORACLE, "--facts", JSON.stringify(facts)], {
    encoding: "utf8",
  });
  return JSON.parse(out.trim());
}

/** Normalise the TS result_eval to the py's JSON shape (numbers compare equal). */
function tsScore(facts: EvalCycleFacts): { version: number; score: number; dims: Record<string, unknown> } {
  const ev = scoreCycle(facts);
  return { version: ev.version, score: ev.score, dims: { ...ev.dims } };
}

const CASES: { name: string; facts: EvalCycleFacts }[] = [
  {
    name: "all-known dims (perfect cycle)",
    facts: {
      status: "merged",
      ci: "green",
      routed_story: "US-1",
      built: ["US-1"],
      tcr_count: 2,
      duration_sec: 300,
      est_min: 10,
      alerts: [],
      orphans: [],
    },
  },
  { name: "missing dims (renormalise) — empty facts", facts: {} },
  { name: "failed outcome, zero-tcr cycle", facts: { status: "failed", tcr_count: 0 } },
  {
    name: "red CI, idle, orphan present",
    facts: { status: "idle", ci: "red", orphans: ["orphan"] },
  },
  {
    name: "over-budget graded efficiency (2x) + rework quality",
    facts: { duration_sec: 1200, est_min: 10, tcr_count: 1, rework_fix: "FIX-9" },
  },
  {
    name: "way-over-budget efficiency floor (5x)",
    facts: { duration_sec: 3000, est_min: 10 },
  },
  {
    name: "routed but nothing built (drifted) + merged flag",
    facts: { merged: true, routed_story: "US-7", built: ["US-8"], ci: "success" },
  },
];

describe("diff-test: scoreCycle == loop_result_eval.py score_cycle", () => {
  for (const { name, facts } of CASES) {
    it(name, () => {
      const py = pyScore(facts);
      const ts = tsScore(facts);
      expect(ts).toEqual(py);
    });
  }
});
