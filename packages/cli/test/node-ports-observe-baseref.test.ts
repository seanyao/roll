import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { RouteDeps } from "@roll/core";
import { nodePorts, type RunnerPaths } from "../src/runner/index.js";

// E8 — the runner's git OBSERVATION functions (commitsAhead / tcrCount /
// recentCommits) must count against a caller-supplied integration-branch
// baseline, not a hardwired `origin/main`. A git submodule cycle branches off
// the submodule's own integration branch and has NO `origin/main` ref at all;
// hardcoding `origin/main..HEAD` makes `git rev-list origin/main..HEAD` fatal →
// the catch collapses to 0 → the engine misreads a real 4-commit delivery as a
// zero-output failure. These tests pin the baseRef parameter against a REAL
// temp git repo whose only branch is NOT origin/main.

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GIT_ID = ["-c", "user.email=t@t", "-c", "user.name=t"];

function git(cwd: string, args: string[]): string {
  return execFileSync("git", [...GIT_ID, ...args], { cwd, encoding: "utf8" }).trim();
}

/**
 * A repo whose integration branch is `feat/work` — deliberately NO `origin/main`
 * ref exists. `base` (the first commit) is the integration baseline; two more
 * commits sit ahead of it, one of them a `tcr:` commit.
 */
function repoWithNoOriginMain(): { cwd: string; baseRef: string } {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "roll-e8-baseref-")));
  dirs.push(cwd);
  git(cwd, ["init", "-q", "-b", "feat/work"]);
  writeFileSync(join(cwd, "a.txt"), "a");
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", "base commit"]);
  const baseRef = git(cwd, ["rev-parse", "HEAD"]);
  writeFileSync(join(cwd, "b.txt"), "b");
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", "tcr: green step one"]);
  writeFileSync(join(cwd, "c.txt"), "c");
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", "chore: not a tcr commit"]);
  return { cwd, baseRef };
}

function ports(repoCwd: string) {
  const paths: RunnerPaths = {
    eventsPath: join(repoCwd, "events.ndjson"),
    runsPath: join(repoCwd, "runs.jsonl"),
    alertsPath: join(repoCwd, "alerts.log"),
    lockPath: join(repoCwd, "lock"),
    heartbeatPath: join(repoCwd, "hb"),
    worktreePath: repoCwd,
  };
  const routeDeps: RouteDeps = { readSlot: () => "claude", firstInstalled: () => "claude" };
  return nodePorts({ repoCwd, paths, skillBody: "", routeDeps });
}

describe("E8: node-ports observation honors a caller-supplied baseRef", () => {
  it("commitsAhead counts ahead of the supplied integration branch (repo has no origin/main)", async () => {
    const { cwd, baseRef } = repoWithNoOriginMain();
    const p = ports(cwd);
    // Two commits sit ahead of the base commit on feat/work.
    expect(await p.git.commitsAhead(cwd, baseRef)).toBe(2);
  });

  it("commitsAhead defaults to origin/main → 0 in a repo without origin/main (legacy behavior preserved)", async () => {
    const { cwd } = repoWithNoOriginMain();
    const p = ports(cwd);
    // No baseRef → the historical `origin/main..HEAD`; the ref is missing so the
    // git failure is caught and collapses to 0 — exactly the false-zero E8 fixes
    // at the call sites, but the DEFAULT must stay byte-identical (zero regression).
    expect(await p.git.commitsAhead(cwd)).toBe(0);
  });

  it("tcrCount counts tcr: commits ahead of the supplied integration branch", async () => {
    const { cwd, baseRef } = repoWithNoOriginMain();
    const p = ports(cwd);
    // Exactly one `tcr:` commit sits ahead of base.
    expect(await p.git.tcrCount(cwd, baseRef)).toBe(1);
  });

  it("tcrCount keeps the FIX-1244 unknown (undefined) semantics on a missing ref", async () => {
    const { cwd } = repoWithNoOriginMain();
    const p = ports(cwd);
    // No baseRef → `origin/main..HEAD` fatals on the missing ref → undefined
    // (unknown ≠ real zero — the self-heal gate must not misread it).
    expect(await p.git.tcrCount(cwd)).toBeUndefined();
  });

  it("recentCommits observes commits ahead of the supplied integration branch", async () => {
    const { cwd, baseRef } = repoWithNoOriginMain();
    const p = ports(cwd);
    const commits = await p.git.recentCommits(cwd, baseRef);
    expect(commits.map((c) => c.message)).toEqual(["tcr: green step one", "chore: not a tcr commit"]);
  });
});
