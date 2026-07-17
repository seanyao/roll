import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CYCLE_NO_PROGRESS_SEC,
  CYCLE_STALL_THRESHOLD_SEC,
  CYCLE_WALL_TIMEOUT_SEC,
  STALL_STARTUP_GRACE_SEC,
  baselineCommits,
  cycleTimeoutVerdict,
  maybeBuildHeartbeat,
  newCycleObserverState,
  newNormalizerState,
  normalizerFor,
  observeBuildStart,
  observeCommits,
  stallVerdict,
  type ActivitySignal,
  type AgentActivityNormalizer,
  type CycleObserverState,
  type NormalizerState,
} from "@roll/core";
import type { RollEvent } from "@roll/spec";
import { parseCaptureMarker, type CaptureMarker, type ScreenshotResult } from "@roll/infra";
import { killLiveAgents } from "./agent-spawn.js";
import type { CapturePort, Ports } from "./ports.js";
import { epochMs } from "./runner-time.js";
import { parsePolicy } from "@roll/core";

export class ActivitySignalRecorder {
  private buffered = "";
  private readonly normalizer: AgentActivityNormalizer;
  private readonly state: NormalizerState;

  constructor(
    private readonly signalPath: string,
    agent: string,
    banner: string,
    private readonly nowMs: () => number,
  ) {
    this.normalizer = normalizerFor(agent);
    this.state = newNormalizerState();
    try {
      mkdirSync(dirname(signalPath), { recursive: true });
      writeFileSync(signalPath, "", "utf8");
    } catch {
      /* best-effort projection */
    }
    this.recordLine(banner);
  }

  accept(chunk: Buffer): void {
    this.buffered += chunk.toString("utf8");
    const lines = this.buffered.split(/\r?\n/);
    this.buffered = lines.pop() ?? "";
    for (const line of lines) this.recordLine(line);
  }

  flush(): void {
    if (this.buffered.trim() !== "") this.recordLine(this.buffered);
    this.buffered = "";
  }

  private recordLine(line: string): void {
    const signals = this.normalizer.normalize(line, this.state, this.nowMs());
    if (signals.length === 0) return;
    this.append(signals);
  }

  private append(signals: readonly ActivitySignal[]): void {
    try {
      appendFileSync(this.signalPath, signals.map((sig) => JSON.stringify(sig)).join("\n") + "\n", "utf8");
    } catch {
      /* best-effort projection */
    }
  }
}

/** Default poll cadence for the runner's build-phase observation (ms). Frequent
 *  enough that a new TCR commit becomes an event within a few seconds; cheap (one
 *  `git log` per tick). Overridable via ROLL_OBSERVE_POLL_MS for tests. */
const OBSERVE_POLL_MS = 5_000;

/**
 * US-LOOP-076 — start the runner's agent-agnostic cycle observer for the build
 * phase. Emits the build-start phase marker immediately, then polls the worktree
 * git log on a timer, deriving standard {@link RollEvent}s (cycle:tcr per new
 * commit, a periodic build heartbeat) into events.ndjson. Returns a handle whose
 * `stop()` clears the timer AND takes one final await'd snapshot so the last
 * commits before agent exit are never dropped.
 *
 * All meaning lives in @roll/core's pure {@link observeCommits} /
 * {@link maybeBuildHeartbeat}; this is just the I/O loop (git read + event
 * append). Best-effort throughout: observation must NEVER fail the cycle.
 */
export async function startCycleObserver(
  ports: Ports,
  cycleId: string,
  // E4: the worktree the agent's commits actually land in. A submodule cycle
  // passes the submodule cycle worktree so the runner observes the RIGHT branch's
  // commits; omitted ⇒ ports.paths.worktreePath (the superproject worktree),
  // byte-identical to before.
  observeCwd: string = ports.paths.worktreePath,
): Promise<{ stop(): Promise<void> }> {
  if (cycleId === "") return { stop: async () => {} };
  const st: CycleObserverState = newCycleObserverState(cycleId);
  const emit = (events: RollEvent[]): void => {
    for (const ev of events) {
      try {
        ports.events.appendEvent(ports.paths.eventsPath, ev);
      } catch {
        /* observation append is best-effort */
      }
    }
  };
  const pollGapMs = Number((process.env["ROLL_OBSERVE_POLL_MS"] ?? "").trim()) || OBSERVE_POLL_MS;
  try {
    baselineCommits(await ports.git.recentCommits(observeCwd), st);
  } catch {
    /* baseline is best-effort; observation must not block the cycle */
  }
  emit(observeBuildStart(st, Date.now()));
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return; // a slow git read must not stack ticks
    running = true;
    try {
      const commits = await ports.git.recentCommits(observeCwd);
      const now = Date.now();
      emit(observeCommits(commits, st, now));
      emit(maybeBuildHeartbeat(st, now));
    } catch {
      /* never let a probe blip topple the cycle */
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), pollGapMs);
  timer.unref?.();
  return {
    stop: async () => {
      clearInterval(timer);
      // One final synchronous snapshot — captures the TCR commits that landed
      // between the last tick and the agent exiting.
      await tick();
    },
  };
}

// ── FIX-907: per-cycle HARD timeout watchdog (the hung-builder killer) ────────

/** Resolved per-cycle timeout thresholds (seconds). 0 / negative ⇒ DISABLED. */
export interface CycleTimeoutThresholds {
  wallSec: number;
  noProgressSec: number;
}

/** Poll cadence (ms) for the timeout watchdog. Frequent enough that a breach is
 *  acted on within a few seconds of crossing a threshold, cheap (one `git log`).
 *  Overridable via ROLL_TIMEOUT_POLL_MS for tests. */
const TIMEOUT_POLL_MS = 5_000;

/**
 * FIX-907 — resolve the per-cycle hard-timeout thresholds. Order:
 *   1. env override (ROLL_CYCLE_WALL_TIMEOUT_SEC / ROLL_CYCLE_NO_PROGRESS_SEC) —
 *      lets an operator (or a test) pin a value without editing policy.yaml;
 *   2. `<repoCwd>/.roll/policy.yaml` loop_safety.{cycle_wall_timeout_sec,
 *      cycle_no_progress_sec};
 *   3. the core defaults (45min wall / 15min no-progress).
 * A 0 / negative value DISABLES that criterion. Best-effort: an unreadable /
 * unparseable policy degrades to defaults (the watchdog must never topple a cycle
 * by failing to read config).
 */
export function readCycleTimeoutThresholds(repoCwd: string): CycleTimeoutThresholds {
  const envNum = (key: string): number | undefined => {
    const raw = (process.env[key] ?? "").trim();
    if (raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  let wallSec = CYCLE_WALL_TIMEOUT_SEC;
  let noProgressSec = CYCLE_NO_PROGRESS_SEC;
  try {
    const p = join(repoCwd, ".roll", "policy.yaml");
    if (existsSync(p)) {
      const ls = parsePolicy(readFileSync(p, "utf8")).loopSafety;
      wallSec = ls.cycleWallTimeoutSec;
      noProgressSec = ls.cycleNoProgressSec;
    }
  } catch {
    /* unreadable policy → core defaults */
  }
  return {
    wallSec: envNum("ROLL_CYCLE_WALL_TIMEOUT_SEC") ?? wallSec,
    noProgressSec: envNum("ROLL_CYCLE_NO_PROGRESS_SEC") ?? noProgressSec,
  };
}

/** FIX-929 — resolved stall-detection threshold. */
export interface StallThresholdConfig {
  thresholdSec: number;
}

/**
 * FIX-929 — resolve the stall-detection threshold. Order:
 *   1. Env override (ROLL_LOOP_STALL_THRESHOLD_MIN) — operator/test can pin a
 *      value without editing policy.yaml;
 *   2. The core default ({@link CYCLE_STALL_THRESHOLD_SEC}, 600s = 10min).
 * 0 / negative ⇒ stall detection DISABLED.
 */
export function readStallThreshold(repoCwd: string): StallThresholdConfig {
  const envNum = (key: string): number | undefined => {
    const raw = (process.env[key] ?? "").trim();
    if (raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const thresholdSec = envNum("ROLL_LOOP_STALL_THRESHOLD_MIN");
  return { thresholdSec: thresholdSec ?? CYCLE_STALL_THRESHOLD_SEC };
}

/** A live timeout-watchdog handle. `markProgress()` resets the no-progress clock
 *  (the spawn calls it on every stdout chunk); `stop()` clears the timer and
 *  returns whether the watchdog fired (so the caller can fold it into the spawn
 *  result's `timedOut`). */
export interface SpawnTimeoutWatchdog {
  markProgress(): void;
  stop(): { firedReason: "wall" | "no-progress" | null };
}

/**
 * FIX-907 — start the per-cycle HARD-timeout watchdog around a blocking agent
 * spawn. The spawn is a single `await`, so the orchestrator's between-step
 * watchdog cannot fire while a builder hangs; this poller closes that hole.
 *
 * It wakes on a timer and asks the PURE {@link cycleTimeoutVerdict} whether the
 * cycle has breached either criterion:
 *   • WALL — `now - spawnStart >= wallSec`.
 *   • NO-PROGRESS — `now - lastProgress >= noProgressSec`, where `lastProgress`
 *     is bumped by (a) a NEW commit observed on the worktree branch (a `git log`
 *     count probe each tick) and (b) every stdout chunk (`markProgress`). This
 *     dual signal is the误杀-prevention核心: a slow `deepseek` call sits at 0%
 *     CPU yet keeps emitting stdout, so its no-progress clock keeps resetting and
 *     it is NEVER killed — only a TRULY silent hang (no commit, no output) trips.
 *
 * On a breach it KILLS the agent process tree ({@link killLiveAgents} SIGKILL —
 * the same teardown FIX-204D uses, reaping the PTY-wrapped group), emits the
 * auditable `cycle:timeout` event (cycleId + reason + elapsed/idle), and records
 * the reason. The spawn's own `child.on("exit")` then resolves; the caller folds
 * `firedReason !== null` into `timedOut`, so the orchestrator runs its existing
 * clean teardown (`abort_timeout` → kill + cycle:end blocked + RELEASE LOCK; the
 * worktree branch is PRESERVED — timeoutTeardownCommands never cleans it).
 *
 * Best-effort throughout: a probe blip / append failure never crashes the
 * watchdog (it would otherwise leave the agent un-killed). Injectable seams
 * (`clock`, `commitCount`, `appendEvent`, `kill`, `pollMs`) keep it unit-testable
 * with NO real agent / git / timer.
 */
export function startSpawnTimeoutWatchdog(opts: {
  cycleId: string;
  thresholds: CycleTimeoutThresholds;
  /** Epoch SECONDS (injected — the runner's ProcessClock). */
  clock: () => number;
  /** Observe commits-ahead on the worktree branch (progress signal). */
  commitCount: () => Promise<number>;
  /** Append the cycle:timeout event (best-effort). */
  appendEvent: (ev: RollEvent) => void;
  /** Kill the in-flight agent process tree (returns count signalled). */
  kill?: () => number;
  /** Poll cadence ms (default {@link TIMEOUT_POLL_MS}; tests pin a small value). */
  pollMs?: number;
}): SpawnTimeoutWatchdog {
  const { cycleId, thresholds, clock, commitCount, appendEvent } = opts;
  const kill = opts.kill ?? ((): number => killLiveAgents("SIGKILL"));
  const pollMs = opts.pollMs ?? (Number((process.env["ROLL_TIMEOUT_POLL_MS"] ?? "").trim()) || TIMEOUT_POLL_MS);
  // Both criteria disabled → an inert handle (no timer, never fires).
  if (thresholds.wallSec <= 0 && thresholds.noProgressSec <= 0) {
    return { markProgress: () => {}, stop: () => ({ firedReason: null }) };
  }
  const startSec = clock();
  let lastProgressSec = startSec;
  let lastCommitCount = -1;
  let firedReason: "wall" | "no-progress" | null = null;
  let running = false;

  const markProgress = (): void => {
    lastProgressSec = clock();
  };

  const tick = async (): Promise<void> => {
    if (running || firedReason !== null) return; // don't stack ticks / re-fire
    running = true;
    try {
      // A NEW commit on the worktree branch is progress (bumps the idle clock).
      try {
        const n = await commitCount();
        if (n > lastCommitCount) {
          lastCommitCount = n;
          lastProgressSec = clock();
        }
      } catch {
        /* a git-probe blip is NOT progress and NOT a reason to kill — skip */
      }
      const now = clock();
      const verdict = cycleTimeoutVerdict({
        elapsedSec: now - startSec,
        idleSec: now - lastProgressSec,
        wallLimitSec: thresholds.wallSec,
        noProgressLimitSec: thresholds.noProgressSec,
      });
      if (verdict.timedOut) {
        firedReason = verdict.reason;
        clearInterval(timer);
        // Record FIRST (durable), then kill — so the trip is observable even if
        // the kill races the process exiting on its own.
        try {
          appendEvent({
            type: "cycle:timeout",
            cycleId,
            reason: verdict.reason,
            elapsedSec: verdict.elapsedSec,
            idleSec: verdict.idleSec,
            ts: epochMs(now),
          });
        } catch {
          /* event append is best-effort; the kill below is the point */
        }
        try {
          kill();
        } catch {
          /* the spawn's exit handler still settles the promise */
        }
      }
    } finally {
      running = false;
    }
  };
  // Seed the commit baseline once up front so the first real new commit counts.
  void (async () => {
    try {
      lastCommitCount = await commitCount();
    } catch {
      /* baseline best-effort */
    }
  })();
  const timer = setInterval(() => void tick(), pollMs);
  timer.unref?.();
  return {
    markProgress,
    stop: () => {
      clearInterval(timer);
      return { firedReason };
    },
  };
}

/** FIX-929 — agent stall detector. Monitors agent output (stdout token stream)
 *  and emits a SOFT `agent:stall` signal when the agent has been completely
 *  silent for ≥ threshold seconds AFTER the startup grace period. Does NOT kill
 *  the agent — it signals the recovery layer (FIX-930) to switch agents before
 *  the hard timeout watchdog (FIX-907) kills the process.
 *
 *  Distinction from {@link startSpawnTimeoutWatchdog}:
 *    • Stall detector — SOFT signal at 10min (configurable); no kill; 2min grace.
 *    • Timeout watchdog — HARD kill at 15min no-progress / 45min wall.
 */
export interface StallDetector {
  /** Bump the last-progress clock (called on every agent stdout chunk). */
  markProgress(): void;
  /** Stop the timer. Returns whether stall was detected. */
  stop(): { stalled: boolean };
}

/** FIX-929 — start the per-cycle stall detector. Emits `agent:stall` once when
 *  the agent is idle for ≥ the threshold after the startup grace. Best-effort;
 *  a probe blip never crashes the detector. Overridable via
 *  `ROLL_LOOP_STALL_THRESHOLD_MIN` env var. */
export function startStallDetector(opts: {
  cycleId: string;
  agent: string;
  /** Epoch SECONDS (injected — the runner's ProcessClock). */
  clock: () => number;
  /** Append the agent:stall event (best-effort). */
  appendEvent: (ev: RollEvent) => void;
  /** Stall threshold seconds (default {@link CYCLE_STALL_THRESHOLD_SEC}). */
  thresholdSec?: number;
  /** Startup grace seconds (default {@link STALL_STARTUP_GRACE_SEC}). */
  startupGraceSec?: number;
  /** Poll cadence ms (default 5s; tests pin a small value). */
  pollMs?: number;
}): StallDetector {
  const { cycleId, agent, clock, appendEvent } = opts;
  const thresholdSec = opts.thresholdSec ?? CYCLE_STALL_THRESHOLD_SEC;
  const startupGraceSec = opts.startupGraceSec ?? STALL_STARTUP_GRACE_SEC;
  const pollMs = opts.pollMs ?? (Number((process.env["ROLL_STALL_POLL_MS"] ?? "").trim()) || 5_000);
  // Disabled → inert handle (no timer, never fires).
  if (thresholdSec <= 0) {
    return { markProgress: () => {}, stop: () => ({ stalled: false }) };
  }
  const startSec = clock();
  let lastProgressSec = startSec;
  let fired = false;
  let running = false;

  const markProgress = (): void => {
    lastProgressSec = clock();
  };

  const tick = (): void => {
    if (running || fired) return;
    running = true;
    try {
      const now = clock();
      const verdict = stallVerdict({
        elapsedSec: now - startSec,
        idleSec: now - lastProgressSec,
        stallThresholdSec: thresholdSec,
        startupGraceSec,
        alreadyFired: fired,
      });
      if (verdict.stalled) {
        fired = true;
        clearInterval(timer);
        try {
          appendEvent({
            type: "agent:stall",
            cycleId,
            agent,
            idleSec: verdict.idleSec,
            thresholdSec: verdict.thresholdSec,
            ts: Date.now(),
          });
        } catch {
          /* event append is best-effort */
        }
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, pollMs);
  timer.unref?.();
  return {
    markProgress,
    stop: () => {
      clearInterval(timer);
      return { stalled: fired };
    },
  };
}

export function createCaptureMarkerSink(runDir: string, capture: CapturePort): { onChunk(chunk: Buffer): void; flush(): Promise<void> } {
  let buf = "";
  const pending: Promise<void>[] = [];
  const logPath = join(runDir, "evidence", "capture-markers.log");
  const record = (marker: CaptureMarker, result: ScreenshotResult): void => {
    try {
      mkdirSync(dirname(logPath), { recursive: true });
      appendFileSync(logPath, JSON.stringify({ marker, result }) + "\n", "utf8");
    } catch {
      /* evidence logging is best-effort */
    }
  };
  const runMarker = (line: string): void => {
    const marker = parseCaptureMarker(line);
    if (marker === null) return;
    pending.push(
      capture
        .fromMarker(marker, runDir)
        .then((result) => record(marker, result))
        .catch((e: unknown) =>
          record(marker, {
            kind: marker.kind,
            out: join(runDir, "screenshots", `${marker.phase}-${marker.stem}.png`),
            taken: false,
            skipped: `capture errored: ${String(e)}`,
            failed: true,
            error: String(e),
          }),
        ),
    );
  };
  return {
    onChunk(chunk) {
      buf += chunk.toString("utf8");
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) runMarker(line);
    },
    async flush() {
      if (buf.trim() !== "") runMarker(buf);
      buf = "";
      await Promise.allSettled(pending);
    },
  };
}
