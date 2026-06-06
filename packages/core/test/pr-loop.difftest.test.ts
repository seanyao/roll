/**
 * Frozen-expectation test: pr-loop pure decisions.
 *
 * Two load-bearing rules were proven byte-equal to the bash/jq oracle (bin/roll)
 * under diff-test across an exhaustive input matrix. Per US-PORT-009b the oracle
 * is retired: the `jq`/`bash` spawns are dropped and each matrix row asserts
 * against the frozen verdict captured while the oracle agreed.
 *
 *   - the CI statusCheckRollup reduction jq (bin/roll 11996-12000) vs
 *     {@link reduceCiRollup}.
 *   - the `_loop_pr_classify` mergeable/ci `case` (bin/roll 11748-11763) vs
 *     {@link classifyPr}.
 *
 * The orchestration (gh fan-out, rebase git, heal dispatch) drives real
 * processes + side effects, so it stays behaviour-tested in pr-loop.test.ts and
 * documented-not-difftested per the module header.
 */
import { describe, expect, it } from "vitest";
import {
  type CheckConclusion,
  type CiRollupState,
  type MergeStateStatus,
  classifyPr,
  reduceCiRollup,
} from "../src/loop/pr-loop.js";

describe("frozen: reduceCiRollup == jq rollup reduction (bin/roll 11996-12000)", () => {
  const cases: Array<{ rollup: CheckConclusion[]; expected: CiRollupState }> = [
    { rollup: [], expected: "" },
    { rollup: ["SUCCESS"], expected: "success" },
    { rollup: ["SUCCESS", "SKIPPED"], expected: "success" },
    { rollup: ["SUCCESS", "FAILURE"], expected: "failure" },
    { rollup: ["FAILURE"], expected: "failure" },
    { rollup: ["SUCCESS", null], expected: "pending" },
    { rollup: ["SUCCESS", "NEUTRAL"], expected: "pending" },
    { rollup: ["SKIPPED", "SKIPPED"], expected: "success" },
    { rollup: ["FAILURE", "SUCCESS", "SKIPPED"], expected: "failure" },
    { rollup: ["CANCELLED"], expected: "pending" },
    { rollup: [null, null], expected: "pending" },
  ];
  for (const { rollup, expected } of cases) {
    it(`[${rollup.join(",")}] → ${expected || "(empty)"}`, () => {
      expect(reduceCiRollup(rollup)).toBe(expected);
    });
  }
});

describe("frozen: classifyPr == _loop_pr_classify case (bin/roll 11748-11763)", () => {
  const cis: CiRollupState[] = ["failure", "success", "pending", ""];
  const mergeables: MergeStateStatus[] = ["CLEAN", "BEHIND", "DIRTY", "CONFLICTING", "BLOCKED", "UNKNOWN"];
  // Frozen verdicts in (ci × mergeable) row-major order, captured from the agreed oracle.
  const FROZEN = [
    "ci_red", "stale", "stale", "stale", "ci_red", "ci_red",
    "ready", "stale", "stale", "stale", "ready", "ready",
    "ready", "stale", "stale", "stale", "ready", "ready",
    "ready", "stale", "stale", "stale", "ready", "ready",
  ];
  let i = 0;
  for (const ci of cis) {
    for (const mb of mergeables) {
      const expected = FROZEN[i++];
      it(`ci='${ci}' mergeable='${mb}' → ${expected}`, () => {
        expect(classifyPr(ci, mb)).toBe(expected);
      });
    }
  }
});
