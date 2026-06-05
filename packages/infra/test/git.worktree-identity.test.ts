/**
 * FIX-201 — sibling-worktree identity: canonicalProjectPath must resolve to
 * the CURRENT worktree's toplevel, not the main worktree (the v2-frozen
 * checkout hijack: the loop baked the primary checkout's path and idled there).
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { canonicalProjectPath } from "../src/git.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

describe("canonicalProjectPath (FIX-201)", () => {
  it("a linked worktree resolves to ITSELF, not the primary checkout", async () => {
    const main = realpathSync(mkdtempSync(join(tmpdir(), "roll-id-main-")));
    dirs.push(main);
    const g = (cwd: string, cmd: string): void => {
      execSync(`git ${cmd}`, { cwd, stdio: "pipe" });
    };
    g(main, "init -q -b main");
    g(main, "config user.email t@t");
    g(main, "config user.name t");
    writeFileSync(join(main, "a.txt"), "a\n");
    g(main, "add -A");
    g(main, 'commit -q -m seed');
    const sibling = join(realpathSync(mkdtempSync(join(tmpdir(), "roll-id-sib-"))), "wt");
    dirs.push(join(sibling, ".."));
    g(main, `worktree add -q '${sibling}' -b dev`);

    expect(await canonicalProjectPath(sibling)).toBe(realpathSync(sibling));
    expect(await canonicalProjectPath(main)).toBe(main);
  });

  it("a SUBDIRECTORY inside a worktree resolves to that worktree's toplevel", async () => {
    const main = realpathSync(mkdtempSync(join(tmpdir(), "roll-id-sub-")));
    dirs.push(main);
    const g = (cmd: string): void => {
      execSync(`git ${cmd}`, { cwd: main, stdio: "pipe" });
    };
    g("init -q -b main");
    g("config user.email t@t");
    g("config user.name t");
    mkdirSync(join(main, "deep", "dir"), { recursive: true });
    writeFileSync(join(main, "deep", "dir", "f.txt"), "x\n");
    g("add -A");
    g('commit -q -m seed');
    expect(await canonicalProjectPath(join(main, "deep", "dir"))).toBe(main);
  });
});
