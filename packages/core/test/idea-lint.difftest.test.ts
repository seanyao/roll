/**
 * diff-test: TS `lintIdeaDescription` vs the frozen bash oracle `_backlog_lint`
 * (bin/roll ~14418-14510).
 *
 * "过 lint 规则" (US-PORT-003) means a captured card must clear the SAME backlog
 * linter the rest of the toolchain enforces. This test proves the TS lint
 * categories agree with the bash linter's per-row category set on a battery of
 * fixtures: extract `_backlog_lint` with `sed`, stub its `msg`/`err`/`warn`
 * helpers, run it over a one-row `.roll/backlog.md`, and compare the violated
 * categories (normalising the oracle's `length>NN` tag to `length`).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { lintIdeaDescription } from "../src/backlog/idea.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

/** Run the extracted bash `_backlog_lint` over a one-row backlog; return the
 *  normalised set of violated categories for that row. */
function bashLintCategories(desc: string): string[] {
  const proj = mkdtempSync(join(tmpdir(), "roll-idea-lint-"));
  dirs.push(proj);
  mkdirSync(join(proj, ".roll"), { recursive: true });
  const path = join(proj, ".roll", "backlog.md");
  const content = [
    "| Story | Description | Status |",
    "|-------|-------------|--------|",
    `| FIX-001 | ${desc} | 📋 Todo |`,
    "",
  ].join("\n");
  writeFileSync(path, content, "utf8");
  // Stub the i18n/log helpers `_backlog_lint` calls in its summary tail so the
  // function returns 0 (warn-only, no --gate) instead of erroring on undefined
  // `msg`. The per-row violation lines we parse are printed before the tail.
  const script = [
    "msg() { :; }",
    "err() { echo \"$*\" >&2; }",
    "warn() { echo \"$*\" >&2; }",
    `eval "$(sed -n '/^_backlog_lint()/,/^}$/p' '${REPO}/bin/roll')"`,
    '_backlog_lint "$1"',
  ].join("\n");
  const stdout = execFileSync("bash", ["-c", script, "bash", path], {
    cwd: proj,
    encoding: "utf8",
  });
  // Violation line shape: `<path>:<lineno>: FIX-001 — <cat>, <cat>`
  const line = stdout.split("\n").find((l) => / FIX-001 — /.test(l));
  if (line === undefined) return [];
  const tags = line.split(" — ")[1] ?? "";
  return tags
    .split(",")
    .map((t) => t.trim().replace(/^length>.*/, "length"))
    .filter((t) => t.length > 0)
    .sort();
}

const FIXTURES: Array<{ name: string; desc: string }> = [
  { name: "clean prose", desc: "make the dashboard load faster on first paint" },
  { name: "over-length", desc: "y".repeat(130) },
  { name: "code fence", desc: "wire up the backtick token here please" }, // see below
  { name: "filename", desc: "update config.yaml defaults" },
  { name: "path", desc: "look inside src/foo for it" },
  { name: "function name", desc: "call _helper to refresh" },
  { name: "multi: code+filename+path", desc: "patch the issue in src/app.ts and rebuild" },
];

describe("diff-test: lintIdeaDescription == bash _backlog_lint categories", () => {
  for (const f of FIXTURES) {
    it(`${f.name} — categories agree with the oracle`, () => {
      const bash = bashLintCategories(f.desc);
      const ts = [...lintIdeaDescription(f.desc)].sort();
      expect(ts).toEqual(bash);
    });
  }

  it("backtick fence agrees with the oracle", () => {
    // Kept separate so the backtick lives in a JS template literal, not the
    // fixture table above (clarity).
    const desc = "use the `helper` module";
    expect([...lintIdeaDescription(desc)].sort()).toEqual(bashLintCategories(desc));
  });
});
