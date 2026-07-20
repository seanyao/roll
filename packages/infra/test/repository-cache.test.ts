import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  REPOSITORY_BINDING_V1,
  repositoryIdFromRemote,
  type RepositoryBinding,
} from "@roll/spec";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureRepositoryCache,
  RepositoryCacheError,
  resolveRepositoryCacheIdentity,
} from "../src/repository-cache.js";

const sandboxes: string[] = [];

afterEach(() => {
  for (const root of sandboxes.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), "roll-repository-cache-"));
  sandboxes.push(root);
  return root;
}

function binding(remote: string): RepositoryBinding {
  const repoId = repositoryIdFromRemote(remote);
  if (!repoId.ok) throw new Error("test remote must be valid");
  return {
    schema: REPOSITORY_BINDING_V1,
    repoId: repoId.value,
    alias: "primary",
    remote,
    integrationBranch: "main",
    provider: "generic",
    workflow: { branchPattern: "roll/{workspace_id}/{story_id}", requiredChecks: [] },
  };
}

function runGit(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function localRemote(root: string, name = "upstream"): { remote: string; source: string; bare: string } {
  const source = join(root, `${name}-source`);
  const bare = join(root, `${name}.git`);
  mkdirSync(source, { recursive: true });
  runGit(source, ["init", "-q", "-b", "main"]);
  runGit(source, ["config", "user.email", "roll@example.test"]);
  runGit(source, ["config", "user.name", "Roll Test"]);
  writeFileSync(join(source, "README.md"), "seed\n", "utf8");
  runGit(source, ["add", "README.md"]);
  runGit(source, ["commit", "-q", "-m", "seed"]);
  runGit(root, ["clone", "-q", "--bare", source, bare]);
  return { remote: `file://${bare}`, source, bare };
}

function advanceRemote(remote: ReturnType<typeof localRemote>): string {
  writeFileSync(join(remote.source, "README.md"), `next-${Date.now()}\n`, "utf8");
  runGit(remote.source, ["add", "README.md"]);
  runGit(remote.source, ["commit", "-q", "-m", "next"]);
  runGit(remote.source, ["push", "-q", remote.remote, "HEAD:refs/heads/main"]);
  return runGit(remote.source, ["rev-parse", "HEAD"]);
}

describe("RepositoryCache identity and path safety", () => {
  it("maps normalized remote identity to one deterministic collision-resistant cache path", () => {
    const rollHome = sandbox();
    const canonical = resolveRepositoryCacheIdentity({
      rollHome,
      binding: binding("ssh://git@Example.TEST:22/team/product.git/"),
    });
    const scp = resolveRepositoryCacheIdentity({
      rollHome,
      binding: binding("git@example.test:team/product.git"),
    });
    const other = resolveRepositoryCacheIdentity({
      rollHome,
      binding: binding("git@example.test:team/other.git"),
    });

    expect(canonical).toEqual(scp);
    expect(canonical.cachePath).toBe(join(rollHome, "repos", `${canonical.repoId}.git`));
    expect(basename(canonical.cachePath)).toMatch(/^repo-[0-9a-f]{12}\.git$/u);
    expect(other.cachePath).not.toBe(canonical.cachePath);
    expect(canonical.lockPath).toBe(join(rollHome, "locks", "repos", `${canonical.repoId}.lock`));
  });

  it("rejects an embedded credential before invoking Git and never echoes the secret", async () => {
    const rollHome = sandbox();
    const runGitAdapter = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    const unsafe = {
      ...binding("https://example.test/team/product.git"),
      remote: "https://token-secret@example.test/team/product.git",
    };

    let error: unknown;
    try {
      await ensureRepositoryCache({
        rollHome,
        binding: unsafe,
        integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
        runGit: runGitAdapter,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject<Partial<RepositoryCacheError>>({ code: "unsafe_remote" });
    expect(String(error)).not.toContain("token-secret");
    expect(runGitAdapter).not.toHaveBeenCalled();
  });

  it("rejects unsupported integration refspec before invoking Git", async () => {
    const rollHome = sandbox();
    const runGitAdapter = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    await expect(ensureRepositoryCache({
      rollHome,
      binding: binding("https://example.test/team/product.git"),
      integrationRefspec: "+refs/tags/v1:refs/tags/v1",
      runGit: runGitAdapter,
    })).rejects.toMatchObject<Partial<RepositoryCacheError>>({ code: "unsupported_refspec" });
    expect(runGitAdapter).not.toHaveBeenCalled();
  });

  it("rejects a repos symlink escape before invoking Git", async () => {
    const rollHome = sandbox();
    const outside = sandbox();
    symlinkSync(outside, join(rollHome, "repos"), "dir");
    const runGitAdapter = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));

    await expect(ensureRepositoryCache({
      rollHome,
      binding: binding("https://example.test/team/product.git"),
      integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
      runGit: runGitAdapter,
    })).rejects.toMatchObject<Partial<RepositoryCacheError>>({ code: "unsafe_path" });
    expect(runGitAdapter).not.toHaveBeenCalled();
  });
});

describe("RepositoryCache lifecycle", () => {
  it("creates, fetches and idempotently reuses one real bare cache", async () => {
    const rollHome = sandbox();
    const upstream = localRemote(sandbox());
    const repository = binding(upstream.remote);
    const firstExpected = runGit(upstream.source, ["rev-parse", "HEAD"]);

    const created = await ensureRepositoryCache({
      rollHome,
      binding: repository,
      integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
    });
    expect(created).toMatchObject({ action: "created", event: { type: "repo:cache_created" } });
    expect(created.baseSha).toBe(firstExpected);
    expect(runGit(created.cachePath, ["rev-parse", "--is-bare-repository"])).toBe("true");

    const nextExpected = advanceRemote(upstream);
    const reused = await ensureRepositoryCache({
      rollHome,
      binding: repository,
      integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
    });
    expect(reused).toMatchObject({ action: "reused", cachePath: created.cachePath, event: { type: "repo:cache_reused" } });
    expect(reused.baseSha).toBe(nextExpected);
    expect(existsSync(resolveRepositoryCacheIdentity({ rollHome, binding: repository }).journalPath)).toBe(false);
  });

  it("fails loud on an existing cache origin mismatch", async () => {
    const rollHome = sandbox();
    const upstream = localRemote(sandbox(), "expected");
    const conflicting = localRemote(sandbox(), "conflicting");
    const repository = binding(upstream.remote);
    const created = await ensureRepositoryCache({
      rollHome,
      binding: repository,
      integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
    });
    runGit(created.cachePath, ["remote", "set-url", "origin", conflicting.remote]);

    await expect(ensureRepositoryCache({
      rollHome,
      binding: repository,
      integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
    })).rejects.toMatchObject<Partial<RepositoryCacheError>>({ code: "origin_mismatch" });
    expect(runGit(created.cachePath, ["remote", "get-url", "origin"])).toBe(conflicting.remote);
  });

  it("repairs a corrupt object database and an interrupted creation journal", async () => {
    const corruptHome = sandbox();
    const upstream = localRemote(sandbox(), "repair");
    const repository = binding(upstream.remote);
    const created = await ensureRepositoryCache({
      rollHome: corruptHome,
      binding: repository,
      integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
    });
    rmSync(join(created.cachePath, "objects"), { recursive: true, force: true });
    writeFileSync(join(created.cachePath, "objects"), "corrupt\n", "utf8");

    const repairedCorrupt = await ensureRepositoryCache({
      rollHome: corruptHome,
      binding: repository,
      integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
    });
    expect(repairedCorrupt).toMatchObject({ action: "repaired", event: { type: "repo:cache_repaired" } });
    expect(repairedCorrupt.baseSha).toBe(runGit(upstream.source, ["rev-parse", "HEAD"]));
    expect(statSync(join(repairedCorrupt.cachePath, "objects")).isDirectory()).toBe(true);

    const interruptedHome = sandbox();
    const identity = resolveRepositoryCacheIdentity({ rollHome: interruptedHome, binding: repository });
    mkdirSync(identity.reposRoot, { recursive: true });
    mkdirSync(identity.temporaryPath);
    writeFileSync(identity.journalPath, JSON.stringify({ interrupted: true }), "utf8");
    const repairedInterrupted = await ensureRepositoryCache({
      rollHome: interruptedHome,
      binding: repository,
      integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
    });
    expect(repairedInterrupted.action).toBe("repaired");
    expect(existsSync(identity.temporaryPath)).toBe(false);
    expect(existsSync(identity.journalPath)).toBe(false);
    expect(readFileSync(join(repairedInterrupted.cachePath, "HEAD"), "utf8")).toContain("refs/heads");
  });

});
