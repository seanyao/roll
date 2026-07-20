import { describe, expect, it } from "vitest";
import type { RepositoryBinding, RequirementSourceManifest } from "@roll/spec";
import {
  parseIssueStoryContract,
  resolveIssueInitPlan,
  type IssueInitProbe,
} from "../src/workspace/issue-init-plan.js";

const storySpec = `---
id: US-XX1
repositories:
  - alias: sot1
    access: write
    required_delivery: true
  - alias: sot2
    access: write
    required_delivery: true
    depends_on_repo: sot1
  - alias: sot3
    access: read
---

# US-XX1 body mentions repositories: should never be parsed
`;

const bindings: readonly RepositoryBinding[] = [
  {
    schema: "roll.repository-binding/v1",
    repoId: "repo-sot1",
    alias: "sot1",
    remote: "file:///tmp/remotes/sot1",
    integrationBranch: "main",
    provider: "generic",
    workflow: { branchPattern: "roll/{workspace_id}/{story_id}", requiredChecks: [] },
  },
  {
    schema: "roll.repository-binding/v1",
    repoId: "repo-sot2",
    alias: "sot2",
    remote: "file:///tmp/remotes/sot2",
    integrationBranch: "main",
    provider: "generic",
    workflow: { branchPattern: "roll/{workspace_id}/{story_id}", requiredChecks: [] },
  },
  {
    schema: "roll.repository-binding/v1",
    repoId: "repo-sot3",
    alias: "sot3",
    remote: "file:///tmp/remotes/sot3",
    integrationBranch: "main",
    provider: "generic",
    workflow: { branchPattern: "roll/{workspace_id}/{story_id}", requiredChecks: [] },
  },
];

const requirementManifests: readonly RequirementSourceManifest[] = [
  {
    schema: "roll.requirement-source/v1",
    requirementId: "req-1",
    provider: "jira",
    ref: "SOT-15499",
    revision: "rev-1",
    capturedAt: "2026-07-20T00:00:00.000Z",
    previousRevisions: [],
    requirement: { bytes: 10, sha256: "a".repeat(64) },
    context: [],
    stories: ["US-XX1"],
    attest: { schema: "roll.requirement-attest-projection/v1", mode: "generated_aggregate", evidenceAuthority: "issue" },
  },
];

function probe(overrides: Partial<IssueInitProbe> = {}): IssueInitProbe {
  return {
    manifest: { state: "absent" },
    worktrees: {},
    ...overrides,
  };
}

describe("parseIssueStoryContract", () => {
  it("reads only the frontmatter repositories block, ignoring prose mentions", () => {
    const parsed = parseIssueStoryContract(storySpec, { storyId: "US-XX1" });
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        storyId: "US-XX1",
        repositories: [
          { alias: "sot1", access: "write", requiredDelivery: true },
          { alias: "sot2", access: "write", requiredDelivery: true, dependsOnRepo: "sot1" },
          { alias: "sot3", access: "read", requiredDelivery: false },
        ],
      },
    });
  });

  it.each([
    ["missing frontmatter", "# no frontmatter here", "invalid_config"],
    ["mismatched id", storySpec.replace("id: US-XX1", "id: US-OTHER"), "identity_mismatch"],
    ["empty repositories", storySpec.replace(/repositories:[\s\S]*?(?=\n---)/, "repositories: []\n"), "invalid_value"],
    ["unknown field", storySpec.replace("access: write", "access: write\n    weird_field: yes"), "unknown_field"],
  ])("rejects %s", (_name, text, code) => {
    const parsed = parseIssueStoryContract(text, { storyId: "US-XX1" });
    expect(parsed).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ code })]) });
  });
});

describe("resolveIssueInitPlan", () => {
  const contract = parseIssueStoryContract(storySpec, { storyId: "US-XX1" });
  if (!contract.ok) throw new Error("fixture must parse");

  it("resolves every declared alias against the Workspace bindings and requirement links", () => {
    const result = resolveIssueInitPlan({
      workspaceId: "ws-demo",
      contract: contract.value,
      bindings,
      requirementManifests,
    }, probe());
    expect(result).toMatchObject({
      ok: true,
      value: {
        manifest: {
          schema: "roll.issue/v1",
          workspaceId: "ws-demo",
          storyId: "US-XX1",
          requirements: [{ provider: "jira", ref: "SOT-15499" }],
          repositories: [
            { repoId: "repo-sot1", alias: "sot1", access: "write" },
            { repoId: "repo-sot2", alias: "sot2", access: "write", dependsOnRepo: "sot1" },
            { repoId: "repo-sot3", alias: "sot3", access: "read" },
          ],
        },
        outcome: "created",
        targets: [
          expect.objectContaining({ alias: "sot1", action: "created", worktreePath: expect.stringContaining("sot1") }),
          expect.objectContaining({ alias: "sot2", action: "created", worktreePath: expect.stringContaining("sot2") }),
          expect.objectContaining({ alias: "sot3", action: "created", worktreePath: expect.stringContaining("sot3") }),
        ],
      },
    });
  });

  it("fails loud when a declared alias has no matching Workspace binding", () => {
    const result = resolveIssueInitPlan({
      workspaceId: "ws-demo",
      contract: contract.value,
      bindings: bindings.filter((binding) => binding.alias !== "sot2"),
      requirementManifests,
    }, probe());
    expect(result).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "unknown_field", path: expect.stringContaining("sot2") })]),
    });
  });

  it("summarizes compatible per-target retries as reused or repaired, never silently created", () => {
    const reused = resolveIssueInitPlan({
      workspaceId: "ws-demo",
      contract: contract.value,
      bindings,
      requirementManifests,
    }, probe({
      manifest: { state: "compatible" },
      worktrees: { sot1: "compatible", sot2: "compatible", sot3: "compatible" },
    }));
    expect(reused).toMatchObject({ ok: true, value: { outcome: "reused" } });

    const repaired = resolveIssueInitPlan({
      workspaceId: "ws-demo",
      contract: contract.value,
      bindings,
      requirementManifests,
    }, probe({
      manifest: { state: "compatible" },
      worktrees: { sot1: "repairable", sot2: "compatible", sot3: "compatible" },
    }));
    expect(repaired).toMatchObject({ ok: true, value: { outcome: "repaired" } });
    if (!repaired.ok) throw new Error("expected repaired plan");
    expect(repaired.value.targets[0]).toMatchObject({ alias: "sot1", action: "repaired" });
  });

  it("orders rollback of newly-created targets in reverse, excluding conflicted/dirty ones", () => {
    const result = resolveIssueInitPlan({
      workspaceId: "ws-demo",
      contract: contract.value,
      bindings,
      requirementManifests,
    }, probe({
      worktrees: { sot1: "compatible", sot2: "absent", sot3: "absent" },
    }));
    expect(result).toMatchObject({
      ok: true,
      value: {
        targets: [
          expect.objectContaining({ alias: "sot1", action: "reused" }),
          expect.objectContaining({ alias: "sot2", action: "created" }),
          expect.objectContaining({ alias: "sot3", action: "created" }),
        ],
      },
    });
    if (!result.ok) throw new Error("expected plan");
    expect(result.value.rollbackOrder).toEqual(["sot3", "sot2"]);
  });

  it("rejects a conflicting worktree state instead of silently repairing it", () => {
    const result = resolveIssueInitPlan({
      workspaceId: "ws-demo",
      contract: contract.value,
      bindings,
      requirementManifests,
    }, probe({ worktrees: { sot1: "conflict", sot2: "absent", sot3: "absent" } }));
    expect(result).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ code: "invalid_value", path: "repositories[sot1]" })]) });
  });
});
