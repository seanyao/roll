import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IssueStoryContract } from "@roll/core";
import { repositoryIdFromRemote, type RepositoryBinding, type RequirementSourceManifest } from "@roll/spec";
import { afterEach, describe, expect, it } from "vitest";
import {
  IssueInitializationError,
  applyIssueInit,
  inspectIssueInit,
} from "../src/issue-worktrees.js";

const sandboxes: string[] = [];
afterEach(() => {
  for (const root of sandboxes.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), "roll-issue-worktrees-"));
  sandboxes.push(root);
  return root;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Materialize a real remote with one commit on main. */
function materializeRemote(root: string, name: string): string {
  const source = join(root, `${name}-source`);
  mkdirSync(source, { recursive: true });
  git(source, ["init", "-q", "-b", "main"]);
  git(source, ["config", "user.email", "roll@example.test"]);
  git(source, ["config", "user.name", "Roll Test"]);
  writeFileSync(join(source, "README.md"), "fixture\n", "utf8");
  git(source, ["add", "README.md"]);
  git(source, ["commit", "-q", "-m", "fixture"]);
  const remote = join(root, `${name}.git`);
  git(root, ["clone", "-q", "--bare", source, remote]);
  return remote;
}

function binding(alias: string, remote: string): RepositoryBinding {
  const url = `file://${remote}`;
  const repoId = repositoryIdFromRemote(url);
  if (!repoId.ok) throw new Error(`fixture remote must be valid: ${remote}`);
  return {
    schema: "roll.repository-binding/v1",
    repoId: repoId.value,
    alias,
    remote: url,
    integrationBranch: "main",
    provider: "generic",
    workflow: { branchPattern: "roll/{workspace_id}/{story_id}", requiredChecks: [] },
  };
}

function fixture() {
  const root = sandbox();
  const rollHome = join(root, "roll-home");
  const sot1Remote = materializeRemote(root, "sot1");
  const sot2Remote = materializeRemote(root, "sot2");
  const sot3Remote = materializeRemote(root, "sot3");
  const bindings: readonly RepositoryBinding[] = [
    binding("sot1", sot1Remote),
    binding("sot2", sot2Remote),
    binding("sot3", sot3Remote),
  ];
  const contract: IssueStoryContract = {
    storyId: "US-XX1",
    repositories: [
      { alias: "sot1", access: "write", requiredDelivery: true },
      { alias: "sot2", access: "write", requiredDelivery: true, dependsOnRepo: "sot1" },
      { alias: "sot3", access: "read", requiredDelivery: false },
    ],
  };
  const requirementManifests: readonly RequirementSourceManifest[] = [];
  const issueRoot = join(root, "workspace", "issues", "US-XX1");
  return { root, rollHome, bindings, contract, requirementManifests, issueRoot, remotes: { sot1: sot1Remote, sot2: sot2Remote, sot3: sot3Remote } };
}

describe("inspectIssueInit", () => {
  it("is side-effect free and reports every target's full check facts for a brand-new Issue", async () => {
    const f = fixture();
    const before = existsSync(f.rollHome);
    const report = await inspectIssueInit({
      workspaceId: "ws-demo",
      rollHome: f.rollHome,
      issueRoot: f.issueRoot,
      contract: f.contract,
      bindings: f.bindings,
    });
    expect(report.manifest.state).toBe("absent");
    expect(report.targets["sot1"]).toMatchObject({
      alias: "sot1", access: "write", repoId: f.bindings.find((b) => b.alias === "sot1")?.repoId,
      cacheState: "absent", baseSha: null, decision: "created", workBranch: expect.stringContaining("sot1"),
    });
    expect(report.targets["sot3"]).toMatchObject({ alias: "sot3", access: "read", workBranch: null });
    // Zero filesystem writes anywhere, including the machine Roll Home cache.
    expect(before).toBe(false);
    expect(existsSync(f.rollHome)).toBe(false);
    expect(existsSync(f.issueRoot)).toBe(false);
  });

  it("reports compatible cache/worktree facts after a real apply, still with zero writes on re-check", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });

    const beforeDigest = statSync(f.rollHome).mtimeMs;
    const report = await inspectIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings });
    expect(statSync(f.rollHome).mtimeMs).toBe(beforeDigest); // zero writes on re-check

    expect(report.manifest.state).toBe("compatible");
    for (const alias of ["sot1", "sot2", "sot3"]) {
      expect(report.targets[alias]).toMatchObject({ cacheState: "compatible", decision: "reused" });
      expect(typeof report.targets[alias]?.baseSha).toBe("string");
      expect(typeof report.targets[alias]?.cachePath).toBe("string");
    }
    expect(report.targets["sot1"]?.workBranch).toBe("roll/ws-demo/US-XX1/sot1");
    expect(report.targets["sot3"]?.workBranch).toBeNull();
  });
});

describe("applyIssueInit", () => {
  it("creates the Issue root with real git worktrees, the immutable manifest, and one issue:repository_bound event per target with full facts", async () => {
    const f = fixture();
    const result = await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });

    expect(result.outcome).toBe("created");
    expect(existsSync(join(f.issueRoot, "sot1", ".git"))).toBe(true);
    expect(existsSync(join(f.issueRoot, "sot2", ".git"))).toBe(true);
    expect(existsSync(join(f.issueRoot, "sot3", ".git"))).toBe(true);
    // Write targets get a real named branch; read targets are real detached worktrees.
    expect(git(join(f.issueRoot, "sot1"), ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("roll/ws-demo/US-XX1/sot1");
    expect(() => git(join(f.issueRoot, "sot3"), ["symbolic-ref", "-q", "HEAD"])).toThrow();

    const manifestPath = join(f.issueRoot, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest).toMatchObject({ schema: "roll.issue/v1", workspaceId: "ws-demo", storyId: "US-XX1" });
    // The immutable manifest never carries runtime SHA/path/branch.
    expect(JSON.stringify(manifest)).not.toContain("baseSha");
    expect(JSON.stringify(manifest)).not.toContain("worktreePath");
    expect(JSON.stringify(manifest)).not.toContain("workBranch");

    const events = readFileSync(join(f.issueRoot, "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(event).toMatchObject({ type: "issue:repository_bound", workspaceId: "ws-demo", storyId: "US-XX1" });
      expect(typeof event.repoId).toBe("string");
      expect(typeof event.alias).toBe("string");
      expect(["read", "write"]).toContain(event.access);
      expect(typeof event.baseSha).toBe("string");
      expect(typeof event.worktreePath).toBe("string");
    }
    const sot1Event = events.find((event) => event.alias === "sot1");
    expect(sot1Event.workBranch).toBe("roll/ws-demo/US-XX1/sot1");
    const sot3Event = events.find((event) => event.alias === "sot3");
    expect(sot3Event.workBranch).toBeNull();
  });

  it("resolves ALL targets, cache and base SHA before creating or mutating the Issue root", async () => {
    const f = fixture();
    // Break the SECOND repository's remote before apply — resolution of every
    // target must fail BEFORE the Issue root is created at all.
    rmSync(f.remotes.sot2, { recursive: true, force: true });

    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);
    expect(existsSync(f.issueRoot)).toBe(false);
  });

  it("uses the real machine Roll Home cache under <rollHome>/repos, never a Workspace-relative cache", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    expect(existsSync(join(f.rollHome, "repos", `${f.bindings.find((b) => b.alias === "sot1")?.repoId}.git`))).toBe(true);
    expect(existsSync(join(f.rollHome, "repos", `${f.bindings.find((b) => b.alias === "sot2")?.repoId}.git`))).toBe(true);
    expect(existsSync(join(f.rollHome, "repos", `${f.bindings.find((b) => b.alias === "sot3")?.repoId}.git`))).toBe(true);
    // No cache anywhere under the Workspace/Issue tree.
    expect(existsSync(join(f.root, "workspace", ".roll-cache"))).toBe(false);
  });

  it("never mutates the manifest once written, and reuses it verbatim on a compatible retry", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    const manifestPath = join(f.issueRoot, "manifest.json");
    const before = readFileSync(manifestPath, "utf8");

    const retry = await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    expect(retry.outcome).toBe("reused");
    expect(readFileSync(manifestPath, "utf8")).toBe(before);
  });

  it("real-git idempotent retry creates no duplicate worktrees, branches or events; manifest bytes unchanged", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    const cachePath = join(f.rollHome, "repos", `${f.bindings.find((b) => b.alias === "sot1")?.repoId}.git`);
    const listBefore = git(cachePath, ["worktree", "list", "--porcelain"]);
    const eventsBefore = readFileSync(join(f.issueRoot, "events.jsonl"), "utf8");

    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    const listAfter = git(cachePath, ["worktree", "list", "--porcelain"]);
    expect(listAfter).toBe(listBefore);
    expect(readFileSync(join(f.issueRoot, "events.jsonl"), "utf8")).toBe(eventsBefore);
    const branches = git(cachePath, ["branch", "--list", "roll/*"]).split("\n").filter(Boolean);
    expect(branches).toHaveLength(1);
  });

  it("rejects an on-disk manifest that conflicts with the resolved identity instead of overwriting it", async () => {
    const f = fixture();
    mkdirSync(f.issueRoot, { recursive: true });
    writeFileSync(join(f.issueRoot, "manifest.json"), JSON.stringify({
      schema: "roll.issue/v1", workspaceId: "ws-other", storyId: "US-XX1", requirements: [], repositories: [],
    }));
    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);
  });

  it("rejects a manifest_conflict when requirements/repositories changed under the same identity, with zero mutation", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    const manifestPath = join(f.issueRoot, "manifest.json");
    const before = readFileSync(manifestPath, "utf8");

    // Same workspaceId/storyId, but the Story Contract now declares a DIFFERENT
    // repository set — the full immutable intent no longer matches.
    const changedContract: IssueStoryContract = {
      storyId: "US-XX1",
      repositories: [
        { alias: "sot1", access: "write", requiredDelivery: true },
        { alias: "sot3", access: "read", requiredDelivery: false },
      ],
    };
    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: f.issueRoot, contract: changedContract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);
    expect(readFileSync(manifestPath, "utf8")).toBe(before);
  });

  it("resolves no target and creates nothing when even ONE target's repository cache cannot be resolved", async () => {
    const f = fixture();
    // Break sot3's remote — cache resolution for ALL targets happens BEFORE
    // any worktree is created, so this must leave the Issue root untouched.
    rmSync(f.remotes.sot3, { recursive: true, force: true });

    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);

    expect(existsSync(f.issueRoot)).toBe(false);
  });

  it("rolls back a newly-created CLEAN target via real git worktree removal when a LATER target's worktree add genuinely fails", async () => {
    const f = fixture();
    // A real, unmocked git-level failure at the worktree-ADD phase (after
    // every target's cache already resolved): sot2's governed branch name
    // already exists in its OWN cache (e.g. left by some other process) —
    // git's own `worktree add -b` refuses to recreate an existing branch.
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: join(f.root, "throwaway-issue"), contract: { storyId: "US-XX1", repositories: [{ alias: "sot2", access: "write", requiredDelivery: true }] }, bindings: f.bindings, requirementManifests: f.requirementManifests });

    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);

    // sot1 was newly-created and clean -> rolled back via git worktree remove.
    expect(existsSync(join(f.issueRoot, "sot1"))).toBe(false);
    const journal = JSON.parse(readFileSync(join(f.issueRoot, "issue-init.pending.json"), "utf8"));
    expect(journal.status).toBe("repair_required");
  });

  it("preserves a target that becomes dirty after creation when a LATER target fails — real fault injection", async () => {
    const f = fixture();
    // A real, unmocked git-level failure at the worktree-ADD phase: sot2's
    // governed branch already exists in its own cache (left by some other
    // process), so git's own `worktree add -b` refuses to recreate it.
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: join(f.root, "throwaway-issue"), contract: { storyId: "US-XX1", repositories: [{ alias: "sot2", access: "write", requiredDelivery: true }] }, bindings: f.bindings, requirementManifests: f.requirementManifests });

    let firstAttemptError: unknown;
    try {
      await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }, {
        // Real fault injection: the instant sot1's real worktree is created,
        // make it genuinely dirty — BEFORE sot2's real git failure triggers rollback.
        afterTargetCreated: (alias, path) => {
          if (alias === "sot1") writeFileSync(join(path, "dirty.txt"), "keep me — real uncommitted work");
        },
      });
    } catch (error) {
      firstAttemptError = error;
    }
    expect(firstAttemptError).toBeInstanceOf(IssueInitializationError);
    // sot1 went dirty before rollback ran -> preserved, never removed.
    expect(existsSync(join(f.issueRoot, "sot1", "dirty.txt"))).toBe(true);

    // Repair: remove the colliding branch from the OTHER worktree, then re-run.
    const cachePath = join(f.rollHome, "repos", `${f.bindings.find((b) => b.alias === "sot2")?.repoId}.git`);
    execFileSync("git", ["worktree", "remove", "--force", join(f.root, "throwaway-issue", "sot2")], { cwd: cachePath, stdio: "ignore" });
    execFileSync("git", ["branch", "-D", "roll/ws-demo/US-XX1/sot2"], { cwd: cachePath, stdio: "ignore" });
    const repaired = await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    expect(repaired.outcome).toBe("repaired");
    expect(existsSync(join(f.issueRoot, "sot1", "dirty.txt"))).toBe(true);
    expect(existsSync(join(f.issueRoot, "sot2", ".git"))).toBe(true);
  });

  it("resumes and repairs the same Issue identity after interruption without duplicating worktrees or branches", async () => {
    const f = fixture();
    await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: join(f.root, "throwaway-issue"), contract: { storyId: "US-XX1", repositories: [{ alias: "sot2", access: "write", requiredDelivery: true }] }, bindings: f.bindings, requirementManifests: f.requirementManifests });
    await expect(applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests }))
      .rejects.toThrow(IssueInitializationError);
    // sot1 was newly-created and clean -> rolled back on the failed attempt.
    expect(existsSync(join(f.issueRoot, "sot1"))).toBe(false);

    const cachePath = join(f.rollHome, "repos", `${f.bindings.find((b) => b.alias === "sot2")?.repoId}.git`);
    execFileSync("git", ["worktree", "remove", "--force", join(f.root, "throwaway-issue", "sot2")], { cwd: cachePath, stdio: "ignore" });
    execFileSync("git", ["branch", "-D", "roll/ws-demo/US-XX1/sot2"], { cwd: cachePath, stdio: "ignore" });
    const result = await applyIssueInit({ workspaceId: "ws-demo", rollHome: f.rollHome, issueRoot: f.issueRoot, contract: f.contract, bindings: f.bindings, requirementManifests: f.requirementManifests });
    expect(result.outcome).toBe("repaired");
    expect(existsSync(join(f.issueRoot, "sot2", ".git"))).toBe(true);
    expect(existsSync(join(f.issueRoot, "sot3", ".git"))).toBe(true);

    const sot1CachePath = join(f.rollHome, "repos", `${f.bindings.find((b) => b.alias === "sot1")?.repoId}.git`);
    const branches = git(sot1CachePath, ["branch", "--list", "roll/*"]).split("\n").filter(Boolean);
    expect(branches).toHaveLength(1); // sot1 never got a duplicate branch across the two attempts
  });
});
