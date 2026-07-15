/**
 * US-LOOP-107 — process-fallback scheduler backend: pure lease / heartbeat /
 * liveness primitives.
 *
 * The fallback is an owner-confirmed, bounded process scheduler used when
 * launchd cannot arm. It is never auto-selected; callers must pass an explicit
 * owner-confirmed intent. Reboot / logout / dead PID is represented as `stale`,
 * never as armed or persistent across login.
 *
 * Design notes:
 * - The lease is a DIRECTORY (not a plain file) so concurrent `start` races are
 *   resolved by the kernel-atomic `mkdir` — only one caller wins the claim.
 * - The lease file inside the directory is written atomically (tmp + rename).
 * - Liveness requires BOTH a live PID and a fresh heartbeat (content, not mtime).
 * - A command digest pins the lease to the exact configuration; a config change
 *   makes the existing lease stale so the next start reclaims cleanly.
 */
import type { FallbackHealth, FallbackLease, FallbackStatus } from "@roll/spec";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** Default heartbeat timeout: longer than the cycle hard-timeout watchdog. */
export const FALLBACK_HEARTBEAT_TIMEOUT_SEC = 3600;

/** Default heartbeat write interval while the fallback runner is alive. */
export const FALLBACK_HEARTBEAT_INTERVAL_SEC = 60;

/** Project-local runtime directory for fallback scheduler state. */
export function fallbackRuntimeDir(projectPath: string): string {
  return join(projectPath, ".roll", "loop");
}

/** Atomic lease directory path (`<rt>/fallback-lease-<slug>`). */
export function fallbackLeasePath(projectPath: string, slug: string): string {
  return join(fallbackRuntimeDir(projectPath), `fallback-lease-${slug}`);
}

/** Heartbeat file path (`<rt>/fallback-heartbeat-<slug>`). */
export function fallbackHeartbeatPath(projectPath: string, slug: string): string {
  return join(fallbackRuntimeDir(projectPath), `fallback-heartbeat-${slug}`);
}

const LEASE_FILE = "lease.json";

function leaseFilePath(leaseDir: string): string {
  return join(leaseDir, LEASE_FILE);
}

/** Inputs that define a fallback runner's identity for the command digest. */
export interface FallbackCommandInputs {
  projectPath: string;
  slug: string;
  /** Loop fire period in minutes. */
  periodMinutes: number;
  /** Roll binary / command used to invoke `roll loop run-once`. */
  rollBin: string;
}

/**
 * Stable SHA-256 digest of the fallback command configuration. Any change to
 * these inputs makes an existing lease stale, forcing a clean reclaim.
 */
export function computeFallbackCommandDigest(inputs: FallbackCommandInputs): string {
  const payload = JSON.stringify(
    {
      projectPath: inputs.projectPath,
      rollBin: inputs.rollBin,
      periodMinutes: inputs.periodMinutes,
      slug: inputs.slug,
    },
    Object.keys(inputs).sort(),
  );
  return createHash("sha256").update(payload).digest("hex");
}

/** Validate a parsed object is a {@link FallbackLease}. */
export function isFallbackLease(value: unknown): value is FallbackLease {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec["pid"] === "number" &&
    Number.isFinite(rec["pid"]) &&
    typeof rec["commandDigest"] === "string" &&
    typeof rec["ownerConfirmedAt"] === "string" &&
    typeof rec["startedAt"] === "string" &&
    typeof rec["heartbeatAt"] === "string"
  );
}

/** Read the lease from the lease directory, returning null when absent/invalid. */
export function readFallbackLease(leaseDir: string): FallbackLease | null {
  const path = leaseFilePath(leaseDir);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isFallbackLease(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Atomically write a lease into the lease directory. The caller must already
 * own the lease directory claim (kernel-atomic mkdir).
 */
export function writeFallbackLease(leaseDir: string, lease: FallbackLease): void {
  mkdirSync(leaseDir, { recursive: true });
  const target = leaseFilePath(leaseDir);
  const tmp = `${target}.tmp.${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(lease)}\n`, "utf8");
  renameSync(tmp, target);
}

/** Idempotently remove the lease directory and its contents. */
export function removeFallbackLease(leaseDir: string): void {
  try {
    rmSync(leaseDir, { recursive: true, force: true });
  } catch {
    /* best-effort: a concurrent reclaim may have already moved it aside */
  }
}

/** Read the heartbeat file content as epoch seconds (0 when missing/unparseable). */
export function readFallbackHeartbeat(heartbeatPath: string): number {
  if (!existsSync(heartbeatPath)) return 0;
  try {
    const raw = readFileSync(heartbeatPath, "utf8").trim();
    if (!/^\d+$/.test(raw)) return 0;
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

/** Injectable PID-liveness probe (mirrors `kill -0 <pid>` semantics). */
export type PidAlive = (pid: number) => boolean;

/** Default liveness probe: `process.kill(pid, 0)`. */
export const systemPidAlive: PidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but is owned by another user → alive.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Inputs for {@link evaluateFallbackLiveness}. */
export interface FallbackLivenessInputs {
  lease: FallbackLease | null;
  heartbeatPath: string;
  expectedDigest: string;
  now?: () => number;
  pidAlive?: PidAlive;
  heartbeatTimeoutSec?: number;
}

/**
 * Evaluate whether a fallback lease is currently alive.
 *
 * Alive requires:
 *   1. lease exists
 *   2. command digest matches expected (config has not drifted)
 *   3. recorded PID is live
 *   4. heartbeat content is fresh (age < timeout)
 *
 * Any missing or failed condition yields `stale` (or `unknown` when no lease).
 */
export function evaluateFallbackLiveness(inputs: FallbackLivenessInputs): FallbackHealth {
  const { lease, heartbeatPath, expectedDigest } = inputs;
  const now = inputs.now ? inputs.now() : Math.floor(Date.now() / 1000);
  const pidAlive = inputs.pidAlive ?? systemPidAlive;
  const timeoutSec = inputs.heartbeatTimeoutSec ?? FALLBACK_HEARTBEAT_TIMEOUT_SEC;

  if (lease === null) {
    return { status: "unknown", reason: "no fallback lease", lease: null, alive: false };
  }

  if (lease.commandDigest !== expectedDigest) {
    return {
      status: "stale",
      reason: "command digest mismatch — configuration changed",
      lease,
      alive: false,
    };
  }

  if (!pidAlive(lease.pid)) {
    return {
      status: "stale",
      reason: `PID ${lease.pid} is not alive`,
      lease,
      alive: false,
    };
  }

  const hbTs = readFallbackHeartbeat(heartbeatPath);
  const ageSec = now - hbTs;
  if (ageSec >= timeoutSec) {
    return {
      status: "stale",
      reason: `heartbeat stale (${ageSec}s >= ${timeoutSec}s)`,
      lease,
      alive: false,
    };
  }

  return {
    status: "armed",
    reason: `PID ${lease.pid} live, heartbeat fresh (${ageSec}s)`,
    lease,
    alive: true,
  };
}

/** Inputs for generating the self-contained fallback runner script. */
export interface FallbackRunnerConfig {
  projectPath: string;
  slug: string;
  periodMinutes: number;
  rollBin: string;
  heartbeatIntervalSec?: number;
}

/**
 * Build the contents of the generated fallback runner `.mjs` script.
 *
 * The script imports only `@roll/core/runFallbackLoop` and invokes it with the
 * frozen configuration. It never spawns agents directly; every work tick is
 * delegated to `roll loop run-once` through the configured `rollBin`.
 */
export function buildFallbackRunnerScript(config: FallbackRunnerConfig): string {
  const payload = JSON.stringify(config, null, 2);
  return `#!/usr/bin/env node
// Generated by roll process-fallback scheduler (US-LOOP-107).
// This script is the owner-confirmed fallback runner; it invokes only
// \`roll loop run-once\` and writes a periodic heartbeat.
import { runFallbackLoop } from "@roll/core";

const config = ${payload};
runFallbackLoop(config).catch((err) => {
  console.error("fallback runner failed:", err);
  process.exit(1);
});
`;
}

/** Status of an attempt to claim the fallback lease directory. */
export interface FallbackClaimResult {
  /** True if this caller won the atomic mkdir claim. */
  claimed: boolean;
  /** When `claimed` is false, the live lease that already holds the claim. */
  existingLease: FallbackLease | null;
}

/**
 * Attempt to atomically claim the fallback lease directory.
 *
 * Returns `claimed: true` only when `mkdirSync(leaseDir)` succeeds. The caller
 * is responsible for writing the lease file and starting the runner process
 * BEFORE releasing control (so a concurrent observer sees a complete lease).
 */
export function claimFallbackLeaseDir(leaseDir: string): FallbackClaimResult {
  mkdirSync(dirname(leaseDir), { recursive: true });
  try {
    mkdirSync(leaseDir); // non-recursive → EEXIST if another process won
    return { claimed: true, existingLease: null };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      return { claimed: false, existingLease: readFallbackLease(leaseDir) };
    }
    throw e;
  }
}
