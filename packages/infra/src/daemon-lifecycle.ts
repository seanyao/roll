/**
 * Daemon lifecycle — spawn / stop / status for the read-only observability daemon.
 *
 * US-OBS-024: thin infra layer that owns pid tracking and detached-process
 * spawning. Reuses the existing PidAlive probe from process.ts rather than
 * inventing a new pid-liveness mechanism.
 *
 * The pid file lives at `.roll/loop/daemon.pid` (JSON: { pid, host, port, startedAt }).
 * This is a per-project runtime artefact, never committed.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { systemPidAlive, type PidAlive } from "./process.js";

/** Content of the daemon pid file. */
export interface DaemonPidRecord {
  pid: number;
  host: string;
  port: number;
  startedAt: number; // epoch ms
}

/** Resolve `.roll/loop/daemon.pid` relative to a project root. */
export function daemonPidPath(cwd: string): string {
  return join(cwd, ".roll", "loop", "daemon.pid");
}

/** Read the daemon pid record. Returns null if absent or unparseable. */
export function readDaemonPid(cwd: string): DaemonPidRecord | null {
  const path = daemonPidPath(cwd);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const o = JSON.parse(raw) as Partial<DaemonPidRecord>;
    if (
      typeof o.pid !== "number" ||
      typeof o.host !== "string" ||
      typeof o.port !== "number" ||
      typeof o.startedAt !== "number"
    ) {
      return null;
    }
    return { pid: o.pid, host: o.host, port: o.port, startedAt: o.startedAt };
  } catch {
    return null;
  }
}

/** Write the daemon pid record, creating parent directories. */
export function writeDaemonPid(cwd: string, record: DaemonPidRecord): void {
  const path = daemonPidPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}

/** Remove the daemon pid record (idempotent). */
export function clearDaemonPid(cwd: string): void {
  const path = daemonPidPath(cwd);
  try {
    rmSync(path, { force: true });
  } catch {
    /* ok */
  }
}

/**
 * Check whether the recorded daemon process is alive.
 * Returns true only if a pid record exists AND the pid is alive.
 */
export function isDaemonRunning(cwd: string, pidAlive: PidAlive = systemPidAlive): boolean {
  const record = readDaemonPid(cwd);
  if (!record) return false;
  return pidAlive(record.pid);
}

/**
 * Spawn the daemon as a detached child process.
 *
 * In development (when `conventions/` exists), spawns via `node --import tsx <bin.ts>`.
 * In production, spawns via `node <dist/bin.js>`.
 *
 * Returns the child process (so the caller can detach/wait), the pid, and the
 * ws:// address parsed from the child's stdout.
 */
export function spawnDaemon(
  cwd: string,
  opts: { host?: string; port?: number },
): Promise<{ child: ChildProcess; pid: number; address: string }> {
  return new Promise((resolve, reject) => {
    const host = opts.host ?? "127.0.0.1";
    const port = opts.port ?? 7077;

    // Resolve the daemon bin module relative to the daemon package.
    // Walk up from this module to find the daemon package root.
    const daemonBin = resolveDaemonBin();

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ROLL_DAEMON_OPTS: JSON.stringify({ host, port, cwd }),
    };

    const args: string[] = [];
    if (isDev()) {
      // In dev: use tsx to run the raw TypeScript.
      args.push("--import", "tsx");
    }
    args.push(daemonBin);

    const child = spawn(process.execPath, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"], // stdout for address, stderr for errors
      windowsHide: true,
    });

    let address = "";
    let stderr = "";
    let resolved = false;

    const onData = (data: Buffer): void => {
      address += data.toString();
      // The first line of stdout is the ws:// address.
      const nl = address.indexOf("\n");
      if (nl !== -1 && !resolved) {
        resolved = true;
        const addr = address.slice(0, nl).trim();
        child.stdout?.removeListener("data", onData);
        child.unref(); // Detach — child runs independently.
        resolve({ child, pid: child.pid!, address: addr });
      }
    };

    const onErr = (data: Buffer): void => {
      stderr += data.toString();
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onErr);

    child.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    child.on("exit", (code) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Daemon exited early (code ${code}) stderr: ${stderr.slice(0, 500)}`));
      }
    });

    // Timeout: give the daemon 5s to print its address.
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill();
        reject(new Error(`Daemon did not start within 5s. stderr: ${stderr.slice(0, 500)}`));
      }
    }, 5000);
  });
}

// ── private helpers ──────────────────────────────────────────────────────────

function resolveDaemonBin(): string {
  // Walk up from this module to find packages/daemon.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "daemon", "src", "bin.ts");
    if (existsSync(candidate)) return candidate;
    const distCandidate = join(dir, "daemon", "dist", "bin.js");
    if (existsSync(distCandidate)) return distCandidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot resolve daemon bin module");
}

/** True when running in the dev monorepo (conventions/ marker exists). */
function isDev(): boolean {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "conventions"))) return true;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}
