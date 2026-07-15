/**
 * Scheduler backend health contract (US-LOOP-107).
 *
 * These types describe the owner-confirmed process-fallback scheduler's lease
 * and liveness. They are intentionally separate from LoopConfig / LoopState so
 * the fallback backend can be reasoned about without coupling to launchd/cron.
 */

/** On-disk fallback lease state. */
export interface FallbackLease {
  /** PID of the fallback runner process. */
  pid: number;
  /** SHA-256 digest of the command/configuration the runner was started with. */
  commandDigest: string;
  /** ISO 8601 timestamp of the owner-confirmed start decision. */
  ownerConfirmedAt: string;
  /** ISO 8601 timestamp when the runner started. */
  startedAt: string;
  /** ISO 8601 timestamp of the most recent heartbeat written by the runner. */
  heartbeatAt: string;
}

/** High-level status returned by fallback health probes. */
export type FallbackStatus = "armed" | "stale" | "unknown";

/** Result of evaluating whether a fallback lease is currently alive. */
export interface FallbackHealth {
  status: FallbackStatus;
  /** Human-readable reason for the status (logging / ALERTs). */
  reason: string;
  /** Current lease, or null when none exists. */
  lease: FallbackLease | null;
  /** True only when the PID is live AND the heartbeat is fresh. */
  alive: boolean;
}
