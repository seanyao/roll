/**
 * US-OBS-024 — `roll daemon` CLI output-surface tests.
 *
 * Tests help, stop (idempotent), status (liveness-probing), and unknown-subcommand
 * error. All surfaces are deterministic: output captured via the same
 * stdout/stderr interceptor pattern used throughout the CLI test suite.
 *
 * AC5: help shows defaults and states daemon is read-only, optional.
 * AC2: stop when not running exits cleanly.
 * AC3: status probes pid liveness — stale pid → stopped.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { daemonCommand, daemonHelp } from "../src/commands/daemon.js";

interface RunOpts {
  args: string[];
  /** Called after chdir but before daemonCommand — for writing fixture files. */
  setup?: (cwd: string) => void;
}

/** Run daemonCommand inside a temp project, capturing stdout/stderr. */
async function runDaemon(opts: RunOpts): Promise<{
  status: number;
  stdout: string;
  stderr: string;
  clean: () => Promise<void>;
}> {
  const cwd = mkdtempSync(join(tmpdir(), "roll-daemon-"));
  mkdirSync(join(cwd, ".roll", "loop"), { recursive: true });
  const save = {
    NO_COLOR: process.env["NO_COLOR"],
    ROLL_LANG: process.env["ROLL_LANG"],
    ROLL_DAEMON_ENTRYPOINT: process.env["ROLL_DAEMON_ENTRYPOINT"],
  };
  process.env["NO_COLOR"] = "1";
  process.env["ROLL_LANG"] = "en";

  if (opts.setup) opts.setup(cwd);

  const clean = async (): Promise<void> => {
    if (save.NO_COLOR === undefined) delete process.env["NO_COLOR"];
    else process.env["NO_COLOR"] = save.NO_COLOR;
    if (save.ROLL_LANG === undefined) delete process.env["ROLL_LANG"];
    else process.env["ROLL_LANG"] = save.ROLL_LANG;
    if (save.ROLL_DAEMON_ENTRYPOINT === undefined) delete process.env["ROLL_DAEMON_ENTRYPOINT"];
    else process.env["ROLL_DAEMON_ENTRYPOINT"] = save.ROLL_DAEMON_ENTRYPOINT;
    rmSync(cwd, { recursive: true, force: true });
  };

  const { status, stdout, stderr } = await runDaemonIn(cwd, opts.args);
  return { status, stdout, stderr, clean };
}

async function runDaemonIn(cwd: string, args: string[]): Promise<{
  status: number;
  stdout: string;
  stderr: string;
}> {
  const saveCwd = process.cwd();
  process.chdir(cwd);
  const outC: string[] = [];
  const errC: string[] = [];
  const rOut = process.stdout.write.bind(process.stdout);
  const rErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (x: string | Uint8Array): boolean => (outC.push(String(x)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (x: string | Uint8Array): boolean => (errC.push(String(x)), true);
  let status: number;
  try {
    status = await daemonCommand(args);
  } finally {
    process.stdout.write = rOut;
    process.stderr.write = rErr;
    process.chdir(saveCwd);
  }
  return { status, stdout: outC.join(""), stderr: errC.join("") };
}

function writeDaemonShim(cwd: string): string {
  const path = join(cwd, "daemon-child.mjs");
  writeFileSync(
    path,
    [
      "const opts = JSON.parse(process.env.ROLL_DAEMON_OPTS ?? '{}');",
      "const host = opts.host ?? '127.0.0.1';",
      "const port = opts.port ?? 7077;",
      "process.stdout.write(`ws://${host}:${port}\\n`);",
      "process.on('SIGTERM', () => process.exit(0));",
      "process.on('SIGINT', () => process.exit(0));",
      "setInterval(() => {}, 1000);",
      "",
    ].join("\n"),
    "utf8",
  );
  return path;
}

describe("daemonCommand (CLI surface)", () => {
  describe("help (AC5)", () => {
    it("bare call prints help and exits 0", async () => {
      const { status, stdout, clean } = await runDaemon({ args: [] });
      await clean();
      expect(status).toBe(0);
      expect(stdout).toContain("roll daemon");
      expect(stdout).toContain("start");
      expect(stdout).toContain("stop");
      expect(stdout).toContain("status");
    });

    it("--help prints help and exits 0", async () => {
      const { status, stdout, clean } = await runDaemon({ args: ["--help"] });
      await clean();
      expect(status).toBe(0);
      expect(stdout).toContain("roll daemon");
    });

    it("-h prints help and exits 0", async () => {
      const { status, stdout, clean } = await runDaemon({ args: ["-h"] });
      await clean();
      expect(status).toBe(0);
      expect(stdout).toContain("roll daemon");
    });

    it("help shows defaults (AC5)", () => {
      const h = daemonHelp("en");
      expect(h).toContain("127.0.0.1");
      expect(h).toContain("7077");
      expect(h).toContain("read-only");
      expect(h).toContain("OPT-IN");
    });
  });

  describe("stop (AC2)", () => {
    it("not-running → clean exit 0 with 'not running' message", async () => {
      const { status, stdout, clean } = await runDaemon({ args: ["stop"] });
      await clean();
      expect(status).toBe(0);
      expect(stdout.toLowerCase()).toContain("not running");
    });

    it("stale pid record → clears it, exits 0", async () => {
      const { status, stdout, clean } = await runDaemon({
        args: ["stop"],
        setup: (cwd) => {
          writeFileSync(
            join(cwd, ".roll", "loop", "daemon.pid"),
            JSON.stringify({ pid: 99999, host: "127.0.0.1", port: 7077, startedAt: Date.now() }) + "\n",
            "utf8",
          );
        },
      });
      await clean();
      expect(status).toBe(0);
      // Should report the pid it stopped (even if dead).
      expect(stdout).toContain("99999");
    });
  });

  describe("start (AC1)", () => {
    it("starts a detached child, records pid/address, and is idempotent", async () => {
      const cwd = mkdtempSync(join(tmpdir(), "roll-daemon-"));
      mkdirSync(join(cwd, ".roll", "loop"), { recursive: true });
      const save = {
        NO_COLOR: process.env["NO_COLOR"],
        ROLL_LANG: process.env["ROLL_LANG"],
        ROLL_DAEMON_ENTRYPOINT: process.env["ROLL_DAEMON_ENTRYPOINT"],
      };
      process.env["NO_COLOR"] = "1";
      process.env["ROLL_LANG"] = "en";
      process.env["ROLL_DAEMON_ENTRYPOINT"] = writeDaemonShim(cwd);

      try {
        const started = await runDaemonIn(cwd, ["start"]);
        expect(started.status).toBe(0);
        expect(started.stdout).toContain("Daemon started");
        expect(started.stdout).toContain("ws://127.0.0.1:7077");

        const status = await runDaemonIn(cwd, ["status"]);
        expect(status.status).toBe(0);
        expect(status.stdout).toContain("RUNNING");
        expect(status.stdout).toContain("ws://127.0.0.1:7077");

        const secondStart = await runDaemonIn(cwd, ["start"]);
        expect(secondStart.status).toBe(0);
        expect(secondStart.stdout.toLowerCase()).toContain("already running");

        const stopped = await runDaemonIn(cwd, ["stop"]);
        expect(stopped.status).toBe(0);
        expect(stopped.stdout).toContain("Daemon stopped");

        const stoppedStatus = await runDaemonIn(cwd, ["status"]);
        expect(stoppedStatus.status).toBe(0);
        expect(stoppedStatus.stdout).toContain("STOPPED");
      } finally {
        await runDaemonIn(cwd, ["stop"]);
        if (save.NO_COLOR === undefined) delete process.env["NO_COLOR"];
        else process.env["NO_COLOR"] = save.NO_COLOR;
        if (save.ROLL_LANG === undefined) delete process.env["ROLL_LANG"];
        else process.env["ROLL_LANG"] = save.ROLL_LANG;
        if (save.ROLL_DAEMON_ENTRYPOINT === undefined) delete process.env["ROLL_DAEMON_ENTRYPOINT"];
        else process.env["ROLL_DAEMON_ENTRYPOINT"] = save.ROLL_DAEMON_ENTRYPOINT;
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  });

  describe("status (AC3)", () => {
    it("no pid record → reports STOPPED", async () => {
      const { status, stdout, clean } = await runDaemon({ args: ["status"] });
      await clean();
      expect(status).toBe(0);
      expect(stdout.toLowerCase()).toContain("stopped");
    });

    it("stale pid record → probes liveness, reports STOPPED", async () => {
      const { status, stdout, clean } = await runDaemon({
        args: ["status"],
        setup: (cwd) => {
          writeFileSync(
            join(cwd, ".roll", "loop", "daemon.pid"),
            JSON.stringify({ pid: 99999, host: "127.0.0.1", port: 7077, startedAt: Date.now() }) + "\n",
            "utf8",
          );
        },
      });
      await clean();
      expect(status).toBe(0);
      // Must say STOPPED, not RUNNING — the pid is dead.
      expect(stdout.toLowerCase()).toContain("stopped");
    });
  });

  describe("unknown subcommand", () => {
    it("exits 1 with stderr for garbage subcommand", async () => {
      const { status, stderr, clean } = await runDaemon({ args: ["nonsense"] });
      await clean();
      expect(status).toBe(1);
      expect(stderr).toBeTruthy();
    });
  });
});
