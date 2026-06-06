/**
 * diff-test: TS `roll ci` — frozen v2 oracle output.
 *
 * cmd_ci reports GitHub Actions status for the HEAD commit. The harness shims
 * `gh` on PATH; both sides run the SAME shim + a REAL git.
 *
 * Per US-PORT-009d the bash oracle spawn is dropped; values below were captured
 * while tests were green (TS == oracle) and then frozen.
 */
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ciCommand } from "../src/commands/ci.js";
import { seedUpdateCheckCache, pathWithout } from "./helpers.js";

const dirs: string[] = [];
let rollHome = "";

// gh shims: one that returns canned JSON, one that exits non-zero, one absent.
let binGhRuns = "";
let binGhEmpty = "";
let binGhFail = "";
let binNoGh = "";

const CANNED_RUNS = JSON.stringify([
  { name: "build", status: "completed", conclusion: "success" },
  { name: "lint", status: "completed", conclusion: "failure" },
  { name: "e2e", status: "in_progress", conclusion: null },
]);

function writeGh(dir: string, body: string[]): void {
  writeFileSync(join(dir, "gh"), ["#!/bin/sh", ...body, ""].join("\n"), { mode: 0o755 });
}

beforeAll(() => {
  binGhRuns = realpathSync(mkdtempSync(join(tmpdir(), "roll-ci-gh-")));
  binGhEmpty = realpathSync(mkdtempSync(join(tmpdir(), "roll-ci-ghe-")));
  binGhFail = realpathSync(mkdtempSync(join(tmpdir(), "roll-ci-ghf-")));
  binNoGh = realpathSync(mkdtempSync(join(tmpdir(), "roll-ci-nogh-")));
  dirs.push(binGhRuns, binGhEmpty, binGhFail, binNoGh);

  rollHome = realpathSync(mkdtempSync(join(tmpdir(), "roll-ci-home-")));
  dirs.push(rollHome);
  seedUpdateCheckCache(join(rollHome, ".roll"));

  writeGh(binGhRuns, [
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then',
    `  cat <<'JSON'`,
    CANNED_RUNS,
    "JSON",
    "  exit 0",
    "fi",
    "exit 0",
  ]);
  writeGh(binGhEmpty, [
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then echo "[]"; exit 0; fi',
    "exit 0",
  ]);
  writeGh(binGhFail, [
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then echo "boom" >&2; exit 1; fi',
    "exit 0",
  ]);
});

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

/** A scratch git repo with a single commit (stable HEAD), repo-local identity. */
function gitRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "roll-ci-repo-")));
  dirs.push(dir);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  const run = (cmd: string, a: string[]): void => {
    const r = spawnSync(cmd, a, { cwd: dir, env, encoding: "utf8" });
    if ((r.status ?? 1) !== 0) throw new Error(`${cmd} ${a.join(" ")}: ${r.stderr}`);
  };
  run("git", ["init", "-q"]);
  run("git", ["config", "user.email", "ci@test.local"]);
  run("git", ["config", "user.name", "CI Test"]);
  writeFileSync(join(dir, "f"), "x\n");
  run("git", ["add", "f"]);
  run("git", ["commit", "-q", "-m", "init"]);
  return dir;
}

/** A non-git scratch dir. */
function nonGitDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "roll-ci-nogit-")));
  dirs.push(dir);
  mkdirSync(join(dir, "sub"), { recursive: true });
  return dir;
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function baseEnv(cwd: string, shimDir: string, extra: Record<string, string>): Record<string, string> {
  return {
    PATH: `${shimDir}:${pathWithout("gh")}`,
    HOME: cwd,
    ROLL_HOME: join(rollHome, ".roll"),
    NO_COLOR: "1",
    ROLL_LANG: "en",
    PWD: cwd,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    ...extra,
  };
}

const ENV_KEYS = [
  "PATH", "HOME", "ROLL_HOME", "NO_COLOR", "ROLL_LANG", "LC_ALL", "LANG", "PWD",
  "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM",
];

function tsCi(cwd: string, args: string[], shimDir: string, extra: Record<string, string> = {}): Run {
  const target = baseEnv(cwd, shimDir, extra);
  const save: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) save[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(target)) process.env[k] = v;
  const saveCwd = process.cwd();
  process.chdir(cwd);
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (outChunks.push(String(c)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (c: string | Uint8Array): boolean => (errChunks.push(String(c)), true);
  let status: number | null;
  try {
    status = ciCommand(args);
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    process.chdir(saveCwd);
    for (const k of ENV_KEYS) {
      const v = save[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return { status: status ?? 0, stdout: outChunks.join(""), stderr: errChunks.join("") };
}

// HEAD short-sha varies per repo; scrub it before compare.
const scrubSha = (s: string): string => s.replace(/[0-9a-f]{7}/g, "<SHA>");

describe("frozen: roll ci", () => {
  it("gh not installed → warn + exit 0 (en)", () => {
    const cwd = gitRepo();
    expect(tsCi(cwd, [], binNoGh, { ROLL_LANG: "en" })).toEqual({ status: 0, stdout: "[roll] gh not installed  gh\n", stderr: "" });
  });

  it("non-git dir → err + exit 1 (en)", () => {
    const cwd = nonGitDir();
    expect(tsCi(cwd, [], binGhRuns, { ROLL_LANG: "en" })).toEqual({ status: 1, stdout: "", stderr: "[roll] Not a git repo\n" });
  });

  it('no CI runs ("[]") → note + exit 0 (en)', () => {
    const cwd = gitRepo();
    const r = tsCi(cwd, [], binGhEmpty, { ROLL_LANG: "en" });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(scrubSha(r.stdout)).toBe("No CI runs for <SHA>\n");
  });

  it("unknown argument → usage err + exit 1 (en)", () => {
    const cwd = gitRepo();
    expect(tsCi(cwd, ["--bogus"], binGhRuns, { ROLL_LANG: "en" })).toEqual({ status: 1, stdout: "", stderr: "[roll] Usage: roll ci [--wait] [--timeout=N]\n" });
  });

  it("gh not installed → warn + exit 0 (zh)", () => {
    const cwd = gitRepo();
    expect(tsCi(cwd, [], binNoGh, { ROLL_LANG: "zh" })).toEqual({ status: 0, stdout: "[roll] 未安装\n", stderr: "" });
  });

  it("non-git dir → err + exit 1 (zh)", () => {
    const cwd = nonGitDir();
    expect(tsCi(cwd, [], binGhRuns, { ROLL_LANG: "zh" })).toEqual({ status: 1, stdout: "", stderr: "[roll] 非 git 仓库\n" });
  });

  it('no CI runs ("[]") → note + exit 0 (zh)', () => {
    const cwd = gitRepo();
    const r = tsCi(cwd, [], binGhEmpty, { ROLL_LANG: "zh" });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(scrubSha(r.stdout)).toBe("<SHA> 无 CI 记录\n");
  });

  it("unknown argument → usage err + exit 1 (zh)", () => {
    const cwd = gitRepo();
    expect(tsCi(cwd, ["--bogus"], binGhRuns, { ROLL_LANG: "zh" })).toEqual({ status: 1, stdout: "", stderr: "[roll] 用法: roll ci [--wait] [--timeout=N]\n" });
  });

  it("canned mixed runs → one line each (green/red/pending)", () => {
    const cwd = gitRepo();
    expect(tsCi(cwd, [], binGhRuns)).toEqual({
      status: 0,
      stdout: "build: completed/success\nlint: completed/failure\ne2e: in_progress/null\n",
      stderr: "",
    });
  });

  it("gh run list failure → warn + exit 0", () => {
    const cwd = gitRepo();
    expect(tsCi(cwd, [], binGhFail)).toEqual({ status: 0, stdout: "[roll] gh run list failed\n", stderr: "" });
  });

  it("--timeout=N without --wait → falls through to read surface", () => {
    const cwd = gitRepo();
    expect(tsCi(cwd, ["--timeout=60"], binGhRuns)).toEqual({
      status: 0,
      stdout: "build: completed/success\nlint: completed/failure\ne2e: in_progress/null\n",
      stderr: "",
    });
  });
});
