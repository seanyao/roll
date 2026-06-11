/**
 * Frozen-expectation test: TS `roll skills`.
 *
 * `skillsCommand` was proven byte-equal to the bash oracle `bin/roll skills`
 * under diff-test. Per US-PORT-009c the oracle is retired: the `bin/roll skills`
 * spawn is dropped and each case freezes the TS `{status, stdout, stderr}` as an
 * inline snapshot (zero engine spawn). The up-to-date `check` fixture is now
 * seeded with the TS `generateCatalog()` (not the bash `generate` oracle). The
 * drift `diff -u` output carries a `--- <file> <mtime>` / `+++ <tmp> <mtime>`
 * header whose temp path + timestamp are environment artifacts — the two header
 * lines are stripped (WHITELIST) and the diff BODY frozen; the random ROLL_PKG_DIR
 * path is scrubbed to `<PKG>` so the frozen value stays portable.
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { skillsCommand, generateCatalog } from "../src/commands/skills.js";
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

/** Seed pkg/guide/skills.md with the TS catalog (replaces the bash `generate`). */
function seedCatalog(pkg: string): void {
  mkdirSync(join(pkg, "guide"), { recursive: true });
  const savePkg = process.env["ROLL_PKG_DIR"];
  process.env["ROLL_PKG_DIR"] = pkg;
  writeFileSync(join(pkg, "guide", "skills.md"), generateCatalog());
  if (savePkg === undefined) delete process.env["ROLL_PKG_DIR"];
  else process.env["ROLL_PKG_DIR"] = savePkg;
}

/** Scrub the random ROLL_PKG_DIR path → portable. */
function scrub(r: Run, pkg: string): Run {
  const s = (x: string): string => x.split(pkg).join("<PKG>");
  return { status: r.status, stdout: s(r.stdout), stderr: s(r.stderr) };
}

// The diff -u STDOUT carries a `--- <file> <mtime>` / `+++ <tmp> <mtime>` header
// whose temp path + timestamp are environment artifacts (WHITELIST): strip the
// two header lines and freeze the diff BODY (hunk header + content).
const stripDiffHeader = (s: string): string =>
  s.split("\n").filter((l) => !l.startsWith("--- ") && !l.startsWith("+++ ")).join("\n");

describe("frozen: roll skills", () => {
  it("help (no-arg) en", () => {
    expect(tsSkills([], { ROLL_LANG: "en" })).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "Usage: roll doctor skills | roll setup skills
      ",
      }
    `);
  });
  it("help (no-arg) zh", () => {
    expect(tsSkills([], { ROLL_LANG: "zh" })).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "用法：roll doctor skills | roll setup skills
      ",
      }
    `);
  });
  it("help (explicit) en", () => {
    expect(tsSkills(["help"], { ROLL_LANG: "en" })).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "Usage: roll doctor skills | roll setup skills
      ",
      }
    `);
  });

  // Self-consistent up-to-date fixture: seed the catalog with the TS
  // generateCatalog() ON THIS PLATFORM, then check. (Freezing the repo's
  // committed guide/skills.md is platform-fragile: glob collation on Linux CI
  // reorders entries → drift with diverging diffs.)
  it("check (self-generated catalog — up to date) en", () => {
    const pkg = freshPkg();
    symlinkSync(join(REPO, "skills"), join(pkg, "skills"));
    seedCatalog(pkg);
    expect(scrub(tsSkills(["check"], { ROLL_LANG: "en", ROLL_PKG_DIR: pkg }), pkg)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "[roll] Skill catalog is up to date.
      ",
      }
    `);
  });
  it("check (self-generated catalog — up to date) zh", () => {
    const pkg = freshPkg();
    symlinkSync(join(REPO, "skills"), join(pkg, "skills"));
    seedCatalog(pkg);
    expect(scrub(tsSkills(["check"], { ROLL_LANG: "zh", ROLL_PKG_DIR: pkg }), pkg)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "[roll] 技能清单已是最新。
      ",
      }
    `);
  });

  it("unknown subcommand en", () => {
    expect(tsSkills(["bogus"], { ROLL_LANG: "en" })).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] Unknown 'roll skills' subcommand: bogus
      ",
        "stdout": "Usage: roll doctor skills | roll setup skills
      ",
      }
    `);
  });
  it("unknown subcommand zh", () => {
    expect(tsSkills(["bogus"], { ROLL_LANG: "zh" })).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] 未知的 'roll skills' 子命令：bogus
      ",
        "stdout": "用法：roll doctor skills | roll setup skills
      ",
      }
    `);
  });

  it("check drift (stale fixture) prints diff -u + exit 1, en", () => {
    const pkg = makeStalePkg();
    const t = tsSkills(["check"], { ROLL_LANG: "en", ROLL_PKG_DIR: pkg });
    expect(scrub({ status: t.status, stdout: stripDiffHeader(t.stdout), stderr: t.stderr }, pkg)).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] Skill catalog drift: <PKG>/guide/skills.md differs from a fresh scan. Run 'roll setup skills'.
      ",
        "stdout": "@@ -1,3 +1,12 @@
       # Roll Skill Catalog
       
      -stale
      +> GENERATED by \`roll setup skills\` — do not edit by hand.
      +> 由 \`roll setup skills\` 生成 — 请勿手工编辑。
      +>
      +> Source of truth: each skill's \`skills/<name>/SKILL.md\` frontmatter.
      +> 事实源：各 skill 的 \`skills/<name>/SKILL.md\` frontmatter。
      +
      +| Skill | Description |
      +|-------|-------------|
      +| \`alpha\` | First skill description. |
      +| \`beta\` | Second skill \\| with a pipe. |
      ",
      }
    `);
  });
  it("check drift (stale fixture) zh", () => {
    const pkg = makeStalePkg();
    const t = tsSkills(["check"], { ROLL_LANG: "zh", ROLL_PKG_DIR: pkg });
    expect(scrub({ status: t.status, stdout: stripDiffHeader(t.stdout), stderr: t.stderr }, pkg)).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] 技能清单漂移：<PKG>/guide/skills.md 与最新扫描不一致。请运行 'roll setup skills'。
      ",
        "stdout": "@@ -1,3 +1,12 @@
       # Roll Skill Catalog
       
      -stale
      +> GENERATED by \`roll setup skills\` — do not edit by hand.
      +> 由 \`roll setup skills\` 生成 — 请勿手工编辑。
      +>
      +> Source of truth: each skill's \`skills/<name>/SKILL.md\` frontmatter.
      +> 事实源：各 skill 的 \`skills/<name>/SKILL.md\` frontmatter。
      +
      +| Skill | Description |
      +|-------|-------------|
      +| \`alpha\` | First skill description. |
      +| \`beta\` | Second skill \\| with a pipe. |
      ",
      }
    `);
  });

  it("check missing target (empty fixture pkg) en", () => {
    const pkg = freshPkg();
    mkdirSync(join(pkg, "skills"), { recursive: true });
    expect(scrub(tsSkills(["check"], { ROLL_LANG: "en", ROLL_PKG_DIR: pkg }), pkg)).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] Skill catalog not found at <PKG>/guide/skills.md. Run 'roll setup skills'.
      ",
        "stdout": "",
      }
    `);
  });
});
