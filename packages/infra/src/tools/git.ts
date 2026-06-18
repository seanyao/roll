import type { GitResult } from "../git.js";
import { commit as gitCommit, git, push as gitPush } from "../git.js";
import type { ToolDeclaration, ToolDeps, ToolInvocation, ToolMeta, ToolResult } from "@roll/spec";

export type GitToolId = "git.commit" | "git.status" | "git.push" | "git.merge";

export interface GitCommitInput {
  cwd: string;
  message: string;
  allowEmpty?: boolean;
}

export interface GitPushInput {
  cwd: string;
  branch: string;
  remote?: string;
  setUpstream?: boolean;
}

export interface GitStatusInput {
  cwd: string;
}

export interface GitMergeInput {
  cwd: string;
  ref: string;
  ffOnly?: boolean;
  noCommit?: boolean;
}

export interface GitCommandOutput {
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitStatusOutput extends GitCommandOutput {
  clean: boolean;
}

type GitInput = GitCommitInput | GitPushInput | GitStatusInput | GitMergeInput;
type GitOutput = GitCommandOutput | GitStatusOutput;

const TITLES: Record<GitToolId, string> = {
  "git.commit": "Git Commit",
  "git.status": "Git Status",
  "git.push": "Git Push",
  "git.merge": "Git Merge",
};

export class GitTool {
  readonly declaration: ToolDeclaration;

  constructor(private readonly id: GitToolId) {
    this.declaration = {
      id: id as ToolDeclaration["id"],
      kind: "git",
      title: TITLES[id],
      description: "Run governed git operations through the Tool interface.",
      emitsEvents: id === "git.status" ? false : true,
      defaults: {
        enabled: true,
        timeoutMs: 60_000,
      },
      requirements: [{ kind: "executable", name: "git", optional: false }],
    };
  }

  async init(_deps: ToolDeps): Promise<void> {
    return undefined;
  }

  async dispose(_deps: ToolDeps): Promise<void> {
    return undefined;
  }

  async execute(invocation: ToolInvocation<GitInput>, deps: ToolDeps): Promise<ToolResult<GitOutput>> {
    const startedAt = deps.now();
    try {
      if (this.id === "git.commit") {
        const input = invocation.input as GitCommitInput;
        return ok(invocation, startedAt, deps.now(), await gitCommit(input.cwd, deps.redact(input.message), { allowEmpty: input.allowEmpty }));
      }
      if (this.id === "git.status") {
        const input = invocation.input as GitStatusInput;
        const result = await git(["status", "--short"], input.cwd);
        return {
          ok: true,
          output: { ...toOutput(result), clean: result.code === 0 && result.stdout.trim() === "" },
          meta: meta(invocation, startedAt, deps.now()),
        };
      }
      if (this.id === "git.push") {
        const input = invocation.input as GitPushInput;
        return ok(invocation, startedAt, deps.now(), await gitPush(input.cwd, input.branch, { remote: input.remote, setUpstream: input.setUpstream }));
      }
      const input = invocation.input as GitMergeInput;
      const args = ["merge", ...(input.ffOnly === true ? ["--ff-only"] : []), ...(input.noCommit === true ? ["--no-commit"] : []), input.ref];
      return ok(invocation, startedAt, deps.now(), await git(args, input.cwd));
    } catch (cause) {
      return {
        ok: false,
        error: {
          code: "adapter_error",
          message: "git execution failed",
          retryable: true,
          detail: cause,
        },
        meta: meta(invocation, startedAt, deps.now()),
      };
    }
  }
}

export function gitTools(): GitTool[] {
  return [new GitTool("git.commit"), new GitTool("git.status"), new GitTool("git.push"), new GitTool("git.merge")];
}

function ok(invocation: ToolInvocation<GitInput>, startedAt: number, endedAt: number, result: GitResult): ToolResult<GitCommandOutput> {
  return {
    ok: true,
    output: toOutput(result),
    meta: meta(invocation, startedAt, endedAt),
  };
}

function toOutput(result: GitResult): GitCommandOutput {
  return {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function meta(invocation: ToolInvocation<GitInput>, startedAt: number, endedAt: number): ToolMeta {
  return {
    invocationId: invocation.invocationId,
    toolId: invocation.toolId,
    caller: invocation.caller,
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
  };
}
