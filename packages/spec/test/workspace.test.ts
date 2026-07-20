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
    expect(https).toMatchObject({ ok: true, value: expect.stringMatching(/^repo-[0-9a-f]{12}$/u) });
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
  ])("rejects ambiguous or credential-bearing remote input without echoing it: %s", (input) => {
    const result = normalizeRepositoryRemote(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((error) => error.path === "remote")).toBe(true);
    expect(JSON.stringify(result.errors)).not.toContain("token");
    expect(JSON.stringify(result.errors)).not.toContain("secret");
  });
});

describe("RepositoryBinding and WorkspaceManifest", () => {
  it("publishes closed schemas at every object boundary", () => {
    expect(repositoryBindingV1Schema).toMatchObject({ type: "object", additionalProperties: false });
    expect(workspaceManifestV1Schema).toMatchObject({ type: "object", additionalProperties: false });
    const workspaceProperties = (workspaceManifestV1Schema as { properties: Record<string, unknown> }).properties;
    expect(workspaceProperties.repositories).toMatchObject({ type: "array" });
  });

  it("parses and canonicalizes a complete repository binding", () => {
    const parsed = parseRepositoryBinding(repository());
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        schema: REPOSITORY_BINDING_V1,
        alias: "product",
        remote: "https://github.com/Owner/Repo",
        integrationBranch: "main",
        provider: "github",
      },
    });
  });

  it("round-trips a valid Workspace manifest and enforces expected identity", () => {
    const parsed = parseWorkspaceManifest(JSON.parse(JSON.stringify(workspace())), {
      workspaceId: "ws-sot-platform",
    });
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        schema: WORKSPACE_MANIFEST_V1,
        workspaceId: "ws-sot-platform",
        requirements: [{ provider: "jira", ref: "SOT-15499" }],
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
    ["read delivery", { repositories: [{ ...issue().repositories[1], requiredDelivery: true }] }],
    ["write policy", { repositories: [{ ...issue().repositories[0], noChangePolicy: undefined }] }],
    ["absolute path", { repositories: [{ ...issue().repositories[0], pathScope: ["/packages/spec"] }] }],
    ["Windows absolute path", { repositories: [{ ...issue().repositories[0], pathScope: ["C:/packages/spec"] }] }],
    ["traversal path", { repositories: [{ ...issue().repositories[0], pathScope: ["packages/../infra"] }] }],
    ["backslash path", { repositories: [{ ...issue().repositories[0], pathScope: ["packages\\spec"] }] }],
    ["unknown dependency", { repositories: [{ ...issue().repositories[0], dependsOnRepo: "missing" }] }],
  ])("rejects malformed target semantics: %s", (_label, override) => {
    const parsed = parseIssueManifest({ ...issue(), ...override }, {});
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.length).toBeGreaterThan(0);
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
});
