import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  deriveIssueCompletion,
  isHumanSoftLeaseActive,
  isLeaseAlive,
  readLeases,
} from "@roll/core";
import {
  readIssueCompletionEvidence,
  readRepositoryBoundFacts,
  readWorkspace,
  resolveRepositoryCacheIdentity,
  WorkspaceRegistry,
  type InspectedWorkspace,
  type IssueCompletionEvidenceCollection,
  type PinnedTargetFacts,
} from "@roll/infra";
import {
  parseIssueManifest,
  type IssueManifest,
  type RepositoryBinding,
  type WorkspaceManifest,
} from "@roll/spec";
import {
  auditWorktrees,
  type WorktreeAuditDeps,
  type WorktreeAuditOutput,
  type WorktreeAuditRecord,
  type WorkspaceDeliveryProof,
  type WorkspaceWorktreeOwnership,
} from "./worktree-audit.js";

export interface WorkspaceWorktreeAuditInput {
  readonly selectedWorkspaceId: string;
  readonly selectedWorkspaceRoot: string;
  readonly rollHome: string;
}

export interface WorkspaceCacheIdentity {
  readonly repoId: string;
  readonly cachePath: string;
  readonly integrationBranch: string;
}

export interface WorkspaceCountedBranch {
  readonly repoId: string;
  readonly cachePath: string;
  readonly branch: string;
}

export interface WorkspaceWorktreeAuditOutput {
  readonly schema: 1;
  readonly generatedAt: string;
  readonly selectedWorkspaceId: string;
  readonly records: readonly WorktreeAuditRecord[];
  readonly ephemeralBranches: readonly WorkspaceCountedBranch[];
  readonly repositories: readonly WorkspaceCacheIdentity[];
  readonly summary: {
    readonly worktrees: number;
    readonly active: number;
    readonly disposableCandidates: number;
    readonly preserved: number;
    readonly ephemeralBranches: number;
    readonly canaryTotal: number;
  };
}

export interface WorkspaceWorktreeLifecycleDeps {
  readonly inspectWorkspaces: () => readonly InspectedWorkspace[];
  readonly readWorkspace: (root: string) => WorkspaceManifest;
  readonly listIssueIds: (root: string) => readonly string[];
  readonly readIssueManifest: (issueRoot: string) => IssueManifest;
  readonly readRepositoryBoundFacts: (issueRoot: string) => ReadonlyMap<string, PinnedTargetFacts>;
  readonly readIssueCompletionEvidence: (issueRoot: string) => IssueCompletionEvidenceCollection;
  readonly storyActive: (workspaceRoot: string, storyId: string) => boolean;
  readonly resolveCache: (binding: RepositoryBinding) => WorkspaceCacheIdentity;
  readonly auditRepository: (deps: WorktreeAuditDeps) => WorktreeAuditOutput;
  readonly nowISO: () => string;
}

function listIssueIds(root: string): readonly string[] {
  const issuesRoot = join(root, "issues");
  try {
    return readdirSync(issuesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function readIssueManifest(issueRoot: string): IssueManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(issueRoot, "manifest.json"), "utf8"));
  } catch (error) {
    throw new Error(`invalid_issue_manifest: ${issueRoot}`, { cause: error });
  }
  const parsed = parseIssueManifest(raw);
  if (!parsed.ok) {
    throw new Error(`invalid_issue_manifest: ${issueRoot}`);
  }
  return parsed.value;
}

function storyActive(workspaceRoot: string, storyId: string): boolean {
  const lease = readLeases(join(workspaceRoot, "runtime", "locks", "story-leases.json"))[storyId];
  if (lease === undefined) return false;
  if (lease.source === "cycle") return isLeaseAlive(lease);
  return isHumanSoftLeaseActive(lease, Date.now());
}

function realDeps(rollHome: string): WorkspaceWorktreeLifecycleDeps {
  return {
    inspectWorkspaces: () => new WorkspaceRegistry({ rollHome }).inspect(),
    readWorkspace,
    listIssueIds,
    readIssueManifest,
    readRepositoryBoundFacts,
    readIssueCompletionEvidence,
    storyActive,
    resolveCache: (binding) => {
      const identity = resolveRepositoryCacheIdentity({ rollHome, binding });
      return {
        repoId: identity.repoId,
        cachePath: identity.cachePath,
        integrationBranch: identity.integrationBranch,
      };
    },
    auditRepository: auditWorktrees,
    nowISO: () => new Date().toISOString(),
  };
}

function deliveryProof(
  manifest: IssueManifest,
  evidence: IssueCompletionEvidenceCollection,
): WorkspaceDeliveryProof {
  const projection = deriveIssueCompletion({
    workspaceId: manifest.workspaceId,
    storyId: manifest.storyId,
    repositories: manifest.repositories.map((repository) => ({
      repoId: repository.repoId,
      required: repository.requiredDelivery,
    })),
    repositoryFacts: evidence.repositoryFacts,
    integrationAcceptances: evidence.integrationAcceptances,
    backlogDone: false,
  });
  if (projection.state === "delivered") return "delivered";
  if (projection.state === "abandoned") return "abandoned";
  if (projection.state === "blocked") return "blocked";
  return "incomplete";
}

function ownershipForFact(
  workspaceRoot: string,
  manifest: IssueManifest,
  target: IssueManifest["repositories"][number],
  fact: PinnedTargetFacts,
  cache: WorkspaceCacheIdentity,
  proof: WorkspaceDeliveryProof,
  active: boolean,
): WorkspaceWorktreeOwnership {
  if (
    fact.workspaceId !== manifest.workspaceId ||
    fact.storyId !== manifest.storyId ||
    fact.repoId !== target.repoId ||
    fact.access !== target.access
  ) {
    throw new Error(`workspace_worktree_identity_mismatch: ${manifest.workspaceId}/${manifest.storyId}/${target.alias}`);
  }
  const expectedPrefix = resolve(workspaceRoot, "issues", manifest.storyId);
  const factPath = resolve(fact.path);
  if (factPath !== resolve(expectedPrefix, target.alias)) {
    throw new Error(`workspace_worktree_path_mismatch: ${manifest.workspaceId}/${manifest.storyId}/${target.alias}`);
  }
  return {
    workspaceId: manifest.workspaceId,
    storyId: manifest.storyId,
    repoId: target.repoId,
    repositoryAlias: target.alias,
    cachePath: cache.cachePath,
    expectedBranch: fact.workBranch,
    active,
    deliveryProof: proof,
  };
}

/** Aggregate the existing repository audit over the selected Workspace's unique
 * cache set. Other registered Workspaces are inspected only to identify their
 * exact Issue-owned paths on those same caches, so cleanup/canary can preserve
 * cross-Workspace legs and never mistake them for unrelated path names. */
export function auditWorkspaceWorktrees(
  input: WorkspaceWorktreeAuditInput,
  overrides: Partial<WorkspaceWorktreeLifecycleDeps> = {},
): WorkspaceWorktreeAuditOutput {
  const defaults = realDeps(input.rollHome);
  const deps: WorkspaceWorktreeLifecycleDeps = { ...defaults, ...overrides };
  const inspected = deps.inspectWorkspaces();
  const selected = inspected.find((entry) =>
    entry.workspaceId === input.selectedWorkspaceId && entry.consistency === "consistent"
  );
  if (selected === undefined || resolve(selected.root) !== resolve(input.selectedWorkspaceRoot)) {
    throw new Error(`workspace_target_mismatch: ${input.selectedWorkspaceId}`);
  }
  const selectedManifest = deps.readWorkspace(selected.root);
  if (selectedManifest.workspaceId !== selected.workspaceId) {
    throw new Error(`workspace_manifest_mismatch: ${selected.workspaceId}`);
  }

  const caches = new Map<string, WorkspaceCacheIdentity>();
  for (const binding of selectedManifest.repositories) {
    const cache = deps.resolveCache(binding);
    if (cache.repoId !== binding.repoId) throw new Error(`workspace_cache_identity_mismatch: ${binding.repoId}`);
    caches.set(binding.repoId, cache);
  }

  const ownershipByRepo = new Map<string, Map<string, WorkspaceWorktreeOwnership>>();
  for (const workspace of inspected) {
    if (workspace.consistency !== "consistent") continue;
    const manifest = deps.readWorkspace(workspace.root);
    if (manifest.workspaceId !== workspace.workspaceId) {
      throw new Error(`workspace_manifest_mismatch: ${workspace.workspaceId}`);
    }
    for (const storyId of deps.listIssueIds(workspace.root)) {
      const issueRoot = join(workspace.root, "issues", storyId);
      if (!existsSync(join(issueRoot, "manifest.json")) && overrides.readIssueManifest === undefined) continue;
      const issue = deps.readIssueManifest(issueRoot);
      if (issue.workspaceId !== workspace.workspaceId || issue.storyId !== storyId) {
        throw new Error(`workspace_issue_identity_mismatch: ${workspace.workspaceId}/${storyId}`);
      }
      const relevantTargets = issue.repositories.filter((target) => caches.has(target.repoId));
      if (relevantTargets.length === 0) continue;
      const facts = deps.readRepositoryBoundFacts(issueRoot);
      const proof = deliveryProof(issue, deps.readIssueCompletionEvidence(issueRoot));
      const active = deps.storyActive(workspace.root, storyId);
      for (const target of relevantTargets) {
        const fact = facts.get(target.alias);
        if (fact === undefined) continue;
        const cache = caches.get(target.repoId);
        if (cache === undefined) continue;
        const ownership = ownershipForFact(workspace.root, issue, target, fact, cache, proof, active);
        const byPath = ownershipByRepo.get(target.repoId) ?? new Map<string, WorkspaceWorktreeOwnership>();
        const path = resolve(fact.path);
        const existing = byPath.get(path);
        if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(ownership)) {
          throw new Error(`workspace_worktree_ownership_conflict: ${path}`);
        }
        byPath.set(path, ownership);
        ownershipByRepo.set(target.repoId, byPath);
      }
    }
  }

  const records: WorktreeAuditRecord[] = [];
  const branches: WorkspaceCountedBranch[] = [];
  const repositories = [...caches.values()].sort((left, right) => left.repoId.localeCompare(right.repoId));
  for (const cache of repositories) {
    const audit = deps.auditRepository({
      repoRoot: cache.cachePath,
      home: "",
      integrationBranch: `origin/${cache.integrationBranch}`,
      workspaceOwnership: ownershipByRepo.get(cache.repoId) ?? new Map(),
      nowISO: deps.nowISO,
    });
    records.push(...audit.records.filter((record) => record.owner === "workspace"));
    for (const branch of audit.ephemeralBranches) {
      branches.push({ repoId: cache.repoId, cachePath: cache.cachePath, branch });
    }
  }
  records.sort((left, right) => left.path.localeCompare(right.path));
  branches.sort((left, right) => left.repoId.localeCompare(right.repoId) || left.branch.localeCompare(right.branch));

  const summary = {
    worktrees: records.length,
    active: records.filter((record) => record.active).length,
    disposableCandidates: records.filter((record) => record.disposition === "disposable_candidate").length,
    preserved: records.filter((record) => record.disposition !== "disposable_candidate").length,
    ephemeralBranches: branches.length,
    canaryTotal: records.length + branches.length,
  };
  return {
    schema: 1,
    generatedAt: deps.nowISO(),
    selectedWorkspaceId: input.selectedWorkspaceId,
    records,
    ephemeralBranches: branches,
    repositories,
    summary,
  };
}
