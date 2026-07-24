import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  REPOSITORY_BINDING_V1,
  REQUIREMENT_HINT_V1,
  WORKSPACE_INTENT_V1,
  WORKSPACE_MANIFEST_V1,
  type WorkspaceIntentV1,
  type WorkspaceLifecycle,
  type WorkspaceMatchCandidateV1,
} from "@roll/spec";
import type { WorkspaceDiscoveryFactsV1 } from "@roll/core";
import {
  beginAgentWorkspaceClarification,
  continueAgentWorkspaceClarification,
} from "../src/runner/workspace-clarification.js";

const SHA = "a".repeat(64);
const evidenceDir = fileURLToPath(new URL("./fixtures/workspace/us-ws-029-terminal-evidence", import.meta.url));

function intent(operation: "read" | "mutation" = "mutation"): WorkspaceIntentV1 {
  return {
    schema: WORKSPACE_INTENT_V1,
    operation,
    interaction: "interactive",
    scope: operation === "read" ? "workspace_required_read" : "workspace_required_mutation",
    cwd: "/tmp",
    requirement: {
      schema: REQUIREMENT_HINT_V1,
      sources: [{ key: { provider: "jira", ref: "APE-234" }, provenance: "deterministic_extraction" }],
      storyIds: [],
      repositoryRemotes: [],
      paths: [],
    },
  };
}

function facts(workspaceId: string, lifecycle: WorkspaceLifecycle): WorkspaceDiscoveryFactsV1 {
  const root = `/workspaces/${workspaceId}`;
  return {
    candidate: {
      workspaceId,
      root,
      canonicalRoot: root,
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
    evidence: workspaceId === "fields"
      ? [{
          kind: "requirement_source_exact",
          value: "jira:APE-234",
          hard: true,
          score: 100,
          source: "jira:APE-234",
          provenance: "deterministic_extraction",
          detail: "exact requirement source",
        }]
      : [],
    hardMatch: workspaceId === "fields",
    score: workspaceId === "fields" ? 100 : 0,
  };
}

describe("US-WS-029 agent Workspace clarification host", () => {
  it("deposits the single-active requirement-mismatch select/create stopping transcript", () => {
    const question = beginAgentWorkspaceClarification({
      intent: intent(),
      reason: "requirement_match_required",
      candidates: [candidate("roll", "active")],
      diagnostics: [],
      discovery: { registryRevision: 7, discoveryFactsSha256: SHA, workspaces: [facts("roll", "active")] },
    });
    const selected = continueAgentWorkspaceClarification({
      handoff: question.handoff,
      answer: { action: "select_existing", workspaceId: "roll" },
      currentDiscovery: { registryRevision: 7, discoveryFactsSha256: SHA },
      rerunResolver: (selector) => ({ selector, status: "explicit_recheck_required" }),
    });
    const created = continueAgentWorkspaceClarification({
      handoff: question.handoff,
      answer: { action: "create_new", workspaceId: "ws-ape-234" },
      currentDiscovery: { registryRevision: 7, discoveryFactsSha256: SHA },
      rerunResolver: () => ({ unexpected: true }),
    });
    const transcript = [
      "US-WS-029 normalized agent terminal transcript",
      "Generated from the public agent Workspace clarification host.",
      "",
      "$ agent -> roll-.clarify workspace_target",
      question.prompt,
      "",
      "> select_existing roll",
      JSON.stringify(selected, null, 2),
      "",
      "> create_new ws-ape-234",
      JSON.stringify(created, null, 2),
      "",
    ].join("\n");

    expect(question.handoff.allowedActions).toEqual(["select_existing", "create_new"]);
    expect(selected).toMatchObject({ kind: "resolution_retried", stopped: true, canonicalSelector: "--workspace roll" });
    expect(created).toMatchObject({
      kind: "collect_create_input",
      stopped: true,
      previewCommand: "roll workspace create <ID> --config <path> --check",
      applyAuthorized: false,
    });
    expect(readFileSync(`${evidenceDir}/transcript.txt`, "utf8")).toBe(transcript);
    expect(JSON.parse(readFileSync(`${evidenceDir}/evidence.json`, "utf8"))).toMatchObject({
      storyId: "US-WS-029",
      physical: false,
      taken: false,
      reason: "headless_terminal_capture_unavailable",
    });
    expect(readFileSync(`${evidenceDir}/capture-skip.txt`, "utf8")).toContain("No PNG was generated");
  });

  it.each(["registered", "paused"] as const)("stops on a %s exact match without activating or mutating", (lifecycle) => {
    const writeRegistry = vi.fn();
    const activate = vi.fn();
    const create = vi.fn();
    const question = beginAgentWorkspaceClarification({
      intent: intent(),
      reason: "workspace_activation_required",
      candidates: [candidate("fields", lifecycle)],
      diagnostics: [],
      discovery: {
        registryRevision: 7,
        discoveryFactsSha256: SHA,
        workspaces: [facts("fields", lifecycle), facts("roll", "active")],
      },
    });

    expect(question).toMatchObject({ route: "workspace_target", stopped: true });
    expect(question.handoff.allowedActions).toEqual(["select_existing"]);
    expect(question.prompt).toContain("APE-234");
    expect(question.prompt).toContain(`fields (${lifecycle})`);
    expect(question.prompt).toContain("requirement_source_exact");
    expect(question.prompt.match(/\?/gu)).toHaveLength(1);
    expect(question.prompt).not.toContain("planning / building");
    expect(writeRegistry).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("reruns the resolver with a canonical explicit selector and does nothing else", () => {
    const question = beginAgentWorkspaceClarification({
      intent: intent(),
      reason: "workspace_activation_required",
      candidates: [candidate("fields", "registered")],
      diagnostics: [],
      discovery: {
        registryRevision: 7,
        discoveryFactsSha256: SHA,
        workspaces: [facts("fields", "registered"), facts("roll", "active")],
      },
    });
    const rerunResolver = vi.fn((selector: { readonly kind: "id"; readonly workspaceId: string }) => ({
      ok: false as const,
      code: "workspace_activation_required" as const,
      selector,
    }));

    expect(continueAgentWorkspaceClarification({
      handoff: question.handoff,
      answer: { action: "select_existing", workspaceId: "fields" },
      currentDiscovery: { registryRevision: 7, discoveryFactsSha256: SHA },
      rerunResolver,
    })).toEqual({
      kind: "resolution_retried",
      stopped: true,
      canonicalSelector: "--workspace fields",
      result: {
        ok: false,
        code: "workspace_activation_required",
        selector: { kind: "id", workspaceId: "fields" },
      },
    });
    expect(rerunResolver).toHaveBeenCalledOnce();
  });

  it("turns create intent into ID/config collection and an authorization-free check preview", () => {
    const question = beginAgentWorkspaceClarification({
      intent: intent(),
      reason: "create_required",
      candidates: [],
      diagnostics: [],
      discovery: { registryRevision: 7, discoveryFactsSha256: SHA, workspaces: [] },
    });
    const rerunResolver = vi.fn();
    const next = continueAgentWorkspaceClarification({
      handoff: question.handoff,
      answer: { action: "create_new", workspaceId: "ws-ape-234" },
      currentDiscovery: { registryRevision: 7, discoveryFactsSha256: SHA },
      rerunResolver,
    });

    expect(next).toEqual({
      kind: "collect_create_input",
      stopped: true,
      requestedWorkspaceId: "ws-ape-234",
      previewCommand: "roll workspace create <ID> --config <path> --check",
      applyAuthorized: false,
    });
    expect(JSON.stringify(next)).not.toContain("--authorization");
    expect(rerunResolver).not.toHaveBeenCalled();
  });

  it("offers only repair for mutation discovery-incomplete and never executes it", () => {
    const diagnostic = {
      workspaceId: "fields",
      root: "/workspaces/fields",
      code: "invalid_workspace_manifest" as const,
      authorityPath: "/workspaces/fields/workspace.yaml",
      message: "invalid manifest",
    };
    const question = beginAgentWorkspaceClarification({
      intent: intent("mutation"),
      reason: "workspace_discovery_incomplete",
      candidates: [],
      diagnostics: [diagnostic],
      discovery: { registryRevision: 7, discoveryFactsSha256: SHA, workspaces: [] },
    });
    const rerunResolver = vi.fn();

    expect(question.handoff.allowedActions).toEqual(["repair_discovery"]);
    expect(continueAgentWorkspaceClarification({
      handoff: question.handoff,
      answer: { action: "repair_discovery" },
      currentDiscovery: { registryRevision: 7, discoveryFactsSha256: SHA },
      rerunResolver,
    })).toEqual({
      kind: "repair_actions",
      stopped: true,
      commands: ["roll workspace doctor fields --json"],
    });
    expect(rerunResolver).not.toHaveBeenCalled();
  });

  it("stops and reloads stale answers without rerunning or mutating", () => {
    const question = beginAgentWorkspaceClarification({
      intent: intent(),
      reason: "workspace_activation_required",
      candidates: [candidate("fields", "registered")],
      diagnostics: [],
      discovery: { registryRevision: 7, discoveryFactsSha256: SHA, workspaces: [facts("fields", "registered")] },
    });
    const rerunResolver = vi.fn();
    expect(continueAgentWorkspaceClarification({
      handoff: question.handoff,
      answer: { action: "select_existing", workspaceId: "fields" },
      currentDiscovery: { registryRevision: 8, discoveryFactsSha256: "b".repeat(64) },
      rerunResolver,
    })).toEqual({
      kind: "reload_required",
      stopped: true,
      code: "invalid_workspace_clarification",
    });
    expect(rerunResolver).not.toHaveBeenCalled();
  });
});
