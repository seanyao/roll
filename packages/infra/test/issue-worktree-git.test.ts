import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  issueWorktreeAdd,
  issueWorktreeIdentity,
  issueWorktreeRemove,
  protectReadOnlyWorktree,
  unprotectReadOnlyWorktree,
} from "../src/issue-worktree-git.js";

const sandboxes: string[] = [];
afterEach(() => {
  for (const root of sandboxes.splice(0)) {
    unprotectReadOnlyWorktree(root);
    rmSync(root, { recursive: true, force: true });
  }
});

function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), "roll-issue-worktree-git-"));
  sandboxes.push(root);
  return root;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A real bare cache with one commit on main, mirroring ensureRepositoryCache's output shape. */
function bareCache(root: string): { readonly cachePath: string; readonly baseSha: string } {
  const source = join(root, "source");
  mkdirSync(source, { recursive: true });
  git(source, ["init", "-q", "-b", "main"]);
  git(source, ["config", "user.email", "roll@example.test"]);
  git(source, ["config", "user.name", "Roll Test"]);
  writeFileSync(join(source, "README.md"), "fixture\n", "utf8");
  git(source, ["add", "README.md"]);
  git(source, ["commit", "-q", "-m", "fixture"]);
  const cachePath = join(root, "cache.git");
  git(root, ["clone", "-q", "--bare", source, cachePath]);
  const baseSha = git(source, ["rev-parse", "HEAD"]);
  return { cachePath, baseSha };
}

describe("issueWorktreeAdd", () => {
  it("creates a real detached git worktree for a read target (no branch)", async () => {
    const root = sandbox();
    const { cachePath, baseSha } = bareCache(root);
    const path = join(root, "issues", "US-XX1", "docs");
    await issueWorktreeAdd(cachePath, path, baseSha, null);
    expect(existsSync(join(path, ".git"))).toBe(true);
    const head = git(path, ["rev-parse", "HEAD"]);
    expect(head).toBe(baseSha);
    // detached HEAD: `git symbolic-ref` exits non-zero (no branch ref to report)
    expect(() => git(path, ["symbolic-ref", "-q", "HEAD"])).toThrow();
  });

  it("creates a real git worktree on a NEW named branch for a write target", async () => {
    const root = sandbox();
    const { cachePath, baseSha } = bareCache(root);
    const path = join(root, "issues", "US-XX1", "sot");
    await issueWorktreeAdd(cachePath, path, baseSha, "roll/ws-demo/US-XX1/sot");
    const branch = git(path, ["rev-parse", "--abbrev-ref", "HEAD"]);
    expect(branch).toBe("roll/ws-demo/US-XX1/sot");
    const head = git(path, ["rev-parse", "HEAD"]);
    expect(head).toBe(baseSha);
  });

  it("never force-removes a pre-existing path — it fails loud instead", async () => {
    const root = sandbox();
    const { cachePath, baseSha } = bareCache(root);
    const path = join(root, "issues", "US-XX1", "sot");
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "keep-me.txt"), "pre-existing content");
    await expect(issueWorktreeAdd(cachePath, path, baseSha, "roll/ws-demo/US-XX1/sot")).rejects.toThrow();
    expect(existsSync(join(path, "keep-me.txt"))).toBe(true);
  });

  it("re-adds at the same path after its directory was deleted by hand (stale worktree admin metadata), by pruning first", async () => {
    const root = sandbox();
    const { cachePath, baseSha } = bareCache(root);
    const path = join(root, "issues", "US-XX1", "docs");
    await issueWorktreeAdd(cachePath, path, baseSha, null);
    // Simulate an operator deleting the worktree directory directly, NOT via
    // `git worktree remove` — git's own admin metadata still references it.
    rmSync(path, { recursive: true, force: true });
    await issueWorktreeAdd(cachePath, path, baseSha, null);
    expect(existsSync(join(path, ".git"))).toBe(true);
  });
});

describe("issueWorktreeIdentity", () => {
  it("reports absent for a path that does not exist", async () => {
    const root = sandbox();
    const identity = await issueWorktreeIdentity(join(root, "nope"), join(root, "cache.git"));
    expect(identity.state).toBe("absent");
  });

  it("reports conflict for an ordinary directory that is not a git worktree", async () => {
    const root = sandbox();
    const path = join(root, "not-a-worktree");
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "file.txt"), "hi");
    const identity = await issueWorktreeIdentity(path, join(root, "cache.git"));
    expect(identity.state).toBe("conflict");
  });

  it("reports conflict when the worktree belongs to a DIFFERENT repository cache", async () => {
    const root = sandbox();
    const { cachePath, baseSha } = bareCache(root);
    const otherRoot = sandbox();
    const other = bareCache(otherRoot);
    const path = join(root, "issues", "US-XX1", "sot");
    await issueWorktreeAdd(cachePath, path, baseSha, "roll/ws-demo/US-XX1/sot");
    const identity = await issueWorktreeIdentity(path, other.cachePath);
    expect(identity.state).toBe("conflict");
  });

  it("reports compatible for a clean real worktree matching its cache and branch", async () => {
    const root = sandbox();
    const { cachePath, baseSha } = bareCache(root);
    const path = join(root, "issues", "US-XX1", "sot");
    await issueWorktreeAdd(cachePath, path, baseSha, "roll/ws-demo/US-XX1/sot");
    const identity = await issueWorktreeIdentity(path, cachePath);
    expect(identity).toMatchObject({ state: "compatible", dirty: false, branch: "roll/ws-demo/US-XX1/sot", baseSha });
  });

  it("reports dirty:true for a worktree with uncommitted changes, without treating it as conflict", async () => {
    const root = sandbox();
    const { cachePath, baseSha } = bareCache(root);
    const path = join(root, "issues", "US-XX1", "sot");
    await issueWorktreeAdd(cachePath, path, baseSha, "roll/ws-demo/US-XX1/sot");
    writeFileSync(join(path, "scratch.txt"), "uncommitted work");
    const identity = await issueWorktreeIdentity(path, cachePath);
    expect(identity).toMatchObject({ state: "compatible", dirty: true });
  });
});

describe("issueWorktreeRemove", () => {
  it("removes a clean worktree via git worktree remove, never a blind rm -rf", async () => {
    const root = sandbox();
    const { cachePath, baseSha } = bareCache(root);
    const path = join(root, "issues", "US-XX1", "sot");
    await issueWorktreeAdd(cachePath, path, baseSha, "roll/ws-demo/US-XX1/sot");
    await issueWorktreeRemove(cachePath, path);
    expect(existsSync(path)).toBe(false);
    // The cache's worktree admin no longer lists it.
    const list = git(cachePath, ["worktree", "list", "--porcelain"]);
    expect(list).not.toContain(path);
  });

  it("refuses to remove a dirty worktree", async () => {
    const root = sandbox();
    const { cachePath, baseSha } = bareCache(root);
    const path = join(root, "issues", "US-XX1", "sot");
    await issueWorktreeAdd(cachePath, path, baseSha, "roll/ws-demo/US-XX1/sot");
    writeFileSync(join(path, "scratch.txt"), "uncommitted work");
    await expect(issueWorktreeRemove(cachePath, path)).rejects.toThrow();
    expect(existsSync(join(path, "scratch.txt"))).toBe(true);
  });
});

describe("protectReadOnlyWorktree / unprotectReadOnlyWorktree", () => {
  it("denies writes to real product files and blocks new-file creation, without touching a tracked symlink's EXTERNAL target", async () => {
    const root = sandbox();
    const outsidePath = join(root, "outside-the-worktree.txt");
    writeFileSync(outsidePath, "external content, never owned by any worktree\n", "utf8");
    const outsideModeBefore = statSync(outsidePath).mode & 0o777;

    const source = join(root, "source");
    mkdirSync(source, { recursive: true });
    git(source, ["init", "-q", "-b", "main"]);
    git(source, ["config", "user.email", "roll@example.test"]);
    git(source, ["config", "user.name", "Roll Test"]);
    writeFileSync(join(source, "README.md"), "fixture\n", "utf8");
    // A real git-tracked symlink whose target lives OUTSIDE this worktree
    // entirely (an absolute path escaping the repo) — exactly the boundary
    // case protect/unprotect must never cross.
    symlinkSync(outsidePath, join(source, "escape-link.txt"));
    git(source, ["add", "README.md", "escape-link.txt"]);
    git(source, ["commit", "-q", "-m", "fixture with an escaping symlink"]);
    const cachePath = join(root, "cache.git");
    git(root, ["clone", "-q", "--bare", source, cachePath]);
    const baseSha = git(source, ["rev-parse", "HEAD"]);

    const path = join(root, "issues", "US-XX1", "docs");
    await issueWorktreeAdd(cachePath, path, baseSha, null);
    protectReadOnlyWorktree(path);

    // The real checked-out product file is denied for writes.
    expect(() => writeFileSync(join(path, "README.md"), "mutated\n", { flag: "r+" })).toThrow(/EACCES|EPERM/);
    // A new top-level file cannot be created either.
    expect(() => writeFileSync(join(path, "new-file.txt"), "new\n")).toThrow(/EACCES|EPERM/);

    // The symlink itself is left exactly as git checked it out (still a link
    // to the same external target) — its EXTERNAL target's permissions and
    // content are completely untouched by protection.
    const linkPath = join(path, "escape-link.txt");
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(statSync(outsidePath).mode & 0o777).toBe(outsideModeBefore);
    expect(readFileSync(outsidePath, "utf8")).toBe("external content, never owned by any worktree\n");
    // Writing through the external path directly (not via the symlink) still
    // works normally — protection never reached it.
    writeFileSync(outsidePath, "still writable externally\n", "utf8");
    expect(readFileSync(outsidePath, "utf8")).toBe("still writable externally\n");

    unprotectReadOnlyWorktree(path);
    // Unprotection restores the real product file's write access...
    writeFileSync(join(path, "README.md"), "restored\n", { flag: "r+" });
    expect(readFileSync(join(path, "README.md"), "utf8")).toBe("restored\n");
    // ...and never touched the external target either (still untouched by
    // the restore pass, same as it was left after protect).
    expect(readFileSync(outsidePath, "utf8")).toBe("still writable externally\n");
  });
});
