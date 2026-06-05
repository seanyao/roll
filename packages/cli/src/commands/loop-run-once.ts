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
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type RunnerPaths, dryRunPlan, nodePorts, runCycleOnce } from "../runner/index.js";
import { spawn } from "node:child_process";

/** US-PORT-011: after a delivered cycle, surface the acceptance report —
 *  print its path always; auto-open in the browser unless the project is
 *  muted (mute-<slug> flag, same gate as the popup). Best-effort. */
export function announceReport(
  projectPath: string,
  slug: string,
  storyId: string,
  opener: (p: string) => void = (p) => {
    try {
      spawn("open", [p], { stdio: "ignore", detached: true }).unref();
    } catch {
      /* best-effort */
    }
  },
): string | null {
  if (storyId === "") return null;
  const report = join(projectPath, ".roll", "verification", storyId, "latest", "report.html");
  if (!existsSync(report)) return null;
  process.stdout.write(`evidence: ${report}\n验收报告: ${report}\n`);
  const muted =
    existsSync(join(projectPath, ".roll", "loop", `mute-${slug}`)) ||
    existsSync(
      join(process.env["ROLL_SHARED_ROOT"] || join(process.env["HOME"] ?? "", ".shared", "roll"), "loop", `mute-${slug}`),
    );
  if (!muted) opener(report);
  return report;
}

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

/**
 * Resolve + read the loop SKILL.md body the agent runs, frontmatter stripped.
 *
 * FIX-204A: the v2-era path (`.roll/skills/roll-loop/SKILL.md`) became a
 * fossil when skills moved to the `skills/` submodule — every live cycle got
 * an EMPTY body and the agent drove blind (2026-06-06, the v3 heart's first
 * live run). Resolution order: `ROLL_LOOP_SKILL` env (explicit override) →
 * legacy `.roll/skills/` (projects vendoring a private copy) → `skills/`
 * submodule (the shipped truth). Returns null when nothing resolves to a
 * non-empty body — the caller must fail LOUD, never spawn a blind agent.
 */
export function readSkillBody(projectPath: string): string | null {
  const candidates = [
    process.env["ROLL_LOOP_SKILL"] ?? "",
    join(projectPath, ".roll", "skills", "roll-loop", "SKILL.md"),
    join(projectPath, "skills", "roll-loop", "SKILL.md"),
  ].filter((p) => p !== "");
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    let raw = "";
    try {
      raw = readFileSync(p, "utf8");
    } catch {
      continue;
    }
    // Strip YAML frontmatter — the v2 oracle hands the agent the body only
    // (`_agent_skill_cmd` splices the "stripped SKILL.md body").
    const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
    if (body !== "") return body;
  }
  return null;
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

  // FIX-204A: an empty workflow document = a blind agent burning tokens for
  // nothing — halt loudly BEFORE any lock/worktree/agent side effect.
  const skillBody = readSkillBody(id.path);
  if (skillBody === null) {
    const msg =
      `[${new Date().toISOString()}] ALERT loop run-once: roll-loop SKILL.md not found ` +
      `(checked ROLL_LOOP_SKILL, .roll/skills/, skills/) — cycle ${cycleId} refused to start`;
    try {
      mkdirSync(dirname(paths.alertsPath), { recursive: true });
      appendFileSync(paths.alertsPath, `${msg}\n`, "utf8");
    } catch {
      /* the stderr line below still fires */
    }
    process.stderr.write(
      `loop run-once: roll-loop SKILL.md not found — refusing to spawn a blind agent (ALERT written)\n` +
        `loop run-once: 找不到 roll-loop SKILL.md — 拒绝盲开 agent(已写 ALERT)\n`,
    );
    return 1;
  }

  // Minimal route deps: read agents.yaml slots would be the real wiring; for the
  // single-cycle runner default to the project agent via firstInstalled.
  const routeDeps: RouteDeps = {
    readSlot: () => undefined,
    firstInstalled: () => process.env["ROLL_LOOP_AGENT"] ?? "claude",
  };

  const ports = nodePorts({
    repoCwd: id.path,
    paths,
    skillBody,
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
  // US-PORT-011: delivered? surface the acceptance report (print + auto-open
  // unless muted) — the owner's "做完想看 attest html" loop closure.
  if (result.terminal === "done") {
    const storyId = (result.state?.ctx?.storyId ?? "").trim();
    announceReport(id.path, id.slug, storyId);
  }
  return result.terminal === "failed" || result.terminal === "blocked" ? 1 : 0;
}
