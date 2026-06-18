/**
 * ProcessManager — TS port of the v2 loop lock / heartbeat / signal discipline
 * (US-INFRA-006).
 *
 * ─── v2 oracle (frozen bash, bin/roll) ──────────────────────────────────────
 *   LOCK (single-flight re-entry guard):
 *     - outer PR-loop lock      8319-8336  `_write_pr_loop_runner_script`
 *         file shape: `printf '%s:%s\n' "$$" "$(date -u +%s)"` → `pid:ts`.
 *         stale rule: held iff `kill -0 $pid` AND `(now - ts) < 900`.
 *         else → `rm -f LOCK` and take over. `now = date -u +%s`.
 *     - inner loop lock         8411-8425  (FIX-031)
 *         same `pid:ts` shape; staleness threshold 14400s (4h). On a live,
 *         fresh lock the runner exits 0 (skip); else removes + takes over.
 *   HEARTBEAT:
 *     - writer                  8454-8472  `_heartbeat_writer`
 *         every 60s: `echo "$(date -u +%s)" > HEARTBEAT_FILE` (CONTENT is an
 *         epoch second, NOT relying on mtime).
 *     - liveness verdict        9430-9452  (monitor / orphan-heal path)
 *         `_hb_ts=$(cat HEARTBEAT_FILE); _hb_age=$((now - _hb_ts))`;
 *         alive iff `_hb_age < HEARTBEAT_TIMEOUT` where
 *         `HEARTBEAT_TIMEOUT="${ROLL_HEARTBEAT_TIMEOUT:-1800}"`.
 *         (The cycle hard-timeout `LOOP_CYCLE_TIMEOUT_SEC=${...:-2700}` at 8480
 *         is a SEPARATE watchdog that SIGTERMs the cycle; the orphan-liveness
 *         threshold a monitor reads is 1800. Both are exposed below.)
 *     - mtime helper            7757-7762  `_file_mtime`:
 *         `stat -c %Y || stat -f %m || echo 0`.
 *   SIGNALS (S3 — once a start signal is emitted, EVERY exit path must emit the
 *   matching end signal):
 *     - inner runner            8487-8488  `_on_sigterm(){ _CYCLE_TIMED_OUT=1; }`
 *                                          `trap '_on_sigterm' TERM`.
 *     - cleanup                 8765-8783  `_inner_cleanup`: UNCONDITIONALLY
 *         writes a terminal runs.jsonl row (idempotent), removes
 *         INNER_LOCK + HEARTBEAT_FILE + phase file, then `exit $_rc`.
 *         `trap '_inner_cleanup' EXIT` (8783) — fires on normal exit AND after
 *         the TERM handler, so the final write is guaranteed on any exit path.
 *
 * ─── Lib choice: plain files + node:fs, NOT proper-lockfile ─────────────────
 * The card warns off a fs-lock dep "unless v2 semantics genuinely need it".
 * They don't: v2's lock is a hand-rolled `pid:ts` text file with a bespoke
 * stale rule (PID liveness OR age threshold) and unconditional `rm -f`
 * takeover. proper-lockfile implements a DIFFERENT contract (mtime-refreshed,
 * compromise callbacks, retry/backoff) that would change observable behavior
 * (e.g. it would not take over a same-pid-reused lock the way bash's age gate
 * does). We mirror the bash file shape + rule exactly with `node:fs`. Zero
 * runtime deps. Deliberate.
 *
 * Clock + process-liveness are injected so the verdicts are unit-testable with
 * a fixture clock and a dead pid (a spawned-then-exited child).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExecOpts, ExecResult, ToolInvocation, ToolResult } from "@roll/spec";
import { BashTool, type BashInput, type BashOutput } from "./tools/bash.js";
import { infraToolExecFile, infraToolFs, invokeInfraTool, redactInfraToolValue } from "./tools/delegation.js";

/** v2 default: outer PR-loop lock staleness (bin/roll 8326). */
export const OUTER_LOCK_STALE_SEC = 900;
/** v2 default: inner loop lock staleness, FIX-031 (bin/roll 8418). */
export const INNER_LOCK_STALE_SEC = 14400;
/** v2 default: orphan-heal heartbeat liveness threshold (bin/roll 9430). */
export const HEARTBEAT_TIMEOUT_SEC = 1800;
/** v2 default: cycle hard-timeout watchdog, FIX-057 (bin/roll 8480). */
export const CYCLE_TIMEOUT_SEC = 2700;

/** Injectable wall clock — returns epoch SECONDS (UTC), matching `date -u +%s`. */
export type Clock = () => number;

/** Default clock: `Math.floor(Date.now()/1000)` == `date -u +%s`. */
export const systemClock: Clock = () => Math.floor(Date.now() / 1000);

/**
 * argv-only process execution through the governed bash tool. Existing lock and
 * heartbeat code stays file-based; new process call sites can use this seam to
 * emit tool events without depending on the core ToolRegistry package.
 */
export async function execFile(command: string, args: readonly string[], opts: ExecOpts = {}): Promise<ExecResult> {
  const tool = new BashTool();
  const result = await invokeInfraTool<BashInput, BashOutput>({
    declaration: tool.declaration,
    input: {
      command,
      args: [...args],
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      ...(opts.env !== undefined ? { env: { ...opts.env } } : {}),
    },
    policy: {
      timeoutMs: opts.timeoutMs,
      sandbox: {
        maxOutputBytes: opts.maxOutputBytes,
      },
    },
    run: (invocation: ToolInvocation<BashInput>): Promise<ToolResult<BashOutput>> => tool.execute(invocation, {
      fs: infraToolFs,
      now: () => Date.now(),
      execFile: infraToolExecFile,
      redact: redactInfraToolValue,
    }),
  });
  if (result.ok) return { ...result.output };
  return {
    exitCode: result.error.code === "timeout" ? 124 : 1,
    stdout: "",
    stderr: result.error.message,
    timedOut: result.error.code === "timeout",
  };
}

/**
 * Injectable PID-liveness probe — mirrors `kill -0 <pid>` (true = process
 * exists / signalable). Default uses `process.kill(pid, 0)`.
 */
export type PidAlive = (pid: number) => boolean;

/** Default liveness: `process.kill(pid, 0)` — true unless ESRCH (no process). */
export const systemPidAlive: PidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but is owned by another user → alive.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Parsed lock-file contents (`pid:ts`). `undefined` fields = unparseable. */
export interface LockContents {
  pid: number | undefined;
  ts: number | undefined;
}

/**
 * Parse a `pid:ts` lock line — mirrors bash `IFS=: read -r _pp _pt < LOCK`.
 * Only the first line is consulted; non-numeric fields → undefined.
 */
export function parseLock(raw: string): LockContents {
  const firstLine = raw.split("\n", 1)[0] ?? "";
  const colon = firstLine.indexOf(":");
  const pidStr = colon === -1 ? firstLine : firstLine.slice(0, colon);
  const tsStr = colon === -1 ? "" : firstLine.slice(colon + 1);
  const pid = /^\d+$/.test(pidStr.trim()) ? Number(pidStr.trim()) : undefined;
  const ts = /^\d+$/.test(tsStr.trim()) ? Number(tsStr.trim()) : undefined;
  return { pid, ts };
}

/** Serialize lock contents — mirrors `printf '%s:%s\n' "$$" "$(date -u +%s)"`. */
export function formatLock(pid: number, ts: number): string {
  return `${pid}:${ts}\n`;
}

/**
 * Decide whether an existing lock is HELD by a live owner — mirrors the bash
 * gate `kill -0 $pid && (now - ts) < threshold`.
 *
 * Held (skip / cannot take over) iff: pid parses AND ts parses AND the pid is
 * alive AND `(now - ts) < staleSec`. Anything else is stale → takeover allowed
 * (the oracle `rm -f`s and proceeds).
 */
export function isLockHeld(
  contents: LockContents,
  now: number,
  staleSec: number,
  pidAlive: PidAlive = systemPidAlive,
): boolean {
  if (contents.pid === undefined || contents.ts === undefined) return false;
  if (!pidAlive(contents.pid)) return false;
  return now - contents.ts < staleSec;
}

/** Outcome of {@link acquireLock}. */
export interface AcquireResult {
  /** true = we now hold the lock (wrote our pid:ts). */
  acquired: boolean;
  /** When `acquired` is false, the live owner's pid (mirrors the bash skip). */
  heldByPid: number | undefined;
}

/**
 * Acquire `lockPath`, mirroring the runner's re-entry guard
 * (bin/roll 8323-8337 / 8412-8425):
 *   - `mkdir -p $(dirname lock)`.
 *   - if the file exists and {@link isLockHeld} → DO NOT acquire; report the
 *     live owner's pid (bash `exit 0` / skip).
 *   - else `rm -f` any stale lock and write `pid:ts` (takeover / fresh).
 *
 * @param staleSec  {@link OUTER_LOCK_STALE_SEC} or {@link INNER_LOCK_STALE_SEC}.
 */
export function acquireLock(
  lockPath: string,
  pid: number = process.pid,
  opts: { now?: Clock; staleSec?: number; pidAlive?: PidAlive } = {},
): AcquireResult {
  const now = (opts.now ?? systemClock)();
  const staleSec = opts.staleSec ?? OUTER_LOCK_STALE_SEC;
  const pidAlive = opts.pidAlive ?? systemPidAlive;
  mkdirSync(dirname(lockPath), { recursive: true });
  if (existsSync(lockPath)) {
    const contents = parseLock(readFileSync(lockPath, "utf8"));
    if (isLockHeld(contents, now, staleSec, pidAlive)) {
      return { acquired: false, heldByPid: contents.pid };
    }
    rmSyncQuiet(lockPath); // stale → bash `rm -f LOCK`
  }
  writeFileSync(lockPath, formatLock(pid, now), "utf8");
  return { acquired: true, heldByPid: undefined };
}

/**
 * Release a lock — mirrors `rm -f LOCK` (the EXIT trap, bin/roll 8332/8777).
 * Idempotent and tolerant of an already-absent file.
 */
export function releaseLock(lockPath: string): void {
  rmSyncQuiet(lockPath);
}

// ─── heartbeat ────────────────────────────────────────────────────────────────

/**
 * Write the heartbeat — mirrors `_heartbeat_writer`'s per-tick line
 * (bin/roll 8456): `echo "$(date -u +%s)" > HEARTBEAT_FILE`. The CONTENT is the
 * epoch second; liveness reads the content (not mtime). Creates parent dirs.
 */
export function writeHeartbeat(heartbeatPath: string, now: Clock = systemClock): void {
  mkdirSync(dirname(heartbeatPath), { recursive: true });
  writeFileSync(heartbeatPath, `${now()}\n`, "utf8");
}

/**
 * Heartbeat age in seconds — mirrors `_hb_ts=$(cat FILE); $((now - _hb_ts))`
 * (bin/roll 9448-9450). A missing file or unparseable content reads as `_hb_ts`
 * 0 (bash `cat ... || echo "0"`), i.e. age = `now` (effectively dead).
 * Returns `undefined` only when the file is absent AND the caller wants to
 * distinguish missing — here we mirror bash and treat missing as ts=0.
 */
export function heartbeatAge(heartbeatPath: string, now: Clock = systemClock): number {
  let ts = 0;
  if (existsSync(heartbeatPath)) {
    const raw = readFileSync(heartbeatPath, "utf8").trim();
    ts = /^\d+$/.test(raw) ? Number(raw) : 0;
  }
  return now() - ts;
}

/**
 * Liveness verdict — mirrors the orphan-heal gate (bin/roll 9450-9452):
 * alive iff `heartbeatAge < timeoutSec`. A missing/stale heartbeat → dead
 * (the bash path then heals `status: running` → `idle`).
 *
 * @param timeoutSec defaults to {@link HEARTBEAT_TIMEOUT_SEC} (1800, the
 *   `ROLL_HEARTBEAT_TIMEOUT` default the monitor uses).
 */
export function livenessVerdict(
  heartbeatPath: string,
  opts: { now?: Clock; timeoutSec?: number } = {},
): { alive: boolean; ageSec: number } {
  const now = opts.now ?? systemClock;
  const timeoutSec = opts.timeoutSec ?? HEARTBEAT_TIMEOUT_SEC;
  const ageSec = heartbeatAge(heartbeatPath, now);
  return { alive: ageSec < timeoutSec, ageSec };
}

/**
 * Cross-platform file mtime in epoch seconds — mirrors `_file_mtime`
 * (bin/roll 7757-7762): `stat -c %Y || stat -f %m || echo 0`. Missing file → 0.
 * Provided for callers that need the mtime fallback path; the primary heartbeat
 * liveness uses CONTENT (see {@link heartbeatAge}), matching v2 exactly.
 */
export function fileMtime(path: string): number {
  try {
    return Math.floor(statSync(path).mtimeMs / 1000);
  } catch {
    return 0;
  }
}

// ─── signal / exit discipline (S3) ────────────────────────────────────────────

/** Handle returned by {@link installExitHooks} so a caller can detach hooks. */
export interface ExitHooks {
  /** Remove all installed listeners (idempotent). */
  uninstall(): void;
}

/**
 * Install the unconditional final-write discipline — mirrors
 * `trap '_on_sigterm' TERM` + `trap '_inner_cleanup' EXIT` (bin/roll 8488/8783).
 *
 * Invariant S3: once a cycle's start signal is emitted, EVERY exit path must
 * emit the matching end signal. The bash runner guarantees this by trapping
 * EXIT (fires on normal return AND after the TERM handler) and doing the
 * terminal write there. We reproduce it:
 *   - `final` runs EXACTLY ONCE, on the first of: normal `exit`, SIGTERM,
 *     SIGINT (the equivalent of bash's EXIT trap covering all paths).
 *   - on a signal we run `final` then re-raise default disposition so the
 *     process still terminates with the conventional 128+signo code — matching
 *     the bash trap which performs cleanup then lets the process exit.
 *   - `final` MUST be synchronous (Node's `'exit'` event cannot await), exactly
 *     like the bash cleanup which is straight-line shell.
 *
 * @param final  the terminal write (idempotent recommended, as `_inner_cleanup`
 *               is — it dedupes the runs.jsonl row).
 */
export function installExitHooks(final: () => void, target: NodeJS.Process = process): ExitHooks {
  let ran = false;
  const runOnce = (): void => {
    if (ran) return;
    ran = true;
    final();
  };

  const onExit = (): void => {
    runOnce(); // covers normal exit + the path after a signal handler
  };
  const onSignal = (signal: NodeJS.Signals): void => {
    runOnce();
    // Re-raise with default disposition so we exit 128+signo (bash semantics):
    // remove our handler, then re-send the signal to ourselves.
    target.removeListener(signal, onSignal as (...a: unknown[]) => void);
    target.kill(target.pid, signal);
  };

  target.on("exit", onExit);
  target.on("SIGTERM", onSignal);
  target.on("SIGINT", onSignal);

  return {
    uninstall(): void {
      target.removeListener("exit", onExit);
      target.removeListener("SIGTERM", onSignal as (...a: unknown[]) => void);
      target.removeListener("SIGINT", onSignal as (...a: unknown[]) => void);
    },
  };
}

function rmSyncQuiet(p: string): void {
  try {
    rmSync(p, { force: true });
  } catch {
    /* lenient: mirrors `rm -f ... 2>/dev/null || true` */
  }
}
