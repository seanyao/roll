/**
 * diff-test: TS BacklogStore marking vs the frozen bash oracle
 * `_backlog_set_status` (bin/roll ~14006-14029).
 *
 * Harness style mirrors packages/spec/test/project.difftest.test.ts: extract the
 * bash function with `sed`, `eval` it, run it against a fixture `.roll/backlog.md`
 * in a temp dir, and compare the resulting file bytes + printed count to the TS
 * `markStatus`.
 *
 * The bash function hardcodes `.roll/backlog.md`, so each case runs in its own
 * temp project dir.
 *
 * NOTE — the FIX-106 trap is a DELIBERATE divergence (see store.ts): bash uses a
 * naive case-insensitive substring (`US-LOOP-01` matches `US-LOOP-019`); the v3
 * store anchors on the id token. That case asserts the divergence explicitly
 * rather than byte-equality.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { markStatus } from "../src/index.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

/** Run the extracted bash _backlog_set_status against a fixture; return file + count. */
function bashMark(
  backlogContent: string,
  pattern: string,
  newStatus: string,
): { content: string; count: number } {
  const proj = mkdtempSync(join(tmpdir(), "roll-blstore-"));
  dirs.push(proj);
  mkdirSync(join(proj, ".roll"), { recursive: true });
  const path = join(proj, ".roll", "backlog.md");
  writeFileSync(path, backlogContent, "utf8");
  const script = [
    `eval "$(sed -n '/^_backlog_set_status()/,/^}$/p' '${REPO}/bin/roll')"`,
    `_backlog_set_status "$1" "$2"`,
  ].join("\n");
  const stdout = execFileSync("bash", ["-c", script, "bash", pattern, newStatus], {
    cwd: proj,
    encoding: "utf8",
  });
  return { content: readFileSync(path, "utf8"), count: Number(stdout.trim()) };
}

const DONE = "✅ Done";

describe("diff-test: BacklogStore.markStatus == bash _backlog_set_status", () => {
  it("simple mark — single matching row is byte-identical", () => {
    const content = ["| US-X | a | 📋 Todo |", "| US-Y | b | 📋 Todo |", ""].join("\n");
    const bash = bashMark(content, "US-X", DONE);
    const ts = markStatus(content, "US-X", DONE);
    expect(ts.count).toBe(bash.count);
    expect(ts.content).toBe(bash.content);
    expect(ts.count).toBe(1);
  });

  it("pattern matching multiple stories — same bytes & count", () => {
    // US-AUTH-001/002 match on both sides; US-AUTHZ-001 matches NEITHER
    // (bash: 'US-AUTH' IS a substring of 'US-AUTHZ-001' → bash WOULD match it).
    // To keep this a true agreement case, omit the AUTHZ trap here.
    const content = [
      "| US-AUTH-001 | a | 📋 Todo |",
      "| US-AUTH-002 | b | 📋 Todo |",
      "| FIX-1 | c | 📋 Todo |",
      "",
    ].join("\n");
    const bash = bashMark(content, "US-AUTH", DONE);
    const ts = markStatus(content, "US-AUTH", DONE);
    expect(ts.count).toBe(bash.count);
    expect(ts.content).toBe(bash.content);
    expect(ts.count).toBe(2);
  });

  it("pattern matching zero stories — both report 0 and leave bytes intact", () => {
    const content = ["| US-X | a | 📋 Todo |", "| FIX-9 | b | ✅ Done |", ""].join("\n");
    const bash = bashMark(content, "REFACTOR-404", DONE);
    const ts = markStatus(content, "REFACTOR-404", DONE);
    expect(ts.count).toBe(bash.count);
    expect(ts.content).toBe(bash.content);
    expect(ts.count).toBe(0);
  });

  it("FIX-106 trap — WHITELISTED divergence (bash substring bug vs TS anchor)", () => {
    const content = ["| US-LOOP-01 | first | 📋 Todo |", "| US-LOOP-019 | nineteen | 📋 Todo |", ""].join(
      "\n",
    );
    const bash = bashMark(content, "US-LOOP-01", DONE);
    const ts = markStatus(content, "US-LOOP-01", DONE);
    // Oracle (buggy): substring match flips BOTH rows.
    expect(bash.count).toBe(2);
    // v3 store (correct): id-token anchor flips ONLY US-LOOP-01.
    expect(ts.count).toBe(1);
    expect(ts.content).toContain("| US-LOOP-019 | nineteen | 📋 Todo |");
    // The divergence is intentional — they MUST differ here.
    expect(ts.content).not.toBe(bash.content);
  });
});
