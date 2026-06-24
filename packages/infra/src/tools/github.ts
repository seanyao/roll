import type { ToolDeclaration, ToolDeps, ToolInvocation, ToolJsonSchema, ToolMeta, ToolResult } from "@roll/spec";
import { rawGh, type PrMergeMode } from "../github.js";

export type GitHubToolId = "github.pr" | "github.ci";

export type GitHubPrInput =
  | {
      action: "create";
      slug: string;
      head: string;
      title: string;
      body: string;
      base?: string;
    }
  | {
      action: "status";
      slug: string;
      ref: string;
    }
  | {
      action: "merge";
      slug: string;
      ref: string;
      mode?: PrMergeMode;
    };

export interface GitHubPrCreateOutput {
  prUrl: string;
  prNumber: string;
}

export interface GitHubPrStatusOutput {
  state: string;
}

export interface GitHubCommandOutput {
  code: number;
  stdout: string;
  stderr: string;
}

export type GitHubCiInput =
  | {
      action: "status";
      slug: string;
      commit: string;
    }
  | {
      action: "rerun";
      slug: string;
      runId: string;
    };

export interface GitHubCiOutput {
  state: "pass" | "fail" | "pending";
  runs: Array<{ status?: string; conclusion?: string | null }>;
}

type GitHubInput = GitHubPrInput | GitHubCiInput;
type GitHubOutput = GitHubPrCreateOutput | GitHubPrStatusOutput | GitHubCommandOutput | GitHubCiOutput;

const TITLES: Record<GitHubToolId, string> = {
  "github.pr": "GitHub PR",
  "github.ci": "GitHub CI",
};

function githubInputSchema(id: GitHubToolId): ToolJsonSchema {
  if (id === "github.pr") {
    return {
      type: "object",
      required: ["action", "slug"],
      properties: {
        action: { type: "string", enum: ["create", "status", "merge"], description: "PR action to perform" },
        slug: { type: "string", description: "Repository slug (owner/repo)" },
        head: { type: "string", description: "[create] Head branch" },
        title: { type: "string", description: "[create] PR title" },
        body: { type: "string", description: "[create] PR body" },
        base: { type: "string", description: "[create] Base branch (default: main)" },
        ref: { type: "string", description: "[status/merge] PR reference (branch or number)" },
        mode: { type: "string", enum: ["plain", "auto", "admin"], description: "[merge] Merge mode" },
      },
    };
  }
  return {
    type: "object",
    required: ["action", "slug"],
    properties: {
      action: { type: "string", enum: ["status", "rerun"], description: "CI action to perform" },
      slug: { type: "string", description: "Repository slug (owner/repo)" },
      commit: { type: "string", description: "[status] Commit SHA" },
      runId: { type: "string", description: "[rerun] Run ID to re-run" },
    },
  };
}

function githubOutputSchema(id: GitHubToolId): ToolJsonSchema {
  if (id === "github.pr") {
    return {
      type: "object",
      required: [],
      additionalProperties: true,
      description: "Varies by action: create→{prUrl,prNumber}, status→{state}, merge→{code,stdout,stderr}",
    };
  }
  return {
    type: "object",
    required: ["state", "runs"],
    properties: {
      state: { type: "string", enum: ["pass", "fail", "pending"], description: "Overall CI state" },
      runs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
        },
        description: "CI run records (status, conclusion)",
      },
    },
  };
}

export class GitHubTool {
  readonly declaration: ToolDeclaration;

  constructor(private readonly id: GitHubToolId) {
    this.declaration = {
      id: id as ToolDeclaration["id"],
      kind: "github",
      title: TITLES[id],
      description: "Run governed GitHub operations through the Tool interface.",
      defaults: {
        enabled: true,
        timeoutMs: 60_000,
      },
      requirements: [{ kind: "executable", name: "gh", optional: false }],
      inputSchema: githubInputSchema(id),
      outputSchema: githubOutputSchema(id),
    };
  }

  async init(_deps: ToolDeps): Promise<void> {
    return undefined;
  }

  async dispose(_deps: ToolDeps): Promise<void> {
    return undefined;
  }

  async execute(invocation: ToolInvocation<GitHubInput>, deps: ToolDeps): Promise<ToolResult<GitHubOutput>> {
    const startedAt = deps.now();
    try {
      if (this.id === "github.pr") {
        return await this.executePr(invocation as ToolInvocation<GitHubPrInput>, deps, startedAt);
      }
      return await this.executeCi(invocation as ToolInvocation<GitHubCiInput>, deps, startedAt);
    } catch (cause) {
      return failure(invocation, startedAt, deps.now(), "github execution failed", true, cause);
    }
  }

  private async executePr(invocation: ToolInvocation<GitHubPrInput>, deps: ToolDeps, startedAt: number): Promise<ToolResult<GitHubOutput>> {
    const input = invocation.input;
    if (input.action === "create") {
      const result = await rawGh([
        "-R", input.slug, "pr", "create",
        "--base", input.base ?? "main", "--head", input.head,
        "--title", deps.redact(input.title), "--body", deps.redact(input.body),
      ]);
      if (result.code !== 0) return ghFailure(invocation, startedAt, deps.now(), result);
      const prUrl = result.stdout.trim();
      if (prUrl === "") return failure(invocation, startedAt, deps.now(), "github pr create failed", true);
      const prNumber = prUrl.split("/").filter(Boolean).at(-1) ?? "";
      return ok(invocation, startedAt, deps.now(), { prUrl, prNumber });
    }

    if (input.action === "status") {
      const result = await rawGh(["-R", input.slug, "pr", "view", input.ref, "--json", "state", "-q", ".state"]);
      if (result.code !== 0) return ghFailure(invocation, startedAt, deps.now(), result);
      const state = result.stdout.trim() === "" ? "UNKNOWN" : result.stdout.trim();
      return ok(invocation, startedAt, deps.now(), { state });
    }

    const mode = input.mode ?? "plain";
    const flags = mode === "auto" ? ["--auto"] : mode === "admin" ? ["--admin"] : [];
    const result = await rawGh(["-R", input.slug, "pr", "merge", input.ref, ...flags, "--squash", "--delete-branch"]);
    return ok(invocation, startedAt, deps.now(), toOutput(result));
  }

  private async executeCi(invocation: ToolInvocation<GitHubCiInput>, deps: ToolDeps, startedAt: number): Promise<ToolResult<GitHubOutput>> {
    const input = invocation.input;
    if (input.action === "status") {
      const result = await rawGh(["-R", input.slug, "run", "list", "--commit", input.commit, "--json", "status,conclusion"]);
      const runs = result.code === 0 ? parseRunRows(result.stdout) : [];
      return ok(invocation, startedAt, deps.now(), { state: ciState(runs), runs });
    }

    const result = await rawGh(["-R", input.slug, "run", "rerun", input.runId]);
    if (result.code !== 0) return ghFailure(invocation, startedAt, deps.now(), result);
    return ok(invocation, startedAt, deps.now(), toOutput(result));
  }
}

export function githubTools(): GitHubTool[] {
  return [new GitHubTool("github.pr"), new GitHubTool("github.ci")];
}

function ciState(runs: Array<{ status?: string; conclusion?: string | null }>): GitHubCiOutput["state"] {
  if (runs.some((run) => run.status === "completed" && run.conclusion === "success")) return "pass";
  if (runs.some((run) => run.status === "completed" && run.conclusion !== "success")) return "fail";
  return "pending";
}

function parseRunRows(stdout: string): Array<{ status?: string; conclusion?: string | null }> {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is { status?: unknown; conclusion?: unknown } => typeof row === "object" && row !== null)
      .map((row) => ({
        ...(typeof row.status === "string" ? { status: row.status } : {}),
        ...(typeof row.conclusion === "string" || row.conclusion === null ? { conclusion: row.conclusion } : {}),
      }));
  } catch {
    return [];
  }
}

function ok(invocation: ToolInvocation<GitHubInput>, startedAt: number, endedAt: number, output: GitHubOutput): ToolResult<GitHubOutput> {
  return {
    ok: true,
    output,
    meta: meta(invocation, startedAt, endedAt),
  };
}

function ghFailure(invocation: ToolInvocation<GitHubInput>, startedAt: number, endedAt: number, result: GitHubCommandOutput): ToolResult<never> {
  const text = `${result.stderr}\n${result.stdout}`.trim();
  return failure(invocation, startedAt, endedAt, text === "" ? "github command failed" : text, isRateLimit(text), result);
}

function failure(
  invocation: ToolInvocation<GitHubInput>,
  startedAt: number,
  endedAt: number,
  message: string,
  retryable: boolean,
  detail?: unknown,
): ToolResult<never> {
  return {
    ok: false,
    error: {
      code: "adapter_error",
      message,
      retryable,
      detail,
    },
    meta: meta(invocation, startedAt, endedAt),
  };
}

function isRateLimit(text: string): boolean {
  return /rate limit/i.test(text);
}

function toOutput(result: GitHubCommandOutput): GitHubCommandOutput {
  return {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function meta(invocation: ToolInvocation<GitHubInput>, startedAt: number, endedAt: number): ToolMeta {
  return {
    invocationId: invocation.invocationId,
    toolId: invocation.toolId,
    caller: invocation.caller,
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
  };
}
