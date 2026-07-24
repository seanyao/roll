import {
  CONTEXT_PAGE_V1,
  CONTEXT_PROVIDER_REGISTRY_V1,
  CONTEXT_READ_REQUEST_V1,
  REPOSITORY_BINDING_V1,
  WORKSPACE_EXECUTION_CONTEXT_V1,
  type ContextPageMetadataV1,
  type ContextProviderRegistryV1,
  type ContextReadFileV1,
  type ContextReadRequestV1,
  type RepositoryBinding,
  type WorkspaceContextBindingV1,
  type WorkspaceExecutionContextV1,
} from "@roll/spec";
import { describe, expect, it, vi } from "vitest";
import {
  createContextReadService,
  type ContextProviderReadAdapter,
  type ContextProviderReadSuccessV1,
} from "../../src/context/read-service.js";

function repository(remote: string, index = 0): RepositoryBinding {
  return {
    schema: REPOSITORY_BINDING_V1,
    repoId: `repo-${index}`,
    alias: `repo-${index}`,
    remote,
    integrationBranch: "main",
    provider: "github",
    workflow: { branchPattern: "roll/{workspaceId}/{storyId}", requiredChecks: [] },
  };
}

function contextBinding(overrides: Partial<WorkspaceContextBindingV1> = {}): WorkspaceContextBindingV1 {
  return {
    providerId: "enterprise-wiki",
    enabled: true,
    required: true,
    entrypoints: ["wiki/index.md", "wiki/overview.md"],
    ...overrides,
  };
}

function workspace(bindings: readonly WorkspaceContextBindingV1[] = [contextBinding()]): WorkspaceExecutionContextV1 {
  return {
    schema: WORKSPACE_EXECUTION_CONTEXT_V1,
    workspace: {
      workspaceId: "roll",
      root: "/workspace/roll",
      canonicalRoot: "/workspace/roll",
      lifecycle: "active",
    },
    resolution: { source: "explicit", evidence: [] },
    bindings: [repository("https://github.com/seanyao/roll.git")],
    contexts: { enabled: true, bindings },
    authorities: {
      backlog: "/workspace/roll/backlog",
      features: "/workspace/roll/features",
      design: "/workspace/roll/design",
      requirements: "/workspace/roll/requirements",
      policy: "/workspace/roll/policy.yaml",
      evidence: "/workspace/roll/evidence",
      toolDumps: "/workspace/roll/tool-dumps",
      events: "/workspace/roll/events",
      runtime: "/workspace/roll/runtime",
      locks: "/workspace/roll/locks",
    },
  };
}

function registry(): ContextProviderRegistryV1 {
  return {
    schema: CONTEXT_PROVIDER_REGISTRY_V1,
    enabled: true,
    providers: [{
      id: "enterprise-wiki",
      type: "git_llm_wiki",
      enabled: true,
      remote: "https://github.com/bipo/context-wiki.git",
      branch: "main",
      fetch_timeout_seconds: 30,
    }],
  };
}

function request(overrides: Partial<ContextReadRequestV1> = {}): ContextReadRequestV1 {
  return {
    schema: CONTEXT_READ_REQUEST_V1,
    workspace: workspace(),
    storyId: "US-CONTEXT-005",
    stage: "build",
    environmentIds: ["sit"],
    refs: ["context://enterprise-wiki/wiki/systems/axis.md"],
    ...overrides,
  };
}

function metadata(overrides: Partial<ContextPageMetadataV1> = {}): ContextPageMetadataV1 {
  return {
    schema: CONTEXT_PAGE_V1,
    title: "Axis system",
    page_type: "system_runbook",
    status: "active",
    confidence: "approved",
    updated_at: "2026-07-24",
    scope: { workspace_ids: ["roll"], environment_ids: ["sit"], stages: ["build"] },
    sources: ["raw/sources/axis.md"],
    sensitivity: "internal",
    ...overrides,
  };
}

function file(path: string, page?: ContextPageMetadataV1): ContextReadFileV1 {
  const content = page === undefined ? `# ${path}\n` : `---\nschema: ${CONTEXT_PAGE_V1}\n---\n# ${path}\n`;
  return {
    ref: `context://enterprise-wiki/${path}`,
    path,
    sha256: "a".repeat(64),
    bytes: Buffer.byteLength(content),
    ...(page === undefined ? {} : { page }),
    content,
  };
}

function success(paths: readonly string[]): ContextProviderReadSuccessV1 {
  return {
    ok: true,
    revision: {
      providerId: "enterprise-wiki",
      remoteIdentity: "https://github.com/bipo/context-wiki",
      branch: "main",
      fetchedAt: "2026-07-24T05:00:00.000Z",
      revision: "0123456789abcdef0123456789abcdef01234567",
    },
    files: paths.map((path) => file(path, path === "wiki/overview.md" || path === "wiki/systems/axis.md" ? metadata() : undefined)),
    warnings: [],
  };
}

describe("ContextReadService", () => {
  it("compiles every plan before effects and blocks all Provider reads on one invalid explicit ref", async () => {
    const adapter: ContextProviderReadAdapter = { read: vi.fn() };
    const service = createContextReadService({ registry: registry(), adapter });

    const result = await service.read(request({ refs: ["not-a-context-ref"] }));

    expect(result).toMatchObject({ outcome: "blocked", providers: [] });
    expect(result.gaps).toEqual([expect.objectContaining({ code: "invalid_context_ref", severity: "blocking" })]);
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it("reads reserved pages, current entrypoints and explicit refs once at one revision", async () => {
    const paths = [
      "purpose.md",
      "schema.md",
      "wiki/index.md",
      "wiki/log.md",
      "wiki/overview.md",
      "wiki/systems/axis.md",
    ];
    const adapter: ContextProviderReadAdapter = {
      read: vi.fn(async (input) => {
        expect(input.paths).toEqual(paths);
        return success(paths);
      }),
    };
    const service = createContextReadService({
      registry: registry(),
      adapter,
      now: () => Date.parse("2026-07-24T05:01:02.003Z"),
      authorizeRestrictedReference: () => true,
    });

    const result = await service.read(request());

    expect(adapter.read).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe("completed");
    expect(result.requestScope).toEqual({
      workspaceId: "roll",
      storyId: "US-CONTEXT-005",
      repositoryIds: ["https://github.com/seanyao/roll"],
      environmentIds: ["sit"],
      stage: "build",
    });
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]).toMatchObject({
      providerId: "enterprise-wiki",
      remoteIdentity: "https://github.com/bipo/context-wiki",
      revision: "0123456789abcdef0123456789abcdef01234567",
      files: paths.map((path) => expect.objectContaining({ path })),
    });
    expect(result.providers[0]?.files.at(-1)).toMatchObject({
      page: metadata(),
      matchedScope: { workspace_ids: ["roll"], environment_ids: ["sit"], stages: ["build"] },
    });
    expect(result.snapshotDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.snapshotId).toMatch(/^ctx_20260724T050102003Z_[0-9a-f]{12}$/u);
    expect(result.artifactPath).toBe(`/workspace/roll/runtime/context/US-CONTEXT-005/${result.snapshotId}.json`);
  });

  it("returns disabled without Provider effects when machine or Workspace Context is disabled", async () => {
    const adapter: ContextProviderReadAdapter = { read: vi.fn() };
    const machineDisabled = createContextReadService({ registry: { ...registry(), enabled: false }, adapter });
    const workspaceDisabled = createContextReadService({ registry: registry(), adapter });

    await expect(machineDisabled.read(request())).resolves.toMatchObject({ outcome: "disabled", providers: [] });
    await expect(workspaceDisabled.read(request({
      workspace: { ...workspace(), contexts: { enabled: false, bindings: [] } },
    }))).resolves.toMatchObject({ outcome: "disabled", providers: [] });
    expect(adapter.read).not.toHaveBeenCalled();
  });
});
