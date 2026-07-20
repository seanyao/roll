export type WorkspaceLifecycle = "registered" | "active" | "paused" | "archived";
export type WorkspaceTargetOperation = "read" | "mutation";
export type WorkspaceTargetSource = "explicit" | "environment" | "cwd_manifest" | "issue_manifest" | "all";

export type WorkspaceTargetFailureCode =
  | "all_requires_readonly"
  | "conflicting_candidates"
  | "duplicate_candidate"
  | "identity_mismatch"
  | "invalid_target"
  | "migration_required"
  | "stale_registry"
  | "symlink_escape"
  | "target_missing"
  | "unrelated_worktree";

export interface WorkspaceRegistryCandidate {
  readonly workspaceId: string;
  readonly root: string;
  readonly canonicalRoot: string;
  readonly manifestWorkspaceId: string;
  readonly pathState: "valid" | "stale";
  readonly lifecycle: WorkspaceLifecycle;
}

export type WorkspaceTargetSelector =
  | { readonly kind: "id"; readonly workspaceId: string }
  | { readonly kind: "path"; readonly absolutePath: string; readonly canonicalPath: string };

export interface WorkspaceContextCandidate {
  readonly workspaceId: string;
  readonly root: string;
  readonly canonicalRoot: string;
  readonly containment: "safe" | "symlink_escape" | "unrelated_worktree";
}

export interface WorkspaceTargetContext {
  readonly cwdManifest?: WorkspaceContextCandidate;
  readonly issueManifest?: WorkspaceContextCandidate;
  readonly legacyProject?: boolean;
}

export interface WorkspaceTargetInput {
  readonly operation: WorkspaceTargetOperation;
  readonly registry: readonly WorkspaceRegistryCandidate[];
  readonly all?: boolean;
  readonly explicit?: WorkspaceTargetSelector;
  readonly environment?: WorkspaceTargetSelector;
  readonly context?: WorkspaceTargetContext;
}

export interface WorkspaceTargetSummary {
  readonly workspaceId: string;
  readonly root: string;
  readonly canonicalRoot: string;
  readonly lifecycle: WorkspaceLifecycle;
}

export interface ResolvedWorkspaceTarget {
  readonly kind: "workspace";
  readonly workspaceId: string;
  readonly root: string;
  readonly canonicalRoot: string;
}

export interface AggregateWorkspaceTarget {
  readonly kind: "all";
  readonly workspaces: readonly WorkspaceTargetSummary[];
}

export interface WorkspaceTargetFailure {
  readonly code: WorkspaceTargetFailureCode;
  readonly message: string;
  readonly candidates: readonly WorkspaceTargetSummary[];
  readonly sources?: readonly WorkspaceTargetSource[];
}

export type WorkspaceTargetDecision =
  | {
      readonly ok: true;
      readonly source: WorkspaceTargetSource;
      readonly target: ResolvedWorkspaceTarget | AggregateWorkspaceTarget;
    }
  | { readonly ok: false; readonly error: WorkspaceTargetFailure };

interface SourceCandidate {
  readonly source: Exclude<WorkspaceTargetSource, "all">;
  readonly workspace: WorkspaceRegistryCandidate;
}

function compareWorkspace(a: WorkspaceRegistryCandidate, b: WorkspaceRegistryCandidate): number {
  return a.workspaceId.localeCompare(b.workspaceId) || a.root.localeCompare(b.root);
}

function summary(candidate: WorkspaceRegistryCandidate): WorkspaceTargetSummary {
  return {
    workspaceId: candidate.workspaceId,
    root: candidate.root,
    canonicalRoot: candidate.canonicalRoot,
    lifecycle: candidate.lifecycle,
  };
}

function summaries(registry: readonly WorkspaceRegistryCandidate[], activeOnly = false): WorkspaceTargetSummary[] {
  return registry
    .filter((candidate) => !activeOnly || candidate.lifecycle === "active")
    .slice()
    .sort(compareWorkspace)
    .map(summary);
}

function failure(
  input: WorkspaceTargetInput,
  code: WorkspaceTargetFailureCode,
  message: string,
  sources?: readonly WorkspaceTargetSource[],
): WorkspaceTargetDecision {
  return {
    ok: false,
    error: {
      code,
      message,
      candidates: summaries(input.registry, true),
      ...(sources === undefined ? {} : { sources: sources.slice().sort() }),
    },
  };
}

function registryIntegrityFailure(input: WorkspaceTargetInput): WorkspaceTargetDecision | null {
  const ids = new Set<string>();
  const paths = new Map<string, string>();
  for (const candidate of input.registry.slice().sort(compareWorkspace)) {
    if (ids.has(candidate.workspaceId)) {
      return failure(input, "duplicate_candidate", "Workspace registry contains a duplicate workspace identity");
    }
    ids.add(candidate.workspaceId);
    for (const candidatePath of [candidate.root, candidate.canonicalRoot]) {
      const owner = paths.get(candidatePath);
      if (owner !== undefined && owner !== candidate.workspaceId) {
        return failure(input, "duplicate_candidate", "Workspace registry contains a duplicate workspace path");
      }
      paths.set(candidatePath, candidate.workspaceId);
    }
  }
  return null;
}

function candidateValidityFailure(
  input: WorkspaceTargetInput,
  candidate: WorkspaceRegistryCandidate,
): WorkspaceTargetDecision | null {
  if (candidate.pathState === "stale") {
    return failure(input, "stale_registry", "Workspace registry target is stale");
  }
  if (candidate.manifestWorkspaceId !== candidate.workspaceId) {
    return failure(input, "identity_mismatch", "Workspace registry and manifest identities do not match");
  }
  return null;
}

function findBySelector(
  input: WorkspaceTargetInput,
  selector: WorkspaceTargetSelector,
): WorkspaceRegistryCandidate | WorkspaceTargetDecision {
  if (selector.kind === "id") {
    const candidate = input.registry.find((entry) => entry.workspaceId === selector.workspaceId);
    return candidate ?? failure(input, "target_missing", "Workspace identity is not registered");
  }

  if (!selector.absolutePath.startsWith("/") || !selector.canonicalPath.startsWith("/")) {
    return failure(input, "invalid_target", "Workspace path target must be absolute and canonicalized");
  }
  const absoluteMatches = input.registry.filter(
    (entry) => entry.root === selector.absolutePath || entry.canonicalRoot === selector.absolutePath,
  );
  const canonicalMatches = input.registry.filter(
    (entry) => entry.canonicalRoot === selector.canonicalPath || entry.root === selector.canonicalPath,
  );
  const identities = new Set([...absoluteMatches, ...canonicalMatches].map((entry) => entry.workspaceId));
  if (identities.size > 1) {
    return failure(input, "conflicting_candidates", "Workspace path facts resolve to conflicting identities");
  }
  const candidate = canonicalMatches[0] ?? absoluteMatches[0];
  if (candidate === undefined) return failure(input, "target_missing", "Workspace path is not registered");
  if (absoluteMatches.length > 0 && canonicalMatches.length === 0) {
    return failure(input, "symlink_escape", "Workspace path canonicalizes outside the registered root");
  }
  return candidate;
}

function findByContext(
  input: WorkspaceTargetInput,
  candidate: WorkspaceContextCandidate,
): WorkspaceRegistryCandidate | WorkspaceTargetDecision {
  if (candidate.containment === "symlink_escape") {
    return failure(input, "symlink_escape", "Workspace context escapes its canonical root");
  }
  if (candidate.containment === "unrelated_worktree") {
    return failure(input, "unrelated_worktree", "Current Git worktree is unrelated to the Workspace");
  }
  const registered = input.registry.find((entry) => entry.workspaceId === candidate.workspaceId);
  if (registered === undefined) return failure(input, "target_missing", "Workspace context identity is not registered");
  if (registered.root !== candidate.root || registered.canonicalRoot !== candidate.canonicalRoot) {
    return failure(input, "identity_mismatch", "Workspace context path does not match the registry identity");
  }
  return registered;
}

function isFailure(value: WorkspaceRegistryCandidate | WorkspaceTargetDecision): value is WorkspaceTargetDecision {
  return "ok" in value;
}

function resolveSourceCandidates(input: WorkspaceTargetInput): readonly SourceCandidate[] | WorkspaceTargetDecision {
  const candidates: SourceCandidate[] = [];
  const explicitSources: readonly [Exclude<WorkspaceTargetSource, "all">, WorkspaceTargetSelector | undefined][] = [
    ["explicit", input.explicit],
    ["environment", input.environment],
  ];
  for (const [source, selector] of explicitSources) {
    if (selector === undefined) continue;
    const resolved = findBySelector(input, selector);
    if (isFailure(resolved)) return resolved;
    candidates.push({ source, workspace: resolved });
  }

  const hasExplicitTarget = candidates.length > 0;
  const contextSources: readonly [Exclude<WorkspaceTargetSource, "all">, WorkspaceContextCandidate | undefined][] = [
    ["cwd_manifest", input.context?.cwdManifest],
    ["issue_manifest", input.context?.issueManifest],
  ];
  for (const [source, context] of contextSources) {
    if (context === undefined) continue;
    if (hasExplicitTarget && context.containment !== "safe") continue;
    const resolved = findByContext(input, context);
    if (isFailure(resolved)) return resolved;
    candidates.push({ source, workspace: resolved });
  }
  return candidates;
}

function isDecision(
  value: readonly SourceCandidate[] | WorkspaceTargetDecision,
): value is WorkspaceTargetDecision {
  return !Array.isArray(value);
}

export function resolveWorkspaceTarget(input: WorkspaceTargetInput): WorkspaceTargetDecision {
  if (input.all === true && input.operation === "mutation") {
    return failure(input, "all_requires_readonly", "Aggregate Workspace targets are read-only");
  }

  const integrityFailure = registryIntegrityFailure(input);
  if (integrityFailure !== null) return integrityFailure;

  if (input.all === true) {
    for (const candidate of input.registry.slice().sort(compareWorkspace)) {
      const invalid = candidateValidityFailure(input, candidate);
      if (invalid !== null) return invalid;
    }
    return { ok: true, source: "all", target: { kind: "all", workspaces: summaries(input.registry) } };
  }

  const sourceCandidates = resolveSourceCandidates(input);
  if (isDecision(sourceCandidates)) return sourceCandidates;
  if (sourceCandidates.length === 0) {
    if (input.context?.legacyProject === true) {
      return failure(input, "migration_required", "Repository-local .roll state must migrate to a Workspace");
    }
    return failure(input, "target_missing", "No Workspace target could be resolved");
  }

  const selected = sourceCandidates[0];
  if (selected === undefined) return failure(input, "target_missing", "No Workspace target could be resolved");
  const invalid = candidateValidityFailure(input, selected.workspace);
  if (invalid !== null) return invalid;
  return {
    ok: true,
    source: selected.source,
    target: {
      kind: "workspace",
      workspaceId: selected.workspace.workspaceId,
      root: selected.workspace.root,
      canonicalRoot: selected.workspace.canonicalRoot,
    },
  };
}
