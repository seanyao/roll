import { describe, expect, it, vi } from "vitest";
import {
  applyWorktreeCleanup,
  isSafelyDisposable,
  planWorktreeCleanup,
} from "../src/commands/worktree-cleanup.js";
import type { WorktreeAuditOutput, WorktreeAuditRecord } from "../src/commands/worktree-audit.js";

const HEAD = "b".repeat(40);

function record(overrides: Partial<WorktreeAuditRecord> = {}): WorktreeAuditRecord {
  return {
    path: "/workspaces/alpha/issues/US-A/primary",
    branch: "refs/heads/roll/ws-alpha/US-A",
    head: HEAD,
    owner: "workspace",
    workspaceId: "ws-alpha",
    storyId: "US-A",
    repoId: "repo-shared",
    repositoryAlias: "primary",
    cachePath: "/roll-home/repos/repo-shared.git",
    deliveryProof: "delivered",
    ownershipState: "verified",
    dirtyTracked: false,
    dirtyUntracked: false,
    ahead: 0,
    mergeEvidence: { kind: "ancestor" },
    active: false,
    disposition: "disposable_candidate",
    reason: "delivered",
    ...overrides,
  };
}

function audit(records: readonly WorktreeAuditRecord[]): WorktreeAuditOutput {
  return {
    schema: 1,
    generatedAt: "2026-07-22T00:00:00.000Z",
    repo: "workspace:ws-alpha",
    records: [...records],
    ephemeralBranches: [],
    summary: {
      total: records.length,
      loop: 0,
      workspace: records.length,
      manual: 0,
      external: 0,
      active: records.filter((item) => item.active).length,
      disposableCandidates: records.filter((item) => item.disposition === "disposable_candidate").length,
      preserved: records.filter((item) => item.disposition !== "disposable_candidate").length,
      ephemeralBranches: 0,
    },
  };
}

describe("US-WS-011a Workspace worktree cleanup", () => {
  it("selects only clean, inactive, proof-backed legs owned by the requested Workspace", () => {
    const dirty = record({
      path: "/workspaces/alpha/issues/US-DIRTY/primary",
      storyId: "US-DIRTY",
      dirtyUntracked: true,
      disposition: "preserved_dirty_no_tcr",
    });
    const otherWorkspace = record({
      path: "/workspaces/beta/issues/US-B/primary",
      workspaceId: "ws-beta",
      storyId: "US-B",
      branch: "refs/heads/roll/ws-beta/US-B",
    });
    const safe = record();

    expect(isSafelyDisposable(safe)).toBe(true);
    expect(isSafelyDisposable(dirty)).toBe(false);
    expect(isSafelyDisposable(record({ ownershipState: "mismatch" }))).toBe(false);

    const plan = planWorktreeCleanup(audit([safe, dirty, otherWorkspace]), 0, [], { workspaceId: "ws-alpha" });
    expect(plan.candidates).toEqual([
      expect.objectContaining({
        path: safe.path,
        workspaceId: "ws-alpha",
        repoId: "repo-shared",
        repositoryAlias: "primary",
        cachePath: safe.cachePath,
        expectedHead: HEAD,
      }),
    ]);
    expect(plan.preserved.map((item) => item.path)).toEqual([dirty.path, otherWorkspace.path]);
  });

  it("revalidates Workspace identity and refuses a cross-Workspace substitution before removal", async () => {
    const planned = record();
    const plan = planWorktreeCleanup(audit([planned]), 0, [], { workspaceId: "ws-alpha" });
    const removeWorktree = vi.fn(() => ({ ok: true, detail: "" }));
    const result = await applyWorktreeCleanup(plan, {
      repositoryRoot: planned.cachePath as string,
      dryRun: false,
      audit: () => audit([record({ workspaceId: "ws-beta" })]),
      removeWorktree,
    });

    expect(removeWorktree).not.toHaveBeenCalled();
    expect(result.removed).toEqual([]);
    expect(result.refused).toEqual([
      expect.objectContaining({ path: planned.path, reason: expect.stringContaining("identity") }),
    ]);
  });
});
