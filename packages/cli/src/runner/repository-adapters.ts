import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { ToolRegistry, type CycleContext, type ObservedCommit } from "@roll/core";
import {
  BashTool, GitTool, ghRepoSlug, infraToolExecFile, infraToolFs, prViewMergeInfo,
  prViewState, push as gitPush, redactInfraToolValue, remoteUrl,
  type BashInput, type BashOutput, type GitCommandOutput, type GitPushInput,
  type GitStatusInput, type GitStatusOutput,
} from "@roll/infra";
import type { CycleRepositoryExecutionContext, RepositoryExecutionContext, ToolDeps, ToolEvent } from "@roll/spec";
import type { RepositoryPortAdapters } from "./ports.js";
import { buildRepositoryWorkspaceExecutionContext } from "./repository-context.js";
import { createWorkspaceToolInvocationFactory } from "./tool-context-invocation.js";

const execFileAsync = promisify(execFile);

async function repositoryCommitsAhead(repository: RepositoryExecutionContext): Promise<number> {
  const result = await execFileAsync("git", ["rev-list", "--count", `${repository.baseSha}..HEAD`], {
    cwd: repository.worktreePath, encoding: "utf8",
  });
  const count = Number(result.stdout.trim());
  if (!Number.isInteger(count) || count < 0) throw new Error("invalid commits-ahead result");
  return count;
}

async function repositoryTcrCount(repository: RepositoryExecutionContext): Promise<number> {
  const result = await execFileAsync("git", ["log", "--oneline", `${repository.baseSha}..HEAD`], {
    cwd: repository.worktreePath, encoding: "utf8",
  });
  return result.stdout.split("\n").filter((line) => line.includes(" tcr:")).length;
}

async function repositoryRecentCommits(repository: RepositoryExecutionContext): Promise<ObservedCommit[]> {
  const result = await execFileAsync("git", ["log", "--reverse", "--format=%H%x09%ct%x09%s", `${repository.baseSha}..HEAD`], {
    cwd: repository.worktreePath, encoding: "utf8",
  });
  return result.stdout.split("\n").flatMap((line) => {
    if (line.trim() === "") return [];
    const [hash, rawTs, ...message] = line.split("\t");
    if (hash === undefined || hash === "") throw new Error("invalid recent-commit result");
    const tsSec = Number(rawTs ?? "0");
    if (!Number.isFinite(tsSec)) throw new Error("invalid recent-commit timestamp");
    return [{ hash, message: message.join("\t"), tsSec }];
  });
}

async function repositoryDirty(repository: RepositoryExecutionContext): Promise<boolean> {
  const result = await execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: repository.worktreePath, encoding: "utf8",
  });
  return result.stdout.trim() !== "";
}

export async function repositoryHeadSha(repository: RepositoryExecutionContext): Promise<string> {
  const result = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repository.worktreePath, encoding: "utf8" });
  const head = result.stdout.trim();
  if (!/^[0-9a-f]{40,64}$/u.test(head)) throw new Error("invalid repository head");
  return head;
}

function commandFailure(error: unknown): { readonly exitCode: number; readonly stdout: string; readonly stderr: string } | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record["code"] !== "number") return undefined;
  return {
    exitCode: record["code"],
    stdout: typeof record["stdout"] === "string" ? record["stdout"] : "",
    stderr: typeof record["stderr"] === "string" ? record["stderr"] : "",
  };
}

async function runRepositoryCommand(cwd: string, command: readonly string[], env: Readonly<Record<string, string>>) {
  const [executable, ...args] = command;
  if (executable === undefined || executable.trim() === "") throw new Error("empty_repository_verification_command");
  try {
    const result = await execFileAsync(executable, args, {
      cwd, encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 10 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = commandFailure(error);
    if (failure !== undefined) return failure;
    throw error;
  }
}

interface RepositoryToolRuntime {
  dirty(repository: RepositoryExecutionContext): Promise<boolean>;
  push(repository: RepositoryExecutionContext, branch: string): Promise<{ code: number }>;
  runRepository(repository: RepositoryExecutionContext, command: readonly string[], env: Readonly<Record<string, string>>): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  runIntegration(execution: CycleRepositoryExecutionContext, command: readonly string[], env: Readonly<Record<string, string>>): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

function createRepositoryToolRuntime(ctx: CycleContext): RepositoryToolRuntime {
  const execution = ctx.repositoryExecution;
  const storyId = ctx.storyId;
  if (execution === undefined || storyId === undefined || storyId === "") throw new Error("missing_repository_context");
  const workspaceRoot = dirname(dirname(execution.issueRoot));
  const requests = createWorkspaceToolInvocationFactory({
    cycleId: ctx.cycleId, storyId,
    workspace: buildRepositoryWorkspaceExecutionContext(workspaceRoot, storyId, execution),
    ...(ctx.agent === undefined ? {} : { agent: ctx.agent }),
  });
  const deps: ToolDeps = { fs: infraToolFs, execFile: infraToolExecFile, now: () => Date.now(), redact: redactInfraToolValue };
  const registry = new ToolRegistry({
    deps,
    policyEngine: {
      resolve(_toolId, defaults) {
        return {
          enabled: defaults?.enabled ?? true,
          ...(defaults?.timeoutMs === undefined ? {} : { timeoutMs: defaults.timeoutMs }),
          ...(defaults?.retry === undefined ? {} : { retry: defaults.retry }),
          ...(defaults?.sandbox === undefined ? {} : { sandbox: defaults.sandbox }),
          ...(defaults?.maxInvocationsPerCycle === undefined ? {} : { maxInvocationsPerCycle: defaults.maxInvocationsPerCycle }),
        };
      },
    },
    events: {
      emit(event: ToolEvent) {
        mkdirSync(requests.context.authorities.events, { recursive: true });
        appendFileSync(join(requests.context.authorities.events, "tools.ndjson"), `${JSON.stringify(event)}\n`, "utf8");
      },
    },
  });
  registry.register(new BashTool());
  registry.register(new GitTool("git.status"));
  registry.register(new GitTool("git.push"));
  let invocation = 0;
  const invocationId = (toolId: string): string => `${ctx.cycleId}:${toolId}:${++invocation}`;
  const runRepository = async (repository: RepositoryExecutionContext, command: readonly string[], env: Readonly<Record<string, string>>) => {
    const [executable, ...args] = command;
    if (executable === undefined || executable.trim() === "") throw new Error("empty_repository_verification_command");
    const result = await registry.invoke<BashInput, BashOutput>("bash", requests.request({
      invocationId: invocationId("bash"), repoId: repository.repoId,
      input: { command: executable, args, cwd: repository.worktreePath, env: { ...env } },
    }));
    if (!result.ok) throw new Error(`repository_tool_failed: ${result.error.code}`);
    return { exitCode: result.output.exitCode, stdout: result.output.stdout, stderr: result.output.stderr };
  };
  return {
    async dirty(repository) {
      const result = await registry.invoke<GitStatusInput, GitStatusOutput>("git.status", requests.request({
        invocationId: invocationId("git.status"), repoId: repository.repoId, input: { cwd: repository.worktreePath },
      }));
      if (!result.ok) throw new Error(`repository_tool_failed: ${result.error.code}`);
      return !result.output.clean;
    },
    async push(repository, branch) {
      const result = await registry.invoke<GitPushInput, GitCommandOutput>("git.push", requests.request({
        invocationId: invocationId("git.push"), repoId: repository.repoId,
        input: { cwd: repository.worktreePath, branch },
      }));
      if (!result.ok) throw new Error(`repository_tool_failed: ${result.error.code}`);
      return { code: result.output.code };
    },
    runRepository,
    async runIntegration(boundExecution, command, env) {
      const writable = Object.values(boundExecution.repositories).filter((repository) => repository.access === "write");
      if (writable.length !== 1 || writable[0] === undefined) {
        throw new Error("missing_execution_context: integration verification requires a unique writable repository");
      }
      return runRepository(writable[0], command, env);
    },
  };
}

export function defaultRepositoryAdapters(ctx?: CycleContext): RepositoryPortAdapters {
  const tools = ctx === undefined ? undefined : createRepositoryToolRuntime(ctx);
  return {
    git: {
      commitsAhead: repositoryCommitsAhead, tcrCount: repositoryTcrCount,
      recentCommits: repositoryRecentCommits, dirty: tools?.dirty ?? repositoryDirty,
      headSha: repositoryHeadSha,
      push: tools?.push ?? ((repository, branch) => gitPush(repository.worktreePath, branch)),
    },
    verification: {
      runRepository: tools?.runRepository ?? ((repository, command, env) => runRepositoryCommand(repository.worktreePath, command, env)),
      runIntegration: tools?.runIntegration ?? ((execution, command, env) => runRepositoryCommand(execution.issueRoot, command, env)),
    },
    provider: {
      async repoSlug(repository) { return ghRepoSlug(await remoteUrl(repository.worktreePath)); },
      async prState(repository, branch) {
        const slug = ghRepoSlug(await remoteUrl(repository.worktreePath));
        return slug === undefined ? "UNKNOWN" : prViewState(slug, branch);
      },
      async prMergeInfo(repository, branch) {
        const slug = ghRepoSlug(await remoteUrl(repository.worktreePath));
        return slug === undefined ? undefined : prViewMergeInfo(slug, branch);
      },
    },
  };
}

export function productionRepositoryAdapters(ctx: CycleContext): RepositoryPortAdapters {
  return defaultRepositoryAdapters(ctx);
}
