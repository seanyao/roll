import { describe, expect, it } from "vitest";
import {
  REQUIREMENT_HINT_V1,
  REPOSITORY_BINDING_V1,
  WORKSPACE_INTENT_V1,
  WORKSPACE_MANIFEST_V1,
  type RequirementHintV1,
  type WorkspaceClarificationReason,
  type WorkspaceIntentV1,
  type WorkspaceLifecycle,
  type WorkspaceMatchCandidateV1,
} from "@roll/spec";
import {
  buildWorkspaceClarificationHandoff,
  type WorkspaceDiscoveryFactsV1,
} from "../src/index.js";

function requirement(): RequirementHintV1 {
  return {
    schema: REQUIREMENT_HINT_V1,
    sources: [{ key: { provider: "jira", ref: "APE-234" }, provenance: "deterministic_extraction" }],
    storyIds: [{ storyId: "US-FIELDS-1", provenance: "explicit_user" }],
    repositoryRemotes: [],
    paths: [],
    semanticTerms: ["fields"],
  };
}

function intent(operation: "read" | "mutation"): WorkspaceIntentV1 {
  return {
    schema: WORKSPACE_INTENT_V1,
    operation,
    interaction: "interactive",
    scope: operation === "read" ? "workspace_required_read" : "workspace_required_mutation",
    cwd: "/tmp",
    requirement: requirement(),
  };
}

function facts(workspaceId: string, lifecycle: WorkspaceLifecycle): WorkspaceDiscoveryFactsV1 {
  return {
    candidate: {
      workspaceId,
      root: `/workspaces/${workspaceId}`,
      canonicalRoot: `/workspaces/${workspaceId}`,
      manifestWorkspaceId: workspaceId,
      pathState: "valid",
      lifecycle,
    },
    manifest: {
      schema: WORKSPACE_MANIFEST_V1,
      workspaceId,
      displayName: `${workspaceId} delivery`,
      requirements: [{ provider: "jira", ref: workspaceId === "fields" ? "APE-234" : "IDEA-074" }],
      repositories: [{
        schema: REPOSITORY_BINDING_V1,
        repoId: `repo-${workspaceId}`,
        alias: "product",
        remote: `https://example.test/${workspaceId}/product.git`,
        integrationBranch: "main",
        provider: "generic",
        workflow: { branchPattern: "roll/{workspace_id}/{story_id}", requiredChecks: [] },
      }],
    },
    issues: [],
  };
}

function candidate(workspaceId: string, lifecycle: WorkspaceLifecycle): WorkspaceMatchCandidateV1 {
  return {
    workspaceId,
    root: `/workspaces/${workspaceId}`,
    lifecycle,
    hardMatch: workspaceId === "fields",
    score: workspaceId === "fields" ? 100 : 0,
    evidence: workspaceId === "fields"
      ? [{ kind: "requirement_source_exact", value: "jira:APE-234", hard: true, score: 100 }]
      : [],
  };
}

const SHA = "a".repeat(64);

describe("US-WS-029 Workspace clarification handoff", () => {
  it.each([
    { reason: "requirement_match_required", operation: "read", candidates: [candidate("roll", "active")], expected: ["select_existing", "create_new"] },
    { reason: "requirement_match_required", operation: "mutation", candidates: [], expected: ["create_new"] },
    { reason: "ambiguous_requirement_match", operation: "read", candidates: [candidate("fields", "active")], expected: ["select_existing"] },
    { reason: "requirement_workspace_conflict", operation: "mutation", candidates: [candidate("fields", "active")], expected: ["select_existing"] },
    { reason: "workspace_activation_required", operation: "mutation", candidates: [candidate("fields", "paused")], expected: ["select_existing"] },
    { reason: "create_required", operation: "read", candidates: [], expected: ["create_new"] },
    { reason: "workspace_discovery_incomplete", operation: "read", candidates: [candidate("fields", "registered")], expected: ["select_existing", "repair_discovery"] },
    { reason: "workspace_discovery_incomplete", operation: "mutation", candidates: [candidate("fields", "registered")], expected: ["repair_discovery"] },
  ] as const)("narrows $reason for $operation", ({ reason, operation, candidates, expected }) => {
    const diagnostic = reason === "workspace_discovery_incomplete"
      ? [{
          workspaceId: "fields",
          root: "/workspaces/fields",
          code: "invalid_workspace_manifest" as const,
          authorityPath: "/workspaces/fields/workspace.yaml",
          message: "invalid manifest",
        }]
      : [];
    const handoff = buildWorkspaceClarificationHandoff({
      intent: intent(operation),
      reason: reason as WorkspaceClarificationReason,
      candidates,
      diagnostics: diagnostic,
      facts: [facts("fields", candidates[0]?.lifecycle ?? "active"), facts("roll", "active")],
      registryRevision: 7,
      discoveryFactsSha256: SHA,
    });

    expect(handoff).toMatchObject({
      schema: "roll.workspace-clarification/v1",
      registryRevision: 7,
      discoveryFactsSha256: SHA,
      reason,
      operation,
      requirementSummary: {
        sources: [{ provider: "jira", ref: "APE-234" }],
        storyIds: ["US-FIELDS-1"],
        hasSemanticOnlyEvidence: false,
      },
      allowedActions: expected,
      canonicalCreateCommand: "roll workspace create",
    });
    expect(handoff.candidates).toEqual(candidates.map((entry) => expect.objectContaining({
      workspaceId: entry.workspaceId,
      lifecycle: entry.lifecycle,
      canonicalSelector: `--workspace ${entry.workspaceId}`,
    })));
    expect(handoff.canonicalRepairCommands).toEqual(
      reason === "workspace_discovery_incomplete" ? ["roll workspace doctor fields --json"] : [],
    );
  });
});
