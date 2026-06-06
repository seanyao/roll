/**
 * Frozen-expectation test: TS pickStory.
 *
 * pickStory was proven byte-equal to the bash oracle `_loop_pick_next_story`
 * (bin/roll ~13129) + helpers `_loop_story_is_eligible` (~13094) and
 * `_loop_check_depends_on` (~11652) under diff-test, with `gh` stubbed
 * unavailable so the open-PR gate (FIX-141) was empty on both sides. Per
 * US-PORT-009b the oracle is retired: the `sed`-extract + `bash` spawn is
 * dropped and each fixture carries the frozen picked id captured while the
 * oracle agreed. The TS side parses via `parseBacklog`, then `pickStory` with
 * the default (no open PR) predicate.
 */
import { describe, expect, it } from "vitest";
import { parseBacklog, pickStory } from "../src/index.js";

/** TS pick over a fixture (default = no open PRs, matching the retired stubbed gh). */
function tsPick(backlogContent: string): string {
  return pickStory(parseBacklog(backlogContent))?.id ?? "";
}

const FIXTURES: Array<{ name: string; content: string; expected: string }> = [
  {
    name: "FIX priority + satisfied depends-on",
    content: [
      "| ID | Description | Status |",
      "|----|----|----|",
      "| FIX-9 | needs `depends-on:US-A` | 📋 Todo |",
      "| US-A | base | ✅ Done |",
      "| US-B | second | 📋 Todo |",
      "| REFACTOR-1 | cleanup | 📋 Todo |",
      "",
    ].join("\n"),
    expected: "FIX-9",
  },
  {
    name: "status skips (Hold/Blocked/Deferred) + missing dep skip",
    content: [
      "| FIX-1 | needs `depends-on:US-MISSING` | 📋 Todo |",
      "| US-1 | on hold | 🚫 Hold |",
      "| US-2 | blocked | 🔒 Blocked |",
      "| US-3 | deferred | ⏸ Deferred |",
      "| US-4 | good | 📋 Todo |",
      "",
    ].join("\n"),
    expected: "US-4",
  },
  {
    name: "multi-dep one not done — dependent skipped, the dep row itself picked",
    content: [
      "| US-X | x `depends-on:US-A,US-B` | 📋 Todo |",
      "| US-A | a | ✅ Done |",
      "| US-B | b | 📋 Todo |",
      "",
    ].join("\n"),
    expected: "US-B",
  },
  {
    name: "dep id mentioned in another row's description (FIX-161)",
    content: [
      "| US-DONE | done one | ✅ Done |",
      "| US-TODO | mentions US-DONE here | 📋 Todo |",
      "",
    ].join("\n"),
    expected: "US-TODO",
  },
  {
    name: "nothing eligible — empty pick on both sides",
    content: ["| US-1 | a | ✅ Done |", "| FIX-1 | b | 🚫 Hold |", ""].join("\n"),
    expected: "",
  },
  {
    name: "US falls through after FIX/REFACTOR not eligible",
    content: [
      "| FIX-1 | f | 🔒 Blocked |",
      "| REFACTOR-1 | r | ⏸ Deferred |",
      "| US-9 | u | 📋 Todo |",
      "",
    ].join("\n"),
    expected: "US-9",
  },
];

describe("frozen: pickStory == bash _loop_pick_next_story", () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      expect(tsPick(f.content)).toBe(f.expected);
    });
  }
});
