/**
 * Daemon bootstrap entry point — spawned by `roll daemon start`.
 *
 * Reads DaemonOptions from ROLL_DAEMON_OPTS env var (JSON), starts the daemon,
 * and stays alive until SIGTERM/SIGINT. The server keeps the process alive.
 *
 * US-OBS-024 AC1 — the spawned, detached daemon process.
 */
import { startDaemon, type DaemonOptions } from "./start-daemon.js";

const opts: DaemonOptions = (() => {
  try {
    return JSON.parse(process.env["ROLL_DAEMON_OPTS"] ?? "{}") as DaemonOptions;
  } catch {
    return {};
  }
})();

const handle = startDaemon(opts);

// Write the bound address to stdout so the spawning CLI can read it.
process.stdout.write(`${handle.address}\n`);

// Graceful shutdown on signal.
const shutdown = async () => {
  await handle.stop();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Keep alive until signal.
process.stdin.resume();
