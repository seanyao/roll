/**
 * diff-test: TS `roll backlog` display == bash/python oracle, over fixture
 * backlogs exercising every group, reasons, CJK truncation, and error paths.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { backlogCommand } from "../src/commands/backlog.js";
import { seedUpdateCheckCache } from "./helpers.js";

const REPO = resolve(__dirname, "../../..");
const ROLL_HOME = join(mkdtempSync(join(tmpdir(), "roll-bl-home-")), ".roll");
seedUpdateCheckCache(ROLL_HOME);
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function mkProj(backlogContent: string | null): string {
  const proj = mkdtempSync(join(tmpdir(), "roll-bl-proj-"));
  dirs.push(proj);
  if (backlogContent !== null) {
    mkdirSync(join(proj, ".roll"), { recursive: true });
    writeFileSync(join(proj, ".roll", "backlog.md"), backlogContent);
  }
  return proj;
}

function bashBacklog(proj: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(join(REPO, "bin", "roll"), ["backlog"], {
      cwd: proj,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ROLL_LANG: "en", ROLL_HOME },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function tsBacklog(proj: string): { status: number; stdout: string; stderr: string } {
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
  try {
    status = backlogCommand([]);
  } finally {
    process.stdout.write = rOut;
    process.stderr.write = rErr;
    process.chdir(saveCwd);
    for (const [k, v] of Object.entries(save)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return { status, stdout: outC.join(""), stderr: errC.join("") };
}

function compare(proj: string): void {
  const b = bashBacklog(proj);
  const t = tsBacklog(proj);
  expect(t.status).toBe(b.status);
  expect(t.stdout).toBe(b.stdout);
  expect(t.stderr).toBe(b.stderr);
}

const RICH = `# Project Backlog

| Story | Description | Status |
|-------|-------------|--------|
| [FIX-001](.roll/x.md#a) | 修一个非常非常长的问题描述用来触发宽度截断逻辑——中日韩字符每个占两格所以这行一定会超过六十二格宽 | 📋 Todo |
| [US-100](.roll/x.md#b) | port roll status with bytes aligned | 📋 Todo |
| US-101 | bare id without link still parses | 📋 Todo |
| [REFACTOR-7](.roll/x.md#c) | tidy the renderer | 📋 Todo |
| [IDEA-3](.roll/x.md#d) | someday maybe | 📋 Todo |
| [US-200](.roll/x.md#e) | currently being built | 🔨 In Progress |
| [FIX-002](.roll/x.md#f) | waiting on upstream | 🔒 Blocked [needs api key] |
| [US-300](.roll/x.md#g) | parked for v3 | ⏸ Deferred [v2-freeze→v2-final] |
| [DONE-1](.roll/x.md#h) | not an item type we list | ✅ Done |
`;

describe("diff-test: roll backlog == python oracle", () => {
  it("rich backlog (all groups, reasons, CJK truncation)", () => {
    compare(mkProj(RICH));
  });

  it("empty backlog → clear message", () => {
    compare(mkProj("# Project Backlog\n\nno table rows here\n"));
  });

  it("only done items → clear message too", () => {
    compare(mkProj("| [US-1](a) | done thing | ✅ Done |\n"));
  });

  it("missing backlog file → bilingual err + exit 1", () => {
    const proj = mkProj(null);
    const b = bashBacklog(proj);
    const t = tsBacklog(proj);
    expect(t.status).toBe(b.status);
    expect(t.stderr).toBe(b.stderr);
  });
});
