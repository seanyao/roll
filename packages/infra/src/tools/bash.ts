import { join } from "node:path";
import type { ExecResult, ToolDeclaration, ToolDeps, ToolInvocation, ToolMeta, ToolResult } from "@roll/spec";
import { bashInputSchema, bashOutputSchema } from "./schema-contracts.js";
import { isCanonicalPathContained, resolveContainedExistingPath, resolveWorkspaceLocalRepository } from "./workspace-local-context.js";

export interface BashInput {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface BashOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const BASH_TOOL_ID = "bash" as ToolDeclaration["id"];

export class BashTool {
  readonly declaration: ToolDeclaration = {
    id: BASH_TOOL_ID,
    kind: "bash",
    title: "Bash",
    description: "Execute argv-only shell commands through the governed tool path.",
    defaults: {
      enabled: true,
      timeoutMs: 30_000,
      sandbox: {
        maxOutputBytes: 64 * 1024,
      },
    },
    requirements: [{ kind: "executable", name: "system-shell", optional: false }],
    inputSchema: bashInputSchema,
    outputSchema: bashOutputSchema,
  };

  async init(_deps: ToolDeps): Promise<void> {
    return undefined;
  }

  async dispose(_deps: ToolDeps): Promise<void> {
    return undefined;
  }

  async execute(invocation: ToolInvocation<BashInput>, deps: ToolDeps): Promise<ToolResult<BashOutput>> {
    const startedAt = deps.now();
    const input = invocation.input;
    const repository = resolveWorkspaceLocalRepository(invocation, "write");
    if (!repository.ok) return contextFailure(invocation, startedAt, deps.now(), repository.code, repository.message);
    const boundInvocation = invocation.repoId === undefined
      ? { ...invocation, repoId: repository.repository.repoId }
      : invocation;
    const cwd = input.cwd === undefined
      ? repository.canonicalWorktreePath
      : resolveContainedExistingPath(repository.canonicalWorktreePath, input.cwd);
    if (cwd === undefined) {
      return contextFailure(boundInvocation, startedAt, deps.now(), "invalid_execution_context", "bash cwd is outside the selected Issue repository");
    }
    const warnings = advisoryWarnings(input.command, invocation.policy.sandbox?.blockedCommands);
    const allowResult = allowed(cwd, repository.canonicalWorktreePath, invocation.policy.sandbox?.allowedPaths);
    if (!allowResult.ok) {
      return {
        ok: false,
        error: {
          code: "sandbox_denied",
          message: "bash cwd is outside allowedPaths",
          retryable: false,
        },
        meta: meta(boundInvocation, startedAt, deps.now()),
        warnings,
      };
    }

    const maxOutputBytes = invocation.policy.sandbox?.maxOutputBytes;
    const timeoutMs = timeoutFor(invocation);
    const command = deps.redact(input.command);
    const args = (input.args ?? []).map((arg) => deps.redact(arg));
    const env = redactEnv(input.env, deps);

    let execResult: ExecResult;
    try {
      execResult = await deps.execFile(command, args, {
        cwd,
        env,
        timeoutMs,
        maxOutputBytes,
      });
    } catch {
      return {
        ok: false,
        error: {
          code: "adapter_error",
          message: "bash execution failed",
          retryable: true,
        },
        meta: meta(boundInvocation, startedAt, deps.now()),
        warnings,
      };
    }

    const output: BashOutput = {
      exitCode: execResult.exitCode,
      stdout: redactAndTruncate(execResult.stdout, deps, maxOutputBytes),
      stderr: redactAndTruncate(execResult.stderr, deps, maxOutputBytes),
      timedOut: execResult.timedOut,
    };
    await writeDump(boundInvocation, output, deps);

    if (execResult.timedOut) {
      return {
        ok: false,
        error: {
          code: "timeout",
          message: "bash execution timed out",
          retryable: true,
          detail: execResult.signal,
        },
        meta: meta(boundInvocation, startedAt, deps.now()),
        warnings,
      };
    }

    return {
      ok: true,
      output,
      meta: meta(boundInvocation, startedAt, deps.now()),
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}

function timeoutFor(invocation: ToolInvocation<BashInput>): number | undefined {
  const hard = invocation.policy.sandbox?.hardTimeoutSec;
  if (hard !== undefined) return hard * 1000;
  return invocation.policy.timeoutMs;
}

function allowed(cwd: string, repositoryRoot: string, allowedPaths: readonly string[] | undefined): { ok: true } | { ok: false } {
  if (allowedPaths === undefined || allowedPaths.length === 0) return { ok: true };
  for (const path of allowedPaths) {
    const root = resolveContainedExistingPath(repositoryRoot, path);
    if (root !== undefined && isCanonicalPathContained(root, cwd)) return { ok: true };
  }
  return { ok: false };
}

function advisoryWarnings(command: string, blockedCommands: readonly string[] | undefined): string[] {
  if (blockedCommands === undefined) return [];
  return blockedCommands.includes(command) ? [`blocked command advisory: ${command}`] : [];
}

function redactEnv(env: Record<string, string> | undefined, deps: ToolDeps): Record<string, string> | undefined {
  if (env === undefined) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) out[key] = deps.redact(value);
  return out;
}

function redactAndTruncate(value: string, deps: ToolDeps, maxBytes: number | undefined): string {
  const redacted = deps.redact(value);
  if (maxBytes === undefined) return redacted;
  return Buffer.from(redacted, "utf8").subarray(0, maxBytes).toString("utf8");
}

async function writeDump(invocation: ToolInvocation<BashInput>, output: BashOutput, deps: ToolDeps): Promise<void> {
  const dir = invocation.context?.authorities.toolDumps;
  if (dir === undefined) return;
  await deps.fs.mkdir(dir, { recursive: true });
  await deps.fs.writeFile(
    join(dir, `${invocation.invocationId}.log`),
    [
      `tool: ${String(invocation.toolId)}`,
      `invocation: ${invocation.invocationId}`,
      `exitCode: ${output.exitCode}`,
      `timedOut: ${output.timedOut}`,
      "stdout:",
      output.stdout,
      "stderr:",
      output.stderr,
    ].join("\n"),
    "utf8",
  );
}

function meta(invocation: ToolInvocation<BashInput>, startedAt: number, endedAt: number): ToolMeta {
  return {
    invocationId: invocation.invocationId,
    toolId: invocation.toolId,
    caller: invocation.caller,
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    correlation: invocation.context === undefined
      ? undefined
      : {
          workspaceId: invocation.context.workspace.workspaceId,
          ...(invocation.context.issue?.storyId === undefined ? {} : { storyId: invocation.context.issue.storyId }),
          ...(invocation.repoId === undefined ? {} : { repoId: invocation.repoId }),
        },
  };
}

function contextFailure(
  invocation: ToolInvocation<BashInput>,
  startedAt: number,
  endedAt: number,
  code: "missing_execution_context" | "invalid_execution_context",
  message: string,
): ToolResult<never> {
  return {
    ok: false,
    error: { code, message, retryable: false },
    meta: meta(invocation, startedAt, endedAt),
  };
}
