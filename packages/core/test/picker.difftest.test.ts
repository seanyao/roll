/**
 * diff-test: TS pickStory vs the frozen bash oracle `_loop_pick_next_story`
 * (bin/roll ~13129), with its helpers `_loop_story_is_eligible` (~13094) and
 * `_loop_check_depends_on` (~11652).
 *
 * Extraction: the three functions are cleanly extractable (harness style from
 * packages/spec/test/project.difftest.test.ts). The only external dependency is
 * the `gh pr list` open-PR probe (FIX-141); we stub `command` to report `gh`
 * unavailable, which the oracle treats as "no PR skipping" — so the diff-test
 * exercises the status + depends-on + file-order gates against an identical
 * empty open-PR set on both sides.
 *
 * The TS side parses the same fixture via `parseBacklog`, then `pickStory` with
 * the default (no open PR) predicate, mirroring the stubbed bash.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseBacklog, pickStory } from "../src/index.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

/** Run the extracted bash pick over a fixture; return the chosen id ("" if none). */
function bashPick(backlogContent: string): string {
  const proj = mkdtempSync(join(tmpdir(), "roll-pick-"));
  dirs.push(proj);
  mkdirSync(join(proj, ".roll"), { recursive: true });
  writeFileSync(join(proj, ".roll", "backlog.md"), backlogContent, "utf8");
  const script = [
    "command() { return 1; }", // gh unavailable → oracle skips the PR gate
    `eval "$(sed -n '/^_loop_check_depends_on()/,/^}$/p' "$ROLLBIN")"`,
    `eval "$(sed -n '/^_loop_story_is_eligible()/,/^}$/p' "$ROLLBIN")"`,
    `eval "$(sed -n '/^_loop_pick_next_story()/,/^}$/p' "$ROLLBIN")"`,
    "_loop_pick_next_story .roll/backlog.md",
  ].join("\n");
  // The oracle exits 1 (and prints nothing) when no story is eligible; that is
  // a valid "no pick" result, not a harness error — capture stdout regardless.
  try {
    const out = execFileSync("bash", ["-c", script], {
      cwd: proj,
      encoding: "utf8",
      env: { ...process.env, ROLLBIN: `${REPO}/bin/roll` },
    });
    return out.trim();
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1) return (e.stdout ?? "").trim();
    throw err;
  }
}

/** TS pick over the same fixture (default = no open PRs, matching stubbed gh). */
function tsPick(backlogContent: string): string {
  return pickStory(parseBacklog(backlogContent))?.id ?? "";
}

const FIXTURES: Array<{ name: string; content: string }> = [
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
  },
  {
    name: "multi-dep one not done — dependent skipped, the dep row itself picked",
    content: [
      "| US-X | x `depends-on:US-A,US-B` | 📋 Todo |",
      "| US-A | a | ✅ Done |",
      "| US-B | b | 📋 Todo |",
      "",
    ].join("\n"),
  },
  {
    name: "dep id mentioned in another row's description (FIX-161)",
    content: [
      "| US-DONE | done one | ✅ Done |",
      "| US-TODO | mentions US-DONE here | 📋 Todo |",
      "",
    ].join("\n"),
  },
  {
    name: "nothing eligible — empty pick on both sides",
    content: ["| US-1 | a | ✅ Done |", "| FIX-1 | b | 🚫 Hold |", ""].join("\n"),
  },
  {
    name: "US falls through after FIX/REFACTOR not eligible",
    content: [
      "| FIX-1 | f | 🔒 Blocked |",
      "| REFACTOR-1 | r | ⏸ Deferred |",
      "| US-9 | u | 📋 Todo |",
      "",
    ].join("\n"),
  },
];

describe("diff-test: pickStory == bash _loop_pick_next_story", () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      expect(tsPick(f.content)).toBe(bashPick(f.content));
    });
  }
});
