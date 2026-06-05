/**
 * diff-test: TS `roll alert` == bash `bin/roll alert` (frozen v2 oracle).
 *
 * The ACTIVE alert file ($_LOOP_ALERT) is fabricated via _SHARED_ROOT +
 * ROLL_MAIN_SLUG (a live `roll alert` resolves it under $_SHARED_ROOT/loop —
 * see alert.ts header). The consumption HISTORY (.roll/state/alert-log.jsonl)
 * is fabricated in a project cwd. All probes seed the update-check cache.
 *
 * ack carries `date '+%Y-%m-%d %H:%M:%S'` which is not injectable into the bash
 * oracle, so the ack cases compare exit + the timestamp-stripped message and
 * footer (documented whitelist: the wall-clock second).
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { alertCommand } from "../src/commands/alert.js";
import { seedUpdateCheckCache } from "./helpers.js";

const REPO = resolve(__dirname, "../../..");
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

function bashAlert(args: string[], extra: Record<string, string>): Run {
  try {
    const stdout = execFileSync(join(REPO, "bin", "roll"), ["alert", ...args], {
      cwd: proj,
      encoding: "utf8",
      env: envBase(extra),
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
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

// Strip the wall-clock second from ack output / footer (the only non-injectable
// byte). The en ack message word-splits the date (printf format-reuse quirk),
// so date and time can appear as SEPARATE fragments — strip them independently
// or a second-boundary straddle between the two legs flakes the compare.
const stripTs = (s: string): string =>
  s
    .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, "<TS>")
    .replace(/\d{4}-\d{2}-\d{2}/g, "<D>")
    .replace(/\d{2}:\d{2}:\d{2}/g, "<T>");

describe("diff-test: roll alert == bash oracle", () => {
  for (const lang of ["en", "zh"]) {
    it(`list — no active file (${lang})`, () => {
      expect(tsAlert(["list"], { ROLL_LANG: lang })).toEqual(bashAlert(["list"], { ROLL_LANG: lang }));
    });

    it(`list — active file present (${lang})`, () => {
      writeFileSync(alertFile(), "ALERT BODY line1\nline2\n");
      expect(tsAlert(["list"], { ROLL_LANG: lang })).toEqual(bashAlert(["list"], { ROLL_LANG: lang }));
    });

    it(`"" (default subcommand) == list (${lang})`, () => {
      writeFileSync(alertFile(), "BODY\n");
      expect(tsAlert([], { ROLL_LANG: lang })).toEqual(bashAlert([], { ROLL_LANG: lang }));
    });

    it(`resolve — no file (${lang})`, () => {
      expect(tsAlert(["resolve"], { ROLL_LANG: lang })).toEqual(bashAlert(["resolve"], { ROLL_LANG: lang }));
    });

    it(`ack — no file (${lang})`, () => {
      expect(tsAlert(["ack"], { ROLL_LANG: lang })).toEqual(bashAlert(["ack"], { ROLL_LANG: lang }));
    });

    it(`log — no history (${lang})`, () => {
      expect(tsAlert(["log"], { ROLL_LANG: lang })).toEqual(bashAlert(["log"], { ROLL_LANG: lang }));
    });

    it(`log — history newest-first, default 10 (${lang})`, () => {
      mkdirSync(join(proj, ".roll", "state"), { recursive: true });
      writeFileSync(logFile(), LOG_BODY);
      expect(tsAlert(["log"], { ROLL_LANG: lang })).toEqual(bashAlert(["log"], { ROLL_LANG: lang }));
    });

    it(`log N — bounded tail (${lang})`, () => {
      mkdirSync(join(proj, ".roll", "state"), { recursive: true });
      writeFileSync(logFile(), LOG_BODY);
      expect(tsAlert(["log", "2"], { ROLL_LANG: lang })).toEqual(bashAlert(["log", "2"], { ROLL_LANG: lang }));
    });

    it(`unknown subcommand → exit 1 (${lang})`, () => {
      expect(tsAlert(["bogus"], { ROLL_LANG: lang })).toEqual(bashAlert(["bogus"], { ROLL_LANG: lang }));
    });
  }

  // resolve removes the file (mutation): use separate fresh files for each side.
  it("resolve — file present removes it (en)", () => {
    writeFileSync(alertFile(), "BODY\n");
    const t = tsAlert(["resolve"], { ROLL_LANG: "en" });
    expect(existsSync(alertFile())).toBe(false); // TS removed it
    writeFileSync(alertFile(), "BODY\n");
    const b = bashAlert(["resolve"], { ROLL_LANG: "en" });
    expect(existsSync(alertFile())).toBe(false); // bash removed it
    expect(t).toEqual(b);
  });

  // ack appends a footer (mutation + non-injectable timestamp): compare the
  // timestamp-stripped stdout, and assert both wrote the same footer shape.
  it("ack — file present appends footer (en, ts whitelisted)", () => {
    writeFileSync(alertFile(), "BODY\n");
    const t = tsAlert(["ack"], { ROLL_LANG: "en" });
    const tFile = readFileSync(alertFile(), "utf8");
    writeFileSync(alertFile(), "BODY\n");
    const b = bashAlert(["ack"], { ROLL_LANG: "en" });
    const bFile = readFileSync(alertFile(), "utf8");
    expect(t.status).toBe(b.status);
    expect(stripTs(t.stdout)).toBe(stripTs(b.stdout));
    expect(stripTs(tFile)).toBe(stripTs(bFile));
    expect(stripTs(tFile)).toBe("BODY\n\n**Acknowledged**: <TS>\n");
  });

  it("ack — file present (zh, ts whitelisted)", () => {
    writeFileSync(alertFile(), "BODY\n");
    const t = tsAlert(["ack"], { ROLL_LANG: "zh" });
    writeFileSync(alertFile(), "BODY\n");
    const b = bashAlert(["ack"], { ROLL_LANG: "zh" });
    expect(t.status).toBe(b.status);
    expect(stripTs(t.stdout)).toBe(stripTs(b.stdout));
  });
});
