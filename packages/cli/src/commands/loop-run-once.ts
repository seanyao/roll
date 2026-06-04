/**
 * `roll loop run-once` — TS-first single-cycle runner (US-LOOP runner adapter,
 * prerequisite for US-LOOP-006 v2-vs-v3 parallel verification).
 *
 * Two modes:
 *   - `--dry-run` : print the command PLAN the cycle would execute (the
 *     orchestrator's command→executor mapping), WITHOUT touching git / gh / the
 *     agent. Used by the parallel-verification protocol to preview the walk.
 *   - default     : acquire the inner lock, walk the orchestrator to terminal via
 *     {@link runCycleOnce}, executing each command through the real Node ports.
 *
 * The handler stays thin: it resolves the project identity + runtime paths and
 * delegates the entire walk to the runner adapter (packages/cli/src/runner).
 */
import { type RouteDeps } from "@roll/core";
import { projectIdentity } from "@roll/infra";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type RunnerPaths, dryRunPlan, nodePorts, runCycleOnce } from "../runner/index.js";

/** Build the cycle id `<YYYYmmdd-HHMMSS>-<pid>` (mirrors bin/roll:8828). */
function makeCycleId(now = new Date(), pid = process.pid): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  const ts =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${ts}-${pid}`;
}

/** Resolve the `.roll/loop/` runtime dir (ROLL_PROJECT_RUNTIME_DIR override). */
function runtimeDir(projectPath: string): string {
  const env = (process.env["ROLL_PROJECT_RUNTIME_DIR"] ?? "").trim();
  return env !== "" ? env : join(projectPath, ".roll", "loop");
}

/** Read the loop SKILL.md body the agent runs (best-effort; empty when absent). */
function readSkillBody(projectPath: string): string {
  const candidates = [
    join(projectPath, ".roll", "skills", "roll-loop", "SKILL.md"),
    process.env["ROLL_LOOP_SKILL"] ?? "",
  ].filter((p) => p !== "");
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  return "";
}

/**
 * The `loop run-once` entry. Returns a process exit code (0 ok).
 */
export async function loopRunOnceCommand(args: string[]): Promise<number> {
  const dryRun = args.includes("--dry-run");
  const id = await projectIdentity();
  const cycleId = makeCycleId();
  const branch = `loop/cycle-${cycleId}`;
  const ctx = { cycleId, branch, loop: "ci" as never };

  if (dryRun) {
    const plan = dryRunPlan(ctx);
    process.stdout.write(
      [
        `# roll loop run-once --dry-run`,
        `# project: ${id.slug}`,
        `# cycle:   ${cycleId}`,
        `# branch:  ${branch}`,
        "#",
        "# command plan (orchestrator → executor):",
        ...plan.map((l) => `  ${l}`),
        "",
        "(dry-run: nothing executed — no git / gh / agent side effects)",
        "",
      ].join("\n"),
    );
    return 0;
  }

  const rt = runtimeDir(id.path);
  const paths: RunnerPaths = {
    eventsPath: join(rt, "events.ndjson"),
    runsPath: join(rt, "runs.jsonl"),
    alertsPath: join(rt, "alerts.log"),
    lockPath: join(rt, "inner.lock"),
    heartbeatPath: join(rt, "heartbeat"),
    worktreePath: join(rt, "worktrees", `cycle-${cycleId}`),
  };

  // Minimal route deps: read agents.yaml slots would be the real wiring; for the
  // single-cycle runner default to the project agent via firstInstalled.
  const routeDeps: RouteDeps = {
    readSlot: () => undefined,
    firstInstalled: () => process.env["ROLL_LOOP_AGENT"] ?? "claude",
  };

  const ports = nodePorts({
    repoCwd: id.path,
    paths,
    skillBody: readSkillBody(id.path),
    routeDeps,
  });

  const result = await runCycleOnce({ ports, ctx });
  if (!result.ran) {
    process.stdout.write(
      `loop run-once: another cycle holds the inner lock (pid ${result.heldByPid ?? "?"}); skipped\n`,
    );
    return 0;
  }
  process.stdout.write(`loop run-once: cycle ${cycleId} → ${result.terminal ?? "unknown"}\n`);
  return result.terminal === "failed" || result.terminal === "blocked" ? 1 : 0;
}
