import { EventBus } from "@roll/core";
import {
  GOAL_SCHEMA_VERSION,
  parseGoalYaml,
  renderGoalYaml,
  transitionGoal,
  type GoalScope,
  type GoalStatus,
  type RollGoal,
} from "@roll/spec";
import { acquireLock, projectIdentity, releaseLock } from "@roll/infra";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const GO_LOCK_STALE_SEC = 21_600; // 6h: covers the planned 5h goal window.

interface ProjectId {
  path: string;
  slug: string;
}

export interface RunOnceInput {
  projectPath: string;
}

export interface StartTmuxInput {
  projectPath: string;
  slug: string;
  args: string[];
  rollBin: string;
}

export interface LoopGoDeps {
  identity: () => Promise<ProjectId>;
  pid: () => number;
  nowSec: () => number;
  nowIso: () => string;
  hasTmux: () => boolean;
  startTmux: (input: StartTmuxInput) => boolean;
  runOnce: (input: RunOnceInput) => Promise<number>;
}

interface GoOptions {
  worker: boolean;
  noTmux: boolean;
  scope: GoalScope;
  budgetUsd?: number;
  maxCycles?: number;
}

interface RunSummary {
  cycles: number;
  costUsd: number;
}

function realDeps(): LoopGoDeps {
  return {
    identity: () => projectIdentity(),
    pid: () => process.pid,
    nowSec: () => Math.floor(Date.now() / 1000),
    nowIso: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    hasTmux: () => {
      try {
        return spawnSync("tmux", ["-V"], { stdio: "ignore" }).status === 0;
      } catch {
        return false;
      }
    },
    startTmux: startGoTmux,
    runOnce: realRunOnce,
  };
}

function runtimeDir(projectPath: string): string {
  return join(projectPath, ".roll", "loop");
}

function goalPath(projectPath: string): string {
  return join(runtimeDir(projectPath), "goal.yaml");
}

function goLockPath(projectPath: string): string {
  return join(runtimeDir(projectPath), "go.lock");
}

function pauseMarkerPath(projectPath: string, slug: string): string {
  return join(runtimeDir(projectPath), `PAUSE-${slug}`);
}

function eventsPath(projectPath: string): string {
  return join(runtimeDir(projectPath), "events.ndjson");
}

function runsPath(projectPath: string): string {
  return join(runtimeDir(projectPath), "runs.jsonl");
}

function parseOptions(args: string[]): GoOptions {
  let scope: GoalScope = { kind: "all" };
  let budgetUsd: number | undefined;
  let maxCycles: number | undefined;
  const cards: string[] = [];
  let worker = false;
  let noTmux = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--worker") {
      worker = true;
      continue;
    }
    if (arg === "--no-tmux") {
      noTmux = true;
      continue;
    }
    if (arg === "--epic") {
      const epic = args[i + 1]?.trim() ?? "";
      if (epic !== "") scope = { kind: "epic", epic };
      i += 1;
      continue;
    }
    if (arg.startsWith("--epic=")) {
      const epic = arg.slice("--epic=".length).trim();
      if (epic !== "") scope = { kind: "epic", epic };
      continue;
    }
    if (arg === "--budget") {
      budgetUsd = parseNonNegativeNumber(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--budget=")) {
      budgetUsd = parseNonNegativeNumber(arg.slice("--budget=".length));
      continue;
    }
    if (arg === "--max-cycles") {
      maxCycles = parseNonNegativeInteger(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--max-cycles=")) {
      maxCycles = parseNonNegativeInteger(arg.slice("--max-cycles=".length));
      continue;
    }
    if (!arg.startsWith("-")) cards.push(arg);
  }

  if (cards.length > 0) scope = { kind: "cards", cards };
  return {
    worker,
    noTmux,
    scope,
    ...(budgetUsd !== undefined ? { budgetUsd } : {}),
    ...(maxCycles !== undefined ? { maxCycles } : {}),
  };
}

function parseNonNegativeNumber(value: string | undefined): number | undefined {
  const n = Number(value ?? "");
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  const n = parseNonNegativeNumber(value);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function rollBin(): string {
  return (process.env["ROLL_BIN"] ?? "").trim() || process.argv[1] || "roll";
}

function startGoTmux(input: StartTmuxInput): boolean {
  const session = `roll-loop-${input.slug}`;
  const rt = runtimeDir(input.projectPath);
  const workerArgs = input.args
    .filter((arg) => arg !== "--worker" && arg !== "--no-tmux")
    .concat("--worker")
    .map(shellQuote)
    .join(" ");
  const watch = `printf 'roll goal · ${input.slug}\\n'; tail -n +1 -F ${shellQuote(join(rt, "live.log"))} | ${shellQuote(input.rollBin)} loop fmt`;
  try {
    if (spawnSync("tmux", ["has-session", "-t", session], { stdio: "ignore" }).status !== 0) {
      spawnSync("tmux", ["new-session", "-d", "-s", session, "-x", "200", "-y", "50", "-n", "watch", watch], { stdio: "ignore" });
    }
    const command = `cd ${shellQuote(input.projectPath)} && ROLL_LOOP_GO_WORKER=1 ROLL_LOOP_NO_TMUX=1 ROLL_BIN=${shellQuote(input.rollBin)} ${shellQuote(input.rollBin)} loop go ${workerArgs}`;
    return spawnSync("tmux", ["new-window", "-d", "-t", session, "-n", "go", command], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

function realRunOnce(input: RunOnceInput): Promise<number> {
  const bin = rollBin();
  const cmd = bin.endsWith(".js") || bin.endsWith(".mjs") ? process.execPath : bin;
  const args = cmd === process.execPath ? [bin, "loop", "run-once"] : ["loop", "run-once"];
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: input.projectPath,
      detached: true,
      env: { ...process.env, ROLL_LOOP_GO_CHILD: "1" },
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

function writeGoal(path: string, goal: RollGoal): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, renderGoalYaml(goal), "utf8");
  renameSync(tmp, path);
}

function readGoal(path: string): RollGoal | undefined {
  if (!existsSync(path)) return undefined;
  return parseGoalYaml(readFileSync(path, "utf8"));
}

function createGoal(opts: GoOptions, at: string): RollGoal {
  return {
    schema: GOAL_SCHEMA_VERSION,
    scope: opts.scope,
    ...(opts.budgetUsd !== undefined ? { budgetUsd: opts.budgetUsd } : {}),
    limits: {
      ...(opts.maxCycles !== undefined ? { maxCycles: opts.maxCycles } : {}),
    },
    status: "active",
    usage: { cycles: 0, costUsd: 0 },
    createdAt: at,
    updatedAt: at,
  };
}

function summarizeRuns(path: string): RunSummary {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { cycles: 0, costUsd: 0 };
  }
  let cycles = 0;
  let costUsd = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    cycles += 1;
    const effective = typeof row["cost_effective_usd"] === "number" ? row["cost_effective_usd"] : undefined;
    const estimated = typeof row["cost_usd"] === "number" ? row["cost_usd"] : undefined;
    costUsd += effective ?? estimated ?? 0;
  }
  return { cycles, costUsd };
}

function hasSafetyPauseSince(path: string, since: number): boolean {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (row["type"] === "policy:safety_pause" && typeof row["ts"] === "number" && row["ts"] >= since) return true;
  }
  return false;
}

function sessionId(at: string, pid: number): string {
  const compact = at.replace(/\D/g, "").slice(0, 14) || String(Date.now());
  return `goal-${compact}-${pid}`;
}

function appendGoalState(bus: EventBus, path: string, from: GoalStatus, goal: RollGoal, actor: "owner" | "system", reason: string, ts: number): void {
  bus.appendEvent(path, {
    type: "goal:state",
    schema: GOAL_SCHEMA_VERSION,
    from,
    to: goal.status,
    actor,
    reason,
    ts,
  });
}

function pauseGoal(projectPath: string, bus: EventBus, reason: string, at: string, ts: number): RollGoal | undefined {
  const path = goalPath(projectPath);
  const goal = readGoal(path);
  if (goal === undefined) return undefined;
  if (goal.status === "paused" || goal.status === "complete") return goal;
  const next = transitionGoal(goal, "paused", { actor: "system", reason, at });
  writeGoal(path, next);
  appendGoalState(bus, eventsPath(projectPath), goal.status, next, "system", reason, ts);
  return next;
}

function updateUsage(projectPath: string, goal: RollGoal, baseline: RunSummary, initial: RunSummary, at: string): RollGoal {
  const current = summarizeRuns(runsPath(projectPath));
  return {
    ...goal,
    usage: {
      cycles: initial.cycles + Math.max(0, current.cycles - baseline.cycles),
      costUsd: initial.costUsd + Math.max(0, current.costUsd - baseline.costUsd),
    },
    updatedAt: at,
  };
}

function installStopHandlers(onStop: (signal: string) => void): () => void {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  const handlers = signals.map((signal) => {
    const handler = (): void => onStop(signal);
    process.on(signal, handler);
    return { signal, handler };
  });
  return () => {
    for (const { signal, handler } of handlers) process.off(signal, handler);
  };
}

export async function loopGoCommand(args: string[], deps: LoopGoDeps = realDeps()): Promise<number> {
  const opts = parseOptions(args);
  const id = await deps.identity();
  if (!opts.worker && !opts.noTmux && deps.hasTmux()) {
    const started = deps.startTmux({ projectPath: id.path, slug: id.slug, args, rollBin: rollBin() });
    if (started) {
      process.stdout.write(
        `Goal go session started in tmux — attach anytime: tmux attach -t roll-loop-${id.slug}\n` +
          `goal 连跑会话已在 tmux 启动 — 可随时观察: tmux attach -t roll-loop-${id.slug}\n`,
      );
      return 0;
    }
  }
  return runGoWorker(id, opts, deps);
}

async function runGoWorker(id: ProjectId, opts: GoOptions, deps: LoopGoDeps): Promise<number> {
  const rt = runtimeDir(id.path);
  mkdirSync(rt, { recursive: true });
  const bus = new EventBus();
  const evPath = eventsPath(id.path);
  const lockPath = goLockPath(id.path);
  const acq = acquireLock(lockPath, deps.pid(), { staleSec: GO_LOCK_STALE_SEC, now: deps.nowSec });
  if (!acq.acquired) {
    bus.appendEvent(evPath, {
      type: "goal:tick_skipped",
      reason: "go_session_lock",
      ...(acq.heldByPid !== undefined ? { heldByPid: acq.heldByPid } : {}),
      ts: deps.nowSec(),
    });
    process.stdout.write(`roll loop go: go session already active (pid ${acq.heldByPid ?? "?"}); skipped\n`);
    return 0;
  }

  const startedAt = deps.nowIso();
  const startedSec = deps.nowSec();
  const sid = sessionId(startedAt, deps.pid());
  const baseline = summarizeRuns(runsPath(id.path));
  let initialUsage: RunSummary = { cycles: 0, costUsd: 0 };
  let goal: RollGoal;
  let stopReason: string | undefined;
  let stopRequested = false;
  const disposeSignals = installStopHandlers((signal) => {
    stopRequested = true;
    stopReason = `signal_${signal}`;
  });

  try {
    const gPath = goalPath(id.path);
    const existing = readGoal(gPath);
    if (existing === undefined) {
      goal = createGoal(opts, startedAt);
      writeGoal(gPath, goal);
      bus.appendEvent(evPath, {
        type: "goal:created",
        schema: GOAL_SCHEMA_VERSION,
        scope: goal.scope,
        status: "active",
        ...(goal.budgetUsd !== undefined ? { budgetUsd: goal.budgetUsd } : {}),
        ts: startedSec,
      });
    } else if (existing.status === "complete") {
      process.stderr.write("roll loop go: goal is already complete; refusing to restart it\n");
      return 1;
    } else if (existing.status === "active") {
      goal = existing;
    } else {
      goal = transitionGoal(existing, "active", { actor: "owner", reason: "go_start", at: startedAt });
      writeGoal(gPath, goal);
      appendGoalState(bus, evPath, existing.status, goal, "owner", "go_start", startedSec);
    }
    initialUsage = { ...goal.usage };
    bus.appendEvent(evPath, { type: "goal:session_start", sessionId: sid, scope: goal.scope, ts: startedSec });

    while (true) {
      if (stopRequested) break;
      if (existsSync(pauseMarkerPath(id.path, id.slug))) {
        stopReason = "pause_marker";
        break;
      }
      const maxCycles = goal.limits.maxCycles;
      if (maxCycles !== undefined && goal.usage.cycles >= maxCycles) {
        stopReason = "max_cycles";
        break;
      }

      const before = summarizeRuns(runsPath(id.path));
      await deps.runOnce({ projectPath: id.path });
      goal = updateUsage(id.path, goal, baseline, initialUsage, deps.nowIso());
      writeGoal(gPath, goal);
      const after = summarizeRuns(runsPath(id.path));

      if (hasSafetyPauseSince(evPath, startedSec)) {
        stopReason = "safety_pause";
        break;
      }
      if (existsSync(pauseMarkerPath(id.path, id.slug))) {
        stopReason = "pause_marker";
        break;
      }
      if (after.cycles <= before.cycles) {
        stopReason = "no_cycle_terminal";
        break;
      }
    }

    const finalReason = stopReason ?? "stop_requested";
    const paused = pauseGoal(id.path, bus, finalReason, deps.nowIso(), deps.nowSec()) ?? goal;
    bus.appendEvent(evPath, {
      type: "goal:session_end",
      sessionId: sid,
      status: paused.status,
      reason: finalReason,
      cycles: paused.usage.cycles - initialUsage.cycles,
      ts: deps.nowSec(),
    });
    process.stdout.write(`roll loop go: stopped at cycle boundary (${finalReason})\n`);
    return 0;
  } finally {
    disposeSignals();
    releaseLock(lockPath);
  }
}
