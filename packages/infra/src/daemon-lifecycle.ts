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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
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

export interface SpawnDaemonOptions {
  host?: string;
  port?: number;
  /**
   * CLI entrypoint to spawn. Production defaults to the current roll executable
   * (`process.argv[1]`), which keeps the npm package self-contained.
   */
  entrypoint?: string;
  /** Hidden command registered by the CLI bridge; injectable for tests. */
  childCommand?: string;
  timeoutMs?: number;
}

/**
 * Spawn the daemon as a detached child process.
 *
 * The published package ships a single bundled CLI file, so the child process
 * must re-enter that same CLI through a hidden command instead of looking for
 * workspace source paths that do not exist after `npm pack`.
 */
export function spawnDaemon(
  cwd: string,
  opts: SpawnDaemonOptions,
): Promise<{ child: ChildProcess; pid: number; address: string }> {
  return new Promise((resolve, reject) => {
    const host = opts.host ?? "127.0.0.1";
    const port = opts.port ?? 7077;
    const entrypoint = resolveCliEntrypoint(opts);
    const childCommand = opts.childCommand ?? "-daemon";

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ROLL_DAEMON_OPTS: JSON.stringify({ host, port, cwd }),
    };

    const child = spawn(process.execPath, [entrypoint, childCommand], {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"], // stdout for address, stderr for errors
      windowsHide: true,
    });

    let address = "";
    let stderr = "";
    let resolved = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = <T>(fn: (value: T) => void, value: T): void => {
      if (resolved) return;
      resolved = true;
      if (timer !== undefined) clearTimeout(timer);
      fn(value);
    };

    const onData = (data: Buffer): void => {
      address += data.toString();
      // The first line of stdout is the ws:// address.
      const nl = address.indexOf("\n");
      if (nl !== -1) {
        const addr = address.slice(0, nl).trim();
        child.stdout?.removeListener("data", onData);
        child.unref(); // Detach — child runs independently.
        const pid = child.pid;
        if (pid === undefined) {
          finish(reject, new Error("Daemon child did not expose a pid"));
          return;
        }
        finish(resolve, { child, pid, address: addr });
      }
    };

    const onErr = (data: Buffer): void => {
      stderr += data.toString();
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onErr);

    child.on("error", (err) => {
      finish(reject, err);
    });

    child.on("exit", (code) => {
      finish(reject, new Error(`Daemon exited early (code ${code}) stderr: ${stderr.slice(0, 500)}`));
    });

    // Timeout: give the daemon 5s to print its address.
    timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`Daemon did not start within ${opts.timeoutMs ?? 5000}ms. stderr: ${stderr.slice(0, 500)}`));
    }, opts.timeoutMs ?? 5000);
    timer.unref();
  });
}

// ── private helpers ──────────────────────────────────────────────────────────

function resolveCliEntrypoint(opts: SpawnDaemonOptions): string {
  const entrypoint = opts.entrypoint ?? process.env["ROLL_DAEMON_ENTRYPOINT"] ?? process.argv[1];
  if (entrypoint === undefined || entrypoint.trim() === "") {
    throw new Error("Cannot resolve daemon CLI entrypoint");
  }
  return entrypoint;
}
