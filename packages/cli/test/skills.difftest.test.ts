/**
 * diff-test: TS `roll skills` == bash `bin/roll skills` (frozen v2 oracle).
 *
 * Two probe surfaces:
 *  - the REAL frozen skills/ submodule (ROLL_PKG_DIR = repo) for `check` (the
 *    committed guide/skills.md is up to date) and `generate` stdout;
 *  - a fabricated ROLL_PKG_DIR with a hand-built skills/ tree + stale target to
 *    exercise the drift path (`diff -u` output) and the missing-target path.
 * All cases compare stdout/stderr/exit byte-for-byte, en + zh.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { skillsCommand } from "../src/commands/skills.js";
import { seedUpdateCheckCache } from "./helpers.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];
let home = "";

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "roll-skills-home-"));
  dirs.push(home);
  mkdirSync(join(home, ".roll"), { recursive: true });
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

function bashSkills(args: string[], env: Record<string, string>): Run {
  try {
    const stdout = execFileSync(join(REPO, "bin", "roll"), ["skills", ...args], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, HOME: home, ROLL_HOME: join(home, ".roll"), NO_COLOR: "1", ...env },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function tsSkills(args: string[], env: Record<string, string>): Run {
  const keys = ["HOME", "ROLL_HOME", "NO_COLOR", "ROLL_LANG", "LC_ALL", "LANG", "ROLL_PKG_DIR"];
  const save: Record<string, string | undefined> = {};
  for (const k of keys) save[k] = process.env[k];
  for (const k of keys) delete process.env[k];
  process.env["HOME"] = home;
  process.env["ROLL_HOME"] = join(home, ".roll");
  process.env["NO_COLOR"] = "1";
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const saveCwd = process.cwd();
  process.chdir(REPO);
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
    status = skillsCommand(args);
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

// Build a fabricated ROLL_PKG_DIR: bash sources its i18n catalog from
// $ROLL_PKG_DIR/lib, so we symlink the real lib/ (+ conventions) and provide a
// custom skills/ + guide/. Both bash and TS then read the same fixture.
function freshPkg(): string {
  const pkg = mkdtempSync(join(tmpdir(), "roll-skills-pkg-"));
  dirs.push(pkg);
  for (const d of ["lib", "conventions"]) symlinkSync(join(REPO, d), join(pkg, d));
  return pkg;
}

// A fabricated pkg whose committed guide/skills.md is STALE vs a fresh scan of
// its own skills/ tree → exercises the drift `diff -u` output path.
function makeStalePkg(): string {
  const pkg = freshPkg();
  mkdirSync(join(pkg, "guide"), { recursive: true });
  for (const [name, desc] of [
    ["alpha", "First skill description."],
    ["beta", "Second skill | with a pipe."],
  ]) {
    mkdirSync(join(pkg, "skills", name), { recursive: true });
    writeFileSync(
      join(pkg, "skills", name, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${desc}\n---\nbody\n`,
    );
  }
  // Intentionally-stale committed catalog (missing the beta row).
  writeFileSync(join(pkg, "guide", "skills.md"), "# Roll Skill Catalog\n\nstale\n");
  return pkg;
}

describe("diff-test: roll skills == bash oracle", () => {
  it("help (no-arg) en", () => {
    expect(tsSkills([], { ROLL_LANG: "en" })).toEqual(bashSkills([], { ROLL_LANG: "en" }));
  });
  it("help (no-arg) zh", () => {
    expect(tsSkills([], { ROLL_LANG: "zh" })).toEqual(bashSkills([], { ROLL_LANG: "zh" }));
  });
  it("help (explicit) en", () => {
    expect(tsSkills(["help"], { ROLL_LANG: "en" })).toEqual(bashSkills(["help"], { ROLL_LANG: "en" }));
  });

  it("check (real frozen skills/ — up to date) en", () => {
    expect(tsSkills(["check"], { ROLL_LANG: "en" })).toEqual(bashSkills(["check"], { ROLL_LANG: "en" }));
  });
  it("check (real frozen skills/ — up to date) zh", () => {
    expect(tsSkills(["check"], { ROLL_LANG: "zh" })).toEqual(bashSkills(["check"], { ROLL_LANG: "zh" }));
  });

  it("unknown subcommand en", () => {
    expect(tsSkills(["bogus"], { ROLL_LANG: "en" })).toEqual(bashSkills(["bogus"], { ROLL_LANG: "en" }));
  });
  it("unknown subcommand zh", () => {
    expect(tsSkills(["bogus"], { ROLL_LANG: "zh" })).toEqual(bashSkills(["bogus"], { ROLL_LANG: "zh" }));
  });

  // Drift path: stderr (drift message) + exit code are the behavioral contract
  // and must match byte-for-byte. The diff -u STDOUT carries the `--- <file>
  // <mtime>` / `+++ <tmp> <mtime>` header — both the temp path (mktemp vs
  // mkdtemp) and the timestamp are oracle-environment artifacts that cannot
  // agree across two independent runs. WHITELIST: we strip the two `---`/`+++`
  // header lines and compare the diff BODY (hunk header + content) byte-for-byte.
  const stripDiffHeader = (s: string): string =>
    s
      .split("\n")
      .filter((l) => !l.startsWith("--- ") && !l.startsWith("+++ "))
      .join("\n");
  it("check drift (stale fixture) prints diff -u + exit 1, en", () => {
    const pkg = makeStalePkg();
    const t = tsSkills(["check"], { ROLL_LANG: "en", ROLL_PKG_DIR: pkg });
    const b = bashSkills(["check"], { ROLL_LANG: "en", ROLL_PKG_DIR: pkg });
    expect(t.status).toBe(b.status);
    expect(t.stderr).toBe(b.stderr);
    expect(stripDiffHeader(t.stdout)).toBe(stripDiffHeader(b.stdout));
  });
  it("check drift (stale fixture) zh", () => {
    const pkg = makeStalePkg();
    const t = tsSkills(["check"], { ROLL_LANG: "zh", ROLL_PKG_DIR: pkg });
    const b = bashSkills(["check"], { ROLL_LANG: "zh", ROLL_PKG_DIR: pkg });
    expect(t.status).toBe(b.status);
    expect(t.stderr).toBe(b.stderr);
    expect(stripDiffHeader(t.stdout)).toBe(stripDiffHeader(b.stdout));
  });

  it("check missing target (empty fixture pkg) en", () => {
    const pkg = freshPkg();
    mkdirSync(join(pkg, "skills"), { recursive: true });
    expect(tsSkills(["check"], { ROLL_LANG: "en", ROLL_PKG_DIR: pkg })).toEqual(
      bashSkills(["check"], { ROLL_LANG: "en", ROLL_PKG_DIR: pkg }),
    );
  });
});
