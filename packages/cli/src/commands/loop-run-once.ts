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
import { EventBus, cycleEndEvent, firstInstalledAgent, mapV2Status, readSlotFromText, type AgentSlot, type RouteDeps } from "@roll/core";
import { parseLock, projectIdentity, releaseLock } from "@roll/infra";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type RunnerPaths, buildRunRow, dryRunPlan, killLiveAgents, nodePorts, realAgentSpawn, runCycleOnce } from "../runner/index.js";
import { readSkillBody as readSkillBodyGeneric } from "../runner/skill-body.js";
import { realAgentEnv } from "./agent-list.js";
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

// ─── FIX-204D — signal teardown ───────────────────────────────────────────────

/** Injectable seams for {@link cycleSignalTeardown} (tests must not exit). */
export interface SignalTeardownDeps {
  killAgents?: (sig: NodeJS.Signals) => number;
  exit?: (code: number) => void;
  pid?: number;
  now?: () => number;
}

const SIGNUM: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };

/**
 * The I8 invariant ("a terminal cycle:end + runs row exists on EVERY exit
 * path") has a hole the 2026-06-06 first live run fell through: SIGTERM kills
 * the process without running `finally` — no terminal event, no runs row, a
 * dead-pid lock, an orphan worktree, and `loop status` swearing nothing ever
 * ran. This handler closes the hole for TERM/INT/HUP:
 *
 *   kill the in-flight agent → (iff WE own the inner lock) write the aborted
 *   cycle:end + runs row, release the lock → exit 128+signum.
 *
 * The lock-ownership guard matters twice over: a signal during the
 * skip-on-contention path must not touch the LIVE cycle's state, and a signal
 * after a clean terminal (lock already released) must not double-write.
 */
export function cycleSignalTeardown(
  paths: Pick<RunnerPaths, "eventsPath" | "runsPath" | "lockPath">,
  cycleId: string,
  branch: string,
  sig: NodeJS.Signals,
  deps: SignalTeardownDeps = {},
): void {
  const kill = deps.killAgents ?? killLiveAgents;
  const exit = deps.exit ?? ((c: number): void => process.exit(c));
  const pid = deps.pid ?? process.pid;
  const now = deps.now ?? ((): number => Math.floor(Date.now() / 1000));

  try {
    kill("SIGKILL");
  } catch {
    /* no agent in flight */
  }

  let owned = false;
  try {
    owned = existsSync(paths.lockPath) && parseLock(readFileSync(paths.lockPath, "utf8")).pid === pid;
  } catch {
    owned = false;
  }
  if (owned) {
    const bus = new EventBus();
    const tctx = { cycleId, branch, agent: "", model: "" };
    try {
      bus.appendEvent(paths.eventsPath, { ...cycleEndEvent(tctx, "aborted"), ts: now() });
    } catch {
      /* best-effort: the exit below still happens */
    }
    try {
      bus.upsertRun(
        paths.runsPath,
        { storyId: "", cycleId },
        buildRunRow(
          { kind: "append_run", status: "aborted", outcome: mapV2Status("aborted"), cycleId },
          { cycleId, branch, loop: "ci" as never },
        ),
      );
    } catch {
      /* best-effort */
    }
    try {
      releaseLock(paths.lockPath);
    } catch {
      /* best-effort */
    }
  }
  process.stderr.write(
    `loop run-once: ${sig} — aborted terminal recorded, lock released, agent killed\n` +
      `loop run-once: 收到 ${sig} — 已补 aborted 终态、释放锁、终止 agent\n`,
  );
  exit(128 + (SIGNUM[sig] ?? 15));
}

/** Register TERM/INT/HUP teardown for one cycle; returns the disposer. */
export function installCycleSignalTeardown(
  paths: Pick<RunnerPaths, "eventsPath" | "runsPath" | "lockPath">,
  cycleId: string,
  branch: string,
): () => void {
  const sigs: NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGHUP"];
  const handlers = new Map<NodeJS.Signals, () => void>();
  for (const sig of sigs) {
    const h = (): void => cycleSignalTeardown(paths, cycleId, branch, sig);
    handlers.set(sig, h);
    process.on(sig, h);
  }
  return (): void => {
    for (const [sig, h] of handlers) process.removeListener(sig, h);
  };
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

// ── FIX-216b: consecutive-failure auto-PAUSE ──────────────────────────────────

const PAUSE_THRESHOLD = 3;

/**
 * Increment the consecutive-failure counter for a project. If threshold is
 * reached, write a PAUSE marker and an alert so the scheduler skips future
 * ticks. Idempotent: a pre-existing PAUSE marker is not overwritten.
 */
function incrementConsecutiveFails(
  projectPath: string,
  slug: string,
  alertsPath: string,
  cycleId: string,
  storyId: string,
  terminal: string,
): void {
  const rt = runtimeDir(projectPath);
  const counterFile = join(rt, "consecutive-fails");
  let count = 0;
  try {
    if (existsSync(counterFile)) {
      count = parseInt(readFileSync(counterFile, "utf8").trim(), 10) || 0;
    }
  } catch { /* best-effort */ }
  count += 1;
  try {
    writeFileSync(counterFile, String(count), "utf8");
  } catch { /* best-effort */ }

  if (count < PAUSE_THRESHOLD) return;

  const pauseMarker = join(projectPath, ".roll", "loop", `PAUSE-${slug}`);
  const alertMsg =
    `# ALERT — loop auto-paused after ${count} consecutive failures\n\n` +
    `**Cycle**: ${cycleId}\n` +
    `**Story**: ${storyId}\n` +
    `**Terminal**: ${terminal}\n` +
    `**Action**: ${count} consecutive cycles failed — loop paused to prevent burn.\n` +
    `  Resolve the root cause, then: \`roll loop resume\`\n`;
  try {
    writeFileSync(pauseMarker, alertMsg, "utf8");
    appendFileSync(alertsPath, `${alertMsg}\n`, "utf8");
  } catch { /* best-effort */ }
  process.stderr.write(
    `loop run-once: auto-PAUSED after ${count} consecutive failures — PAUSE marker written\n` +
      `loop run-once: 连续 ${count} 次失败后自动暂停 — 已写 PAUSE 标记\n`,
  );
}

/** Reset the consecutive-failure counter (called on a successful delivery). */
function resetConsecutiveFails(projectPath: string): void {
  const rt = runtimeDir(projectPath);
  try {
    writeFileSync(join(rt, "consecutive-fails"), "0", "utf8");
  } catch { /* best-effort */ }
}

/**
 * Resolve + read the loop SKILL.md body the agent runs, frontmatter stripped.
 * Thin wrapper over the shared {@link readSkillBodyGeneric} pinned to the
 * `roll-loop` skill + the `ROLL_LOOP_SKILL` env override (FIX-204A lineage —
 * resolution order documented there).
 */
export function readSkillBody(projectPath: string): string | null {
  return readSkillBodyGeneric(projectPath, {
    skillName: "roll-loop",
    envOverride: process.env["ROLL_LOOP_SKILL"],
  });
}

/**
 * Build route deps mirroring bash `_loop_pick_agent_for_story`: the per-tier
 * slot comes from agents.yaml ONLY (the router walks tier → default →
 * firstInstalled). `local.yaml agent:` is NOT a tier override — in v2 it is
 * the single-agent default for non-loop contexts and the cold-start seed for
 * the `default` slot; consulting it per-slot would collapse all tiers to one
 * agent (FIX-223). `ROLL_LOOP_AGENT` is likewise routing OUTPUT consumed by
 * loop-fmt/dream, never a selection input.
 *
 * Exported for tests.
 */
export function buildLoopRouteDeps(projectPath: string): RouteDeps {
  function readSlot(slot: AgentSlot): string | undefined {
    const agentsYaml = join(projectPath, ".roll", "agents.yaml");
    try {
      return readSlotFromText(readFileSync(agentsYaml, "utf8"), slot);
    } catch {
      return undefined; // agents.yaml missing — router falls through.
    }
  }

  function firstInstalled(): string | undefined {
    // Project single-agent default (only reached when agents.yaml gave the
    // router nothing for tier AND default), then the real installed-agent
    // scan (core mirrors bash `_first_installed_agent` order + probes).
    // undefined when nothing is installed — the router throws, like bash.
    const fromLocal = readField(join(projectPath, ".roll", "local.yaml"), /^agent:/);
    if (fromLocal !== undefined) return fromLocal;
    return firstInstalledAgent(realAgentEnv());
  }

  return { readSlot, firstInstalled };
}

/** Read the first matching field value from a YAML/text file. */
function readField(path: string, re: RegExp): string | undefined {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(re);
      if (m !== null) {
        const v = line.slice((m.index ?? 0) + m[0].length).trim();
        if (v !== "") return v.replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // file missing — ok.
  }
  return undefined;
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
  // FIX-216a: alerts go to project-local .roll/loop/ALERT-<slug>.md —
  // same location `roll alert` reads from (FIX-052: per-project state).
  // The old `alerts.log` was a siloed file no consumer could find.
  const alertsPath = join(rt, `ALERT-${id.slug}.md`);
  mkdirSync(dirname(alertsPath), { recursive: true });

  const paths: RunnerPaths = {
    eventsPath: join(rt, "events.ndjson"),
    runsPath: join(rt, "runs.jsonl"),
    alertsPath,
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
      appendFileSync(alertsPath, `${msg}\n`, "utf8");
    } catch {
      /* the stderr line below still fires */
    }
    process.stderr.write(
      `loop run-once: roll-loop SKILL.md not found — refusing to spawn a blind agent (ALERT written)\n` +
        `loop run-once: 找不到 roll-loop SKILL.md — 拒绝盲开 agent(已写 ALERT)\n`,
    );
    // FIX-216b: SKILL-not-found is also a persistent failure — count it.
    incrementConsecutiveFails(id.path, id.slug, alertsPath, cycleId, "", "skill_missing");
    return 1;
  }

  // Resolve agent from the project's agents.yaml per tier, falling back to
  // local.yaml's single-agent default → first installed agent (the same chain
  // bash `_loop_pick_agent_for_story` walks).
  const routeDeps: RouteDeps = buildLoopRouteDeps(id.path);

  // FIX-220: manual `roll loop now` (ROLL_LOOP_FORCE=1) runs in an interactive
  // terminal — strip --verbose and --output-format stream-json so the user sees
  // readable text instead of a JSON flood.
  const isInteractive = (process.env["ROLL_LOOP_FORCE"] ?? "").trim() !== "";

  const ports = nodePorts({
    repoCwd: id.path,
    paths,
    skillBody,
    routeDeps,
    ...(isInteractive
      ? {
          agentSpawn: (agent: string, opts: Parameters<typeof realAgentSpawn>[1]) =>
            realAgentSpawn(agent, { ...opts, interactive: true }),
        }
      : {}),
  });

  // FIX-204D: between here and the walk's own finally, signals get a clean
  // teardown instead of a half-state corpse.
  const disposeSignals = installCycleSignalTeardown(paths, cycleId, branch);
  let result;
  try {
    result = await runCycleOnce({ ports, ctx });
  } finally {
    disposeSignals();
  }
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
    resetConsecutiveFails(id.path);
  }

  const isFail = result.terminal === "failed" || result.terminal === "blocked";
  if (isFail) {
    const storyId = (result.state?.ctx?.storyId ?? "").trim();
    incrementConsecutiveFails(id.path, id.slug, alertsPath, cycleId, storyId, result.terminal ?? "unknown");
  }

  return isFail ? 1 : 0;
}
