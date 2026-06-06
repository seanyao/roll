/**
 * Frozen-expectation test: ci-loop pure decisions.
 *
 * The FIX-103 red-conclusion selection was proven byte-equal to the bash/jq
 * oracle (bin/roll 11237-11239) under diff-test. Per US-PORT-009b the oracle is
 * now retired: the jq spawn is dropped and {@link redConclusions} is asserted
 * against the frozen expected values captured while the oracle agreed
 * (jq `unique` sorts ascending; redConclusions returns sorted-unique).
 *
 * The heal dispatch / pre-run gate side effects (state-file upsert, agent
 * spawn, ALERT write) drive real processes, so they stay behaviour-tested in
 * ci-loop.test.ts and documented-not-difftested per the module header.
 */
import { describe, expect, it } from "vitest";
import { type CiRunRow, redConclusions } from "../src/loop/ci-loop.js";

describe("frozen: redConclusions == FIX-103 jq (bin/roll 11237-11239)", () => {
  const cases: Array<{ rows: CiRunRow[]; expected: string[] }> = [
    { rows: [], expected: [] },
    { rows: [{ conclusion: "success" }], expected: [] },
    { rows: [{ conclusion: null, status: "in_progress" }], expected: [] },
    { rows: [{ conclusion: "failure" }], expected: ["failure"] },
    { rows: [{ conclusion: "failure" }, { conclusion: "failure" }], expected: ["failure"] },
    { rows: [{ conclusion: "failure" }, { conclusion: "timed_out" }], expected: ["failure", "timed_out"] },
    {
      rows: [{ conclusion: "cancelled" }, { conclusion: "action_required" }, { conclusion: "startup_failure" }],
      expected: ["action_required", "cancelled", "startup_failure"],
    },
    {
      rows: [{ conclusion: "success" }, { conclusion: "failure" }, { conclusion: "skipped" }],
      expected: ["failure"],
    },
    { rows: [{ conclusion: "neutral" }, { conclusion: null }], expected: [] },
    {
      rows: [{ conclusion: "timed_out" }, { conclusion: "timed_out" }, { conclusion: "failure" }],
      expected: ["failure", "timed_out"],
    },
  ];
  for (const { rows, expected } of cases) {
    it(`[${rows.map((r) => r.conclusion).join(",")}] agrees`, () => {
      expect(redConclusions(rows)).toEqual(expected);
    });
  }
});
