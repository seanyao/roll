/**
 * Agent spawn port — the EXECUTION glue between the orchestrator's
 * `{ kind: "spawn_agent" }` command and a real agent process (US-LOOP runner
 * adapter, prerequisite for US-LOOP-006).
 *
 * ── Why this lives in @roll/cli, not @roll/infra ─────────────────────────────
 * The runner adapter dispatches @roll/core's {@link CycleCommand} vocabulary
 * using @roll/infra's executors. The package arrow is one-directional
 * (core→spec, infra→spec, cli→{core,infra,spec}); infra must NOT import core, so
 * the only package that can see BOTH the command language and the executors is
 * the cli. The agent-spawn argv construction is part of that adapter and lives
 * here alongside it. (See runner/executor.ts for the full justification.)
 *
 * ── v2 oracle: how the loop builds the claude argv ───────────────────────────
 * The frozen bash builds the per-cycle agent command at RUNTIME, routing-aware:
 *   - `_agent_argv claude plain "$prompt"`           (bin/roll:4525-4530)
 *       claude plain mode → `claude -p "<prompt>"`.
 *   - `_agent_skill_cmd` / `_loop_cycle_agent_cmd`   (bin/roll:9762-9810)
 *       splices the claude-only loop enhancements onto that base:
 *         `claude -p` → `claude -p --verbose --dangerously-skip-permissions
 *                        --output-format stream-json --add-dir "<wt>"`
 *       and prepends the FIX-152 autonomous-execution directive ahead of the
 *       stripped SKILL.md body as the single positional prompt arg.
 *   - the agent runs WITH CWD = the worktree (`WT`), where it makes its TCR
 *     commits; stdout is piped through loop-fmt.py (display-only, bin/roll:8359)
 *     — the runner does not depend on loop-fmt, it captures raw stdout for the
 *     cost/usage parse (cost/tracker.ts).
 *
 * {@link buildClaudeArgv} reproduces that argv construction for the `claude`
 * agent. Other agents (kimi/pi/codex/gemini/qwen/opencode/deepseek) have their
 * own `_agent_argv` shapes (bin/roll:4531-4581) and loop enhancements that DIFFER
 * (only claude gets the stream-json / --add-dir splice); porting each is deferred
 * — see {@link AGENT_ARGV_TODO}. The integration tests use a SHIM `claude` on
 * PATH (a fake binary that makes a `tcr:` commit in the worktree), so no real
 * agent ever runs in tests.
 */
import { spawn } from "node:child_process";

/** The FIX-152 autonomous-execution directive prepended to the skill body
 *  (bin/roll:9791). Kept byte-identical so the shim/real argv match the oracle. */
export const AUTORUN_DIRECTIVE =
  "[roll 自主模式] 你正在无人值守的自动化循环中运行,这不是对话。请立即、完整地执行下面这份技能文档描述的工作流,直到完成交付或写出 ALERT 为止;严禁反问、严禁等待确认、严禁只复述或总结而不动手。技能文档如下: ";

/**
 * Agents whose loop argv construction is NOT yet ported by the runner adapter.
 * The orchestrator can route to any of these (router.ts is agent-agnostic), but
 * only `claude` has its full loop-enhanced argv reproduced here today. Each entry
 * documents the v2 `_agent_argv` base shape (bin/roll:4531-4581) so the next
 * agent is a one-function add. Routing to a stubbed agent throws a loud error
 * (NEVER a silent no-op) so the parallel-verification protocol surfaces the gap.
 */
export const AGENT_ARGV_TODO: Record<string, string> = {
  kimi: "kimi-code|kimi-cli|kimi -p <prompt> (FIX-126/133; no stream-json splice)",
  pi: "pi -p <prompt> (text mode; no usage on stdout — cost via session file)",
  deepseek: "deepseek <prompt> (positional)",
  codex: "codex exec <prompt>",
  openai: "codex exec <prompt>",
  opencode: "opencode run <prompt>",
  gemini: "agy -p --dangerously-skip-permissions <prompt> (FIX-153)",
  agy: "agy -p --dangerously-skip-permissions <prompt> (FIX-153)",
  antigravity: "agy -p --dangerously-skip-permissions <prompt> (FIX-153)",
  qwen: "qwen <prompt> (positional)",
};

/** Inputs for {@link buildClaudeArgv}: the worktree dir + the prompt body. */
export interface ClaudeArgvInput {
  /** The agent's cwd / `--add-dir` target — the cycle worktree (`WT`). */
  worktree: string;
  /** The skill-document body (already stripped of frontmatter by the caller).
   *  The autorun directive is prepended here, mirroring _agent_skill_cmd. */
  skillBody: string;
  /** The claude binary (resolved path or "claude"); tests inject the shim name. */
  bin?: string;
}

/**
 * Build the claude loop-cycle argv, mirroring `_loop_cycle_agent_cmd` +
 * `_agent_skill_cmd` + `_agent_argv claude plain` (bin/roll:4525-4530 /
 * 9768-9809). Returns argv WITHOUT the binary at [0] folded into args — the
 * caller spawns `bin` with these args.
 *
 *   claude -p --verbose --dangerously-skip-permissions
 *          --output-format stream-json --add-dir <wt> "<autorun + skill body>"
 */
export function buildClaudeArgv(input: ClaudeArgvInput): { bin: string; args: string[] } {
  const bin = input.bin ?? "claude";
  const prompt = `${AUTORUN_DIRECTIVE}${input.skillBody}`;
  const args = [
    "-p",
    "--verbose",
    "--dangerously-skip-permissions",
    "--output-format",
    "stream-json",
    "--add-dir",
    input.worktree,
    prompt,
  ];
  return { bin, args };
}

/** Options for an {@link AgentSpawn} call. */
export interface AgentSpawnOptions {
  /** The agent's working directory — the cycle worktree. */
  cwd: string;
  /** The skill-document body to drive the agent with. */
  skillBody: string;
  /** Hard wall-clock kill after this many ms (the watchdog also enforces this at
   *  the orchestrator layer; this is the spawn-local belt-and-braces). */
  timeoutMs?: number;
  /** Override the claude binary (tests inject the shim). */
  bin?: string;
  /** Extra env for the child (tests inject PATH with the shim dir prepended). */
  env?: NodeJS.ProcessEnv;
}

/** Result of an agent spawn — the orchestrator feeds `exitCode` back as
 *  `agent_exited`; `usage` (raw stdout) feeds cost/tracker.ts. */
export interface AgentSpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** True iff the spawn-local timeout killed the child (maps to `timedOut`). */
  timedOut: boolean;
}

/** The injectable agent-spawn port. Real impl below; tests pass a fake that
 *  fabricates a tcr commit in the worktree fixture without any real agent. */
export type AgentSpawn = (
  agent: string,
  opts: AgentSpawnOptions,
) => Promise<AgentSpawnResult>;

/**
 * Real agent spawn: build the argv for the resolved agent and run it via
 * `child_process.spawn`, capturing stdout/stderr and the exit code. Only
 * `claude` has its loop argv ported ({@link buildClaudeArgv}); any other agent
 * throws with the documented {@link AGENT_ARGV_TODO} hint (fail-loud, never a
 * silent skip — the parallel-verification protocol must see the gap).
 *
 * The child runs with CWD = the worktree, where the agent makes its TCR commits
 * (exactly as v2: the loop hands the agent the worktree and it commits inside).
 */
export const realAgentSpawn: AgentSpawn = (agent, opts) => {
  if (agent !== "claude") {
    const hint = AGENT_ARGV_TODO[agent] ?? "unknown agent";
    throw new Error(
      `runner: agent '${agent}' argv not yet ported (only 'claude' is). v2 shape: ${hint}`,
    );
  }
  const { bin, args } = buildClaudeArgv({
    worktree: opts.cwd,
    skillBody: opts.skillBody,
    bin: opts.bin,
  });
  return new Promise<AgentSpawnResult>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, opts.timeoutMs);
    }
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    let settled = false;
    const settle = (result: AgentSpawnResult): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };
    child.on("error", (e) => {
      // Mirror shell semantics: a missing/unspawnable binary is exit 127 —
      // the v2 oracle classifies that as agent FAILURE (feeds the retry
      // ladder → failed), never an abort. Parallel-verify caught this live.
      settle({ stdout, stderr: `${stderr}${String(e)}\n`, exitCode: 127, timedOut });
    });
    // `exit` (not only `close`): a SIGKILLed agent can leave grandchildren
    // holding the stdio pipes, so `close` may never fire — settle on process
    // death after one tick of stream drain.
    child.on("exit", (code, signal) => {
      setImmediate(() =>
        settle({ stdout, stderr, exitCode: code ?? (signal !== null ? 137 : 1), timedOut }),
      );
    });
    child.on("close", (code) => {
      settle({ stdout, stderr, exitCode: code ?? 1, timedOut });
    });
  });
};
