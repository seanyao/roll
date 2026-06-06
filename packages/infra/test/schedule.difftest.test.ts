/**
 * diff-test (frozen): the TS pure generators reproduce the v2 bash plist + cron
 * generators BYTE-FOR-BYTE.
 *   - plistContent vs `_write_launchd_plist` (bin/roll 8235-8289).
 *   - cronLines vs `printf "%d * * * * %s %s:%s\n"` / `printf "%d %d * * * %s
 *     %s:%s\n"` (bin/roll 9960-9961).
 *
 * Per the US-PORT-009a freeze paradigm (docs/difftest-freeze-paradigm.md): the
 * bash outputs were captured once — while bin/roll was still present and proven
 * byte-equal — and frozen below. The test no longer `sed`-extracts the plist
 * heredoc from bin/roll nor shells `printf` for the cron lines; every input is
 * fixed so the frozen strings are portable. Exec wrappers (launchctl/crontab)
 * stay smoke-tested with fake binaries on PATH (they never spawned the v2 engine).
 */
import { execSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type CronCommands,
  cronLines,
  launchctl,
  type LaunchdSchedule,
  plistContent,
  crontabRead,
  crontabWrite,
} from "../src/schedule.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});
function tmp(name: string): string {
  const d = mkdtempSync(join(tmpdir(), `roll-infra-sched-${name}-`));
  dirs.push(d);
  return d;
}

const common = {
  label: "com.roll.loop.main-abc123",
  runnerScript: "/sh/loop/run-main-abc123.sh",
  projectPath: "/Users/u/proj",
  pathValue: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
};

/** Build the frozen v2 plist with a given schedule block (byte-for-byte oracle). */
function frozenPlist(scheduleBlock: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
    `<plist version="1.0">\n` +
    `<dict>\n` +
    `  <key>Label</key>\n` +
    `  <string>com.roll.loop.main-abc123</string>\n` +
    `  <key>ProgramArguments</key>\n` +
    `  <array>\n` +
    `    <string>/bin/bash</string>\n` +
    `    <string>-l</string>\n` +
    `    <string>/sh/loop/run-main-abc123.sh</string>\n` +
    `  </array>\n` +
    `  <key>EnvironmentVariables</key>\n` +
    `  <dict>\n` +
    `    <key>PATH</key>\n` +
    `    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>\n` +
    `  </dict>\n` +
    scheduleBlock +
    `  <key>WorkingDirectory</key>\n` +
    `  <string>/Users/u/proj</string>\n` +
    `</dict>\n` +
    `</plist>\n`
  );
}

const intervalBlock = (sec: number): string => `  <key>StartInterval</key>\n  <integer>${sec}</integer>\n`;
const calendarBlock =
  `  <key>StartCalendarInterval</key>\n` +
  `  <array>\n` +
  `    <dict>\n` +
  `      <key>Hour</key>\n` +
  `      <integer>3</integer>\n` +
  `      <key>Minute</key>\n` +
  `      <integer>2</integer>\n` +
  `    </dict>\n` +
  `  </array>\n`;

describe("byte-diff: plistContent == frozen _write_launchd_plist (bin/roll 8235-8289)", () => {
  it("loop service: StartInterval = period*60 (period=5 → 300)", () => {
    expect(plistContent({ ...common, schedule: { kind: "interval", periodMinutes: 5 } })).toBe(
      frozenPlist(intervalBlock(300)),
    );
  });

  it("loop service: hourly (period=60 → 3600)", () => {
    expect(plistContent({ ...common, schedule: { kind: "interval", periodMinutes: 60 } })).toBe(
      frozenPlist(intervalBlock(3600)),
    );
  });

  it("dream service default (FIX-105): StartInterval 86400", () => {
    expect(plistContent({ ...common, schedule: { kind: "daily", hour: 3, minute: 2 } })).toBe(
      frozenPlist(intervalBlock(86400)),
    );
  });

  it("dream service calendar opt-in: array-style StartCalendarInterval", () => {
    expect(
      plistContent({ ...common, schedule: { kind: "daily", hour: 3, minute: 2, calendar: true } }),
    ).toBe(frozenPlist(calendarBlock));
  });
});

describe("byte-diff: cronLines == frozen bash printf (bin/roll 9960-9961)", () => {
  const c: CronCommands = {
    loopCmd: 'cd "/proj" && roll loop now >> /sh/loop/cron-s.log 2>&1',
    loopMinute: 17,
    dreamCmd: 'cd "/proj" && roll dream >> /proj/.roll/dream/cron.log 2>&1',
    dreamMinute: 2,
    dreamHour: 3,
    projectPath: "/proj",
  };
  it("loop + dream lines match the frozen oracle byte-for-byte", () => {
    expect(cronLines(c)).toEqual([
      '17 * * * * cd "/proj" && roll loop now >> /sh/loop/cron-s.log 2>&1 # roll-loop:/proj',
      '2 3 * * * cd "/proj" && roll dream >> /proj/.roll/dream/cron.log 2>&1 # roll-loop:/proj',
    ]);
  });
});

// ─── exec-wrapper smoke tests via fake launchctl / crontab on PATH ────────────

describe("launchctl / crontab wrappers via fake binaries on PATH", () => {
  let fakeBin = "";
  let log = "";
  let savePATH = "";

  beforeAll(() => {
    fakeBin = tmp("bin");
    log = join(fakeBin, "argv.log");
    writeFileSync(log, "");
    const lc = join(fakeBin, "launchctl");
    writeFileSync(lc, `#!/bin/bash\nprintf '%s\\n' "$@" >> "${log}"\nprintf -- '---\\n' >> "${log}"\nexit 0\n`);
    chmodSync(lc, 0o755);
    const store = join(fakeBin, "crontab.store");
    writeFileSync(store, "0 0 * * * existing\n");
    const ct = join(fakeBin, "crontab");
    writeFileSync(
      ct,
      `#!/bin/bash\nif [ "$1" = "-l" ]; then cat "${store}"; elif [ "$1" = "-" ]; then cat > "${store}"; fi\n`,
    );
    chmodSync(ct, 0o755);
    savePATH = process.env["PATH"] ?? "";
    process.env["PATH"] = `${fakeBin}:${savePATH}`;
  });

  afterAll(() => {
    process.env["PATH"] = savePATH;
  });

  it("launchctl forwards argv verbatim", async () => {
    writeFileSync(log, "");
    const r = await launchctl(["bootstrap", "gui/501", "/x.plist"]);
    expect(r.code).toBe(0);
    const calls = readFileSync(log, "utf8").split("---\n").filter((s) => s.trim() !== "");
    expect(calls[0]!.split("\n").filter((t) => t !== "")).toEqual([
      "bootstrap", "gui/501", "/x.plist",
    ]);
  });

  it("crontabRead returns the stored crontab; crontabWrite replaces it", async () => {
    expect(await crontabRead()).toBe("0 0 * * * existing\n");
    const code = await crontabWrite("5 * * * * new\n");
    expect(code).toBe(0);
    expect(await crontabRead()).toBe("5 * * * * new\n");
  });

  // sanity: a schedule object is well-typed (compile-time guard).
  void (null as unknown as LaunchdSchedule);
});
