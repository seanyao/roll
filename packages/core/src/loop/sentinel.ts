/**
 * Sentinel remote status-push — pure decision layer (US-LOOP-008 / v2 US-OBS-014,
 * invariants US-O-005 / F4: "loop online but no work" must be distinguishable
 * from "loop offline" on the remote watch).
 *
 * ─── v2 oracle (frozen bash, bin/roll) ──────────────────────────────────────
 *   The push entry point is `_loop_push_status_snapshot` (bin/roll 8091-8144).
 *   It is a best-effort, background, fail-soft push of a status snapshot to the
 *   roll-meta checkout so the remote-watch prompt always sees ≤35-min-fresh data
 *   with NO user-side cron.
 *
 *   CADENCE — it is invoked from the runner on BOTH terminal cycle paths:
 *     - idle terminal       bin/roll 9200-9202  (US-OBS-014 comment verbatim:
 *         "idle cycles push too — keeps the remote heartbeat fresh so remote-watch
 *          can tell 'loop online but no work' apart from 'loop offline'").
 *     - done terminal       bin/roll 9269-9270  (normal-completion path).
 *   i.e. EVERY cycle that reaches a terminal cycle_end pushes — a productive
 *   cycle AND an idle (no-commits) cycle. The idle push is the F4 freshness
 *   signal: as long as the loop is alive it pushes ~every cycle, so a remote
 *   observer reads "online + idle"; once pushes STOP going stale past the watch
 *   window (~35 min) the remote reads "offline".
 *
 *   SKIP / NO-OP GATES (bin/roll 8102-8113), in order:
 *     1. `roll_meta_dir` config unset            → complete no-op, ZERO output
 *        (preserves prior behaviour for projects that don't use remote watch).
 *     2. dir set but missing                      → ONE WARNING line, skip.
 *     3. dir exists but `ops/push-loop-status.sh` absent (older roll-meta
 *        checkout)                                → silent skip, nothing to push.
 *
 *   TRANSPORT (bin/roll 8127-8143): the actual snapshot generation + git push is
 *   delegated to `bash ops/push-loop-status.sh <meta_dir>`, run in the
 *   BACKGROUND with a portable 60s watchdog (`timeout` is GNU-only / absent on
 *   stock macOS) that SIGTERMs a hung push so it can never stall the next cycle.
 *   stdout/stderr → push-status.log, rotated at 1MB keeping 2 copies (.1/.2)
 *   (bin/roll 8115-8125). Failure / timeout NEVER aborts the cycle or sets ALERT.
 *
 *   The snapshot CONTENT shape (what fields land in the pushed status file) is
 *   produced by `ops/push-loop-status.sh`, which lives in the PRIVATE roll-meta
 *   repo — it is NOT part of the bash oracle present in this checkout, so it is
 *   intentionally OUT OF SCOPE for this port (no source to mirror against). What
 *   IS in bin/roll, and what this module ports, is the *decision* layer: WHEN to
 *   push, the skip gates, the watchdog deadline, and the log-rotation policy.
 *
 * ─── Port shape ─────────────────────────────────────────────────────────────
 * Pure: {@link statusPushPlan} maps (terminal outcome, config) → a push action
 * or a skip reason; {@link logRotationPlan} ports the 1MB-rotate-keep-2 policy.
 * The injected transport (run the push script, with the 60s watchdog) is an
 * infra concern — its CONTRACT is declared here ({@link SentinelTransport}) so a
 * test can verify the decision drives it correctly without spawning anything.
 */

// ── cadence: which terminals push (bin/roll 9200-9202 / 9269-9270) ───────────

/**
 * Loop-cycle terminals that the v2 runner pushes a snapshot on. v2 invokes
 * `_loop_push_status_snapshot` from the `idle` and `done` cycle_end paths. We
 * model the runner's terminal vocabulary (not v3's reconcile-derived
 * TerminalOutcome) because the push decision keys off the RUNNER terminal, which is
 * decided BEFORE reconcile: `idle` (no commits) and `done` (published) both
 * push; a `failed`/`aborted`/`blocked` terminal does NOT (no push call on those
 * paths — bin/roll 9216/9218/9226 write the row and return without pushing).
 */
export type LoopTerminal = "idle" | "done" | "failed" | "aborted" | "blocked";

/** Terminals that trigger a status push (the F4 freshness heartbeat). */
const PUSH_TERMINALS: ReadonlySet<LoopTerminal> = new Set<LoopTerminal>(["idle", "done"]);

/**
 * Does this terminal push a snapshot? — mirrors the two call sites
 * (bin/roll 9202 idle, 9270 done). `idle` is the load-bearing case (F4: an
 * online-but-no-work loop must still refresh the remote heartbeat).
 */
export function terminalPushes(terminal: LoopTerminal): boolean {
  return PUSH_TERMINALS.has(terminal);
}

// ── skip gates: roll_meta_dir / dir / script (bin/roll 8102-8113) ────────────

/** Config + filesystem facts the caller (infra) gathers before deciding. */
export interface SentinelConfig {
  /** `config_get roll_meta_dir ""` — ~-expanded; "" / undefined = unconfigured. */
  rollMetaDir: string | undefined;
  /** Does `rollMetaDir` exist as a directory? (only meaningful when configured). */
  metaDirExists: boolean;
  /** Does `<rollMetaDir>/ops/push-loop-status.sh` exist? */
  pushScriptExists: boolean;
}

/** Why a push was skipped (mirrors the three no-op gates). */
export type SentinelSkipReason =
  | "unconfigured" // 8104-8105: roll_meta_dir unset → zero output
  | "meta_dir_missing" // 8106-8108: configured but absent → one WARNING
  | "push_script_missing" // 8111-8113: older checkout → silent skip
  | "terminal_not_pushed"; // 9216+: failed/aborted/blocked terminal → no push call

/** The push decision. */
export type StatusPushPlan =
  | {
      action: "push";
      /** Absolute path passed as `$1` to the push script (bin/roll 8131). */
      metaDir: string;
      /** Absolute script path `<metaDir>/ops/push-loop-status.sh`. */
      scriptPath: string;
      /** Hard watchdog deadline in seconds (bin/roll 8135). */
      watchdogSec: number;
    }
  | {
      action: "skip";
      reason: SentinelSkipReason;
      /** True only for `meta_dir_missing` (the one gate that emits a WARNING). */
      warn: boolean;
      /** The WARNING text the bash emits (bin/roll 8107), else "". */
      warning: string;
    };

/** v2 watchdog deadline — `_waited >= 60` SIGTERMs the push (bin/roll 8135). */
export const PUSH_WATCHDOG_SEC = 60;

/** Join `<dir>/ops/push-loop-status.sh` (bin/roll 8110). */
function scriptPathFor(metaDir: string): string {
  const trimmed = metaDir.replace(/\/+$/, "");
  return `${trimmed}/ops/push-loop-status.sh`;
}

/**
 * Decide whether (and how) to push a status snapshot — mirrors
 * `_loop_push_status_snapshot`'s gate ladder (bin/roll 8101-8113) combined with
 * the call-site cadence (bin/roll 9202/9270). Returns a `push` action with the
 * script path + watchdog deadline, or a `skip` carrying the precise oracle
 * reason (and the WARNING string for the one gate that emits one).
 *
 *   terminal not in {idle,done}   → skip terminal_not_pushed (no push call).
 *   roll_meta_dir unset/""        → skip unconfigured (zero output, warn=false).
 *   dir configured but missing    → skip meta_dir_missing (warn=true, WARNING).
 *   push script absent            → skip push_script_missing (silent).
 *   else                          → push (metaDir, scriptPath, 60s watchdog).
 */
export function statusPushPlan(terminal: LoopTerminal, cfg: SentinelConfig): StatusPushPlan {
  if (!terminalPushes(terminal)) {
    return { action: "skip", reason: "terminal_not_pushed", warn: false, warning: "" };
  }
  const dir = cfg.rollMetaDir;
  if (dir === undefined || dir === "") {
    return { action: "skip", reason: "unconfigured", warn: false, warning: "" };
  }
  if (!cfg.metaDirExists) {
    return {
      action: "skip",
      reason: "meta_dir_missing",
      warn: true,
      warning: `WARNING: roll_meta_dir '${dir}' does not exist; skipping status push`,
    };
  }
  if (!cfg.pushScriptExists) {
    return { action: "skip", reason: "push_script_missing", warn: false, warning: "" };
  }
  return {
    action: "push",
    metaDir: dir,
    scriptPath: scriptPathFor(dir),
    watchdogSec: PUSH_WATCHDOG_SEC,
  };
}

// ── log rotation: 1MB, keep 2 (bin/roll 8117-8125) ──────────────────────────

/** Rotate threshold — 1 MiB (bin/roll 8120 `-gt 1048576`). */
export const PUSH_LOG_ROTATE_BYTES = 1_048_576;

/** One rename in the rotation sequence (oldest first, so renames don't clobber). */
export interface LogRotateRename {
  from: string;
  to: string;
}

/** The rotation plan — empty `renames` + `rotate:false` when under threshold. */
export interface LogRotationPlan {
  rotate: boolean;
  /** `rm -f` targets (the dropped .2). */
  remove: string[];
  /** Ordered renames: .1→.2, base→.1 (bin/roll 8121-8123). */
  renames: LogRotateRename[];
  /** Recreate the base log empty after rotation (`touch`, bin/roll 8124). */
  touch: string | undefined;
}

/**
 * Decide push-log rotation — mirrors bin/roll 8118-8125. When the log exceeds
 * 1 MiB: drop `.2`, move `.1`→`.2` (if present), move base→`.1`, and `touch`
 * the base. Strict `> 1048576` (bash `-gt`). Under threshold → no-op.
 *
 * @param logPath  the base push-status.log path.
 * @param sizeBytes  its current byte size (0 when absent).
 * @param dotOnePresent  whether `<logPath>.1` exists (bin/roll 8122 guard).
 */
export function logRotationPlan(logPath: string, sizeBytes: number, dotOnePresent: boolean): LogRotationPlan {
  if (sizeBytes <= PUSH_LOG_ROTATE_BYTES) {
    return { rotate: false, remove: [], renames: [], touch: undefined };
  }
  const renames: LogRotateRename[] = [];
  if (dotOnePresent) renames.push({ from: `${logPath}.1`, to: `${logPath}.2` });
  renames.push({ from: logPath, to: `${logPath}.1` });
  return {
    rotate: true,
    remove: [`${logPath}.2`], // bin/roll 8121 `rm -f "${logf}.2"`
    renames,
    touch: logPath,
  };
}

// ── injected transport contract (infra performs the actual push) ─────────────

/**
 * The transport an infra adapter implements to perform a {@link StatusPushPlan}
 * of action `push`. It MUST run the push script in the background under a
 * `watchdogSec` hard deadline (SIGTERM on timeout) and route output to the
 * (rotated) log — exactly the bash subshell at bin/roll 8127-8143. It is
 * best-effort: it never throws into the cycle and never sets an ALERT (F-soft).
 */
export interface SentinelTransport {
  /**
   * Fire the push. Returns immediately (background) — the watchdog runs detached.
   * @param scriptPath  `<metaDir>/ops/push-loop-status.sh`.
   * @param metaDir     passed as `$1`.
   * @param logPath     where stdout/stderr append.
   * @param watchdogSec hard kill deadline.
   */
  push(scriptPath: string, metaDir: string, logPath: string, watchdogSec: number): void;
}
