/**
 * diff-test: isStaleCycleBranch's ancestry gate == real git on a fixture repo.
 *
 * The stale-cycle-branch GC predicate (bin/roll 13040) decides "merged" via
 * `git merge-base --is-ancestor <branch> origin/main`. That is the load-bearing,
 * non-obvious rule (the orphan-worktree action ORDER is unit-tested in
 * recovery.test.ts; the lock/heartbeat age math is already diff-tested in
 * infra/process.difftest.test.ts — not duplicated here per the card).
 *
 * We build a throwaway repo with a merged branch and an unmerged branch, run the
 * exact bash gate transcribed from bin/roll 13040, and assert the TS predicate
 * agrees with both git's ancestry verdict and the bash gate.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isStaleCycleBranch } from "../src/delivery/pr.js";

let repo: string;

function git(...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

/** Transcribed bash gate (bin/roll 13040): exit 0 = is-ancestor (merged). */
function bashIsAncestor(branch: string): boolean {
  const script = `
    if git -C "$1" merge-base --is-ancestor "$2" main 2>/dev/null; then
      echo merged
    else
      echo open
    fi`;
  const out = execFileSync("bash", ["-c", script, "bash", repo, branch], { encoding: "utf8" }).trim();
  return out === "merged";
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "rec-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  // base commit on main
  execFileSync("bash", ["-c", `cd "$1" && echo a > a.txt && git add a.txt && git commit -qm base`, "bash", repo]);
  // a fully-merged ephemeral branch: branch off, fast-forward main onto it
  git("branch", "loop/cycle-merged");
  // merged branch == main tip (ancestor of main).
  // an unmerged ephemeral branch: commit on it, do NOT merge to main
  git("checkout", "-q", "-b", "loop/cycle-open");
  execFileSync("bash", ["-c", `cd "$1" && echo b > b.txt && git add b.txt && git commit -qm wip`, "bash", repo]);
  git("checkout", "-q", "main");
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("diff-test: isStaleCycleBranch ancestry == git merge-base --is-ancestor", () => {
  it("merged ephemeral branch → deletable (git agrees)", () => {
    const isAnc = bashIsAncestor("loop/cycle-merged");
    expect(isAnc).toBe(true);
    expect(isStaleCycleBranch("loop/cycle-merged", isAnc)).toBe(true);
  });

  it("unmerged ephemeral branch → NOT deletable (git agrees)", () => {
    const isAnc = bashIsAncestor("loop/cycle-open");
    expect(isAnc).toBe(false);
    expect(isStaleCycleBranch("loop/cycle-open", isAnc)).toBe(false);
  });

  it("non-ephemeral branch never deletable even if merged", () => {
    git("branch", "feat/keep");
    const isAnc = bashIsAncestor("feat/keep");
    expect(isAnc).toBe(true); // it IS an ancestor of main
    expect(isStaleCycleBranch("feat/keep", isAnc)).toBe(false); // but prefix gate blocks it
  });
});
