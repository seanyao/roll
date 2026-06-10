/**
 * US-META-009 — `roll story new`: the single channel for minting card folders.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { storyNewCommand } from "../src/commands/story-new.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

function project(): string {
  const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-storynew-")));
  dirs.push(p);
  mkdirSync(join(p, ".roll", "features"), { recursive: true });
  writeFileSync(join(p, ".roll", "backlog.md"), "| US-NEW-1 | x | 📋 Todo |\n");
  return p;
}

function inProj(p: string, args: string[]): { code: number; out: string; err: string } {
  const save = process.cwd();
  process.chdir(p);
  let out = "";
  let err = "";
  const w = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture
  process.stdout.write = (s: string): boolean => ((out += String(s)), true);
  // @ts-expect-error capture
  process.stderr.write = (s: string): boolean => ((err += String(s)), true);
  try {
    return { code: storyNewCommand(args), out, err };
  } finally {
    process.stdout.write = w;
    process.stderr.write = e;
    process.chdir(save);
  }
}

describe("roll story new — US-META-009", () => {
  it("mints spec.md (frontmatter) + story page + refreshes index.json", () => {
    const p = project();
    const r = inProj(p, ["US-NEW-1", "--title", "一条新故事", "--epic", "alpha"]);
    expect(r.code).toBe(0);
    const spec = readFileSync(join(p, ".roll", "features", "alpha", "US-NEW-1", "spec.md"), "utf8");
    expect(spec).toContain("id: US-NEW-1");
    expect(spec).toContain("title: 一条新故事");
    expect(spec).toContain("epic: alpha");
    expect(existsSync(join(p, ".roll", "features", "alpha", "US-NEW-1", "index.html"))).toBe(true);
    const idx = JSON.parse(readFileSync(join(p, ".roll", "index.json"), "utf8")) as { stories: Record<string, string> };
    expect(idx.stories["US-NEW-1"]).toBe("alpha");
  });

  it("refuses to overwrite an existing card (born once)", () => {
    const p = project();
    expect(inProj(p, ["FIX-7", "--title", "first"]).code).toBe(0);
    const r = inProj(p, ["FIX-7", "--title", "second"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("不可覆盖");
  });

  it("rejects a non-story id and a missing title (exit 2)", () => {
    const p = project();
    expect(inProj(p, ["not-an-id", "--title", "x"]).code).toBe(2);
    expect(inProj(p, ["US-OK-1"]).code).toBe(2);
  });

  it("defaults epic to uncategorized", () => {
    const p = project();
    expect(inProj(p, ["IDEA-9", "--title", "想法"]).code).toBe(0);
    expect(existsSync(join(p, ".roll", "features", "uncategorized", "IDEA-9", "spec.md"))).toBe(true);
  });

  it("FIX-231: minting refreshes the dossier aggregate pages — the new card is on the front page immediately", () => {
    const p = project();
    expect(inProj(p, ["US-NEW-1", "--title", "一条新故事", "--epic", "alpha"]).code).toBe(0);
    const front = readFileSync(join(p, ".roll", "features", "index.html"), "utf8");
    expect(front).toContain("US-NEW-1");
    // the existing story page (mount board) must NOT be clobbered by the refresh.
    const storyIdx = join(p, ".roll", "features", "alpha", "US-NEW-1", "index.html");
    writeFileSync(storyIdx, "<html>MOUNTED-MARK</html>");
    expect(inProj(p, ["FIX-8", "--title", "另一张"]).code).toBe(0);
    expect(readFileSync(storyIdx, "utf8")).toContain("MOUNTED-MARK");
  });
});
