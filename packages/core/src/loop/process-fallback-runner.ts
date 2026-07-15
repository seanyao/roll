/**
 * US-LOOP-107 — owner-confirmed process-fallback runner.
 *
 * This is the long-lived fallback process. It does NOT spawn agents directly;
 * every work tick delegates to the existing `roll loop run-once` entrypoint.
 * It writes a periodic heartbeat so the scheduler can detect crashes, dead PIDs,
 * and reboot/logout.
 */
import type { FallbackRunnerConfig } from "./process-fallback.js";
import {
  FALLBACK_HEARTBEAT_INTERVAL_SEC,
  fallbackHeartbeatPath,
} from "./process-fallback.js";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Default wall clock in epoch seconds. */
function defaultNow(): number {
  return Math.floor(Date.now() / 1000);
}

/** Default sleep as a Promise. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Default heartbeat writer — mirrors the v2 heartbeat shape (epoch seconds). */
function defaultWriteHeartbeat(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${Math.floor(Date.now() / 1000)}\n`, "utf8");
}

/** Default run-once invocation: `roll loop run-once` in the project directory. */
function defaultSpawnRunOnce(
  rollBin: string,
  projectPath: string,
  signal?: AbortSignal,
): Promise<{ exitCode: number; signal: string | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(rollBin, ["loop", "run-once"], {
      cwd: projectPath,
      stdio: "inherit",
      ...(signal !== undefined ? { signal } : {}),
    });
    child.on("error", (err) => {
      // An already-aborted spawn surfaces as AbortError — resolve, not reject,
      // so the runner loop treats it as a stopped tick rather than crashing.
      if ((err as Error & { code?: string }).code === "ABORT_ERR") {
        resolve({ exitCode: 1, signal: "SIGTERM" });
        return;
      }
      reject(err);
    });
    child.on("exit", (code, sig) => {
      resolve({ exitCode: code ?? 1, signal: sig ?? null });
    });
  });
}

/** Injectable seams so the runner loop is fully testable without real processes. */
export interface FallbackRunnerDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  spawnRunOnce?: (
    rollBin: string,
    projectPath: string,
    signal?: AbortSignal,
  ) => Promise<{ exitCode: number; signal: string | null }>;
  writeHeartbeat?: (path: string) => void;
}

/**
 * Run the fallback scheduler loop until signalled.
 *
 * Behavior:
 * - Writes a heartbeat immediately and then every `heartbeatIntervalSec`.
 * - Runs `roll loop run-once` at start and then every `periodMinutes`.
 * - If a run-once invocation is in flight when SIGTERM arrives, the loop waits
 *   for it to finish (run-once owns the project single-flight lock) and then
 *   exits cleanly.
 * - Never starts a new run-once after SIGTERM.
 */
export async function runFallbackLoop(
  config: FallbackRunnerConfig,
  deps: FallbackRunnerDeps = {},
): Promise<void> {
  const now = deps.now ?? defaultNow;
  const sleep = deps.sleep ?? defaultSleep;
  const spawnRunOnce = deps.spawnRunOnce ?? defaultSpawnRunOnce;
  const writeHeartbeat = deps.writeHeartbeat ?? defaultWriteHeartbeat;

  const periodSec = Math.max(1, config.periodMinutes) * 60;
  const heartbeatIntervalSec = Math.max(1, config.heartbeatIntervalSec ?? FALLBACK_HEARTBEAT_INTERVAL_SEC);
  const heartbeatPath = fallbackHeartbeatPath(config.projectPath, config.slug);

  let running = true;
  const abortController = new AbortController();

  function stop(): void {
    running = false;
    try {
      abortController.abort();
    } catch {
      /* ignore double-stop */
    }
  }

  const sigs: NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGHUP"];
  for (const sig of sigs) {
    process.on(sig, stop);
  }

  try {
    let lastRunAt = 0;
    writeHeartbeat(heartbeatPath);

    while (running) {
      const loopStart = now();

      if (lastRunAt === 0 || loopStart - lastRunAt >= periodSec) {
        lastRunAt = loopStart;
        // Run-once owns the project single-flight lock; we just invoke it.
        await spawnRunOnce(config.rollBin, config.projectPath, abortController.signal);
      }

      if (!running) break;

      writeHeartbeat(heartbeatPath);

      const elapsed = now() - loopStart;
      const sleepMs = Math.max(100, heartbeatIntervalSec * 1000 - elapsed * 1000);
      await sleep(sleepMs);
    }
  } finally {
    for (const sig of sigs) {
      process.removeListener(sig, stop);
    }
  }
}
