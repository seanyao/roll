import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IssueStoryContract } from "@roll/core";
import type { RepositoryBinding, RequirementSourceManifest } from "@roll/spec";
import { afterEach, describe, expect, it } from "vitest";
import {
  IssueInitializationError,
  applyIssueInit,
  inspectIssueInit,
  type IssueWorktreeDeps,
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

function binding(alias: string, repoId: string): RepositoryBinding {
  return {
    schema: "roll.repository-binding/v1",
    repoId,
    alias,
    remote: `file:///tmp/remotes/${alias}`,
    integrationBranch: "main",
    provider: "generic",
    workflow: { branchPattern: "roll/{workspace_id}/{story_id}", requiredChecks: [] },
  };
}

const contract: IssueStoryContract = {
  storyId: "US-XX1",
  repositories: [
    { alias: "sot1", access: "write", requiredDelivery: true },
    { alias: "sot2", access: "write", requiredDelivery: true, dependsOnRepo: "sot1" },
    { alias: "sot3", access: "read", requiredDelivery: false },
  ],
};

const bindings: readonly RepositoryBinding[] = [
  binding("sot1", "repo-sot1"),
  binding("sot2", "repo-sot2"),
  binding("sot3", "repo-sot3"),
];

const requirementManifests: readonly RequirementSourceManifest[] = [];

function fakeCache(base = "a".repeat(40)): NonNullable<IssueWorktreeDeps["ensureCache"]> {
  return async (repoBinding) => ({
    action: "created" as const,
    cachePath: `/fake/cache/${repoBinding.repoId}.git`,
    baseSha: base,
  });
}

function fakeWorktreeAdd(created: string[] = []): NonNullable<IssueWorktreeDeps["createWorktree"]> {
  return async (_cachePath, path) => {
    mkdirSync(path, { recursive: true });
    created.push(path);
  };
}

describe("inspectIssueInit", () => {
  it("is side-effect free and reports absent for a brand-new Issue", async () => {
    const root = sandbox();
    const probe = await inspectIssueInit({ issueRoot: join(root, "issues", "US-XX1"), contract });
    expect(probe).toMatchObject({
      manifest: { state: "absent" },
      worktrees: { sot1: "absent", sot2: "absent", sot3: "absent" },
    });
    expect(existsSync(join(root, "issues"))).toBe(false);
  });
});

describe("applyIssueInit", () => {
  it("creates the Issue root, an immutable manifest and one worktree per declared target", async () => {
    const root = sandbox();
    const issueRoot = join(root, "issues", "US-XX1");
    const createdPaths: string[] = [];
    const result = await applyIssueInit({
      workspaceId: "ws-demo",
      issueRoot,
      contract,
      bindings,
      requirementManifests,
    }, { ensureCache: fakeCache(), createWorktree: fakeWorktreeAdd(createdPaths) });

    expect(result.outcome).toBe("created");
    const manifestPath = join(issueRoot, "manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest).toMatchObject({ schema: "roll.issue/v1", workspaceId: "ws-demo", storyId: "US-XX1" });
    expect(createdPaths).toEqual([
      join(issueRoot, "sot1"),
      join(issueRoot, "sot2"),
      join(issueRoot, "sot3"),
    ]);
    const eventsPath = join(issueRoot, "events.jsonl");
    const events = readFileSync(eventsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(events).toHaveLength(3);
    for (const event of events) expect(event).toMatchObject({ type: "issue:repository_bound" });
    expect(events.map((event) => event.alias)).toEqual(["sot1", "sot2", "sot3"]);
  });

  it("never mutates the manifest once written, and reuses it verbatim on a compatible retry", async () => {
    const root = sandbox();
    const issueRoot = join(root, "issues", "US-XX1");
    await applyIssueInit({ workspaceId: "ws-demo", issueRoot, contract, bindings, requirementManifests }, {
      ensureCache: fakeCache(), createWorktree: fakeWorktreeAdd(),
    });
    const manifestPath = join(issueRoot, "manifest.json");
    const before = readFileSync(manifestPath, "utf8");

    const retry = await applyIssueInit({ workspaceId: "ws-demo", issueRoot, contract, bindings, requirementManifests }, {
      ensureCache: fakeCache(), createWorktree: fakeWorktreeAdd(),
    });
    expect(retry.outcome).toBe("reused");
    expect(readFileSync(manifestPath, "utf8")).toBe(before);
  });

  it("rejects an on-disk manifest that conflicts with the resolved identity instead of overwriting it", async () => {
    const root = sandbox();
    const issueRoot = join(root, "issues", "US-XX1");
    mkdirSync(issueRoot, { recursive: true });
    const manifestPath = join(issueRoot, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({
      schema: "roll.issue/v1", workspaceId: "ws-other", storyId: "US-XX1", requirements: [], repositories: [],
    }));
    await expect(applyIssueInit({ workspaceId: "ws-demo", issueRoot, contract, bindings, requirementManifests }, {
      ensureCache: fakeCache(), createWorktree: fakeWorktreeAdd(),
    })).rejects.toThrow(IssueInitializationError);
  });

  it("rolls back newly-created targets and preserves pre-existing/dirty ones when a later target fails", async () => {
    const root = sandbox();
    const issueRoot = join(root, "issues", "US-XX1");
    // sot1 pre-exists (simulating a prior partial run) with a dirty marker file.
    mkdirSync(join(issueRoot, "sot1"), { recursive: true });
    writeFileSync(join(issueRoot, "sot1", "dirty.txt"), "keep me");

    const created: string[] = [];
    let calls = 0;
    await expect(applyIssueInit({ workspaceId: "ws-demo", issueRoot, contract, bindings, requirementManifests }, {
      ensureCache: fakeCache(),
      createWorktree: async (_cachePath, path) => {
        calls += 1;
        if (calls === 1) return; // sot1: treated as pre-existing, no worktree op needed
        if (path.endsWith("sot2")) {
          mkdirSync(path, { recursive: true });
          created.push(path);
          return;
        }
        throw new Error("simulated failure creating sot3 worktree");
      },
      probeWorktree: (path) => path.endsWith("sot1") ? "compatible" : "absent",
    })).rejects.toThrow(IssueInitializationError);

    // sot2 was newly created and clean -> rolled back.
    expect(existsSync(join(issueRoot, "sot2"))).toBe(false);
    // sot1 pre-existing/dirty content is preserved, never destructively cleaned.
    expect(existsSync(join(issueRoot, "sot1", "dirty.txt"))).toBe(true);
    // A repair journal is written recording the failed attempt.
    expect(existsSync(join(issueRoot, "issue-init.pending.json"))).toBe(true);
    const journal = JSON.parse(readFileSync(join(issueRoot, "issue-init.pending.json"), "utf8"));
    expect(journal.status).toBe("repair_required");
  });

  it("resumes and repairs the same Issue identity after interruption without duplicating worktrees", async () => {
    const root = sandbox();
    const issueRoot = join(root, "issues", "US-XX1");
    const createdPaths: string[] = [];
    // First attempt fails after sot1.
    let calls = 0;
    await expect(applyIssueInit({ workspaceId: "ws-demo", issueRoot, contract, bindings, requirementManifests }, {
      ensureCache: fakeCache(),
      createWorktree: async (_cachePath, path) => {
        calls += 1;
        if (calls === 1) {
          mkdirSync(path, { recursive: true });
          createdPaths.push(path);
          return;
        }
        throw new Error("simulated failure");
      },
    })).rejects.toThrow(IssueInitializationError);
    expect(createdPaths).toEqual([join(issueRoot, "sot1")]);

    // Re-run resumes: sot1 reused, sot2/sot3 created, no duplicate worktree op on sot1.
    const secondAttemptPaths: string[] = [];
    const result = await applyIssueInit({ workspaceId: "ws-demo", issueRoot, contract, bindings, requirementManifests }, {
      ensureCache: fakeCache(),
      createWorktree: async (_cachePath, path) => {
        secondAttemptPaths.push(path);
        mkdirSync(path, { recursive: true });
      },
      probeWorktree: (path) => path.endsWith("sot1") ? "compatible" : "absent",
    });
    expect(result.outcome).toBe("repaired");
    expect(secondAttemptPaths).toEqual([join(issueRoot, "sot2"), join(issueRoot, "sot3")]);
  });
});
