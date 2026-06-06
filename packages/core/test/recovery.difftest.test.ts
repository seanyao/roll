/**
 * Frozen-expectation test: isStaleCycleBranch's ancestry gate.
 *
 * The stale-cycle-branch GC predicate (bin/roll 13040) decides "merged" via
 * `git merge-base --is-ancestor <branch> origin/main`. That ancestry verdict was
 * proven equal to a fixture-repo git run under diff-test. Per US-PORT-009b the
 * oracle (the throwaway git repo + transcribed bash gate) is retired:
 * `isStaleCycleBranch(branch, isAncestor)` is a pure function over the branch
 * name and the precomputed ancestry boolean, so the git fixture only ever
 * existed to produce that boolean. We now feed the frozen ancestry verdict
 * directly and assert the prefix gate + ancestry composition.
 *
 * (The orphan-worktree action ORDER is unit-tested in recovery.test.ts; the
 * lock/heartbeat age math is diff-tested in infra/process.difftest.test.ts.)
 */
import { describe, expect, it } from "vitest";
import { isStaleCycleBranch } from "../src/delivery/pr.js";

describe("frozen: isStaleCycleBranch ancestry == git merge-base --is-ancestor", () => {
  it("merged ephemeral branch (ancestor of main) → deletable", () => {
    expect(isStaleCycleBranch("loop/cycle-merged", true)).toBe(true);
  });

  it("unmerged ephemeral branch (not an ancestor) → NOT deletable", () => {
    expect(isStaleCycleBranch("loop/cycle-open", false)).toBe(false);
  });

  it("non-ephemeral branch never deletable even if merged", () => {
    // feat/keep IS an ancestor of main, but the loop/ prefix gate blocks it.
    expect(isStaleCycleBranch("feat/keep", true)).toBe(false);
  });
});
