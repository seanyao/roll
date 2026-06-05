/**
 * diff-test: TS `roll ci` == bash `bin/roll ci` (frozen v2 oracle).
 *
 * cmd_ci reports GitHub Actions status for the HEAD commit. The harness shims
 * `gh` on PATH (the oracle shells `gh run list … --json` then pipes through jq);
 * both sides run the SAME shim + a REAL git, so the parsed/formatted run lines
 * stay byte-identical. The TS port reimplements the `jq -r '.[] | "\(.name):
 * \(.status)/\(.conclusion)"'` interpolation natively (null → literal "null").
 *
 * Covered:
 *   - gh absent → warn + exit 0 (en/zh).
 *   - non-git dir (git rev-parse HEAD fails) → err + exit 1 (en/zh).
 *   - `gh run list` non-zero exit → warn "gh run list failed" + exit 0.
 *   - no runs ("[]") → "No CI runs for <short-sha>" + exit 0 (en/zh).
 *   - canned mixed runs (green / red / pending=null conclusion) → one line each.
 *   - unknown argument → usage err + exit 1 (en/zh).
 *
 * CI portability: a per-run scratch git repo (repo-local identity, one commit)
 * gives a stable HEAD; gh is a PATH shim; locale pinned. No network.
 */
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ciCommand } from "../src/commands/ci.js";
import { seedUpdateCheckCache, pathWithout } from "./helpers.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];
let rollHome = ""; // seeded ROLL_HOME so bin/roll's update-check write is silent

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

  // `gh run list … --json …` → canned JSON; anything else exits 0.
  writeGh(binGhRuns, [
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then',
    `  cat <<'JSON'`,
    CANNED_RUNS,
    "JSON",
    "  exit 0",
    "fi",
    "exit 0",
  ]);
  // `gh run list` → "[]" (no runs).
  writeGh(binGhEmpty, [
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then echo "[]"; exit 0; fi',
    "exit 0",
  ]);
  // `gh run list` → non-zero (gh failure).
  writeGh(binGhFail, [
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then echo "boom" >&2; exit 1; fi',
    "exit 0",
  ]);
  // binNoGh: no gh binary at all.
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

function bashCi(cwd: string, args: string[], shimDir: string, extra: Record<string, string> = {}): Run {
  const r = spawnSync(join(REPO, "bin", "roll"), ["ci", ...args], {
    cwd,
    encoding: "utf8",
    env: baseEnv(cwd, shimDir, extra),
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
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

/**
 * cmd_ci is read-only, so bash and TS run against the SAME cwd — crucial for the
 * paths that echo the HEAD short-sha (two separate repos would carry different
 * commit hashes and never byte-match).
 */
function both(
  buildCwd: () => string,
  args: string[],
  shimDir: string,
  extra: Record<string, string> = {},
): void {
  const cwd = buildCwd();
  const b = bashCi(cwd, args, shimDir, extra);
  const t = tsCi(cwd, args, shimDir, extra);
  expect(t).toEqual(b);
}

describe("diff-test: roll ci == bash oracle", () => {
  for (const lang of ["en", "zh"]) {
    it(`gh not installed → warn + exit 0 (${lang})`, () => {
      both(gitRepo, [], binNoGh, { ROLL_LANG: lang });
    });
    it(`non-git dir → err + exit 1 (${lang})`, () => {
      both(nonGitDir, [], binGhRuns, { ROLL_LANG: lang });
    });
    it(`no CI runs ("[]") → note + exit 0 (${lang})`, () => {
      both(gitRepo, [], binGhEmpty, { ROLL_LANG: lang });
    });
    it(`unknown argument → usage err + exit 1 (${lang})`, () => {
      both(gitRepo, ["--bogus"], binGhRuns, { ROLL_LANG: lang });
    });
  }

  it("canned mixed runs → one line each (green/red/pending)", () => {
    both(gitRepo, [], binGhRuns);
  });

  it("gh run list failure → warn + exit 0", () => {
    both(gitRepo, [], binGhFail);
  });

  it("--timeout=N without --wait → falls through to read surface", () => {
    both(gitRepo, ["--timeout=60"], binGhRuns);
  });
});
