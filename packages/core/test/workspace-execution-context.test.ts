import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ISSUE_MANIFEST_V1,
  REPOSITORY_BINDING_V1,
  WORKSPACE_EXECUTION_CONTEXT_V1,
  WORKSPACE_MANIFEST_V1,
  type CycleRepositoryExecutionContext,
  type IssueManifest,
  type RepositoryBinding,
  type WorkspaceExecutionAuthorityPaths,
  type WorkspaceMatchEvidence,
} from "@roll/spec";
import {
  buildWorkspaceExecutionContext,
  deriveWorkspaceExecutionAuthorities,
  resolveWorkspaceExecutionContextScope,
  type WorkspaceExecutionContextFactsV1,
  type WorkspaceRegistryCandidate,
} from "../src/index.js";

const sha = (value: string): string => value.repeat(40).slice(0, 40);

function binding(alias = "product", repoId = "repo-product"): RepositoryBinding {
  return {
    schema: REPOSITORY_BINDING_V1,
    repoId,
    alias,
    remote: `ssh://github.test/acme/${alias}`,
    integrationBranch: "idea-074-workspace",
    provider: "github",
    workflow: {
      branchPattern: "roll/{workspace_id}/{story_id}/{repo_alias}",
      requiredChecks: ["test", "lint"],
    },
  };
}

function issueManifest(bindings: readonly RepositoryBinding[]): IssueManifest {
  return {
    schema: ISSUE_MANIFEST_V1,
    workspaceId: "ws-demo",
    storyId: "US-WS-031",
    requirements: [],
    repositories: bindings.map((entry, index) => index === 0
      ? {
          repoId: entry.repoId,
          alias: entry.alias,
          access: "write" as const,
          requiredDelivery: true,
          noChangePolicy: "changes_required" as const,
        }
      : {
          repoId: entry.repoId,
          alias: entry.alias,
          access: "read" as const,
          requiredDelivery: false,
        }),
    integrationAcceptance: { command: ["pnpm", "test:integration"] },
  };
}

function execution(root: string, manifest: IssueManifest): CycleRepositoryExecutionContext {
  const issueRoot = join(root, "issues", manifest.storyId);
  return {
    workspaceId: manifest.workspaceId,
    issueRoot,
    repositories: Object.fromEntries(manifest.repositories.map((target, index) => [
      target.repoId,
      {
        repoId: target.repoId,
        alias: target.alias,
        access: target.access,
        requiredDelivery: target.requiredDelivery,
        ...(target.access === "write" ? { noChangePolicy: target.noChangePolicy } : {}),
        ...(target.dependsOnRepo === undefined ? {} : { dependsOnRepo: target.dependsOnRepo }),
        worktreePath: join(issueRoot, target.alias),
        baseSha: sha(String(index + 1)),
        headSha: sha(String(index + 2)),
        commands: { test: ["pnpm", "test"], integration: ["pnpm", "test:integration"] },
      },
    ])),
  };
}

function facts(options: {
  readonly bindings?: readonly RepositoryBinding[];
  readonly lifecycle?: WorkspaceRegistryCandidate["lifecycle"];
  readonly includeIssue?: boolean;
  readonly authorities?: WorkspaceExecutionAuthorityPaths;
} = {}): WorkspaceExecutionContextFactsV1 {
  const root = "/authority/workspaces/ws-demo";
  const bindings = options.bindings ?? [binding()];
  const manifest = issueManifest(bindings);
  return {
    candidate: {
      workspaceId: "ws-demo",
      root,
      canonicalRoot: root,
      manifestWorkspaceId: "ws-demo",
      pathState: "valid",
      lifecycle: options.lifecycle ?? "active",
    },
    manifest: {
      schema: WORKSPACE_MANIFEST_V1,
      workspaceId: "ws-demo",
      displayName: "Demo",
      requirements: [],
      repositories: bindings,
    },
    authorities: options.authorities ?? deriveWorkspaceExecutionAuthorities(root),
    ...(options.includeIssue === false ? {} : {
      issue: {
        manifest,
        manifestPath: join(root, "issues", manifest.storyId, "manifest.json"),
        execution: execution(root, manifest),
      },
    }),
  };
}

const evidence: readonly WorkspaceMatchEvidence[] = [{
  kind: "requirement_source_exact",
  value: "jira:APE-234",
  hard: true,
  score: 100,
  source: "jira:APE-234",
  provenance: "explicit_user",
  detail: "exact",
}];

describe("buildWorkspaceExecutionContext", () => {
  it("builds one frozen serializable authority snapshot without retaining mutable inputs", () => {
    const input = facts();
    const result = buildWorkspaceExecutionContext({ facts: input, source: "explicit", evidence });

    expect(result).toMatchObject({ ok: true, context: { schema: WORKSPACE_EXECUTION_CONTEXT_V1 } });
    if (!result.ok) throw new Error(result.error.code);
    const serialized = JSON.stringify(result.context);
    expect(Object.isFrozen(result.context)).toBe(true);
    expect(Object.isFrozen(result.context.authorities)).toBe(true);
    expect(Object.isFrozen(result.context.issue?.execution.repositories)).toBe(true);
    expect(result.context.bindings[0]?.workflow.requiredChecks).toEqual(["test", "lint"]);

    (input.manifest.repositories[0]?.workflow.requiredChecks as string[]).push("changed-after-build");
    expect(JSON.stringify(result.context)).toBe(serialized);
  });

  it("preserves the complete multi-repository execution contract", () => {
    const result = buildWorkspaceExecutionContext({
      facts: facts({ bindings: [binding("product", "repo-product"), binding("skills", "repo-skills")] }),
      source: "requirement_discovery",
      evidence,
    });

    expect(result).toMatchObject({
      ok: true,
      context: {
        bindings: [
          { repoId: "repo-product", workflow: { requiredChecks: ["test", "lint"] } },
          { repoId: "repo-skills", workflow: { requiredChecks: ["test", "lint"] } },
        ],
        issue: {
          execution: {
            repositories: {
              "repo-product": {
                access: "write",
                requiredDelivery: true,
                noChangePolicy: "changes_required",
                baseSha: sha("1"),
                headSha: sha("2"),
                commands: { test: ["pnpm", "test"], integration: ["pnpm", "test:integration"] },
              },
              "repo-skills": {
                access: "read",
                requiredDelivery: false,
                baseSha: sha("2"),
                headSha: sha("3"),
              },
            },
          },
        },
      },
    });
  });

  it.each([
    ["manifest identity", () => ({ ...facts(), manifest: { ...facts().manifest, workspaceId: "other" } }), "workspace_identity_mismatch"],
    ["Issue identity", () => {
      const value = facts();
      return { ...value, issue: value.issue === undefined ? undefined : { ...value.issue, manifest: { ...value.issue.manifest, workspaceId: "other" } } };
    }, "issue_identity_mismatch"],
    ["authority path", () => ({ ...facts(), authorities: { ...facts().authorities, backlog: "/tmp/backlog.md" } }), "authority_path_mismatch"],
  ])("fails closed on %s mismatch", (_name, makeFacts, code) => {
    expect(buildWorkspaceExecutionContext({ facts: makeFacts(), source: "explicit", evidence })).toMatchObject({
      ok: false,
      error: { code },
    });
  });
});

describe("resolveWorkspaceExecutionContextScope", () => {
  it("keeps machine, optional read, and legacy migration explicitly context-free", () => {
    for (const scope of ["machine_only", "workspace_optional_read", "legacy_migration_only"] as const) {
      expect(resolveWorkspaceExecutionContextScope({ scope, context: undefined })).toEqual({
        ok: true,
        context: undefined,
      });
    }
    for (const scope of [
      "workspace_required_read",
      "workspace_required_mutation",
      "issue_required",
      "repository_required",
    ] as const) {
      expect(resolveWorkspaceExecutionContextScope({ scope, context: undefined })).toMatchObject({
        ok: false,
        error: { code: "missing_execution_context" },
      });
    }
  });

  it("revalidates an externally supplied context before applying scope policy", () => {
    const built = buildWorkspaceExecutionContext({ facts: facts(), source: "explicit", evidence });
    if (!built.ok) throw new Error("fixture failed");
    const forgedSchema = { ...built.context, schema: "roll.workspace-execution-context/v0" } as unknown as typeof built.context;
    const forgedAuthority = {
      ...built.context,
      authorities: { ...built.context.authorities, policy: "/tmp/policy.yaml" },
    };

    expect(resolveWorkspaceExecutionContextScope({ scope: "workspace_required_read", context: forgedSchema })).toMatchObject({
      ok: false,
      error: { code: "invalid_execution_context" },
    });
    expect(resolveWorkspaceExecutionContextScope({ scope: "workspace_required_read", context: forgedAuthority })).toMatchObject({
      ok: false,
      error: { code: "authority_path_mismatch" },
    });
  });

  it("enforces lifecycle and Issue/repository requirements without fabricating empty objects", () => {
    const paused = buildWorkspaceExecutionContext({ facts: facts({ lifecycle: "paused" }), source: "explicit", evidence });
    const noIssue = buildWorkspaceExecutionContext({ facts: facts({ includeIssue: false }), source: "explicit", evidence });
    if (!paused.ok || !noIssue.ok) throw new Error("fixture failed");

    expect(resolveWorkspaceExecutionContextScope({ scope: "workspace_required_read", context: paused.context })).toMatchObject({ ok: true });
    expect(resolveWorkspaceExecutionContextScope({ scope: "workspace_required_mutation", context: paused.context })).toMatchObject({
      ok: false,
      error: { code: "workspace_lifecycle_forbidden" },
    });
    expect(resolveWorkspaceExecutionContextScope({ scope: "issue_required", context: noIssue.context })).toMatchObject({
      ok: false,
      error: { code: "missing_issue_context" },
    });
    expect(resolveWorkspaceExecutionContextScope({ scope: "repository_required", context: noIssue.context })).toMatchObject({
      ok: false,
      error: { code: "missing_repository_context" },
    });
  });
});
