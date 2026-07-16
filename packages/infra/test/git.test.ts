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
import { writeFileSync, mkdirSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import {
  branchCleanlyRebasesOntoMain,
  branchCreate,
  branchMergedIntoMain,
  canonicalProjectPath,
  commit,
  currentBranch,
  fetchRemoteBranch,
  isAncestor,
  lsRemote,
  mergeBase,
  projectIdentity,
  resolveIntegrationBranch,
  worktreeAdd,
  worktreeRemove,
  worktreeResetHard,
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
  it("US-LOOP-094: worktreeAdd creates a DETACHED worktree — no local branch", async () => {
    const repo = initRepo("wt");
    const wtParent = tmp("wtside");
    const wt = join(wtParent, "wt");
    const add = await worktreeAdd(repo, wt, "loop/cycle-x", "main");
    expect(add.code).toBe(0);
    expect(existsSync(wt)).toBe(true);
    // Detached: no branch is checked out; abbrev-ref HEAD reads "HEAD".
    expect(await currentBranch(wt)).toBe("HEAD");
    // The intended remote-ref name never becomes a LOCAL branch.
    const refs = execFileSync("git", ["branch", "--list", "loop/cycle-x"], { cwd: repo, encoding: "utf8" });
    expect(refs.trim()).toBe("");

    const rm = await worktreeRemove(repo, wt, "loop/cycle-x");
    expect(rm.code).toBe(0);
    expect(existsSync(wt)).toBe(false);
  });

  it("US-LOOP-094: detached add does NOT clobber an existing same-named branch", async () => {
    const repo = initRepo("nostomp");
    // A branch with the SAME name exists (e.g. a resumable prior-cycle ref).
    expect((await branchCreate(repo, "feat-stale", "main")).code).toBe(0);
    const wt = join(tmp("nostompwt"), "wt");
    const add = await worktreeAdd(repo, wt, "feat-stale", "main");
    expect(add.code).toBe(0);
    expect(await currentBranch(wt)).toBe("HEAD"); // detached, not on feat-stale
    // The pre-existing branch is untouched (old FIX-114 deleted it; detached must not).
    const refs = execFileSync("git", ["branch", "--list", "feat-stale"], { cwd: repo, encoding: "utf8" });
    expect(refs).toContain("feat-stale");
    await worktreeRemove(repo, wt, "feat-stale");
  });

  it("worktreeAdd is idempotent over a leftover path", async () => {
    const repo = initRepo("idem");
    const wt = join(tmp("idemwt"), "wt");
    expect((await worktreeAdd(repo, wt, "b1", "main")).code).toBe(0);
    // Second add to the SAME path: the existing worktree is removed first, so
    // this still succeeds (now detached).
    expect((await worktreeAdd(repo, wt, "b2", "main")).code).toBe(0);
    expect(await currentBranch(wt)).toBe("HEAD");
    await worktreeRemove(repo, wt, "b2");
  });

  it("US-LOOP-095: worktreeRemove bundles UNPUSHED detached work before teardown", async () => {
    const repo = initRepo("bundle");
    const wt = join(tmp("bundlewt"), "wt");
    expect((await worktreeAdd(repo, wt, "loop/cycle-b", "main")).code).toBe(0);
    // Commit on the detached HEAD → work no remote holds (initRepo has none).
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "cycle work"], { cwd: wt });
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: wt, encoding: "utf8" }).trim();

    const rm = await worktreeRemove(repo, wt, "loop/cycle-b"); // bundleUnpushed defaults true
    expect(rm.code).toBe(0);
    expect(existsSync(wt)).toBe(false);
    const bundle = join(repo, ".roll", "loop", "quarantine", "leaked-loop-cycle-b.bundle");
    expect(existsSync(bundle)).toBe(true);
    expect(execFileSync("git", ["bundle", "list-heads", bundle], { cwd: repo, encoding: "utf8" })).toContain(head);
  });

  it("US-LOOP-095: the quarantine bundle is RECOVERABLE (verify + fetch into a fresh repo)", async () => {
    const repo = initRepo("recover");
    const wt = join(tmp("recoverwt"), "wt");
    expect((await worktreeAdd(repo, wt, "loop/cycle-r", "main")).code).toBe(0);
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "unpushed work"], { cwd: wt });
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: wt, encoding: "utf8" }).trim();
    await worktreeRemove(repo, wt, "loop/cycle-r");
    const bundle = join(repo, ".roll", "loop", "quarantine", "leaked-loop-cycle-r.bundle");

    // (a) the bundle is structurally valid.
    expect(() => execFileSync("git", ["bundle", "verify", bundle], { cwd: repo, stdio: "pipe" })).not.toThrow();
    // (b) the unpushed commit is actually recoverable into a PRISTINE repo
    //     (AC2: not just "recorded" — fetchable back to the exact object).
    const fresh = initRepo("recover-dst");
    execFileSync("git", ["fetch", bundle, "HEAD:refs/heads/recovered"], { cwd: fresh });
    const recovered = execFileSync("git", ["rev-parse", "refs/heads/recovered"], { cwd: fresh, encoding: "utf8" }).trim();
    expect(recovered).toBe(head);
  });

  it("US-LOOP-095: worktreeRemove(bundleUnpushed=false) skips the bundle (work already on remote)", async () => {
    const repo = initRepo("nobundle");
    const wt = join(tmp("nobundlewt"), "wt");
    expect((await worktreeAdd(repo, wt, "loop/cycle-n", "main")).code).toBe(0);
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "cycle work"], { cwd: wt });
    await worktreeRemove(repo, wt, "loop/cycle-n", false);
    expect(existsSync(wt)).toBe(false);
    expect(existsSync(join(repo, ".roll", "loop", "quarantine", "leaked-loop-cycle-n.bundle"))).toBe(false);
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

describe("RESUME-PRIOR-WORK probes (un-merged audit-branch reuse)", () => {
  const W = (p: string, ...args: string[]): string =>
    execFileSync("git", args, { cwd: p, encoding: "utf8" }).trim();
  /** Build an origin repo with main + a `loop/cycle-<tag>` branch holding work,
   *  then a clone whose origin/* tracking refs the probes read. The cycle branch
   *  ALWAYS branches off the same main commit so it is un-merged by construction;
   *  `mainExtra` files (added on main AFTER the branch point) drive the rebase
   *  clean-vs-conflict outcome. */
  function setup(tag: string, opts: { branchFile: string; mainExtra?: { file: string; body: string } | undefined; cycleBody: string }): { clone: string; cycleBranch: string } {
    const origin = initRepo(`origin-${tag}`);
    const cycleBranch = `loop/cycle-${tag}`;
    // Branch the cycle off main, add the prior work, push it back to origin.
    W(origin, "checkout", "-q", "-b", cycleBranch);
    execFileSync("bash", ["-c", `printf '%s' '${opts.cycleBody}' > ${opts.branchFile}`], { cwd: origin });
    W(origin, "add", "-A");
    W(origin, "commit", "-q", "-m", "prior cycle work");
    W(origin, "checkout", "-q", "main");
    if (opts.mainExtra !== undefined) {
      execFileSync("bash", ["-c", `printf '%s' '${opts.mainExtra.body}' > ${opts.mainExtra.file}`], { cwd: origin });
      W(origin, "add", "-A");
      W(origin, "commit", "-q", "-m", "main moved on");
    }
    const clone = tmp(`clone-${tag}`);
    execFileSync("git", ["clone", "-q", origin, clone], { cwd: tmp(`clonebase-${tag}`) });
    return { clone, cycleBranch };
  }

  it("fetchRemoteBranch reports true for an existing branch, false for a missing one", async () => {
    const { clone, cycleBranch } = setup("fetch", { branchFile: "feat.txt", cycleBody: "work" });
    expect((await fetchRemoteBranch(clone, cycleBranch)).fetched).toBe(true);
    expect((await fetchRemoteBranch(clone, "loop/cycle-does-not-exist")).fetched).toBe(false);
  });

  it("branchMergedIntoMain: false for an un-merged branch, true once it lands on main", async () => {
    const { clone, cycleBranch } = setup("merged", { branchFile: "feat.txt", cycleBody: "work" });
    await fetchRemoteBranch(clone, cycleBranch);
    // Un-merged: the cycle branch's tip is not an ancestor of origin/main.
    expect(await branchMergedIntoMain(clone, cycleBranch)).toBe(false);
    // Merge it into the origin's main and re-fetch → now it IS on main.
    const originPath = W(clone, "remote", "get-url", "origin");
    W(originPath, "merge", "-q", "--no-ff", cycleBranch, "-m", "merge cycle");
    W(clone, "fetch", "-q", "origin", "main");
    expect(await branchMergedIntoMain(clone, cycleBranch)).toBe(true);
  });

  it("branchCleanlyRebasesOntoMain: true when no overlap, false on a conflicting file", async () => {
    // Clean: the cycle touches feat.txt; main moves on a DIFFERENT file.
    const clean = setup("clean", {
      branchFile: "feat.txt",
      cycleBody: "feat work",
      mainExtra: { file: "other.txt", body: "unrelated main change" },
    });
    await fetchRemoteBranch(clean.clone, clean.cycleBranch);
    expect(await branchCleanlyRebasesOntoMain(clean.clone, clean.cycleBranch)).toBe(true);

    // Conflict: both the cycle branch and main edit the SAME file divergently.
    const conflict = setup("conflict", {
      branchFile: "shared.txt",
      cycleBody: "cycle version",
      mainExtra: { file: "shared.txt", body: "main version" },
    });
    await fetchRemoteBranch(conflict.clone, conflict.cycleBranch);
    expect(await branchCleanlyRebasesOntoMain(conflict.clone, conflict.cycleBranch)).toBe(false);
  });

  it("worktreeResetHard fetches + reset --hard onto the resume ref so the prior work appears in the tree", async () => {
    // The clone is on main (no feat.txt); the resume ref carries it. After the
    // re-point, the tracked tree carries the prior cycle's file.
    const { clone, cycleBranch } = setup("reset", { branchFile: "git-hooks.ts", cycleBody: "prior work" });
    expect(existsSync(join(clone, "git-hooks.ts"))).toBe(false);
    const r = await worktreeResetHard(clone, `origin/${cycleBranch}`, cycleBranch);
    expect(r.code).toBe(0);
    expect(existsSync(join(clone, "git-hooks.ts"))).toBe(true);
    expect(W(clone, "show", "-s", "--format=%s", "HEAD")).toBe("prior cycle work");
  });

  it("worktreeResetHard returns a non-zero code for an unfetchable branch (caller stays fresh)", async () => {
    const { clone } = setup("reset-miss", { branchFile: "x.txt", cycleBody: "x" });
    const r = await worktreeResetHard(clone, "origin/loop/cycle-missing", "loop/cycle-missing");
    expect(r.code).not.toBe(0);
  });

  it("branchMergedIntoMain honors a custom integrationBranch (default stays origin/main)", async () => {
    // origin has two integration branches: main (unchanged) and release, into
    // which the cycle branch is merged. The probe must consult whichever
    // integration branch it is told, defaulting to origin/main.
    const { clone, cycleBranch } = setup("custom-merged", { branchFile: "feat.txt", cycleBody: "work" });
    const originPath = W(clone, "remote", "get-url", "origin");
    W(originPath, "branch", "release", "main");
    W(originPath, "checkout", "-q", "release");
    W(originPath, "merge", "-q", "--no-ff", cycleBranch, "-m", "merge into release");
    W(originPath, "checkout", "-q", "main");
    W(clone, "fetch", "-q", "origin");
    await fetchRemoteBranch(clone, cycleBranch);
    // Default (origin/main): NOT merged there.
    expect(await branchMergedIntoMain(clone, cycleBranch)).toBe(false);
    // Custom integration branch origin/release: IS merged there.
    expect(await branchMergedIntoMain(clone, cycleBranch, "origin/release")).toBe(true);
  });

  it("branchCleanlyRebasesOntoMain honors a custom integrationBranch", async () => {
    // A clean branch rebases onto whichever integration branch is named.
    const clean = setup("custom-rebase", {
      branchFile: "feat.txt",
      cycleBody: "feat work",
      mainExtra: { file: "other.txt", body: "unrelated main change" },
    });
    const originPath = W(clean.clone, "remote", "get-url", "origin");
    W(originPath, "branch", "release", "main");
    W(clean.clone, "fetch", "-q", "origin");
    await fetchRemoteBranch(clean.clone, clean.cycleBranch);
    expect(await branchCleanlyRebasesOntoMain(clean.clone, clean.cycleBranch, "origin/release")).toBe(true);
  });
});

describe("resolveIntegrationBranch", () => {
  it("defaults to origin/main when no config file exists", () => {
    const d = tmp("rib-default");
    expect(resolveIntegrationBranch(d)).toBe("origin/main");
  });
  it("returns the configured integration_branch from .roll/local.yaml", () => {
    const d = tmp("rib-config");
    mkdirSync(join(d, ".roll"), { recursive: true });
    writeFileSync(join(d, ".roll", "local.yaml"), "integration_branch: origin/dev\n", "utf8");
    expect(resolveIntegrationBranch(d)).toBe("origin/dev");
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
