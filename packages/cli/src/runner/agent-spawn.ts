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
import { type ChildProcess, spawn } from "node:child_process";

/**
 * FIX-204D — live-children registry. The signal teardown must kill an
 * in-flight agent BEFORE the runner dies: a TERM'd run-once whose claude
 * child survives keeps editing the worktree headless (and the next cycle's
 * preflight would meet a haunted checkout).
 */
const liveAgents = new Set<ChildProcess>();

/** Kill every registered in-flight agent. Returns how many were signalled. */
export function killLiveAgents(signal: NodeJS.Signals = "SIGKILL"): number {
  let n = 0;
  for (const c of liveAgents) {
    try {
      if (killHard(c, signal)) n += 1;
    } catch {
      /* already gone */
    }
  }
  liveAgents.clear();
  return n;
}

/**
 * FIX-224: kill the child's whole process GROUP when it leads one (the
 * PTY-wrapped `script` child is spawned detached, so SIGKILLing only `script`
 * would orphan the agent underneath — the exact haunted-worktree scenario
 * FIX-204D exists to prevent). Non-detached children share the runner's group
 * (pgid ≠ pid), so the group signal throws and we fall back to the plain kill.
 */
function killHard(c: ChildProcess, signal: NodeJS.Signals): boolean {
  if (c.pid !== undefined) {
    try {
      process.kill(-c.pid, signal);
      return true;
    } catch {
      /* not a group leader — plain child kill below */
    }
  }
  return c.kill(signal);
}

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
  openai: "codex exec <prompt>",
  opencode: "opencode run <prompt>",
};

/**
 * FIX-204B — the story-pin directive. The executor picks + claims the story
 * (pick_story marks 🔨 in the MAIN repo's backlog) BEFORE the agent spawns;
 * without this segment the agent re-picks from whatever backlog it can find
 * (2026-06-06 first live run: skill body was empty AND the agent free-styled —
 * a second, unsanctioned pick). One cycle = one scheduler-locked story.
 */
export function storyPinDirective(storyId: string): string {
  return (
    `[本周期指定故事] 调度器已锁定 ${storyId} 并在 backlog 标记 🔨 In Progress——` +
    `只执行这一个故事,严禁重新挑选或顺手做别的;若它确实不可执行,写 ALERT 说明原因后干净退出。\n\n`
  );
}

/** Inputs for {@link buildClaudeArgv}: the worktree dir + the prompt body. */
export interface ClaudeArgvInput {
  /** The agent's cwd / `--add-dir` target — the cycle worktree (`WT`). */
  worktree: string;
  /** The skill-document body (already stripped of frontmatter by the caller).
   *  The autorun directive is prepended here, mirroring _agent_skill_cmd. */
  skillBody: string;
  /** FIX-204B: the executor-picked story — pinned into the prompt so the agent
   *  executes exactly this story (absent ⇒ legacy prompt, byte-identical to
   *  the v2 oracle shape). */
  storyId?: string;
  /** The claude binary (resolved path or "claude"); tests inject the shim name. */
  bin?: string;
  /** FIX-220: when the user manually triggers `roll loop now`, the terminal is
   *  interactive — drop --verbose and --output-format stream-json so the
   *  output is human-readable instead of a JSON flood. */
  interactive?: boolean;
}

/**
 * Build the claude loop-cycle argv, mirroring `_loop_cycle_agent_cmd` +
 * `_agent_skill_cmd` + `_agent_argv claude plain` (bin/roll:4525-4530 /
 * 9768-9809). Returns argv WITHOUT the binary at [0] folded into args — the
 * caller spawns `bin` with these args.
 *
 *   claude -p "<autorun + skill body>" --verbose --dangerously-skip-permissions
 *          --output-format stream-json --add-dir <wt>
 *
 * DELIBERATE DIVERGENCE from the v2 oracle's arg ORDER (whitelisted): v2 puts
 * the prompt last, AFTER `--add-dir <wt>` — but `--add-dir` is variadic in
 * claude CLI ≥2.1.x and swallows the trailing prompt ("Input must be provided
 * either through stdin or as a prompt argument"). v2's order is a live bug
 * against current claude; v3 binds the prompt directly to `-p`. Flag set and
 * semantics are otherwise identical. (Caught by scripts/parallel-verify.sh.)
 */
export function buildClaudeArgv(input: ClaudeArgvInput): { bin: string; args: string[] } {
  const bin = input.bin ?? "claude";
  // FIX-204B: the pin rides BETWEEN the autorun directive and the skill body —
  // AUTORUN_DIRECTIVE itself stays byte-identical to the oracle; a cycle with
  // no picked story (undefined) produces the exact pre-204 prompt.
  const pin = input.storyId !== undefined && input.storyId !== "" ? storyPinDirective(input.storyId) : "";
  const prompt = `${AUTORUN_DIRECTIVE}${pin}${input.skillBody}`;
  // FIX-220: manual `roll loop now` runs in an interactive terminal — strip
  // --verbose and --output-format stream-json so the user sees plain text
  // instead of a JSON flood. Cost tracking is best-effort on this path.
  const args = input.interactive
    ? ["-p", prompt, "--dangerously-skip-permissions", "--add-dir", input.worktree]
    : [
        "-p",
        prompt,
        "--verbose",
        "--dangerously-skip-permissions",
        "--output-format",
        "stream-json",
        "--add-dir",
        input.worktree,
      ];
  return { bin, args };
}

/** Options for an {@link AgentSpawn} call. */
export interface AgentSpawnOptions {
  /** US-PORT-011: live sink — called with every raw stdout/stderr chunk as it
   *  arrives (the observation window tails the file this feeds). */
  onChunk?: (chunk: Buffer) => void;
  /** The agent's working directory — the cycle worktree. */
  cwd: string;
  /** The skill-document body to drive the agent with. */
  skillBody: string;
  /** FIX-204B: the executor-picked story id, pinned into the prompt. */
  storyId?: string;
  /** Hard wall-clock kill after this many ms (the watchdog also enforces this at
   *  the orchestrator layer; this is the spawn-local belt-and-braces). */
  timeoutMs?: number;
  /** Override the claude binary (tests inject the shim). */
  bin?: string;
  /** Extra env for the child (tests inject PATH with the shim dir prepended). */
  env?: NodeJS.ProcessEnv;
  /** FIX-220: when the user manually triggers `roll loop now`, drop --verbose
   *  and --output-format stream-json for a human-readable terminal. */
  interactive?: boolean;
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
/** Build the spawn argv for a resolved agent — exported for unit tests. */
export function buildSpawnCommand(agent: string, opts: AgentSpawnOptions): { bin: string; args: string[] } {
  const prompt = `${AUTORUN_DIRECTIVE}${opts.storyId !== undefined && opts.storyId !== "" ? storyPinDirective(opts.storyId) : ""}${opts.skillBody}`;
  if (agent === "claude") {
    return buildClaudeArgv({
      worktree: opts.cwd,
      skillBody: opts.skillBody,
      ...(opts.storyId !== undefined ? { storyId: opts.storyId } : {}),
      bin: opts.bin,
      interactive: opts.interactive,
    });
  }
  if (agent === "pi") {
    // pi -p "<prompt>" in the worktree CWD — no stream-json, no --add-dir.
    // The agent's stdout is plain text; onChunk feeds it to the live log.
    return { bin: opts.bin ?? "pi", args: ["-p", prompt] };
  }
  if (agent === "kimi") {
    return { bin: opts.bin ?? "kimi", args: ["-p", prompt] };
  }
  if (agent === "codex") {
    return { bin: opts.bin ?? "codex", args: ["exec", prompt] };
  }
  if (agent === "deepseek") {
    return { bin: opts.bin ?? "deepseek", args: [prompt] };
  }
  if (agent === "qwen") {
    return { bin: opts.bin ?? "qwen", args: [prompt] };
  }
  if (agent === "agy" || agent === "gemini" || agent === "antigravity") {
    return { bin: opts.bin ?? "agy", args: ["-p", "--dangerously-skip-permissions", prompt] };
  }
  const hint = AGENT_ARGV_TODO[agent] ?? "unknown agent";
  throw new Error(
    `runner: agent '${agent}' argv not yet ported. v2 shape: ${hint}`,
  );
}

/**
 * FIX-224 (v2 `_AGENT_PTY_PREFIX`, FIX-136 lineage): non-claude agents
 * (pi/kimi/…) buffer their stdout when piped, blacking out the live
 * observation window (tmux watch / `roll loop now`) for the whole phase —
 * wrap them in `script -q /dev/null` so they see a PTY and stream line by
 * line. claude is never wrapped: its stream-json protocol runs on plain
 * pipes. Only darwin gets the wrap (BSD `script` takes the command as argv;
 * util-linux needs a single `-c` string — quote-splicing a multi-KB prompt
 * is a worse failure mode than buffered output).
 */
export function withPtyWrap(
  cmd: { bin: string; args: string[] },
  agent: string,
  platform: NodeJS.Platform = process.platform,
): { bin: string; args: string[]; pty: boolean } {
  if (agent === "claude" || platform !== "darwin") return { ...cmd, pty: false };
  return { bin: "script", args: ["-q", "/dev/null", cmd.bin, ...cmd.args], pty: true };
}

function spawnAndWait(bin: string, args: string[], opts: AgentSpawnOptions, pty = false): Promise<AgentSpawnResult> {
  // Operational trace (v2 logs its agent cmd too): goes to the runner's stderr,
  // which leg/cycle logs capture — argv mismatches become diagnosable.
  process.stderr.write(`[runner] spawn ${bin} argv=${JSON.stringify(args.map((a) => (a.length > 80 ? `${a.slice(0, 77)}...` : a)))}\n`);
  return new Promise<AgentSpawnResult>((resolve) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      // FIX-224: the PTY-wrapped `script` leads its own process group so the
      // timeout/teardown can reap script AND the agent under it (killHard).
      detached: pty,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killHard(child, "SIGKILL");
      }, opts.timeoutMs);
    }
    // FIX-204E: live.log (fed via onChunk by the executor) is the single live
    // channel — observers tail it from the tmux watch window / `loop now`.
    child.stdout?.on("data", (d: Buffer) => {
      opts.onChunk?.(d);
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      opts.onChunk?.(d);
      stderr += d.toString("utf8");
    });
    liveAgents.add(child); // FIX-204D
    let settled = false;
    const settle = (result: AgentSpawnResult): void => {
      if (settled) return;
      settled = true;
      liveAgents.delete(child); // FIX-204D
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
}

export const realAgentSpawn: AgentSpawn = (agent, opts) => {
  const { bin, args, pty } = withPtyWrap(buildSpawnCommand(agent, opts), agent);
  return spawnAndWait(bin, args, opts, pty);
};
