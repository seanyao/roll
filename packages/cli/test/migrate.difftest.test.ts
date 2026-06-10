/**
 * diff-test: TS `roll migrate` == bash `bin/roll migrate` (frozen v2 oracle).
 *
 * cmd_migrate mutates the working tree (git mv + commit), so each scenario is
 * built TWICE from an identical builder: once for the bash run, once for the TS
 * run. We byte-compare stdout/stderr/exit, and for the executing path we also
 * compare the resulting `git ls-files` + the migration commit's stat so the
 * transformations match exactly.
 *
 * CI portability: every fixture initializes a repo-LOCAL git identity (user.name
 * / user.email set via `git -C`), so no host-global git config is touched and
 * the commit succeeds deterministically. No network, no gh, no launchd.
 */
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateCommand } from "../src/commands/migrate.js";
import { seedUpdateCheckCache } from "./helpers.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];
let home = "";

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "roll-mg-home-"));
  dirs.push(home);
  mkdirSync(join(home, ".roll"), { recursive: true });
  seedUpdateCheckCache(join(home, ".roll"));
});

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function gitInit(dir: string): void {
  const run = (args: string[]): void => {
    const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  run(["init", "-q"]);
  run(["config", "user.name", "Roll Test"]);
  run(["config", "user.email", "test@roll.local"]);
  run(["config", "commit.gpgsign", "false"]);
}

function commitAll(dir: string, msg: string): void {
  spawnSync("git", ["-C", dir, "add", "-A"], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "commit", "-q", "-m", msg], { encoding: "utf8" });
}

function w(base: string, rel: string, content: string): void {
  const full = join(base, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

// ── Fixture builders ─────────────────────────────────────────────────────────
/** old-only legacy layout, committed clean. */
function oldOnly(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-mg-old-"));
  dirs.push(p);
  gitInit(p);
  w(p, "BACKLOG.md", "# Backlog\n\n- US-1\n");
  w(p, "PROPOSALS.md", "# Proposals\n");
  w(p, "docs/features.md", "# Features\n");
  w(p, "docs/features/foo.md", "foo\n");
  w(p, "docs/briefs/b1.md", "brief\n");
  w(p, "docs/guide/en/intro.md", "intro\n");
  w(p, "docs/guide/zh/intro.md", "介绍\n");
  w(p, "docs/site/index.html", "<html></html>\n");
  w(p, "README.md", "readme\n");
  commitAll(p, "seed legacy layout");
  return p;
}

/** new-only — already migrated. */
function newOnly(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-mg-new-"));
  dirs.push(p);
  gitInit(p);
  w(p, ".roll/backlog.md", "# Backlog\n");
  w(p, "README.md", "readme\n");
  commitAll(p, "already migrated");
  return p;
}

/** both old + new → conflict. */
function both(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-mg-both-"));
  dirs.push(p);
  gitInit(p);
  w(p, "BACKLOG.md", "# Backlog\n");
  w(p, ".roll/backlog.md", "# Backlog new\n");
  w(p, "README.md", "readme\n");
  commitAll(p, "partial");
  return p;
}

/** neither old nor new. */
function neither(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-mg-none-"));
  dirs.push(p);
  gitInit(p);
  w(p, "README.md", "readme\n");
  commitAll(p, "empty");
  return p;
}

/** old-only but working tree dirty (uncommitted change). */
function oldDirty(): string {
  const p = oldOnly();
  w(p, "BACKLOG.md", "# Backlog\n\n- US-1\n- dirty edit\n");
  return p;
}

/** not a git repo. */
function notGit(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-mg-nogit-"));
  dirs.push(p);
  w(p, "BACKLOG.md", "# Backlog\n");
  return p;
}

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
    NO_COLOR: "1",
    // Pin locale so the bash oracle never falls back to macOS AppleLanguages
    // (which would diverge from the TS resolver). en/zh cases override this.
    ROLL_LANG: "en",
    ...extra,
  };
}

const ENV_KEYS = ["PATH", "HOME", "ROLL_HOME", "NO_COLOR", "ROLL_LANG", "LC_ALL", "LANG"];

function tsMg(cwd: string, args: string[], extra: Record<string, string>): Run {
  // Build the target env BEFORE clearing — envBase reads the host PATH so git
  // stays resolvable inside migrateCommand's spawnSync calls.
  const target = envBase(extra);
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
  let status: number;
  try {
    status = migrateCommand(args);
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
  return { status, stdout: outChunks.join(""), stderr: errChunks.join("") };
}

function lsFiles(dir: string): string {
  return execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8" });
}

/** Both sides on freshly-built identical fixtures; compare output + (optional) tree. */
// US-PORT-021b: the bash oracle (bin/roll) is retired; these freeze the
// proven-correct TS output as a snapshot. Scrub the per-run temp dir + git SHAs
// + timestamps so the snapshot is stable across machines/runs (CI is the
// cross-platform gate — locale is pinned via ROLL_LANG in envBase).
function scrub(r: Run, dir: string): Run {
  const n = (s: string): string =>
    s
      .split(dir)
      .join("<DIR>")
      .replace(/[0-9a-f]{7,40}/g, "<SHA>")
      .replace(/\d{4}-\d{2}-\d{2}[T ][\d:]+Z?/g, "<TS>");
  return { status: r.status, stdout: n(r.stdout), stderr: n(r.stderr) };
}

function both2(build: () => string, args: string[], extra: Record<string, string> = {}): void {
  const tDir = build();
  expect(scrub(tsMg(tDir, args, extra), tDir)).toMatchSnapshot();
}

function bothTrees(build: () => string, args: string[], extra: Record<string, string> = {}): void {
  const tDir = build();
  expect(scrub(tsMg(tDir, args, extra), tDir)).toMatchSnapshot();
  // After an executing migration, the tracked file set is frozen too.
  expect(lsFiles(tDir)).toMatchSnapshot();
}

describe("diff-test: roll migrate == bash oracle", () => {
  it("--help → usage, exit 0", () => {
    both2(neither, ["--help"]);
  });

  it("not a git repo → exit 1", () => {
    both2(notGit, []);
  });

  for (const lang of ["en", "zh"]) {
    it(`unknown arg → exit 1 (${lang})`, () => {
      both2(neither, ["--bogus"], { ROLL_LANG: lang });
    });

    it(`new-only → already migrated no-op (${lang})`, () => {
      both2(newOnly, [], { ROLL_LANG: lang });
    });

    it(`neither → nothing to migrate (${lang})`, () => {
      both2(neither, [], { ROLL_LANG: lang });
    });

    it(`both → conflict list, exit 1 (${lang})`, () => {
      both2(both, [], { ROLL_LANG: lang });
    });

    it(`old-only --dry-run → preview (${lang})`, () => {
      both2(oldOnly, ["--dry-run"], { ROLL_LANG: lang });
    });

    it(`old-only dirty tree → refuse, exit 1 (${lang})`, () => {
      both2(oldDirty, [], { ROLL_LANG: lang });
    });

    it(`old-only execute → migrate + commit, trees identical (${lang})`, () => {
      bothTrees(oldOnly, [], { ROLL_LANG: lang });
    });
  }
});
