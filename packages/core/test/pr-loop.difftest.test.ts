/**
 * diff-test: pr-loop pure decisions vs the frozen bash/jq oracle (bin/roll).
 *
 * Two load-bearing, byte-diffable rules are transcribed VERBATIM from bin/roll
 * and run against `jq` / `bash` (both confirmed on PATH), then asserted equal to
 * the TS port across an exhaustive input matrix:
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
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  type CheckConclusion,
  type CiRollupState,
  type MergeStateStatus,
  classifyPr,
  reduceCiRollup,
} from "../src/loop/pr-loop.js";

/** The exact jq from bin/roll 11996-12000 (the statusCheckRollup reduction). */
const ROLLUP_JQ = `
  if (.statusCheckRollup | length) == 0 then ""
  elif any(.statusCheckRollup[]?; .conclusion == "FAILURE") then "failure"
  elif all(.statusCheckRollup[]?; .conclusion == "SUCCESS" or .conclusion == "SKIPPED") then "success"
  else "pending" end`;

function bashRollup(conclusions: readonly CheckConclusion[]): string {
  const rollup = conclusions.map((c) => (c === null ? { conclusion: null } : { conclusion: c }));
  const input = JSON.stringify({ statusCheckRollup: rollup });
  return execFileSync("jq", ["-r", ROLLUP_JQ], { input, encoding: "utf8" }).trim();
}

/** Transcribed `_loop_pr_classify` body (bin/roll 11754-11762). */
function bashClassify(ciState: string, mergeable: string): string {
  const script = `
    mergeable="$1"; ci_state="$2"
    case "$mergeable" in
      BEHIND|DIRTY|CONFLICTING) echo "stale"; exit 0 ;;
    esac
    if [ "$ci_state" = "failure" ]; then echo "ci_red"; exit 0; fi
    echo "ready"`;
  return execFileSync("bash", ["-c", script, "bash", mergeable, ciState], { encoding: "utf8" }).trim();
}

describe("diff-test: reduceCiRollup == jq rollup reduction (bin/roll 11996-12000)", () => {
  const matrix: CheckConclusion[][] = [
    [],
    ["SUCCESS"],
    ["SUCCESS", "SKIPPED"],
    ["SUCCESS", "FAILURE"],
    ["FAILURE"],
    ["SUCCESS", null],
    ["SUCCESS", "NEUTRAL"],
    ["SKIPPED", "SKIPPED"],
    ["FAILURE", "SUCCESS", "SKIPPED"],
    ["CANCELLED"],
    [null, null],
  ];
  for (const m of matrix) {
    it(`[${m.join(",")}] agrees`, () => {
      const expected = bashRollup(m) as CiRollupState;
      expect(reduceCiRollup(m)).toBe(expected);
    });
  }
});

describe("diff-test: classifyPr == _loop_pr_classify case (bin/roll 11748-11763)", () => {
  const cis: CiRollupState[] = ["failure", "success", "pending", ""];
  const mergeables: MergeStateStatus[] = ["CLEAN", "BEHIND", "DIRTY", "CONFLICTING", "BLOCKED", "UNKNOWN"];
  for (const ci of cis) {
    for (const mb of mergeables) {
      it(`ci='${ci}' mergeable='${mb}' agrees`, () => {
        const expected = bashClassify(ci, mb);
        expect(classifyPr(ci, mb)).toBe(expected);
      });
    }
  }
});
