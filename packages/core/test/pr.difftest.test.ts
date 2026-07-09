/**
 * Frozen-expectation test: PRLifecycle pure helpers.
 *
 * These helpers were proven byte-equal to the bash oracle (bin/roll) under
 * diff-test. Per US-PORT-009b the oracle is retired — the `awk`/`bash`/`git`
 * spawns are dropped and each case asserts against the frozen value captured
 * while the oracle agreed:
 *
 *   - claimed-story id extraction (`_loop_pr_claimed_stories` awk +
 *     `awk 'NF' | sort -u`, bin/roll:12551-12557) vs
 *     {@link parseClaimedIdsFromBacklog} + {@link dedupeSortedIds}.
 *   - the `${branch#loop/}` title-suffix expansion vs {@link branchTitleSuffix}.
 *   - the `_loop_emit_pr_final` state→outcome `case` (bin/roll:13564-13569) vs
 *     {@link prStateToOutcome}.
 */
import { describe, expect, it } from "vitest";
import {
  branchTitleSuffix,
  dedupeSortedIds,
  parseClaimedIdsFromBacklog,
  prStateToOutcome,
} from "../src/index.js";

describe("frozen: claimed-id extraction == awk + sort -u", () => {
  const CASES: Array<{ content: string; expected: string[] }> = [
    {
      content: [
        "| [US-A](features/a.md) | desc | 🔨 In Progress |",
        "| FIX-9 | bare id | 🔨 In Progress |",
        "| US-B | not in progress | 📋 Todo |",
        "| [US-C](url) | done | ✅ Done |",
      ].join("\n"),
      expected: ["FIX-9", "US-A"],
    },
    {
      content: [
        "| [US-Z](z) | z | 🔨 In Progress |",
        "| [US-A](a) | a | 🔨 In Progress |",
        "| [US-Z](z2) | dup | 🔨 In Progress |",
      ].join("\n"),
      expected: ["US-A", "US-Z"],
    },
    { content: "|  | empty id | 🔨 In Progress |", expected: [] },
    { content: "no rows at all", expected: [] },
  ];

  for (const [i, { content, expected }] of CASES.entries()) {
    it(`case ${i}`, () => {
      expect(dedupeSortedIds(parseClaimedIdsFromBacklog(content))).toEqual(expected);
    });
  }
});

describe("frozen: branchTitleSuffix == ${branch#loop/}", () => {
  const CASES: Array<[string, string]> = [
    ["loop/cycle-abc", "cycle-abc"],
    ["worktree-agent-x", "worktree-agent-x"],
    ["claude/foo", "claude/foo"],
    ["loop/loop/x", "loop/x"],
  ];
  for (const [branch, expected] of CASES) {
    it(`branch='${branch}'`, () => {
      expect(branchTitleSuffix(branch)).toBe(expected);
    });
  }
});

describe("frozen: prStateToOutcome == _loop_emit_pr_final case", () => {
  const CASES: Array<[string, string]> = [
    ["MERGED", "merged"],
    ["CLOSED", "closed"],
    ["OPEN", "open"],
    ["UNKNOWN", "open"],
    ["weird", "open"],
  ];
  for (const [state, expected] of CASES) {
    it(`state='${state}'`, () => {
      expect(prStateToOutcome(state)).toBe(expected);
    });
  }
});

