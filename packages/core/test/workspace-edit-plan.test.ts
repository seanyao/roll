import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  WORKSPACE_EDIT_CONFIG_V1,
  buildWorkspaceEditPlan,
  parseWorkspaceEditConfig,
  serializeWorkspaceManifest,
  type WorkspaceMetadataReferenceIndex,
} from "../src/workspace/edit-plan.js";
import type { WorkspaceManifest } from "@roll/spec";

const current: WorkspaceManifest = {
  schema: "roll.workspace/v1",
  workspaceId: "ws-demo",
  displayName: "Demo",
  createdAt: "2026-07-20T00:00:00.000Z",
  requirements: [{ provider: "jira", ref: "SOT-15499" }],
  repositories: [{
    schema: "roll.repository-binding/v1",
    repoId: "repo-ff7a87ddbb2b",
    alias: "product",
    remote: "https://example.test/owner/product",
    integrationBranch: "main",
    provider: "github",
    workflow: { branchPattern: "roll/{workspace_id}/{story_id}", requiredChecks: ["test"] },
  }],
};

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function references(overrides: Partial<WorkspaceMetadataReferenceIndex> = {}): WorkspaceMetadataReferenceIndex {
  return {
    schema: "roll.workspace-metadata-reference-index/v1",
    workspaceId: "ws-demo",
    issues: [],
    requirementArchives: [],
    additionalFacts: [],
    ...overrides,
  };
}

function configText(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: WORKSPACE_EDIT_CONFIG_V1,
    workspace_id: "ws-demo",
    expected_manifest_sha256: digest(serializeWorkspaceManifest(current)),
    display_name: "Renamed Demo",
    requirements: [{ provider: "jira", ref: "sot-15499" }],
    repositories: [{
      alias: "product",
      remote: "https://example.test/owner/product.git",
      provider: "github",
      integration_branch: "main",
      branch_pattern: "roll/{workspace_id}/{story_id}",
      required_checks: ["test"],
    }],
    ...overrides,
  });
}

describe("US-WS-025 Workspace metadata edit plan", () => {
  it("parses the closed desired-state schema and builds a byte-stable display-name preview", () => {
    const parsed = parseWorkspaceEditConfig(configText(), { workspaceId: "ws-demo" });
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        schema: WORKSPACE_EDIT_CONFIG_V1,
        workspaceId: "ws-demo",
        displayName: "Renamed Demo",
        requirements: [{ provider: "jira", ref: "SOT-15499" }],
        repositories: [{
          alias: "product",
          remote: "https://example.test/owner/product",
        }],
      },
    });
    if (!parsed.ok) throw new Error("fixture must parse");
    expect(Object.keys(parsed.value.repositories[0] ?? {}).sort()).toEqual([
      "alias",
      "branchPattern",
      "integrationBranch",
      "provider",
      "remote",
      "requiredChecks",
    ]);

    const first = buildWorkspaceEditPlan({
      config: parsed.value,
      current,
      references: references(),
      manifestPath: "/workspace/workspace.yaml",
    });
    const second = buildWorkspaceEditPlan({
      config: parsed.value,
      current,
      references: references(),
      manifestPath: "/workspace/workspace.yaml",
    });

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toMatchObject({
      schema: "roll.workspace-edit-plan/v1",
      outcome: "ready",
      workspaceId: "ws-demo",
      manifestPath: "/workspace/workspace.yaml",
      beforeSha256: digest(serializeWorkspaceManifest(current)),
      referenceIndexSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      afterManifest: {
        workspaceId: "ws-demo",
        displayName: "Renamed Demo",
        createdAt: current.createdAt,
      },
      changes: [{
        kind: "display_name",
        path: "displayName",
        operation: "updated",
        before: "Demo",
        after: "Renamed Demo",
        safety: "safe",
      }],
      blockers: [],
    });
    expect(first.afterSha256).toBe(digest(serializeWorkspaceManifest(first.afterManifest)));
  });

  it("accepts the documented block-style YAML and shell-quotes a complete apply action", () => {
    const yaml = `
schema: roll.workspace-edit/v1
workspace_id: ws-demo
expected_manifest_sha256: ${digest(serializeWorkspaceManifest(current))}
display_name: Renamed Demo
requirements:
  - provider: jira
    ref: sot-15499
repositories:
  - alias: product
    remote: https://example.test/owner/product.git
    provider: github
    integration_branch: main
    branch_pattern: roll/{workspace_id}/{story_id}
    required_checks:
      - test
`;
    const parsed = parseWorkspaceEditConfig(yaml, { workspaceId: "ws-demo" });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));

    expect(buildWorkspaceEditPlan({
      config: parsed.value,
      current,
      references: references(),
      manifestPath: "/workspace/workspace.yaml",
      configPath: "/tmp/edit configs/ws.yaml",
    }).nextAction).toEqual({
      kind: "apply",
      command: "roll workspace edit ws-demo --config '/tmp/edit configs/ws.yaml' --json",
    });
  });

  it.each([
    ["unknown authority field", { root: "/escape" }, "unknown_field"],
    ["Workspace identity mismatch", { workspace_id: "other" }, "identity_mismatch"],
    ["unsafe repository path", { repositories: [{
      alias: "product",
      remote: "file:///tmp/../escape.git",
      provider: "generic",
      integration_branch: "main",
      branch_pattern: "roll/{workspace_id}/{story_id}",
      required_checks: [],
    }] }, "unsafe_remote"],
    ["duplicate binding", { repositories: [
      {
        alias: "product",
        remote: "https://example.test/owner/product",
        provider: "github",
        integration_branch: "main",
        branch_pattern: "roll/{workspace_id}/{story_id}",
        required_checks: [],
      },
      {
        alias: "product",
        remote: "https://example.test/owner/other",
        provider: "github",
        integration_branch: "main",
        branch_pattern: "roll/{workspace_id}/{story_id}",
        required_checks: [],
      },
    ] }, "duplicate_identity"],
  ])("rejects %s before plan construction", (_name, override, code) => {
    expect(parseWorkspaceEditConfig(configText(override), { workspaceId: "ws-demo" })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code })]),
    });
  });

  it("blocks referenced Requirement removal and repository identity/workflow edits without rewriting Issue facts", () => {
    const parsed = parseWorkspaceEditConfig(configText({
      requirements: [],
      repositories: [{
        alias: "renamed-product",
        remote: "https://example.test/owner/product",
        provider: "github",
        integration_branch: "release",
        branch_pattern: "feature/{workspace_id}/{story_id}",
        required_checks: ["lint"],
      }],
    }), { workspaceId: "ws-demo" });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const issue = {
      storyId: "US-EXISTING-1",
      manifestSha256: "a".repeat(64),
      requirementKeys: [{ provider: "jira", ref: "SOT-15499" }],
      repoIds: ["repo-ff7a87ddbb2b"],
    };

    const plan = buildWorkspaceEditPlan({
      config: parsed.value,
      current,
      references: references({ issues: [issue] }),
      manifestPath: "/workspace/workspace.yaml",
    });

    expect(plan.outcome).toBe("blocked");
    expect(plan.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "metadata_referenced", path: "requirements[jira:SOT-15499]" }),
      expect.objectContaining({ code: "metadata_referenced", path: "repositories[repo-ff7a87ddbb2b].alias" }),
      expect.objectContaining({ code: "metadata_referenced", path: "repositories[repo-ff7a87ddbb2b].workflow" }),
    ]));
    expect(plan.blockers.every((blocker) => blocker.references.some((entry) => entry.storyId === "US-EXISTING-1"))).toBe(true);
    expect(issue).toEqual({
      storyId: "US-EXISTING-1",
      manifestSha256: "a".repeat(64),
      requirementKeys: [{ provider: "jira", ref: "SOT-15499" }],
      repoIds: ["repo-ff7a87ddbb2b"],
    });
  });

  it("fails loud when the expected manifest digest or reference identity is not trustworthy", () => {
    const stale = parseWorkspaceEditConfig(configText({ expected_manifest_sha256: "0".repeat(64) }), { workspaceId: "ws-demo" });
    if (!stale.ok) throw new Error("fixture must parse");
    expect(buildWorkspaceEditPlan({
      config: stale.value,
      current,
      references: references(),
      manifestPath: "/workspace/workspace.yaml",
    })).toMatchObject({ outcome: "blocked", blockers: [expect.objectContaining({ code: "manifest_changed" })] });

    const invalidCurrent = { ...current, requirements: [{ provider: "unknown", ref: "opaque" }] };
    const parsed = parseWorkspaceEditConfig(configText({
      expected_manifest_sha256: digest(serializeWorkspaceManifest(invalidCurrent)),
    }), { workspaceId: "ws-demo" });
    if (!parsed.ok) throw new Error("fixture must parse");
    expect(buildWorkspaceEditPlan({
      config: parsed.value,
      current: invalidCurrent,
      references: references(),
      manifestPath: "/workspace/workspace.yaml",
    })).toMatchObject({ outcome: "blocked", blockers: [expect.objectContaining({ code: "normalization_failed" })] });
  });
});
