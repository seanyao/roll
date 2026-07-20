import { describe, expect, it } from "vitest";
import * as publicSpec from "../src/index.js";
import {
  REPOSITORY_BINDING_V1,
  ISSUE_MANIFEST_V1,
  WORKSPACE_MANIFEST_V1,
  issueManifestV1Schema,
  normalizeRepositoryRemote,
  parseIssueManifest,
  parseRepositoryBinding,
  parseWorkspaceManifest,
  repositoryBindingV1Schema,
  repositoryIdFromRemote,
  workspaceManifestV1Schema,
} from "../src/types/workspace.js";

type SchemaView = {
  type?: string;
  additionalProperties?: boolean;
  properties?: Record<string, SchemaView>;
  items?: SchemaView;
  oneOf?: readonly SchemaView[];
};

function repository(remote = "https://github.com/Owner/Repo.git", alias = "product") {
  const id = repositoryIdFromRemote(remote);
  if (!id.ok) throw new Error("test remote must be valid");
  return {
    schema: REPOSITORY_BINDING_V1,
    repoId: id.value,
    alias,
    remote,
    integrationBranch: "main",
    provider: "github",
    workflow: {
      branchPattern: "roll/{workspace_id}/{story_id}",
      requiredChecks: ["unit", "integration"],
    },
  };
}

function workspace() {
  return {
    schema: WORKSPACE_MANIFEST_V1,
    workspaceId: "ws-sot-platform",
    displayName: "SOT platform delivery",
    createdAt: "2026-07-20T00:00:00Z",
    requirements: [{ provider: "jira", ref: "SOT-15499" }],
    repositories: [repository()],
  };
}

function issue() {
  const product = repository();
  const docs = repository("https://github.com/Owner/Docs.git", "docs");
  return {
    schema: ISSUE_MANIFEST_V1,
    workspaceId: "ws-sot-platform",
    storyId: "US-WS-001",
    requirements: [{ provider: "jira", ref: "SOT-15499" }],
    repositories: [
      {
        repoId: product.repoId,
        alias: product.alias,
        access: "write",
        requiredDelivery: true,
        noChangePolicy: "changes_required",
        pathScope: ["packages/spec"],
      },
      {
        repoId: docs.repoId,
        alias: docs.alias,
        access: "read",
        requiredDelivery: false,
        dependsOnRepo: "product",
      },
    ],
  };
}

describe("Workspace repository identity", () => {
  it("exports the complete v1 contract from the public spec surface", () => {
    expect(WORKSPACE_MANIFEST_V1).toBe("roll.workspace/v1");
    expect(REPOSITORY_BINDING_V1).toBe("roll.repository-binding/v1");
    expect(ISSUE_MANIFEST_V1).toBe("roll.issue/v1");
    expect(publicSpec).toMatchObject({
      parseWorkspaceManifest: expect.any(Function),
      parseRepositoryBinding: expect.any(Function),
      parseIssueManifest: expect.any(Function),
      normalizeRepositoryRemote: expect.any(Function),
      repositoryIdFromRemote: expect.any(Function),
      workspaceManifestV1Schema: expect.any(Object),
      repositoryBindingV1Schema: expect.any(Object),
      issueManifestV1Schema: expect.any(Object),
    });
  });

  it.each([
    ["https://GitHub.com/Owner/Repo.git/", "https://github.com/Owner/Repo"],
    ["https://github.com:443/Owner/Repo", "https://github.com/Owner/Repo"],
    ["git@GitHub.com:Owner/Repo.git", "ssh://github.com/Owner/Repo"],
    ["ssh://deploy@GitHub.com:22/Owner/Repo.git/", "ssh://github.com/Owner/Repo"],
    ["file:///Users/Example/Repo.git/", "file:///Users/Example/Repo"],
  ])("canonicalizes the closed v1 remote table: %s", (input, expected) => {
    expect(normalizeRepositoryRemote(input)).toEqual({ ok: true, value: expected });
  });

  it("derives a stable repository ID from the canonical remote", () => {
    const https = repositoryIdFromRemote("https://GitHub.com/Owner/Repo.git");
    const canonical = repositoryIdFromRemote("https://github.com/Owner/Repo");
    expect(https).toEqual(canonical);
    expect(https).toEqual({ ok: true, value: "repo-8d325f3875d5" });
    expect(repositoryIdFromRemote("https://github.com/Owner/Other")).toEqual({
      ok: true,
      value: "repo-473d9ff14ae9",
    });
  });

  it.each([
    "https://token@example.com/Owner/Repo.git",
    "https://example.com:8443/Owner/Repo.git",
    "https://example.com/Owner/Repo.git?token=secret",
    "https://example.com/Owner/Repo.git#fragment",
    "ssh://git@example.com:2222/Owner/Repo.git",
    "../Owner/Repo.git",
    "C:\\Owner\\Repo.git",
    "file://server/share/Repo.git",
    "file:///Owner/../Repo.git",
    "https://example.com/Owner/%52epo.git",
    "https://example.com/Owner/My Repo.git",
    "https://@example.com/Owner/Repo.git",
    "https://example.com/Owner/Repo\n.git",
    "ssh://git@example.com/Owner/Repo\t.git",
    "file://localhost/Users/Example/Repo.git",
    "file:///C:/Owner/Repo.git",
  ])("rejects ambiguous or credential-bearing remote input without echoing it: %s", (input) => {
    const result = normalizeRepositoryRemote(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.every((error) => error.code === "unsafe_remote" && error.path === "remote")).toBe(true);
    expect(JSON.stringify(result.errors)).not.toContain("token");
    expect(JSON.stringify(result.errors)).not.toContain("secret");
  });
});

describe("RepositoryBinding and WorkspaceManifest", () => {
  it("publishes closed schemas at every object boundary", () => {
    const repositorySchema = repositoryBindingV1Schema as SchemaView;
    const workspaceSchema = workspaceManifestV1Schema as SchemaView;
    const issueSchema = issueManifestV1Schema as SchemaView;
    expect(repositorySchema).toMatchObject({ type: "object", additionalProperties: false });
    expect(repositorySchema.properties?.workflow).toMatchObject({ type: "object", additionalProperties: false });
    expect(workspaceSchema).toMatchObject({ type: "object", additionalProperties: false });
    expect(workspaceSchema.properties?.requirements?.items).toMatchObject({ type: "object", additionalProperties: false });
    expect(workspaceSchema.properties?.repositories).toMatchObject({ type: "array", minItems: 1 });
    expect(issueSchema).toMatchObject({ type: "object", additionalProperties: false });
    expect(issueSchema.properties?.requirements?.items).toMatchObject({ type: "object", additionalProperties: false });
    expect(issueSchema.properties?.repositories?.items?.oneOf).toHaveLength(2);
    expect(issueSchema.properties?.repositories?.items?.oneOf?.every((entry) => entry.additionalProperties === false)).toBe(true);
  });

  it("parses and canonicalizes a complete repository binding", () => {
    const parsed = parseRepositoryBinding(repository());
    expect(parsed).toEqual({
      ok: true,
      value: {
        schema: REPOSITORY_BINDING_V1,
        repoId: "repo-8d325f3875d5",
        alias: "product",
        remote: "https://github.com/Owner/Repo",
        integrationBranch: "main",
        provider: "github",
        workflow: {
          branchPattern: "roll/{workspace_id}/{story_id}",
          requiredChecks: ["unit", "integration"],
        },
      },
    });
  });

  it("round-trips a valid Workspace manifest and enforces expected identity", () => {
    const parsed = parseWorkspaceManifest(JSON.parse(JSON.stringify(workspace())), {
      workspaceId: "ws-sot-platform",
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        schema: WORKSPACE_MANIFEST_V1,
        workspaceId: "ws-sot-platform",
        displayName: "SOT platform delivery",
        createdAt: "2026-07-20T00:00:00Z",
        requirements: [{ provider: "jira", ref: "SOT-15499" }],
        repositories: [{ ...repository(), remote: "https://github.com/Owner/Repo" }],
      },
    });
  });

  it.each([
    ["unknown version", { ...workspace(), schema: "roll.workspace/v2" }, "unknown_version"],
    ["unknown root", { ...workspace(), root: "/tmp/workspace" }, "unknown_field"],
    ["mutable lifecycle", { ...workspace(), lifecycle: "active" }, "unknown_field"],
    ["workspace mismatch", workspace(), "identity_mismatch", { workspaceId: "ws-other" }],
  ])("rejects %s", (_label, value, code, expectations = {}) => {
    const parsed = parseWorkspaceManifest(value, expectations);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.map((error) => error.code)).toContain(code);
  });

  it("rejects repository ID mismatch, unsafe refs and unknown nested fields", () => {
    const invalid = repository();
    invalid.repoId = "repo-000000000000";
    invalid.integrationBranch = "main..release";
    const value = { ...invalid, token: "must-not-be-accepted" };
    const parsed = parseRepositoryBinding(value);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["unknown_field", "repo_id_mismatch", "invalid_value"]),
    );
    expect(JSON.stringify(parsed.errors)).not.toContain("must-not-be-accepted");
  });

  it.each([".hidden", "feature/.hidden", "-danger", "feature.lock/child"])(
    "rejects Git refs forbidden by check-ref-format: %s",
    (integrationBranch) => {
      const parsed = parseRepositoryBinding({ ...repository(), integrationBranch });
      expect(parsed).toMatchObject({
        ok: false,
        errors: expect.arrayContaining([
          expect.objectContaining({ code: "invalid_value", path: "integrationBranch" }),
        ]),
      });
    },
  );

  it("rejects unsafe Git ref templates after substituting supported identity tokens", () => {
    const parsed = parseRepositoryBinding({
      ...repository(),
      workflow: { ...repository().workflow, branchPattern: "roll/{workspace_id}/.hidden" },
    });
    expect(parsed).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "invalid_value", path: "workflow.branchPattern" }),
      ]),
    });
  });

  it("rejects unknown repository and nested Workspace fields with typed paths", () => {
    const bindingVersion = parseRepositoryBinding({ ...repository(), schema: "roll.repository-binding/v2" });
    expect(bindingVersion).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "unknown_version", path: "schema" })]),
    });
    const workflowField = parseWorkspaceManifest({
      ...workspace(),
      repositories: [{ ...repository(), workflow: { ...repository().workflow, credential: "forbidden" } }],
    }, {});
    expect(workflowField).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "unknown_field", path: "repositories[0].workflow.credential" }),
      ]),
    });
    const requirementField = parseWorkspaceManifest({
      ...workspace(),
      requirements: [{ provider: "jira", ref: "SOT-15499", status: "mutable" }],
    }, {});
    expect(requirementField).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "unknown_field", path: "requirements[0].status" }),
      ]),
    });
  });

  it.each([
    ["alias", [repository(), repository("https://github.com/Owner/Other.git")]],
    ["repoId", [repository(), { ...repository(), alias: "other" }]],
    ["remote", [repository(), { ...repository("https://GITHUB.com/Owner/Repo"), alias: "other" }]],
  ])("rejects duplicate repository %s", (_kind, repositories) => {
    const parsed = parseWorkspaceManifest({ ...workspace(), repositories }, {});
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.map((error) => error.code)).toContain("duplicate_identity");
  });
});

describe("IssueManifest repository targets", () => {
  it("publishes a closed Issue schema", () => {
    expect(issueManifestV1Schema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("round-trips immutable repository target declarations", () => {
    const parsed = parseIssueManifest(issue(), {
      workspaceId: "ws-sot-platform",
      storyId: "US-WS-001",
    });
    expect(parsed).toEqual({ ok: true, value: issue() });
  });

  it.each([
    ["read delivery", { repositories: [{ ...issue().repositories[1], requiredDelivery: true }] }, "repositories[0].requiredDelivery"],
    ["write policy", { repositories: [{ ...issue().repositories[0], noChangePolicy: undefined }] }, "repositories[0].noChangePolicy"],
    ["absolute path", { repositories: [{ ...issue().repositories[0], pathScope: ["/packages/spec"] }] }, "repositories[0].pathScope"],
    ["Windows absolute path", { repositories: [{ ...issue().repositories[0], pathScope: ["C:/packages/spec"] }] }, "repositories[0].pathScope"],
    ["traversal path", { repositories: [{ ...issue().repositories[0], pathScope: ["packages/../infra"] }] }, "repositories[0].pathScope"],
    ["backslash path", { repositories: [{ ...issue().repositories[0], pathScope: ["packages\\spec"] }] }, "repositories[0].pathScope"],
    ["drive-relative path", { repositories: [{ ...issue().repositories[0], pathScope: ["C:packages/spec"] }] }, "repositories[0].pathScope"],
    ["control path", { repositories: [{ ...issue().repositories[0], pathScope: ["packages/spec\n"] }] }, "repositories[0].pathScope"],
    ["unknown dependency", { repositories: [{ ...issue().repositories[0], dependsOnRepo: "missing" }] }, "repositories[0].dependsOnRepo"],
  ])("rejects malformed target semantics: %s", (_label, override, path) => {
    const parsed = parseIssueManifest({ ...issue(), ...override }, {});
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid_value", path })]));
  });

  it.each(["baseSha", "worktreePath", "branch", "status", "deliverySet"])(
    "rejects runtime or mutable Issue field %s",
    (field) => {
      const parsed = parseIssueManifest({ ...issue(), [field]: "forbidden" }, {});
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.errors.map((error) => error.code)).toContain("unknown_field");
    },
  );

  it.each(["baseSha", "worktreePath", "branch", "delivery", "deliverySet"])(
    "rejects nested runtime or delivery target field %s",
    (field) => {
      const parsed = parseIssueManifest({
        ...issue(),
        repositories: [{ ...issue().repositories[0], [field]: { resolved: true } }],
      }, {});
      expect(parsed).toMatchObject({
        ok: false,
        errors: expect.arrayContaining([
          expect.objectContaining({ code: "unknown_field", path: `repositories[0].${field}` }),
        ]),
      });
    },
  );

  it("rejects unknown Issue version and missing identities", () => {
    expect(parseIssueManifest({ ...issue(), schema: "roll.issue/v2" }, {})).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "unknown_version", path: "schema" })]),
    });
    const { workspaceId: _workspaceId, ...withoutWorkspace } = issue();
    const { storyId: _storyId, ...withoutStory } = issue();
    expect(parseIssueManifest(withoutWorkspace, {})).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "invalid_type", path: "workspaceId" })]),
    });
    expect(parseIssueManifest(withoutStory, {})).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "invalid_type", path: "storyId" })]),
    });
  });

  it("rejects duplicate target identity and expected ID mismatches", () => {
    const duplicate = issue().repositories[0];
    const parsed = parseIssueManifest(
      { ...issue(), repositories: [duplicate, { ...duplicate }] },
      { workspaceId: "ws-other", storyId: "US-OTHER-001" },
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["duplicate_identity", "identity_mismatch"]),
    );
  });

  it.each([
    ["workspaceId", { workspaceId: "ws-other" }, "workspaceId"],
    ["storyId", { storyId: "US-OTHER-001" }, "storyId"],
  ])("rejects expected %s mismatch at its exact path", (_label, expectations, path) => {
    const parsed = parseIssueManifest(issue(), expectations);
    expect(parsed).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "identity_mismatch", path })]),
    });
  });
});
