import { execFileSync, spawn } from "node:child_process";
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
import { fileURLToPath } from "node:url";
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
import { git as typedGit } from "../src/git.js";
import { acquireLock, readLockOwner, releaseLock } from "../src/process.js";

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

async function runCacheWorker(
  rollHome: string,
  remote: string,
  repoId: string,
  outputPath: string,
): Promise<void> {
  const worker = fileURLToPath(new URL("./fixtures/repository-cache-worker.mjs", import.meta.url));
  await new Promise<void>((resolveWorker, rejectWorker) => {
    const child = spawn(process.execPath, [worker, rollHome, remote, repoId, outputPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", rejectWorker);
    child.on("exit", (code) => {
      if (code === 0) resolveWorker();
      else {
        const workerOutput = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
        rejectWorker(new Error(`repository cache worker exited ${code}: ${stderr}${workerOutput}`));
      }
    });
  });
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

    expect(canonical.repoId).toBe(scp.repoId);
    expect(canonical.remote).toBe(scp.remote);
    expect(canonical.cachePath).toBe(scp.cachePath);
    expect(canonical.transportRemote).toBe("ssh://git@Example.TEST:22/team/product.git/");
    expect(scp.transportRemote).toBe("git@example.test:team/product.git");
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
    expect(JSON.stringify(error)).not.toContain("token-secret");
    expect(runGitAdapter).not.toHaveBeenCalled();
  });

  it("rejects unsupported relative remote syntax before invoking Git", async () => {
    const rollHome = sandbox();
    const runGitAdapter = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    await expect(ensureRepositoryCache({
      rollHome,
      binding: { ...binding("https://example.test/team/product.git"), remote: "../product.git" },
      integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
      runGit: runGitAdapter,
    })).rejects.toMatchObject<Partial<RepositoryCacheError>>({ code: "unsafe_remote" });
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

  it("rejects an integration refspec that disagrees with the binding branch", async () => {
    const rollHome = sandbox();
    const runGitAdapter = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    await expect(ensureRepositoryCache({
      rollHome,
      binding: binding("https://example.test/team/product.git"),
      integrationRefspec: "+refs/heads/release:refs/remotes/origin/release",
      runGit: runGitAdapter,
    })).rejects.toMatchObject<Partial<RepositoryCacheError>>({ code: "unsupported_refspec" });
    expect(runGitAdapter).not.toHaveBeenCalled();
  });

  it("rejects invalid lock timing instead of waiting forever", async () => {
    const rollHome = sandbox();
    const runGitAdapter = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    await expect(ensureRepositoryCache({
      rollHome,
      binding: binding("https://example.test/team/product.git"),
      integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
      lockTimeoutMs: Number.NaN,
      runGit: runGitAdapter,
    })).rejects.toMatchObject<Partial<RepositoryCacheError>>({ code: "invalid_lock_options" });
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

  it("rejects a cache leaf symlink before invoking Git", async () => {
    const rollHome = sandbox();
    const outside = sandbox();
    const repository = binding("https://example.test/team/product.git");
    const identity = resolveRepositoryCacheIdentity({ rollHome, binding: repository });
    mkdirSync(identity.reposRoot, { recursive: true });
    symlinkSync(outside, identity.cachePath, "dir");
    const runGitAdapter = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));

    await expect(ensureRepositoryCache({
      rollHome,
      binding: repository,
      integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
      runGit: runGitAdapter,
    })).rejects.toMatchObject<Partial<RepositoryCacheError>>({ code: "unsafe_path" });
    expect(runGitAdapter).not.toHaveBeenCalled();
  });

  it("rechecks path safety after waiting for the repository lock", async () => {
    const rollHome = sandbox();
    const outside = sandbox();
    const repository = binding("https://example.test/team/product.git");
    const identity = resolveRepositoryCacheIdentity({ rollHome, binding: repository });
    mkdirSync(identity.reposRoot, { recursive: true });
    mkdirSync(join(rollHome, "locks", "repos"), { recursive: true });
    expect(acquireLock(identity.lockPath, process.pid, { cycleId: "blocker" }).acquired).toBe(true);
    const runGitAdapter = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));

    const pending = ensureRepositoryCache({
      rollHome,
      binding: repository,
      integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
      lockTimeoutMs: 1_000,
      lockRetryMs: 5,
      runGit: runGitAdapter,
    });
    const pendingResult = pending.then(
      () => ({ ok: true as const, error: undefined }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 25));
    rmSync(identity.reposRoot, { recursive: true, force: true });
    symlinkSync(outside, identity.reposRoot, "dir");
    releaseLock(identity.lockPath);

    const result = await pendingResult;
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject<Partial<RepositoryCacheError>>({ code: "unsafe_path" });
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

  it("serializes two Workspace acquisitions onto one complete cache", async () => {
    const rollHome = sandbox();
    const upstream = localRemote(sandbox(), "concurrent");
    const repository = binding(upstream.remote);

    const [alpha, beta] = await Promise.all([
      ensureRepositoryCache({
        rollHome,
        binding: repository,
        integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
      }),
      ensureRepositoryCache({
        rollHome,
        binding: repository,
        integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
      }),
    ]);

    expect(new Set([alpha.cachePath, beta.cachePath])).toEqual(new Set([alpha.cachePath]));
    expect(new Set([alpha.action, beta.action])).toEqual(new Set(["created", "reused"]));
    expect(alpha.baseSha).toBe(beta.baseSha);
    const identity = resolveRepositoryCacheIdentity({ rollHome, binding: repository });
    expect(existsSync(identity.temporaryPath)).toBe(false);
    expect(existsSync(identity.journalPath)).toBe(false);
    expect(runGit(identity.cachePath, ["fsck", "--connectivity-only"])).toBe("");
  });

  it("serializes two independent Node processes onto one machine cache", async () => {
    const rollHome = sandbox();
    const outputRoot = sandbox();
    const upstream = localRemote(sandbox(), "process-concurrent");
    const repository = binding(upstream.remote);
    const alphaOutput = join(outputRoot, "alpha.json");
    const betaOutput = join(outputRoot, "beta.json");

    await Promise.all([
      runCacheWorker(rollHome, upstream.remote, repository.repoId, alphaOutput),
      runCacheWorker(rollHome, upstream.remote, repository.repoId, betaOutput),
    ]);
    const alpha = JSON.parse(readFileSync(alphaOutput, "utf8")) as { result: { action: string; cachePath: string; baseSha: string } };
    const beta = JSON.parse(readFileSync(betaOutput, "utf8")) as { result: { action: string; cachePath: string; baseSha: string } };

    expect(new Set([alpha.result.action, beta.result.action])).toEqual(new Set(["created", "reused"]));
    expect(alpha.result.cachePath).toBe(beta.result.cachePath);
    expect(alpha.result.baseSha).toBe(beta.result.baseSha);
    expect(runGit(alpha.result.cachePath, ["fsck", "--connectivity-only"])).toBe("");
  });

  it("does not release a newer owner lock after a stale takeover", async () => {
    const rollHome = sandbox();
    const upstream = localRemote(sandbox(), "owner-token");
    const repository = binding(upstream.remote);
    const identity = resolveRepositoryCacheIdentity({ rollHome, binding: repository });
    let unblockFetch: (() => void) | undefined;
    let markFetchStarted: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolveStarted) => {
      markFetchStarted = resolveStarted;
    });
    const fetchBlock = new Promise<void>((resolveFetch) => {
      unblockFetch = resolveFetch;
    });
    let blocked = false;
    const runGitAdapter = async (args: readonly string[], cwd?: string) => {
      if (!blocked && args[0] === "fetch") {
        blocked = true;
        markFetchStarted?.();
        await fetchBlock;
      }
      return typedGit(args, cwd);
    };

    const pending = ensureRepositoryCache({
      rollHome,
      binding: repository,
      integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
      runGit: runGitAdapter,
    });
    const pendingResult = pending.then(
      (value) => ({ ok: true as const, value, error: undefined }),
      (error: unknown) => ({ ok: false as const, value: undefined, error }),
    );
    await fetchStarted;
    expect(existsSync(identity.journalPath)).toBe(true);
    expect(readLockOwner(identity.lockPath)).toMatchObject({
      pid: process.pid,
      cycleId: expect.stringMatching(new RegExp(`^${identity.repoId}:`, "u")),
    });
    const takeover = acquireLock(identity.lockPath, 424242, {
      staleSec: 0,
      pidAlive: () => true,
      cycleId: "new-owner",
    });
    expect(takeover.acquired).toBe(true);
    unblockFetch?.();
    const result = await pendingResult;

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject<Partial<RepositoryCacheError>>({ code: "lock_lost" });
    expect(readLockOwner(identity.lockPath)).toMatchObject({ pid: 424242, cycleId: "new-owner" });
    releaseLock(identity.lockPath);
  });

  it("repairs a deleted cache without changing Workspace, Issue, backlog or completion truth", async () => {
    const rollHome = sandbox();
    const upstream = localRemote(sandbox(), "rebuild");
    const repository = binding(upstream.remote);
    const workspaceRoot = join(rollHome, "workspaces", "ws-alpha");
    const issueRoot = join(workspaceRoot, "issues", "US-WS-004");
    mkdirSync(issueRoot, { recursive: true });
    const truthFiles = [
      join(rollHome, "workspaces.json"),
      join(workspaceRoot, "workspace.yaml"),
      join(issueRoot, "issue.yaml"),
      join(workspaceRoot, "backlog.md"),
      join(issueRoot, "completion.ndjson"),
    ];
    for (const [index, path] of truthFiles.entries()) {
      writeFileSync(path, `truth-${index}\n`, "utf8");
    }
    const before = new Map(truthFiles.map((path) => [path, readFileSync(path, "utf8")]));
    const created = await ensureRepositoryCache({
      rollHome,
      binding: repository,
      integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
    });
    rmSync(created.cachePath, { recursive: true, force: true });

    const rebuilt = await ensureRepositoryCache({
      rollHome,
      binding: repository,
      integrationRefspec: "+refs/heads/main:refs/remotes/origin/main",
    });
    expect(rebuilt).toMatchObject({ action: "repaired", event: { type: "repo:cache_repaired" } });
    expect(rebuilt.baseSha).toBe(runGit(upstream.source, ["rev-parse", "HEAD"]));
    expect(runGit(rebuilt.cachePath, ["rev-parse", "--is-bare-repository"])).toBe("true");
    expect(runGit(rebuilt.cachePath, ["fsck", "--connectivity-only"])).toBe("");
    for (const path of truthFiles) expect(readFileSync(path, "utf8")).toBe(before.get(path));
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
    expect(repairedInterrupted.baseSha).toBe(runGit(upstream.source, ["rev-parse", "HEAD"]));
    expect(existsSync(identity.temporaryPath)).toBe(false);
    expect(existsSync(identity.journalPath)).toBe(false);
    expect(runGit(repairedInterrupted.cachePath, ["remote", "get-url", "origin"])).toBe(upstream.remote);
    expect(runGit(repairedInterrupted.cachePath, ["fsck", "--connectivity-only"])).toBe("");
  });

});
