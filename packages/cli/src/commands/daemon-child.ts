/**
 * Hidden daemon child entrypoint.
 *
 * `roll daemon start` spawns the published CLI bundle with this hidden command
 * so the npm package stays self-contained. It is intentionally not listed in
 * usage output.
 */
import { startDaemon, type DaemonOptions } from "@roll/daemon";

function readDaemonOptions(): DaemonOptions {
  try {
    return JSON.parse(process.env["ROLL_DAEMON_OPTS"] ?? "{}") as DaemonOptions;
  } catch {
    return {};
  }
}

export async function daemonChildCommand(): Promise<number> {
  const handle = startDaemon(readDaemonOptions());
  process.stdout.write(`${handle.address}\n`);

  const shutdown = async (): Promise<void> => {
    await handle.stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return await new Promise<number>(() => {
    // Keep the child process alive until a signal arrives.
  });
}
