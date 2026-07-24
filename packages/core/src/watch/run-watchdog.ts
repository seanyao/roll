/**
 * US-CYCLE-001 — shared run-watchdog: git-state liveness for ANY subagent run,
 * observed on the run's OWN working directory (its worktree), not the main
 * checkout. FIX-1477 put "git state = progress" into the loop runner's
 * spawn-observer, but the goal/supervisor + subagent path bypassed it entirely;
 * a builder that works inside a cycle worktree while the watchdog observes the
 * (static) main checkout would look like "no progress" forever → systematic
 * mis-kill. This is the single implementation both paths reuse.
 *
 * Pure orchestration: all observation (`progressSignals`) and effects
 * (`onTimeout`, `kill`) are injected. The verdict is {@link cycleTimeoutVerdict}
 * — the same decision the loop already used — so behavior is unchanged, only the
 * home and the cwd-binding contract are new.
 */
import { cycleTimeoutVerdict } from "../loop/orchestrator.js";

export type RunKillReason = "wall" | "no-progress" | "no-state-change";

export interface RunWatchThresholds {
  /** Absolute wall-clock ceiling (seconds). <= 0 disables. */
  wallSec: number;
  /** True-silence window: seconds with no progress signal at all. <= 0 disables. */
  noProgressSec: number;
  /** No-git-state-change window: seconds with no new commit / dirty change. <= 0 disables. */
  noStateChangeSec: number;
}

/**
 * Progress signals — MUST observe the run's own `cwd` (the worktree), so a
 * productive run is never mis-killed for the main checkout being static.
 */
export interface RunProgressSignals {
  /** commits-ahead count on the run's worktree branch. A rise is progress. */
  commitCount: () => Promise<number>;
  /** dirty-state fingerprint of the run cwd (e.g. `git status --porcelain`).
   *  A CHANGE is progress. Omit to track commits only. A thrown probe is a blip
   *  — skipped, never progress, never a kill. */
  stateSignature?: () => Promise<string>;
}

export interface RunTimeoutInfo {
  reason: RunKillReason;
  elapsedSec: number;
  idleSec: number;
  /** The run cwd the signals observed — for the record. */
  cwd: string;
}

export interface WatchRunOptions {
  /** The run's OWN working directory. The signals MUST observe THIS path. */
  cwd: string;
  /** Epoch SECONDS (injected clock). */
  clock: () => number;
  thresholds: RunWatchThresholds;
  progressSignals: RunProgressSignals;
  /** Called once when the watchdog trips, BEFORE the kill (so the trip is
   *  durable even if the kill races the process exiting). Best-effort. */
  onTimeout: (info: RunTimeoutInfo) => void;
  /** Kill the in-flight process tree; returns count signalled. */
  kill: () => number;
  /** Poll cadence (ms). */
  pollMs: number;
}

export interface RunWatchHandle {
  /** Reset ONLY the true-silence fuse (proof of liveness, not of work). */
  markProgress(): void;
  /** Stop the watchdog; returns why it fired (null = never tripped). */
  stop(): { firedReason: RunKillReason | null };
}

/**
 * Start a run-watchdog. Renews on progress, interrupts after the no-progress /
 * no-state-change / wall windows, and returns a structured kill reason. All
 * git-state observation happens on `opts.cwd` via the injected signals.
 */
export function watchRun(opts: WatchRunOptions): RunWatchHandle {
  const { cwd, clock, thresholds, progressSignals, onTimeout, kill, pollMs } = opts;
  const { commitCount, stateSignature } = progressSignals;
  // All criteria disabled → an inert handle (no timer, never fires).
  if (thresholds.wallSec <= 0 && thresholds.noProgressSec <= 0 && thresholds.noStateChangeSec <= 0) {
    return { markProgress: () => {}, stop: () => ({ firedReason: null }) };
  }
  const startSec = clock();
  let lastProgressSec = startSec;
  let lastStateSec = startSec;
  let lastCommitCount = -1;
  let lastSignature: string | undefined;
  let firedReason: RunKillReason | null = null;
  let running = false;

  const markProgress = (): void => {
    // stdout feeds ONLY the true-silence fuse — it is proof of liveness, not of
    // work; the git-state clock (lastStateSec) is untouched.
    lastProgressSec = clock();
  };

  const tick = async (): Promise<void> => {
    if (running || firedReason !== null) return; // don't stack ticks / re-fire
    running = true;
    try {
      // A NEW commit on the worktree branch is GIT-STATE progress — bumps BOTH clocks.
      try {
        const n = await commitCount();
        if (n > lastCommitCount) {
          lastCommitCount = n;
          const now = clock();
          lastProgressSec = now;
          lastStateSec = now;
        }
      } catch {
        /* a git-probe blip is NOT progress and NOT a reason to kill — skip */
      }
      // A dirty-state signature CHANGE is also git-state progress (bumps BOTH).
      // The first observation only establishes the baseline (never a bump).
      if (stateSignature !== undefined) {
        try {
          const sig = await stateSignature();
          if (lastSignature !== undefined && sig !== lastSignature) {
            const now = clock();
            lastProgressSec = now;
            lastStateSec = now;
          }
          lastSignature = sig;
        } catch {
          /* a signature-probe blip is NOT progress and NOT a kill — skip */
        }
      }
      const now = clock();
      const verdict = cycleTimeoutVerdict({
        elapsedSec: now - startSec,
        idleSec: now - lastProgressSec,
        stateIdleSec: now - lastStateSec,
        wallLimitSec: thresholds.wallSec,
        noProgressLimitSec: thresholds.noProgressSec,
        noStateChangeLimitSec: thresholds.noStateChangeSec,
      });
      if (verdict.timedOut && verdict.reason !== null) {
        firedReason = verdict.reason;
        clearInterval(timer);
        try {
          onTimeout({ reason: verdict.reason, elapsedSec: verdict.elapsedSec, idleSec: verdict.idleSec, cwd });
        } catch {
          /* onTimeout is best-effort; the kill below is the point */
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
  // Seed the baselines once up front so the first real change counts.
  void (async () => {
    try {
      lastCommitCount = await commitCount();
    } catch {
      /* baseline best-effort */
    }
    if (stateSignature !== undefined) {
      try {
        lastSignature = await stateSignature();
      } catch {
        /* baseline best-effort */
      }
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
