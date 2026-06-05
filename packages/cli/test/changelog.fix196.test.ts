/**
 * FIX-196 regression pins (TS-only — WHITELISTED divergence from the frozen
 * python oracle, which only recognises markdown-link story IDs):
 *
 *   Bug 1  bare-ID `✅ Done` rows (the v3 backlog house style) must keep their
 *          storyId — the release-tag filter previously dropped them silently,
 *          so every loop-merged card vanished from the changelog draft.
 *   Bug 2  `--write` with an empty draft must NOT touch CHANGELOG.md (the v2
 *          bash wrapper wrote the placeholder sentinel as content; the TS port
 *          early-returns before the write — this test pins that shape).
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateDraft } from "../src/commands/changelog.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

/** A tmp git project with a v1.0.0 tag and post-tag commits naming story ids. */
function project(backlog: string, postTagCommits: string[]): string {
  const proj = realpathSync(mkdtempSync(join(tmpdir(), "roll-f196-")));
  dirs.push(proj);
  const git = (cmd: string): void => {
    execSync(`git ${cmd}`, { cwd: proj, stdio: "pipe" });
  };
  git("init -q");
  git("config user.email roll@test.local");
  git("config user.name roll-test");
  git("config commit.gpgsign false");
  mkdirSync(join(proj, ".roll"), { recursive: true });
  writeFileSync(join(proj, ".roll", "backlog.md"), backlog);
  writeFileSync(join(proj, "seed.txt"), "seed\n");
  git("add -A");
  git('commit -q -m "seed"');
  git("tag v1.0.0");
  for (const [i, msg] of postTagCommits.entries()) {
    writeFileSync(join(proj, `f${i}.txt`), `${i}\n`);
    git("add -A");
    git(`commit -q -m "${msg}"`);
  }
  return proj;
}

function inDir<T>(proj: string, fn: () => T): T {
  const save = process.cwd();
  process.chdir(proj);
  try {
    return fn();
  } finally {
    process.chdir(save);
  }
}

describe("FIX-196 bug 1 — bare-ID Done rows survive the release-tag filter", () => {
  it("bare `FIX-200` row is drafted with its id (was: silently dropped)", () => {
    const proj = project(
      [
        "| Story | Description | Status |",
        "|-------|-------------|--------|",
        "| FIX-200 | 修复导出报表的时间区间偏移 | ✅ Done |",
        "",
      ].join("\n"),
      ["tcr: FIX-200 修正时间区间偏移"],
    );
    const r = inDir(proj, () => generateDraft({}));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("修复导出报表的时间区间偏移");
    expect(r.stdout).toContain("FIX-200");
    expect(r.stdout).not.toContain("No new ✅ Done stories");
  });

  it("lowercase ID suffix (`FIX-150b`) parses as part of the id", () => {
    const proj = project(
      [
        "| Story | Description | Status |",
        "|-------|-------------|--------|",
        "| FIX-150b | 评审硬触发保障落地 | ✅ Done |",
        "",
      ].join("\n"),
      ["tcr: FIX-150b 接线完成"],
    );
    const r = inDir(proj, () => generateDraft({ json: true }));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"id": "FIX-150b"');
  });

  it("link-form rows keep working exactly as before (oracle-shared shape)", () => {
    const proj = project(
      [
        "| Story | Description | Status |",
        "|-------|-------------|--------|",
        "| [FIX-201](.roll/features/x/FIX-201.md) | 修复登录页在窄屏下的布局抖动 | ✅ Done |",
        "",
      ].join("\n"),
      ["tcr: FIX-201 布局抖动修复"],
    );
    const r = inDir(proj, () => generateDraft({}));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("FIX-201");
    expect(r.stdout).toContain("布局抖动");
  });
});

describe("FIX-196 bug 2 — empty draft never writes the placeholder", () => {
  it("--write with no Done rows leaves CHANGELOG.md untouched", () => {
    const proj = project(
      ["| Story | Description | Status |", "|-------|-------------|--------|", "| FIX-202 | 还没做的事 | 📋 Todo |", ""].join(
        "\n",
      ),
      [],
    );
    const r = inDir(proj, () => generateDraft({ write: true }));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("No new ✅ Done stories");
    expect(existsSync(join(proj, "CHANGELOG.md"))).toBe(false); // nothing written
  });
});
