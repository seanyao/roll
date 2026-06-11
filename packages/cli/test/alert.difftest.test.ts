/**
 * diff-test: TS `roll alert` — frozen v2 oracle output.
 *
 * The ACTIVE alert file ($_LOOP_ALERT) is fabricated via _SHARED_ROOT +
 * ROLL_MAIN_SLUG (a live `roll alert` resolves it under $_SHARED_ROOT/loop —
 * see alert.ts header). The consumption HISTORY (.roll/state/alert-log.jsonl)
 * is fabricated in a project cwd. All probes seed the update-check cache.
 *
 * ack carries `date '+%Y-%m-%d %H:%M:%S'` which is not injectable, so the ack
 * cases compare exit + the timestamp-stripped message and footer.
 *
 * Per US-PORT-009d the bash oracle spawn is dropped; values below were captured
 * while tests were green (TS == oracle) and then frozen.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { alertCommand } from "../src/commands/alert.js";
import { seedUpdateCheckCache } from "./helpers.js";

const dirs: string[] = [];
let home = "";
let shared = "";
let proj = "";

function alertFile(): string {
  return join(shared, "loop", "ALERT-test.md");
}
function logFile(): string {
  return join(proj, ".roll", "state", "alert-log.jsonl");
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "roll-alert-home-"));
  shared = mkdtempSync(join(tmpdir(), "roll-alert-shared-"));
  proj = mkdtempSync(join(tmpdir(), "roll-alert-proj-"));
  dirs.push(home, shared, proj);
  mkdirSync(join(home, ".roll"), { recursive: true });
  mkdirSync(join(shared, "loop"), { recursive: true });
  seedUpdateCheckCache(join(home, ".roll"));
});

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function envBase(extra: Record<string, string>): Record<string, string> {
  return {
    PATH: process.env["PATH"] ?? "",
    HOME: home,
    ROLL_HOME: join(home, ".roll"),
    _SHARED_ROOT: shared,
    ROLL_MAIN_SLUG: "test",
    NO_COLOR: "1",
    ...extra,
  };
}

function tsAlert(args: string[], extra: Record<string, string>): Run {
  const keys = ["PATH", "HOME", "ROLL_HOME", "_SHARED_ROOT", "ROLL_MAIN_SLUG", "NO_COLOR", "ROLL_LANG", "LC_ALL", "LANG", "ROLL_PROJECT_RUNTIME_DIR"];
  const save: Record<string, string | undefined> = {};
  for (const k of keys) save[k] = process.env[k];
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(envBase(extra))) process.env[k] = v;
  const saveCwd = process.cwd();
  process.chdir(proj);
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (outChunks.push(String(c)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (c: string | Uint8Array): boolean => (errChunks.push(String(c)), true);
  let status: number;
  try {
    status = alertCommand(args);
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    process.chdir(saveCwd);
    for (const k of keys) {
      const v = save[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return { status, stdout: outChunks.join(""), stderr: errChunks.join("") };
}

const LOG_BODY = [
  '{"recorded_at":"2026-06-05T08:30:00Z","notified":true,"level":"error","category":"loop-ci-red","message":"CI failed on main"}',
  '{"recorded_at":"2026-06-05T09:00:00Z","notified":false,"level":"warn","category":"pr-stale","message":"PR #12 idle 3d"}',
  "",
  "bad-json-line",
  '{"ts":"2026-06-05T09:15:00Z","notified":1,"level":"info","category":"note","message":"hello"}',
  "",
].join("\n");

// Strip the wall-clock second from ack output / footer.
const stripTs = (s: string): string =>
  s
    .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, "<TS>")
    .replace(/\d{4}-\d{2}-\d{2}/g, "<D>")
    .replace(/\d{2}:\d{2}:\d{2}/g, "<T>");

describe("frozen: roll alert", () => {
  it("list — no active file (en)", () => {
    expect(tsAlert(["list"], { ROLL_LANG: "en" })).toEqual({ status: 0, stdout: "[roll] No active alerts\n", stderr: "" });
  });

  it("list — active file present (en)", () => {
    writeFileSync(alertFile(), "ALERT BODY line1\nline2\n");
    expect(tsAlert(["list"], { ROLL_LANG: "en" })).toEqual({
      status: 0,
      stdout: "Active Alert\n\nALERT BODY line1\nline2\n\n  Run 'roll loop alert ack' to acknowledge, 'roll loop alert resolve' to clear.\nRun 'roll loop alert ack' to acknowledge alerts, 'roll loop alert resolve' to clear.\n",
      stderr: "",
    });
  });

  it('"" (default subcommand) == list (en)', () => {
    writeFileSync(alertFile(), "BODY\n");
    expect(tsAlert([], { ROLL_LANG: "en" })).toEqual({
      status: 0,
      stdout: "Active Alert\n\nBODY\n\n  Run 'roll loop alert ack' to acknowledge, 'roll loop alert resolve' to clear.\nRun 'roll loop alert ack' to acknowledge alerts, 'roll loop alert resolve' to clear.\n",
      stderr: "",
    });
  });

  it("resolve — no file (en)", () => {
    expect(tsAlert(["resolve"], { ROLL_LANG: "en" })).toEqual({ status: 0, stdout: "[roll] No active alerts\n", stderr: "" });
  });

  it("ack — no file (en)", () => {
    expect(tsAlert(["ack"], { ROLL_LANG: "en" })).toEqual({ status: 0, stdout: "[roll] No active alerts to acknowledge\n", stderr: "" });
  });

  it("log — no history (en)", () => {
    expect(tsAlert(["log"], { ROLL_LANG: "en" })).toEqual({ status: 0, stdout: "[roll] No alert history yet.\n  暂无告警历史。\n", stderr: "" });
  });

  it("log — history newest-first, default 10 (en)", () => {
    mkdirSync(join(proj, ".roll", "state"), { recursive: true });
    writeFileSync(logFile(), LOG_BODY);
    expect(tsAlert(["log"], { ROLL_LANG: "en" })).toEqual({
      status: 0,
      stdout: "  Alert log  (.roll/state/alert-log.jsonl)\n  告警日志  最近 10 条\n\n  09:15  ● [info] note — hello\n  09:00  ○ [warn] pr-stale — PR #12 idle 3d\n  08:30  ● [error] loop-ci-red — CI failed on main\n",
      stderr: "",
    });
  });

  it("log N — bounded tail (en)", () => {
    mkdirSync(join(proj, ".roll", "state"), { recursive: true });
    writeFileSync(logFile(), LOG_BODY);
    expect(tsAlert(["log", "2"], { ROLL_LANG: "en" })).toEqual({
      status: 0,
      stdout: "  Alert log  (.roll/state/alert-log.jsonl)\n  告警日志  最近 2 条\n\n  09:15  ● [info] note — hello\n  09:00  ○ [warn] pr-stale — PR #12 idle 3d\n",
      stderr: "",
    });
  });

  it("unknown subcommand → exit 1 (en)", () => {
    expect(tsAlert(["bogus"], { ROLL_LANG: "en" })).toEqual({
      status: 1,
      stdout: "  Usage: roll loop alert [list|ack|resolve|log]\n  用法：roll loop alert [list|ack|resolve|log]\n",
      stderr: "[roll] Unknown subcommand: bogus\n",
    });
  });

  it("list — no active file (zh)", () => {
    expect(tsAlert(["list"], { ROLL_LANG: "zh" })).toEqual({ status: 0, stdout: "[roll] 暂无告警\n", stderr: "" });
  });

  it("list — active file present (zh)", () => {
    writeFileSync(alertFile(), "ALERT BODY line1\nline2\n");
    expect(tsAlert(["list"], { ROLL_LANG: "zh" })).toEqual({
      status: 0,
      stdout: "当前告警\n\nALERT BODY line1\nline2\n\n  Run 'roll loop alert ack' to acknowledge, 'roll loop alert resolve' to clear.\n  运行 'roll loop alert ack' 确认告警，'roll loop alert resolve' 清除告警。\n",
      stderr: "",
    });
  });

  it('"" (default subcommand) == list (zh)', () => {
    writeFileSync(alertFile(), "BODY\n");
    expect(tsAlert([], { ROLL_LANG: "zh" })).toEqual({
      status: 0,
      stdout: "当前告警\n\nBODY\n\n  Run 'roll loop alert ack' to acknowledge, 'roll loop alert resolve' to clear.\n  运行 'roll loop alert ack' 确认告警，'roll loop alert resolve' 清除告警。\n",
      stderr: "",
    });
  });

  it("resolve — no file (zh)", () => {
    expect(tsAlert(["resolve"], { ROLL_LANG: "zh" })).toEqual({ status: 0, stdout: "[roll] 暂无告警\n", stderr: "" });
  });

  it("ack — no file (zh)", () => {
    expect(tsAlert(["ack"], { ROLL_LANG: "zh" })).toEqual({ status: 0, stdout: "[roll] 暂无待确认告警\n", stderr: "" });
  });

  it("log — no history (zh)", () => {
    expect(tsAlert(["log"], { ROLL_LANG: "zh" })).toEqual({ status: 0, stdout: "[roll] No alert history yet.\n  暂无告警历史。\n", stderr: "" });
  });

  it("log — history newest-first, default 10 (zh)", () => {
    mkdirSync(join(proj, ".roll", "state"), { recursive: true });
    writeFileSync(logFile(), LOG_BODY);
    expect(tsAlert(["log"], { ROLL_LANG: "zh" })).toEqual({
      status: 0,
      stdout: "  Alert log  (.roll/state/alert-log.jsonl)\n  告警日志  最近 10 条\n\n  09:15  ● [info] note — hello\n  09:00  ○ [warn] pr-stale — PR #12 idle 3d\n  08:30  ● [error] loop-ci-red — CI failed on main\n",
      stderr: "",
    });
  });

  it("log N — bounded tail (zh)", () => {
    mkdirSync(join(proj, ".roll", "state"), { recursive: true });
    writeFileSync(logFile(), LOG_BODY);
    expect(tsAlert(["log", "2"], { ROLL_LANG: "zh" })).toEqual({
      status: 0,
      stdout: "  Alert log  (.roll/state/alert-log.jsonl)\n  告警日志  最近 2 条\n\n  09:15  ● [info] note — hello\n  09:00  ○ [warn] pr-stale — PR #12 idle 3d\n",
      stderr: "",
    });
  });

  it("unknown subcommand → exit 1 (zh)", () => {
    expect(tsAlert(["bogus"], { ROLL_LANG: "zh" })).toEqual({
      status: 1,
      stdout: "  Usage: roll loop alert [list|ack|resolve|log]\n  用法：roll loop alert [list|ack|resolve|log]\n",
      stderr: "[roll] 未知子命令: bogus\n",
    });
  });

  it("resolve — file present removes it (en)", () => {
    writeFileSync(alertFile(), "BODY\n");
    const t = tsAlert(["resolve"], { ROLL_LANG: "en" });
    expect(existsSync(alertFile())).toBe(false);
    expect(t).toEqual({ status: 0, stdout: "[roll] Alert resolved and cleared\n", stderr: "" });
  });

  it("ack — file present appends footer (en, ts whitelisted)", () => {
    writeFileSync(alertFile(), "BODY\n");
    const t = tsAlert(["ack"], { ROLL_LANG: "en" });
    const tFile = readFileSync(alertFile(), "utf8");
    expect(t.status).toBe(0);
    expect(stripTs(t.stdout)).toBe("[roll] Alert acknowledged at <D>Alert acknowledged at <T>\n");
    expect(stripTs(tFile)).toBe("BODY\n\n**Acknowledged**: <TS>\n");
  });

  it("ack — file present (zh, ts whitelisted)", () => {
    writeFileSync(alertFile(), "BODY\n");
    const t = tsAlert(["ack"], { ROLL_LANG: "zh" });
    expect(t.status).toBe(0);
    expect(stripTs(t.stdout)).toBe("[roll] 告警已确认\n");
  });
});
