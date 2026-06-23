/**
 * `roll daemon start|stop|status` — manage the read-only observability daemon's
 * process lifecycle (US-OBS-024).
 *
 * Thin shell over `packages/daemon` (startDaemon) and infra (spawnDaemon /
 * pid tracking). The daemon is OPT-IN: no loop path invokes it.
 *
 * Defaults: host 127.0.0.1, port 7077.
 */
import { resolveLang } from "@roll/spec";
import {
  spawnDaemon,
  readDaemonPid,
  writeDaemonPid,
  clearDaemonPid,
  isDaemonRunning,
  systemPidAlive,
} from "@roll/infra";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7077;

interface Ctx {
  lang: "en" | "zh";
}

const t = {
  usage: {
    en: [
      "Usage: roll daemon <start|stop|status>",
      "",
      "Manage the read-only observability daemon.",
      "The daemon is OPT-IN — it is never auto-started by the loop.",
      "",
      "Commands:",
      "  start    Spawn the daemon as a detached process (default 127.0.0.1:7077).",
      "           Idempotent: a second start reports already-running.",
      "  stop     Terminate the daemon process and clear its pid record.",
      "           Exits cleanly when not running (no error).",
      "  status   Report the daemon's real state — running (pid + address)",
      "           or stopped — by probing the recorded pid.",
      "",
      "Defaults:",
      `  host     ${DEFAULT_HOST}`,
      `  port     ${DEFAULT_PORT}`,
      "",
      "管理只读可观测驻守服务。",
      "驻守服务是可选加入的——循环从不会自动启动它。",
      "",
      "子命令:",
      "  start    以独立进程启动驻守服务（默认 127.0.0.1:7077）。幂等：二次调用报已运行。",
      "  stop     终止驻守进程并清除 pid 记录。未运行时干净退出（不报错）。",
      "  status   报告驻守服务真实状态——运行中（pid + 地址）或已停止——通过探测记录的 pid。",
    ].join("\n"),
    zh: [
      "Usage: roll daemon <start|stop|status>",
      "",
      "管理只读可观测驻守服务。",
      "驻守服务是可选加入的——循环从不会自动启动它。",
      "",
      "子命令:",
      "  start    以独立进程启动驻守服务（默认 127.0.0.1:7077）。幂等：二次调用报已运行。",
      "  stop     终止驻守进程并清除 pid 记录。未运行时干净退出（不报错）。",
      "  status   报告驻守服务真实状态——运行中（pid + 地址）或已停止——通过探测记录的 pid。",
      "",
      "Manage the read-only observability daemon.",
      "The daemon is OPT-IN — it is never auto-started by the loop.",
      "",
      "Commands:",
      "  start    Spawn the daemon as a detached process (default 127.0.0.1:7077).",
      "           Idempotent: a second start reports already-running.",
      "  stop     Terminate the daemon process and clear its pid record.",
      "           Exits cleanly when not running (no error).",
      "  status   Report the daemon's real state — running (pid + address)",
      "           or stopped — by probing the recorded pid.",
    ].join("\n"),
  },
  alreadyRunning: {
    en: (pid: number, host: string, port: number) =>
      `Daemon already running (pid ${pid} on ${host}:${port}).`,
    zh: (pid: number, host: string, port: number) =>
      `驻守服务已在运行（pid ${pid}，${host}:${port}）。`,
  },
  started: {
    en: (pid: number, address: string) =>
      `Daemon started (pid ${pid}) on ${address}.`,
    zh: (pid: number, address: string) =>
      `驻守服务已启动（pid ${pid}），地址 ${address}。`,
  },
  notRunning: {
    en: "Daemon is not running.",
    zh: "驻守服务未运行。",
  },
  stopped: {
    en: (pid: number) => `Daemon stopped (was pid ${pid}).`,
    zh: (pid: number) => `驻守服务已停止（原 pid ${pid}）。`,
  },
  statusRunning: {
    en: (pid: number, address: string) =>
      `Daemon is RUNNING (pid ${pid}) at ${address}.`,
    zh: (pid: number, address: string) =>
      `驻守服务运行中（pid ${pid}），地址 ${address}。`,
  },
  statusStopped: {
    en: "Daemon is STOPPED.",
    zh: "驻守服务已停止。",
  },
  startFailed: {
    en: (msg: string) => `Failed to start daemon: ${msg}`,
    zh: (msg: string) => `启动驻守服务失败：${msg}`,
  },
};

export function daemonHelp(lang: "en" | "zh"): string {
  return t.usage[lang];
}

export async function daemonCommand(args: string[]): Promise<number> {
  const lang = resolveLang({
    rollLang: process.env["ROLL_LANG"],
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });
  const ctx: Ctx = { lang };

  const sub = args[0];
  if (sub === undefined || sub === "help" || sub === "--help" || sub === "-h") {
    process.stdout.write(`${daemonHelp(lang)}\n`);
    return 0;
  }

  switch (sub) {
    case "start":
      return await handleStart(ctx);
    case "stop":
      return handleStop(ctx);
    case "status":
      return handleStatus(ctx);
    default:
      process.stderr.write(`Unknown daemon subcommand: ${sub}\n${daemonHelp(lang)}\n`);
      return 1;
  }
}

async function handleStart(ctx: Ctx): Promise<number> {
  const cwd = process.cwd();

  // AC1: idempotent — check if already running.
  if (isDaemonRunning(cwd)) {
    const record = readDaemonPid(cwd)!;
    process.stdout.write(
      `${t.alreadyRunning[ctx.lang](record.pid, record.host, record.port)}\n`,
    );
    return 0;
  }

  // Clean up any stale pid record first.
  clearDaemonPid(cwd);

  try {
    const { pid, address } = await spawnDaemon(cwd, {
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
    });

    // Parse ws://host:port from the address.
    const wsMatch = address.match(/^ws:\/\/([^:]+):(\d+)$/);
    const boundHost = wsMatch?.[1] ?? DEFAULT_HOST;
    const boundPort = wsMatch?.[2] ? parseInt(wsMatch[2], 10) : DEFAULT_PORT;

    writeDaemonPid(cwd, {
      pid,
      host: boundHost,
      port: boundPort,
      startedAt: Date.now(),
    });

    process.stdout.write(`${t.started[ctx.lang](pid, address)}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(
      `${t.startFailed[ctx.lang]((err as Error).message)}\n`,
    );
    return 1;
  }
}

function handleStop(ctx: Ctx): number {
  const cwd = process.cwd();

  const record = readDaemonPid(cwd);
  if (!record) {
    // AC2: stop when not running → clean exit, not an error.
    process.stdout.write(`${t.notRunning[ctx.lang]}\n`);
    return 0;
  }

  // Check if the process is still alive.
  if (systemPidAlive(record.pid)) {
    try {
      process.kill(record.pid, "SIGTERM");
    } catch {
      // Process may have died between the check and the kill — that's fine.
    }
  }

  clearDaemonPid(cwd);
  process.stdout.write(`${t.stopped[ctx.lang](record.pid)}\n`);
  return 0;
}

function handleStatus(ctx: Ctx): number {
  const cwd = process.cwd();

  // AC3: probe pid liveness — never trust the pid file alone.
  if (isDaemonRunning(cwd)) {
    const record = readDaemonPid(cwd)!;
    const address = `ws://${record.host}:${record.port}`;
    process.stdout.write(
      `${t.statusRunning[ctx.lang](record.pid, address)}\n`,
    );
  } else {
    // Clean up stale pid record so a subsequent status/start sees the truth.
    if (readDaemonPid(cwd)) {
      clearDaemonPid(cwd);
    }
    process.stdout.write(`${t.statusStopped[ctx.lang]}\n`);
  }

  return 0;
}
