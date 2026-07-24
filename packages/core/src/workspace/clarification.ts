import type {
  RequirementSourceKey,
  WorkspaceClarificationAction,
  WorkspaceClarificationCandidateV1,
  WorkspaceClarificationHandoffV1,
  WorkspaceClarificationReason,
  WorkspaceDiscoveryDiagnosticV1,
  WorkspaceIntentV1,
  WorkspaceMatchCandidateV1,
} from "@roll/spec";
import { WORKSPACE_CLARIFICATION_V1 } from "@roll/spec";
import type { WorkspaceDiscoveryFactsV1 } from "./discovery.js";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareText);
}

function sourceToken(source: RequirementSourceKey): string {
  return `${source.provider}\u0000${source.ref}`;
}

function requirementSources(intent: WorkspaceIntentV1): readonly RequirementSourceKey[] {
  const sources = new Map<string, RequirementSourceKey>();
  for (const source of intent.requirement.sources) sources.set(sourceToken(source.key), source.key);
  return [...sources.values()].sort((left, right) => compareText(sourceToken(left), sourceToken(right)));
}

export function workspaceClarificationAllowedActions(input: {
  readonly reason: WorkspaceClarificationReason;
  readonly operation: "read" | "mutation";
  readonly candidateCount: number;
}): readonly WorkspaceClarificationAction[] {
  switch (input.reason) {
    case "requirement_match_required":
      return input.candidateCount > 0 ? ["select_existing", "create_new"] : ["create_new"];
    case "ambiguous_requirement_match":
    case "requirement_workspace_conflict":
    case "workspace_activation_required":
      return ["select_existing"];
    case "create_required":
      return ["create_new"];
    case "workspace_discovery_incomplete":
      return input.operation === "read" ? ["select_existing", "repair_discovery"] : ["repair_discovery"];
  }
}

function clarificationCandidate(input: {
  readonly candidate: WorkspaceMatchCandidateV1;
  readonly facts: WorkspaceDiscoveryFactsV1;
  readonly diagnostics: readonly WorkspaceDiscoveryDiagnosticV1[];
}): WorkspaceClarificationCandidateV1 {
  if (input.candidate.lifecycle === "archived") {
    throw new Error("invalid_workspace_clarification: archived Workspace cannot be a clarification candidate");
  }
  if (input.facts.candidate.workspaceId !== input.candidate.workspaceId) {
    throw new Error("invalid_workspace_clarification: candidate facts do not match Workspace identity");
  }
  return {
    workspaceId: input.candidate.workspaceId,
    displayName: input.facts.manifest.displayName,
    lifecycle: input.candidate.lifecycle,
    evidence: input.candidate.evidence,
    diagnostics: input.diagnostics.filter((entry) => entry.workspaceId === input.candidate.workspaceId),
    canonicalSelector: `--workspace ${input.candidate.workspaceId}`,
  };
}

function repairCommands(diagnostics: readonly WorkspaceDiscoveryDiagnosticV1[]): readonly string[] {
  return uniqueSorted(diagnostics
    .map((entry) => entry.workspaceId)
    .filter((workspaceId) => workspaceId !== "" && workspaceId !== "<registry>")
    .map((workspaceId) => `roll workspace doctor ${workspaceId} --json`));
}

export function buildWorkspaceClarificationHandoff(input: {
  readonly intent: WorkspaceIntentV1;
  readonly reason: WorkspaceClarificationReason;
  readonly candidates: readonly WorkspaceMatchCandidateV1[];
  readonly diagnostics: readonly WorkspaceDiscoveryDiagnosticV1[];
  readonly facts: readonly WorkspaceDiscoveryFactsV1[];
  readonly registryRevision: number;
  readonly discoveryFactsSha256: string;
}): WorkspaceClarificationHandoffV1 {
  if (!Number.isSafeInteger(input.registryRevision) || input.registryRevision < 0) {
    throw new Error("invalid_workspace_clarification: registry revision is invalid");
  }
  if (!/^[0-9a-f]{64}$/u.test(input.discoveryFactsSha256)) {
    throw new Error("invalid_workspace_clarification: discovery facts digest is invalid");
  }
  const factsById = new Map(input.facts.map((facts) => [facts.candidate.workspaceId, facts]));
  const candidates = input.candidates.map((candidate) => {
    const facts = factsById.get(candidate.workspaceId);
    if (facts === undefined) {
      throw new Error(`invalid_workspace_clarification: missing facts for ${candidate.workspaceId}`);
    }
    return clarificationCandidate({ candidate, facts, diagnostics: input.diagnostics });
  });
  const sources = requirementSources(input.intent);
  const storyIds = uniqueSorted(input.intent.requirement.storyIds.map((entry) => entry.storyId));
  const hasStructuredEvidence = sources.length > 0 || storyIds.length > 0 ||
    input.intent.requirement.repositoryRemotes.length > 0 || input.intent.requirement.paths.length > 0;
  const allowedActions = workspaceClarificationAllowedActions({
    reason: input.reason,
    operation: input.intent.operation,
    candidateCount: candidates.length,
  });
  const canonicalRepairCommands = repairCommands(input.diagnostics);
  if (allowedActions.includes("repair_discovery") && canonicalRepairCommands.length === 0) {
    throw new Error("invalid_workspace_clarification: repair action has no canonical command");
  }

  return {
    schema: WORKSPACE_CLARIFICATION_V1,
    registryRevision: input.registryRevision,
    discoveryFactsSha256: input.discoveryFactsSha256,
    reason: input.reason,
    operation: input.intent.operation,
    requirementSummary: {
      sources,
      storyIds,
      hasSemanticOnlyEvidence: !hasStructuredEvidence && (input.intent.requirement.semanticTerms?.length ?? 0) > 0,
    },
    candidates,
    allowedActions,
    canonicalCreateCommand: "roll workspace create",
    canonicalRepairCommands,
  };
}
