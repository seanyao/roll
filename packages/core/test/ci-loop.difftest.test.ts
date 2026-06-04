/**
 * diff-test: ci-loop pure decisions vs the frozen bash/jq oracle (bin/roll).
 *
 * Byte-diffable rules transcribed VERBATIM from bin/roll and run against `jq`:
 *   - the FIX-103 red-conclusion selection jq (bin/roll 11237-11239) vs
 *     {@link redConclusions}.
 *
 * The heal dispatch / pre-run gate side effects (state-file upsert, agent
 * spawn, ALERT write) drive real processes, so they stay behaviour-tested in
 * ci-loop.test.ts and documented-not-difftested per the module header.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { type CiRunRow, redConclusions } from "../src/loop/ci-loop.js";

/** The exact jq from bin/roll 11237-11239 (failed-conclusion selection). */
const FAILED_JQ =
  '[.[] | select(.conclusion=="failure" or .conclusion=="cancelled" or .conclusion=="timed_out" or .conclusion=="action_required" or .conclusion=="startup_failure") | .conclusion] | unique | join(",")';

function bashRed(runs: readonly CiRunRow[]): string[] {
  const input = JSON.stringify(runs.map((r) => ({ conclusion: r.conclusion ?? null, status: r.status ?? null })));
  const out = execFileSync("jq", ["-r", FAILED_JQ], { input, encoding: "utf8" }).trim();
  return out === "" ? [] : out.split(",");
}

describe("diff-test: redConclusions == FIX-103 jq (bin/roll 11237-11239)", () => {
  const matrix: CiRunRow[][] = [
    [],
    [{ conclusion: "success" }],
    [{ conclusion: null, status: "in_progress" }],
    [{ conclusion: "failure" }],
    [{ conclusion: "failure" }, { conclusion: "failure" }],
    [{ conclusion: "failure" }, { conclusion: "timed_out" }],
    [{ conclusion: "cancelled" }, { conclusion: "action_required" }, { conclusion: "startup_failure" }],
    [{ conclusion: "success" }, { conclusion: "failure" }, { conclusion: "skipped" }],
    [{ conclusion: "neutral" }, { conclusion: null }],
    [{ conclusion: "timed_out" }, { conclusion: "timed_out" }, { conclusion: "failure" }],
  ];
  for (const m of matrix) {
    it(`[${m.map((r) => r.conclusion).join(",")}] agrees`, () => {
      // jq `unique` sorts ascending — our redConclusions also returns sorted-unique.
      const expected = bashRed(m).sort();
      expect(redConclusions(m)).toEqual(expected);
    });
  }
});
