import type { GitResult } from "../git.js";
import { rawGit } from "../git.js";
import type { ToolDeclaration, ToolDeps, ToolInvocation, ToolJsonSchema, ToolMeta, ToolResult } from "@roll/spec";

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

function gitInputSchema(id: GitToolId): ToolJsonSchema {
  if (id === "git.commit") {
    return {
      type: "object",
      required: ["cwd", "message"],
      properties: {
        cwd: { type: "string", description: "Repository working directory" },
        message: { type: "string", description: "Commit message" },
        allowEmpty: { type: "boolean", description: "Allow empty commit (--allow-empty)" },
      },
    };
  }
  if (id === "git.status") {
    return {
      type: "object",
      required: ["cwd"],
      properties: {
        cwd: { type: "string", description: "Repository working directory" },
      },
    };
  }
  if (id === "git.push") {
    return {
      type: "object",
      required: ["cwd", "branch"],
      properties: {
        cwd: { type: "string", description: "Repository working directory" },
        branch: { type: "string", description: "Branch to push" },
        remote: { type: "string", description: "Remote name (default: origin)" },
        setUpstream: { type: "boolean", description: "Set upstream tracking (-u)" },
      },
    };
  }
  return {
    type: "object",
    required: ["cwd", "ref"],
    properties: {
      cwd: { type: "string", description: "Repository working directory" },
      ref: { type: "string", description: "Reference to merge (branch/tag/commit)" },
      ffOnly: { type: "boolean", description: "Fast-forward only (--ff-only)" },
      noCommit: { type: "boolean", description: "Merge without committing (--no-commit)" },
    },
  };
}

function gitOutputSchema(id: GitToolId): ToolJsonSchema {
  if (id === "git.status") {
    return {
      type: "object",
      required: ["code", "stdout", "stderr", "clean"],
      properties: {
        code: { type: "integer", description: "Exit code" },
        stdout: { type: "string", description: "Standard output" },
        stderr: { type: "string", description: "Standard error" },
        clean: { type: "boolean", description: "Whether the working tree is clean" },
      },
    };
  }
  return {
    type: "object",
    required: ["code", "stdout", "stderr"],
    properties: {
      code: { type: "integer", description: "Exit code" },
      stdout: { type: "string", description: "Standard output" },
      stderr: { type: "string", description: "Standard error" },
    },
  };
}

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
      inputSchema: gitInputSchema(id),
      outputSchema: gitOutputSchema(id),
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
        const args = ["commit", "-m", deps.redact(input.message)];
        if (input.allowEmpty === true) args.splice(1, 0, "--allow-empty");
        return ok(invocation, startedAt, deps.now(), await rawGit(args, input.cwd));
      }
      if (this.id === "git.status") {
        const input = invocation.input as GitStatusInput;
        const result = await rawGit(["status", "--short"], input.cwd);
        return {
          ok: true,
          output: { ...toOutput(result), clean: result.code === 0 && result.stdout.trim() === "" },
          meta: meta(invocation, startedAt, deps.now()),
        };
      }
      if (this.id === "git.push") {
        const input = invocation.input as GitPushInput;
        const remote = input.remote ?? "origin";
        const args = input.setUpstream === true ? ["push", "-u", remote, input.branch] : ["push", remote, input.branch];
        return ok(invocation, startedAt, deps.now(), await rawGit(args, input.cwd));
      }
      const input = invocation.input as GitMergeInput;
      const args = ["merge", ...(input.ffOnly === true ? ["--ff-only"] : []), ...(input.noCommit === true ? ["--no-commit"] : []), input.ref];
      return ok(invocation, startedAt, deps.now(), await rawGit(args, input.cwd));
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
