import { describe, expect, it, vi } from "vitest";
import { buildWorkspaceClarificationHandoff, type WorkspaceDiscoveryFactsV1 } from "@roll/core";
import {
  REPOSITORY_BINDING_V1,
  REQUIREMENT_HINT_V1,
  WORKSPACE_INTENT_V1,
  WORKSPACE_MANIFEST_V1,
  type WorkspaceClarificationHandoffV1,
  type WorkspaceIntentV1,
  type WorkspaceMatchCandidateV1,
} from "@roll/spec";
import {
  answerDirectWorkspaceClarification,
  parseWorkspaceInteractionArgs,
  renderDirectWorkspaceClarificationPrompt,
  type WorkspaceInteractionCapabilities,
} from "../src/lib/workspace-interaction.js";

const noCapability: WorkspaceInteractionCapabilities = {
  stdinTTY: false,
  stderrTTY: false,
  agentQuestionCapable: false,
};

function intent(): WorkspaceIntentV1 {
  return {
    schema: WORKSPACE_INTENT_V1,
    operation: "read",
    interaction: "interactive",
    scope: "workspace_required_read",
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

function facts(workspaceId: string): WorkspaceDiscoveryFactsV1 {
  const root = `/workspaces/${workspaceId}`;
  return {
    candidate: {
      workspaceId,
      root,
      canonicalRoot: root,
      manifestWorkspaceId: workspaceId,
      pathState: "valid",
      lifecycle: "active",
    },
    manifest: {
      schema: WORKSPACE_MANIFEST_V1,
      workspaceId,
      displayName: `${workspaceId} delivery`,
      requirements: workspaceId === "fields" ? [{ provider: "jira", ref: "APE-234" }] : [],
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

function candidate(workspaceId: string): WorkspaceMatchCandidateV1 {
  return {
    workspaceId,
    root: `/workspaces/${workspaceId}`,
    lifecycle: "active",
    evidence: workspaceId === "fields" ? [{
      kind: "requirement_source_exact",
      value: "jira:APE-234",
      hard: true,
      score: 100,
      source: "jira:APE-234",
      provenance: "deterministic_extraction",
      detail: "exact requirement source",
    }] : [],
    hardMatch: workspaceId === "fields",
    score: workspaceId === "fields" ? 100 : 0,
  };
}

function handoff(): WorkspaceClarificationHandoffV1 {
  return buildWorkspaceClarificationHandoff({
    intent: intent(),
    reason: "requirement_match_required",
    candidates: [candidate("fields"), candidate("roll")],
    diagnostics: [],
    facts: [facts("fields"), facts("roll")],
    registryRevision: 7,
    discoveryFactsSha256: "a".repeat(64),
  });
}

describe("US-WS-030 direct Workspace interaction capability", () => {
  it("keeps interaction capability independent from JSON format", () => {
    expect(parseWorkspaceInteractionArgs(["--json"], {
      stdinTTY: true,
      stderrTTY: true,
      agentQuestionCapable: false,
    })).toEqual({ ok: true, mode: "interactive", args: ["--json"] });
    expect(parseWorkspaceInteractionArgs(["--json", "--no-input"], {
      stdinTTY: true,
      stderrTTY: true,
      agentQuestionCapable: false,
    })).toEqual({ ok: true, mode: "non_interactive", args: ["--json"] });
    expect(parseWorkspaceInteractionArgs(["--json"], noCapability)).toEqual({
      ok: true,
      mode: "non_interactive",
      args: ["--json"],
    });
  });

  it("requires a real direct TTY pair or an agent question capability when forced", () => {
    expect(parseWorkspaceInteractionArgs(["--interactive"], noCapability)).toEqual({
      ok: false,
      code: "interaction_unavailable",
      args: [],
    });
    expect(parseWorkspaceInteractionArgs(["--interactive"], {
      ...noCapability,
      agentQuestionCapable: true,
    })).toEqual({ ok: true, mode: "interactive", args: [] });
    expect(parseWorkspaceInteractionArgs(["--interactive"], {
      ...noCapability,
      stdinTTY: true,
      stderrTTY: true,
    })).toEqual({ ok: true, mode: "interactive", args: [] });
  });

  it("lets --no-input force non-interactive handling without changing other argv bytes", () => {
    expect(parseWorkspaceInteractionArgs([
      "list",
      "--no-input",
      "--json",
      "--workspace",
      "roll",
    ], {
      stdinTTY: true,
      stderrTTY: true,
      agentQuestionCapable: true,
    })).toEqual({
      ok: true,
      mode: "non_interactive",
      args: ["list", "--json", "--workspace", "roll"],
    });
  });
});

describe("US-WS-030 direct Workspace clarification", () => {
  it("renders the shared handoff facts without claiming that the CLI loaded a skill", () => {
    const prompt = renderDirectWorkspaceClarificationPrompt(handoff());
    expect(prompt).toContain("jira:APE-234");
    expect(prompt).toContain("fields delivery (active)");
    expect(prompt).toContain("requirement_source_exact jira:APE-234");
    expect(prompt).toContain("roll delivery (active)");
    expect(prompt).toContain("create a new Workspace");
    expect(prompt).not.toMatch(/load(?:ed|ing)? .*skill/i);
  });

  it("turns a selection into an explicit selector and reruns the resolver", () => {
    const rerunResolver = vi.fn((selector: string) => ({ ok: true, selector }));
    expect(answerDirectWorkspaceClarification({
      handoff: handoff(),
      answer: "1",
      currentDiscovery: { registryRevision: 7, discoveryFactsSha256: "a".repeat(64) },
      rerunResolver,
    })).toEqual({
      kind: "selected",
      canonicalSelector: "--workspace fields",
      result: { ok: true, selector: "fields" },
    });
    expect(rerunResolver).toHaveBeenCalledExactlyOnceWith("fields");
  });

  it("stops the original family on create and never authorizes apply", () => {
    const rerunResolver = vi.fn();
    expect(answerDirectWorkspaceClarification({
      handoff: handoff(),
      answer: "create",
      currentDiscovery: { registryRevision: 7, discoveryFactsSha256: "a".repeat(64) },
      rerunResolver,
    })).toEqual({
      kind: "create",
      nextAction: "roll workspace create <ID> --config <path> --check",
      applyAuthorized: false,
    });
    expect(rerunResolver).not.toHaveBeenCalled();
  });

  it.each([null, "cancel", "q"])("cancels on %s without resolving a target", (answer) => {
    const rerunResolver = vi.fn();
    expect(answerDirectWorkspaceClarification({
      handoff: handoff(),
      answer,
      currentDiscovery: { registryRevision: 7, discoveryFactsSha256: "a".repeat(64) },
      rerunResolver,
    })).toEqual({ kind: "cancelled", code: "workspace_clarification_cancelled" });
    expect(rerunResolver).not.toHaveBeenCalled();
  });

  it("rejects stale answers before rerunning resolution", () => {
    const rerunResolver = vi.fn();
    expect(answerDirectWorkspaceClarification({
      handoff: handoff(),
      answer: "fields",
      currentDiscovery: { registryRevision: 8, discoveryFactsSha256: "b".repeat(64) },
      rerunResolver,
    })).toEqual({ kind: "invalid", code: "invalid_workspace_clarification", reload: true });
    expect(rerunResolver).not.toHaveBeenCalled();
  });
});
