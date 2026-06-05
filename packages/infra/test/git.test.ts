/**
 * Tests for the git module — real temp git repos. Covers the worktree
 * lifecycle, the FIX-114 branch-collision case, the raw wrappers
 * (branch/commit/push/currentBranch/mergeBase/isAncestor/lsRemote), and
 * canonicalProjectPath / projectIdentity (the latter cross-checked against the
 * @roll/spec slug contract in git.difftest.test.ts).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  branchCreate,
  canonicalProjectPath,
  commit,
  currentBranch,
  isAncestor,
  lsRemote,
  mergeBase,
  projectIdentity,
  worktreeAdd,
  worktreeRemove,
} from "../src/index.js";
import { projectSlug } from "@roll/spec";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});
function tmp(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `roll-infra-git-${tag}-`));
  dirs.push(d);
  return realpathSync(d);
}
/** Init a repo with one commit on `main`. */
function initRepo(tag: string): string {
  const d = tmp(tag);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: d });
  // Repo-local identity: CI runners have no global git config, and the
  // wrappers under test deliberately don't inject one (AGENTS: identity
  // comes from git config, never hardcoded).
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: d });
  execFileSync("git", ["config", "user.name", "t"], { cwd: d });
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], { cwd: d });
  return d;
}

describe("worktree lifecycle", () => {
  it("worktreeAdd creates a worktree on a new branch, worktreeRemove tears it down", async () => {
    const repo = initRepo("wt");
    const wtParent = tmp("wtside");
    const wt = join(wtParent, "wt");
    const add = await worktreeAdd(repo, wt, "feat-1", "main");
    expect(add.code).toBe(0);
    expect(existsSync(wt)).toBe(true);
    expect((await currentBranch(wt))).toBe("feat-1");

    const rm = await worktreeRemove(repo, wt, "feat-1");
    expect(rm.code).toBe(0);
    expect(existsSync(wt)).toBe(false);
    // branch deleted too
    const refs = execFileSync("git", ["branch", "--list", "feat-1"], { cwd: repo, encoding: "utf8" });
    expect(refs.trim()).toBe("");
  });

  it("FIX-114: worktreeAdd succeeds even when the branch already exists (deletes it first)", async () => {
    const repo = initRepo("fix114");
    // Pre-create a stale branch (as a prior failed run would leave behind).
    expect((await branchCreate(repo, "feat-stale", "main")).code).toBe(0);
    const wt = join(tmp("fix114wt"), "wt");
    const add = await worktreeAdd(repo, wt, "feat-stale", "main");
    expect(add.code).toBe(0);
    expect(existsSync(wt)).toBe(true);
    expect(await currentBranch(wt)).toBe("feat-stale");
    await worktreeRemove(repo, wt, "feat-stale");
  });

  it("worktreeAdd is idempotent over a leftover path", async () => {
    const repo = initRepo("idem");
    const wt = join(tmp("idemwt"), "wt");
    expect((await worktreeAdd(repo, wt, "b1", "main")).code).toBe(0);
    // Second add to the SAME path with a new branch: the existing worktree is
    // removed first, so this still succeeds.
    expect((await worktreeAdd(repo, wt, "b2", "main")).code).toBe(0);
    expect(await currentBranch(wt)).toBe("b2");
    await worktreeRemove(repo, wt, "b2");
  });
});

describe("raw wrappers", () => {
  it("commit / currentBranch / mergeBase / isAncestor", async () => {
    const repo = initRepo("raw");
    expect(await currentBranch(repo)).toBe("main");
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

    expect((await branchCreate(repo, "topic", "main")).code).toBe(0);
    execFileSync("git", ["checkout", "-q", "topic"], { cwd: repo });
    const c = await commit(repo, "second", { allowEmpty: true });
    expect(c.code).toBe(0);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

    expect(await mergeBase(repo, "main", "topic")).toBe(base);
    expect(await isAncestor(repo, base, head)).toBe(true);
    expect(await isAncestor(repo, head, base)).toBe(false);
  });

  it("lsRemote parses sha/ref rows against a local 'remote' repo", async () => {
    const origin = initRepo("origin");
    const clone = tmp("clone");
    execFileSync("git", ["clone", "-q", origin, clone], { cwd: tmp("clonebase") });
    const refs = await lsRemote(clone, "origin", ["HEAD"]);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs[0]?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(refs.some((r) => r.ref === "HEAD")).toBe(true);
  });
});

describe("canonicalProjectPath", () => {
  it("resolves a worktree to its OWN toplevel (FIX-201; supersedes FIX-034)", async () => {
    // FIX-034's main-tree canonicalization hijacked sibling dev worktrees onto
    // the frozen v2 checkout — identity is now the current worktree's toplevel.
    const main = initRepo("canonmain");
    const wt = join(tmp("canonwt"), "wt");
    execFileSync("git", ["worktree", "add", "-q", wt, "-b", "side"], { cwd: main });
    const canon = await canonicalProjectPath(wt);
    expect(canon).toBe(realpathSync(wt));
    execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: main });
  });

  it("leaves a plain main-tree path canonical (modulo realpath)", async () => {
    const main = initRepo("canonplain");
    expect(await canonicalProjectPath(main)).toBe(main);
  });
});

describe("projectIdentity", () => {
  it("slug matches @roll/spec projectSlug for a remote-backed repo", async () => {
    const repo = initRepo("identity");
    execFileSync("git", ["remote", "add", "origin", "https://github.com/SeanYao/Some.Project.git"], { cwd: repo });
    const id = await projectIdentity(repo);
    expect(id.path).toBe(repo);
    expect(id.slug).toBe(projectSlug({ path: repo, remoteUrl: "https://github.com/SeanYao/Some.Project.git" }));
  });

  it("no-remote repo → path-based slug", async () => {
    const repo = initRepo("identity-noremote");
    const id = await projectIdentity(repo);
    expect(id.slug).toBe(projectSlug({ path: repo, remoteUrl: undefined }));
  });

  it("ROLL_MAIN_SLUG override short-circuits", async () => {
    const repo = initRepo("identity-override");
    const save = process.env["ROLL_MAIN_SLUG"];
    process.env["ROLL_MAIN_SLUG"] = "main-deadbe";
    try {
      const id = await projectIdentity(repo);
      expect(id.slug).toBe("main-deadbe");
    } finally {
      if (save === undefined) delete process.env["ROLL_MAIN_SLUG"];
      else process.env["ROLL_MAIN_SLUG"] = save;
    }
  });
});
