/**
 * FIX-276 — `roll setup skills` / `roll doctor skills` on a GLOBAL INSTALL:
 * the published package ships no guide/ source dir, so the catalog
 * generate/check used to crash with a raw ENOENT stack while WRITING into the
 * install tree. An install tree has no catalog to maintain — the command must
 * say so in one line and exit 0, never write into the installed package.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { skillsCommand } from "../src/commands/skills.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env["ROLL_PKG_DIR"];
});

function installTree(withGuide: boolean): string {
  const p = mkdtempSync(join(tmpdir(), "roll-install-"));
  dirs.push(p);
  mkdirSync(join(p, "skills", "roll-x"), { recursive: true });
  writeFileSync(join(p, "skills", "roll-x", "SKILL.md"), "---\nname: roll-x\ndescription: d\n---\n# x\n");
  mkdirSync(join(p, "conventions"), { recursive: true }); // repoRoot marker
  if (withGuide) {
    mkdirSync(join(p, "guide"), { recursive: true });
    writeFileSync(join(p, "guide", "skills.md"), "old\n");
  }
  return p;
}

async function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const so = process.stdout.write.bind(process.stdout);
  const se = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
  process.stderr.write = ((s: string) => ((err += s), true)) as typeof process.stderr.write;
  try {
    const code = await skillsCommand(args);
    return { code: code as number, out, err };
  } finally {
    process.stdout.write = so;
    process.stderr.write = se;
  }
}

describe("FIX-276 — catalog maintenance skips honestly on an install tree", () => {
  it("generate without a guide/ dir: one-line notice, exit 0, NOTHING written", async () => {
    const p = installTree(false);
    process.env["ROLL_PKG_DIR"] = p;
    const r = await run(["generate"]);
    expect(r.code).toBe(0);
    expect(r.out.toLowerCase()).toContain("install");
    expect(readdirSync(p)).not.toContain("guide"); // never mints guide/ in the install tree
  });

  it("check keeps its old graceful contract (missing catalog → exit 1, no crash)", async () => {
    const p = installTree(false);
    process.env["ROLL_PKG_DIR"] = p;
    const r = await run(["check"]);
    expect(r.code).toBe(1); // the frozen difftest contract — never a raw ENOENT stack
  });

  it("a source checkout (guide/ present) still regenerates as before", async () => {
    const p = installTree(true);
    process.env["ROLL_PKG_DIR"] = p;
    const r = await run(["generate"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("install tree");
  });
});
