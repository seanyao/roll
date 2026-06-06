import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBacklog } from "@roll/core";
import { describe, expect, it } from "vitest";
import { ideaCommand } from "../src/commands/idea.js";

/** Run ideaCommand against a throwaway project with the given backlog. */
function run(
  args: string[],
  backlog: string,
): { status: number; stdout: string; stderr: string; backlog: string | null } {
  const proj = mkdtempSync(join(tmpdir(), "roll-idea-proj-"));
  mkdirSync(join(proj, ".roll"), { recursive: true });
  const path = join(proj, ".roll", "backlog.md");
  writeFileSync(path, backlog, "utf8");
  const save = { NO_COLOR: process.env["NO_COLOR"], ROLL_LANG: process.env["ROLL_LANG"] };
  process.env["NO_COLOR"] = "1";
  process.env["ROLL_LANG"] = "en";
  const saveCwd = process.cwd();
  process.chdir(proj);
  const outC: string[] = [];
  const errC: string[] = [];
  const rOut = process.stdout.write.bind(process.stdout);
  const rErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (x: string | Uint8Array): boolean => (outC.push(String(x)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (x: string | Uint8Array): boolean => (errC.push(String(x)), true);
  let status: number;
  let after: string | null = null;
  try {
    status = ideaCommand(args);
    after = readFileSync(path, "utf8");
  } finally {
    process.stdout.write = rOut;
    process.stderr.write = rErr;
    process.chdir(saveCwd);
    rmSync(proj, { recursive: true, force: true });
    if (save.NO_COLOR === undefined) delete process.env["NO_COLOR"];
    else process.env["NO_COLOR"] = save.NO_COLOR;
    if (save.ROLL_LANG === undefined) delete process.env["ROLL_LANG"];
    else process.env["ROLL_LANG"] = save.ROLL_LANG;
  }
  return { status, stdout: outC.join(""), stderr: errC.join(""), backlog: after };
}

const EMPTY = ["# Backlog", "", "intro line", ""].join("\n");

describe("ideaCommand (E2E golden path)", () => {
  it("captures an idea: classifies, numbers, appends a parseable Todo row (exit 0)", () => {
    const r = run(["add", "a", "dark", "mode", "toggle"], EMPTY);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("IDEA-001");
    expect(r.stdout).toContain("idea");
    // The row is appended and parses back through the SAME backlog reader.
    const items = parseBacklog(r.backlog ?? "");
    const added = items.find((i) => i.id === "IDEA-001");
    expect(added?.status).toBe("📋 Todo");
    expect(added?.desc).toBe("add a dark mode toggle");
  });

  it("captures a bug under the FIX family", () => {
    const r = run(["the", "export", "button", "is", "broken"], EMPTY);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("FIX-001");
    const items = parseBacklog(r.backlog ?? "");
    expect(items.find((i) => i.id === "FIX-001")).toBeDefined();
  });

  it("auto-numbers from the existing max in the family", () => {
    const backlog = [
      "## 🐛 Bug Fixes",
      "",
      "| ID | Description | Status |",
      "|----|-------------|--------|",
      "| FIX-204 | old bug | ✅ Done |",
      "| FIX-215 | another | ✅ Done |",
      "",
    ].join("\n");
    const r = run(["a", "new", "crash", "on", "startup"], backlog);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("FIX-216");
  });

  it("refuses a description that fails lint and writes nothing", () => {
    const r = run(["use", "the", "`module`", "in", "src/app.ts"], EMPTY);
    expect(r.status).toBe(1);
    expect(r.stderr.toLowerCase()).toContain("lint");
    // Backlog is byte-unchanged — no bad card landed.
    expect(r.backlog).toBe(EMPTY);
  });

  it("rejects empty input with usage (exit 1)", () => {
    const r = run([], EMPTY);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("roll idea");
    expect(r.backlog).toBe(EMPTY);
  });

  it("--help prints usage and exits 0 without writing", () => {
    const r = run(["--help"], EMPTY);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("roll idea");
    expect(r.backlog).toBe(EMPTY);
  });

  it("English output carries no CJK (single-language contract)", () => {
    const r = run(["add", "offline", "support"], EMPTY);
    expect(r.stdout).not.toMatch(/[一-鿿]/);
  });
});
