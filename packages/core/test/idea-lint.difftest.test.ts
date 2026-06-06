/**
 * Frozen-expectation test: TS `lintIdeaDescription`.
 *
 * `lintIdeaDescription` was proven byte-equal to the bash oracle `_backlog_lint`
 * (bin/roll ~14418-14510) under diff-test: extract with `sed`, run over a
 * one-row `.roll/backlog.md`, compare the violated-category set (normalising the
 * oracle's `length>NN` tag to `length`). Per US-PORT-009b the oracle is retired:
 * the `bash`/`sed` spawn is dropped and each fixture carries the frozen sorted
 * category set captured while the oracle agreed. Inputs are fixed strings →
 * portable literals.
 */
import { describe, expect, it } from "vitest";
import { lintIdeaDescription } from "../src/backlog/idea.js";

const FIXTURES: Array<{ name: string; desc: string; expected: string[] }> = [
  { name: "clean prose", desc: "make the dashboard load faster on first paint", expected: [] },
  { name: "over-length", desc: "y".repeat(130), expected: ["length"] },
  // No actual backtick here — clean prose despite the name (the real fence case is below).
  { name: "no fence despite 'backtick' word", desc: "wire up the backtick token here please", expected: [] },
  { name: "filename", desc: "update config.yaml defaults", expected: ["filename"] },
  { name: "path", desc: "look inside src/foo for it", expected: ["path"] },
  { name: "function name", desc: "call _helper to refresh", expected: ["function"] },
  { name: "multi: filename+path", desc: "patch the issue in src/app.ts and rebuild", expected: ["filename", "path"] },
];

describe("frozen: lintIdeaDescription == bash _backlog_lint categories", () => {
  for (const f of FIXTURES) {
    it(`${f.name} — categories match the frozen oracle set`, () => {
      expect([...lintIdeaDescription(f.desc)].sort()).toEqual(f.expected);
    });
  }

  it("backtick fence — code-fence category", () => {
    // Kept separate so the backtick lives in a JS template literal, not the
    // fixture table above (clarity).
    const desc = "use the `helper` module";
    expect([...lintIdeaDescription(desc)].sort()).toEqual(["code-fence"]);
  });
});
