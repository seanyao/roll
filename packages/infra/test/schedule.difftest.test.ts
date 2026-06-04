/**
 * Byte-diff tests for the Schedule module (US-INFRA-004): the TS pure generators
 * reproduce the frozen bash plist + cron-line generators BYTE-FOR-BYTE.
 *   - plistContent vs the extracted `_write_launchd_plist` body (bin/roll
 *     8235-8289): we run the bash schedule_xml selection + content heredoc +
 *     `printf '%s\n' "$content" > $plist_path` with injected vars, then compare
 *     the written file to plistContent().
 *   - cronLines vs the bash `printf "%d * * * * %s %s:%s\n"` /
 *     `printf "%d %d * * * %s %s:%s\n"` (bin/roll 9960-9961).
 * Exec wrappers (launchctl/crontab) are smoke-tested with fake binaries below.
 */
import { execFileSync, execSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});
function tmp(name: string): string {
  const d = mkdtempSync(join(tmpdir(), `roll-infra-sched-${name}-`));
  dirs.push(d);
  return d;
}

/**
 * Run the extracted bash schedule_xml + content block (bin/roll 8235-8289) with
 * injected vars and return the bytes it writes. We sed out lines 8235-8289 (the
 * schedule_xml selection + content assignment + the printf write) and prepend
 * the variable assignments the surrounding function would have set.
 */
function bashPlist(vars: {
  label: string;
  runner_script: string;
  project_path: string;
  path_value: string;
  period: string;
  offset: string;
  hour: string;
  ROLL_DREAM_CALENDAR?: string;
}): string {
  const out = join(tmp("plist"), "out.plist");
  const body = execFileSync("sed", ["-n", "8235,8289p", join(REPO, "bin", "roll")], {
    encoding: "utf8",
  });
  // Wrap the extracted body in a function so the bash `local` declarations
  // inside it (cal_minute / interval) are legal exactly as they are in-oracle.
  const script = [
    `_gen() {`,
    `local label='${vars.label}'`,
    `local runner_script='${vars.runner_script}'`,
    `local project_path='${vars.project_path}'`,
    `local path_value='${vars.path_value}'`,
    `local period='${vars.period}'`,
    `local offset='${vars.offset}'`,
    `local hour='${vars.hour}'`,
    `local plist_path='${out}'`,
    body,
    `}`,
    `_gen`,
  ].join("\n");
  execFileSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, ROLL_DREAM_CALENDAR: vars.ROLL_DREAM_CALENDAR ?? "" },
  });
  return readFileSync(out, "utf8");
}

describe("byte-diff: plistContent == extracted _write_launchd_plist (bin/roll 8235-8289)", () => {
  const common = {
    label: "com.roll.loop.main-abc123",
    runner_script: "/sh/loop/run-main-abc123.sh",
    project_path: "/Users/u/proj",
    path_value: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
  };

  it("loop service: StartInterval = period*60 (period=5 → 300)", () => {
    const bash = bashPlist({ ...common, period: "5", offset: "0", hour: "" });
    const ts = plistContent({
      label: common.label,
      runnerScript: common.runner_script,
      projectPath: common.project_path,
      pathValue: common.path_value,
      schedule: { kind: "interval", periodMinutes: 5 },
    });
    expect(ts).toBe(bash);
  });

  it("loop service: hourly (period=60 → 3600)", () => {
    const bash = bashPlist({ ...common, period: "60", offset: "17", hour: "" });
    const ts = plistContent({
      label: common.label,
      runnerScript: common.runner_script,
      projectPath: common.project_path,
      pathValue: common.path_value,
      schedule: { kind: "interval", periodMinutes: 60 },
    });
    expect(ts).toBe(bash);
  });

  it("dream service default (FIX-105): StartInterval 86400", () => {
    const bash = bashPlist({ ...common, period: "60", offset: "2", hour: "3" });
    const ts = plistContent({
      label: common.label,
      runnerScript: common.runner_script,
      projectPath: common.project_path,
      pathValue: common.path_value,
      schedule: { kind: "daily", hour: 3, minute: 2 },
    });
    expect(ts).toBe(bash);
  });

  it("dream service calendar opt-in: array-style StartCalendarInterval", () => {
    const bash = bashPlist({
      ...common,
      period: "60",
      offset: "2",
      hour: "3",
      ROLL_DREAM_CALENDAR: "1",
    });
    const ts = plistContent({
      label: common.label,
      runnerScript: common.runner_script,
      projectPath: common.project_path,
      pathValue: common.path_value,
      schedule: { kind: "daily", hour: 3, minute: 2, calendar: true },
    });
    expect(ts).toBe(bash);
  });
});

/** The bash cron printf lines exactly as _loop_on emits them (bin/roll 9960-9961). */
function bashCronLines(c: CronCommands): [string, string] {
  const tag = "# roll-loop";
  const loop = execFileSync(
    "bash",
    ["-c", `printf "%d * * * * %s %s:%s\\n" "$1" "$2" "$3" "$4"`, "_", String(c.loopMinute), c.loopCmd, tag, c.projectPath],
    { encoding: "utf8" },
  );
  const dream = execFileSync(
    "bash",
    [
      "-c",
      `printf "%d %d * * * %s %s:%s\\n" "$1" "$2" "$3" "$4" "$5"`,
      "_",
      String(c.dreamMinute),
      String(c.dreamHour),
      c.dreamCmd,
      tag,
      c.projectPath,
    ],
    { encoding: "utf8" },
  );
  // bash appends a trailing \n; cronLines returns lines without it.
  return [loop.replace(/\n$/, ""), dream.replace(/\n$/, "")];
}

describe("byte-diff: cronLines == bash printf (bin/roll 9960-9961)", () => {
  const c: CronCommands = {
    loopCmd: 'cd "/proj" && roll loop now >> /sh/loop/cron-s.log 2>&1',
    loopMinute: 17,
    dreamCmd: 'cd "/proj" && roll dream >> /proj/.roll/dream/cron.log 2>&1',
    dreamMinute: 2,
    dreamHour: 3,
    projectPath: "/proj",
  };
  it("loop + dream lines match bash byte-for-byte", () => {
    expect(cronLines(c)).toEqual(bashCronLines(c));
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
    // fake launchctl: log argv, exit 0; `print` exits 0 (loaded).
    const lc = join(fakeBin, "launchctl");
    writeFileSync(lc, `#!/bin/bash\nprintf '%s\\n' "$@" >> "${log}"\nprintf -- '---\\n' >> "${log}"\nexit 0\n`);
    chmodSync(lc, 0o755);
    // fake crontab: `-l` echoes a stored tab; `-` reads stdin into the store.
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
