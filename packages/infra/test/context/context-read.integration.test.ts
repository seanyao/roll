import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTEXT_PROVIDER_REGISTRY_V1,
  CONTEXT_READ_REQUEST_V1,
  REPOSITORY_BINDING_V1,
  WORKSPACE_EXECUTION_CONTEXT_V1,
  type ContextReadRequestV1,
  type WorkspaceExecutionContextV1,
} from "@roll/spec";
import { createContextReadService } from "@roll/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContextReadAdapter } from "../../src/context/context-read-adapter.js";
import { rawGit, type GitResult } from "../../src/git.js";
import type {
  GitLlmWikiCommandRunner,
  GitLlmWikiReadAuditEventV1,
} from "../../src/context/git-llm-wiki-transport.js";

const sandboxes: string[] = [];
const PUBLIC_REMOTE = "https://example.test/enterprise/context-wiki";

afterEach(() => {
  for (const root of sandboxes.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), "roll-context-read-"));
  sandboxes.push(root);
  return root;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function page(title: string, body: string): string {
  return [
    "---",
    "schema: roll.context-page/v1",
    `title: ${title}`,
    "page_type: system_runbook",
    "status: active",
    "confidence: approved",
    "updated_at: 2026-07-24",
    "scope:",
    "  workspace_ids: [roll]",
    "  repository_ids: []",
    "  environment_ids: [sit]",
    "  story_ids: []",
    "  stages: [build]",
    "sources: [raw/sources/axis.md]",
    "sensitivity: internal",
    "---",
    body,
    "",
  ].join("\n");
}

function writeWiki(source: string, version: string): void {
  mkdirSync(join(source, "wiki", "systems"), { recursive: true });
  writeFileSync(join(source, "purpose.md"), "# Purpose\n", "utf8");
  writeFileSync(join(source, "schema.md"), "# Schema\n", "utf8");
  writeFileSync(join(source, "wiki", "log.md"), `# Log\n\n${version}\n`, "utf8");
  writeFileSync(join(source, "wiki", "index.md"), `# Index\n\naxis-${version}\n`, "utf8");
  writeFileSync(join(source, "wiki", "overview.md"), page("Overview", `overview-${version}`), "utf8");
  writeFileSync(join(source, "wiki", "systems", "axis.md"), page("Axis", `axis-${version}`), "utf8");
}

function remoteFixture(root: string): { readonly source: string; readonly bare: string; revision: string } {
  const source = join(root, "source");
  const bare = join(root, "remote.git");
  mkdirSync(source, { recursive: true });
  git(source, ["init", "-q", "-b", "main"]);
  git(source, ["config", "user.email", "roll@example.test"]);
  git(source, ["config", "user.name", "Roll Test"]);
  writeWiki(source, "v1");
  git(source, ["add", "."]);
  git(source, ["commit", "-q", "-m", "v1"]);
  git(root, ["clone", "-q", "--bare", source, bare]);
  return { source, bare, revision: git(source, ["rev-parse", "HEAD"]) };
}

function advance(remote: ReturnType<typeof remoteFixture>, version: string): string {
  writeWiki(remote.source, version);
  git(remote.source, ["add", "."]);
  git(remote.source, ["commit", "-q", "-m", version]);
  git(remote.source, ["push", "-q", remote.bare, "HEAD:refs/heads/main"]);
  remote.revision = git(remote.source, ["rev-parse", "HEAD"]);
  return remote.revision;
}

function workspace(): WorkspaceExecutionContextV1 {
  return {
    schema: WORKSPACE_EXECUTION_CONTEXT_V1,
    workspace: { workspaceId: "roll", root: "/workspace/roll", canonicalRoot: "/workspace/roll", lifecycle: "active" },
    resolution: { source: "explicit", evidence: [] },
    bindings: [{
      schema: REPOSITORY_BINDING_V1,
      repoId: "repo-roll",
      alias: "primary",
      remote: "https://github.com/seanyao/roll.git",
      integrationBranch: "main",
      provider: "github",
      workflow: { branchPattern: "roll/{workspaceId}/{storyId}", requiredChecks: [] },
    }],
    contexts: {
      enabled: true,
      bindings: [{
        providerId: "enterprise-wiki",
        enabled: true,
        required: true,
        entrypoints: ["wiki/index.md", "wiki/overview.md"],
      }],
    },
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

function request(): ContextReadRequestV1 {
  return {
    schema: CONTEXT_READ_REQUEST_V1,
    workspace: workspace(),
    storyId: "US-CONTEXT-005",
    stage: "build",
    environmentIds: ["sit"],
    refs: ["context://enterprise-wiki/wiki/systems/axis.md"],
  };
}

describe("Context read integration", () => {
  it("fetches every read, pins every file to that read SHA and never falls back after a later fetch failure", async () => {
    const root = sandbox();
    const remote = remoteFixture(root);
    const firstExpectedRevision = remote.revision;
    const mutableCalls: string[][] = [];
    const timeouts: number[] = [];
    let failFetch = false;
    const runGit: GitLlmWikiCommandRunner = vi.fn(async (args, cwd, options): Promise<GitResult> => {
      mutableCalls.push([...args]);
      timeouts.push(options.timeoutMs);
      const operation = args.slice(12);
      if (operation[0] === "fetch" && failFetch) {
        return { code: 1, stdout: "", stderr: "fatal: token=secret-token fetch failed" };
      }
      const executable = [...args];
      if (operation[0] === "remote" && operation[1] === "add") {
        executable[executable.length - 1] = `file://${remote.bare}`;
      }
      if (operation[0] === "fetch") {
        executable[executable.length - 2] = `file://${remote.bare}`;
      }
      executable.splice(12, 0, "-c", "protocol.file.allow=always");
      const result = await rawGit(executable, cwd, options);
      if (operation[0] === "remote" && operation[1] === "get-url" && result.code === 0) {
        return { ...result, stdout: `${PUBLIC_REMOTE}\n` };
      }
      return result;
    });
    let clock = Date.parse("2026-07-24T06:00:00.000Z");
    const audits: GitLlmWikiReadAuditEventV1[] = [];
    const adapter = createContextReadAdapter({
      rollHome: join(root, "roll-home"),
      runGit,
      now: () => clock++,
      audit: (event) => { audits.push(event); },
    });
    const service = createContextReadService({
      registry: {
        schema: CONTEXT_PROVIDER_REGISTRY_V1,
        enabled: true,
        providers: [{
          id: "enterprise-wiki",
          type: "git_llm_wiki",
          enabled: true,
          remote: PUBLIC_REMOTE,
          branch: "main",
          fetch_timeout_seconds: 5,
        }],
      },
      adapter,
      now: () => clock++,
    });

    const first = await service.read(request());
    const secondRevision = advance(remote, "v2");
    const second = await service.read(request());
    failFetch = true;
    const failed = await service.read(request());

    expect(first).toMatchObject({ outcome: "completed", providers: [{ revision: firstExpectedRevision }] });
    expect(first.providers[0]?.revision).not.toBe(secondRevision);
    expect(second).toMatchObject({ outcome: "completed", providers: [{ revision: secondRevision }] });
    expect(second.providers[0]?.files.find((file) => file.path === "wiki/index.md")?.content).toContain("axis-v2");
    expect(second.providers[0]?.files.find((file) => file.path === "wiki/systems/axis.md")?.content).toContain("axis-v2");
    expect(JSON.stringify(second)).not.toContain("axis-v1");
    expect(failed).toMatchObject({
      outcome: "blocked",
      providers: [],
      gaps: [expect.objectContaining({ code: "fetch_failed", severity: "blocking" })],
    });
    expect(audits).toMatchObject([
      { providerId: "enterprise-wiki", branch: "main", outcome: "completed", revision: firstExpectedRevision },
      { providerId: "enterprise-wiki", branch: "main", outcome: "completed", revision: secondRevision },
      { providerId: "enterprise-wiki", branch: "main", outcome: "failed", diagnosticCode: "fetch_failed" },
    ]);
    expect(JSON.stringify(audits)).not.toMatch(/secret-token|GIT_|credential/u);
    expect(JSON.stringify(failed)).not.toMatch(/axis-v[12]|secret-token/u);

    const fetches = mutableCalls.filter((args) => args.slice(12)[0] === "fetch");
    expect(fetches).toHaveLength(3);
    const lsTrees = mutableCalls.filter((args) => args.slice(12)[0] === "ls-tree");
    expect(lsTrees.length).toBeGreaterThan(0);
    expect(lsTrees.every((args) => {
      const revision = args.slice(12)[1];
      return revision === first.providers[0]?.revision || revision === second.providers[0]?.revision;
    })).toBe(true);
    expect(lsTrees.some((args) => args.includes("HEAD"))).toBe(false);
    expect(new Set(timeouts)).toEqual(new Set([5_000]));
  });
});
