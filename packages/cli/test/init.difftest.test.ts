/**
 * diff-test: TS `roll init` == bash `bin/roll init` (frozen v2 oracle, which
 * shells lib/roll-init.py for the v2 UI). The TS port reimplements the
 * scaffolding + the python UI renderer; both read the SAME fabricated ROLL_HOME
 * (a copy of the repo's conventions/ tree) so AGENTS.md/CLAUDE.md/agent-routes
 * sources are identical, and run in the SAME fabricated project dir.
 *
 * cmd_init mutates the project dir, so each scenario is built TWICE (one fixture
 * for bash, one for TS) and we byte-compare stdout/stderr/exit AND the resulting
 * AGENTS.md / .claude/CLAUDE.md / .roll tree. The banner embeds the project path
 * (right-aligned, width-sensitive), so both sides run with cwd = the SAME
 * realpath'd dir and PWD pinned to it — bash uses logical `$(pwd)` while Node's
 * cwd is physical, so resolving up front keeps the banner byte-identical.
 *
 * CI portability: fabricated HOME/ROLL_HOME (seeded update-check cache); the
 * config has NO ai_* tools so `_sync_conventions` is a clean no-op pass on both
 * sides (sync_status = ok) and nothing touches host AI-client dirs. Locale is
 * pinned (en/zh cases override). No network, no gh, no launchd, no git.
 */
import { execFileSync, execSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initCommand } from "../src/commands/init.js";
import { binRollVersion } from "./helpers.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];

/** A fabricated ROLL_HOME containing a copy of the repo conventions/ tree. */
function freshHome(): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "roll-init-home-")));
  dirs.push(home);
  cpSync(join(REPO, "conventions"), join(home, "conventions"), { recursive: true });
  // `roll setup` populates ROLL_TEMPLATES (conventions/templates) with the repo's
  // top-level agent-routes templates; mirror that so init seeds agent-routes.yaml.
  cpSync(join(REPO, "templates", "agent-routes"), join(home, "conventions", "templates", "agent-routes"), {
    recursive: true,
  });
  // Seed update-check cache so the oracle never nags / fetches releases.
  const v = binRollVersion();
  writeFileSync(join(home, ".update-check"), `${Math.floor(Date.now() / 1000)} ${v} ${v}\n`);
  // Config with NO ai_* tools → _sync_conventions is a no-op pass.
  writeFileSync(join(home, "config.yaml"), "# Roll config\nlang: en\n");
  return home;
}

beforeAll(() => {
  /* per-fixture homes built on demand */
});
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

interface Fixture {
  proj: string;
  home: string;
}

function freshProj(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "roll-init-proj-")));
}

// ── Fixture builders ─────────────────────────────────────────────────────────
/** Empty dir → project type "unknown", fresh init. */
function freshUnknown(): Fixture {
  const proj = freshProj();
  dirs.push(proj);
  return { proj, home: freshHome() };
}

/** A `bin/` dir → project type "cli", fresh init (gets a CLAUDE.md template). */
function freshCli(): Fixture {
  const proj = freshProj();
  dirs.push(proj);
  mkdirSync(join(proj, "bin"), { recursive: true });
  // a non-empty file keeps the dir, but stays under the legacy ≥10 threshold.
  writeFileSync(join(proj, "bin", "tool"), "#!/bin/sh\n");
  return { proj, home: freshHome() };
}

/** Fresh init with NO global AGENTS.md present → AGENTS.md step skipped. */
function freshNoGlobalAgents(): Fixture {
  const proj = freshProj();
  dirs.push(proj);
  const home = freshHome();
  // Remove the global AGENTS.md so _merge_global_to_project warns (discarded)
  // and creates nothing — step 2 renders as "not modified".
  execSync(`rm -f '${join(home, "conventions", "global", "AGENTS.md")}'`);
  return { proj, home };
}

/** Existing AGENTS.md (no global-only sections missing) → re-init unchanged. */
function reinitExisting(): Fixture {
  const proj = freshProj();
  dirs.push(proj);
  const home = freshHome();
  // Copy the global AGENTS.md verbatim so the section-merge finds nothing new.
  cpSync(join(home, "conventions", "global", "AGENTS.md"), join(proj, "AGENTS.md"));
  return { proj, home };
}

/** Existing partial AGENTS.md missing some global sections → re-init merges. */
function reinitPartial(): Fixture {
  const proj = freshProj();
  dirs.push(proj);
  const home = freshHome();
  writeFileSync(join(proj, "AGENTS.md"), "# Project AGENTS\n\n## 1. Communication\n\nlocal stuff\n");
  return { proj, home };
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function envBase(home: string, extra: Record<string, string>): Record<string, string> {
  return {
    PATH: process.env["PATH"] ?? "",
    HOME: home,
    ROLL_HOME: home,
    NO_COLOR: "1",
    ROLL_LANG: "en",
    PWD: "", // set per-run to the proj dir
    ...extra,
  };
}

function bashInit(fx: Fixture, args: string[], extra: Record<string, string>): Run {
  try {
    const stdout = execFileSync(join(REPO, "bin", "roll"), ["init", ...args], {
      cwd: fx.proj,
      encoding: "utf8",
      env: { ...envBase(fx.home, extra), PWD: fx.proj },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

const ENV_KEYS = [
  "PATH", "HOME", "ROLL_HOME", "NO_COLOR", "ROLL_LANG", "LC_ALL", "LANG", "PWD",
  "ROLL_AGENT_ROUTES_TEMPLATE",
];

function tsInit(fx: Fixture, args: string[], extra: Record<string, string>): Run {
  const target = { ...envBase(fx.home, extra), PWD: fx.proj };
  const save: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) save[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(target)) process.env[k] = v;
  const saveCwd = process.cwd();
  process.chdir(fx.proj);
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
    status = initCommand(args);
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

function read(p: string): string {
  return existsSync(p) ? readFileSync(p, "utf8") : "<MISSING>";
}

/**
 * Replace a fixture's (per-run, random) project path with a fixed-WIDTH
 * placeholder so the width-sensitive right-aligned banner still compares. The
 * mkdtemp suffix has a constant length, so a constant-length token preserves
 * the `row()` gap exactly for both sides.
 */
function norm(run: Run, proj: string): Run {
  const token = "X".repeat(proj.length);
  const repl = (s: string): string => s.split(proj).join(token);
  return { status: run.status, stdout: repl(run.stdout), stderr: repl(run.stderr) };
}

/**
 * US-PAIR-008: v3 init adds a pairing scaffold step + NEXT item the frozen v2
 * oracle lacks. Strip those (and ONLY those) lines so the rest stays byte-
 * identical to v2; a dedicated test asserts the pairing lines ARE present.
 */
function stripPairing(r: Run): Run {
  return {
    ...r,
    stdout: r.stdout
      .split("\n")
      .filter((l) => !/pairing/i.test(l) && !/roll pair status/i.test(l) && !/\.roll\/pairing\.yaml/.test(l))
      .join("\n"),
  };
}

/** Compare stdout/stderr/exit AND the scaffolded artefacts. */
function bothFull(
  build: () => Fixture,
  args: string[],
  extra: Record<string, string> = {},
): void {
  const bf = build();
  const tf = build();
  const b = norm(bashInit(bf, args, extra), bf.proj);
  const t = norm(tsInit(tf, args, extra), tf.proj);
  expect(stripPairing(t)).toEqual(b);
  // Scaffolded artefacts byte-identical.
  for (const rel of [
    "AGENTS.md",
    ".claude/CLAUDE.md",
    ".roll/backlog.md",
    ".roll/features.md",
    ".roll/agent-routes.yaml",
  ]) {
    expect(read(join(tf.proj, rel))).toBe(read(join(bf.proj, rel)));
  }
}

describe("diff-test: roll init == bash oracle", () => {
  for (const lang of ["en", "zh"]) {
    it(`fresh init (unknown type) → scaffold + UI (${lang})`, () => {
      bothFull(freshUnknown, [], { ROLL_LANG: lang });
    });

    it(`fresh init (cli type, has CLAUDE.md template) → scaffold + UI (${lang})`, () => {
      bothFull(freshCli, [], { ROLL_LANG: lang });
    });

    it(`re-init over identical AGENTS.md → unchanged merge (${lang})`, () => {
      bothFull(reinitExisting, [], { ROLL_LANG: lang });
    });

    it(`re-init over partial AGENTS.md → section merge (${lang})`, () => {
      bothFull(reinitPartial, [], { ROLL_LANG: lang });
    });

    it(`fresh init with no global AGENTS.md → step skipped (${lang})`, () => {
      bothFull(freshNoGlobalAgents, [], { ROLL_LANG: lang });
    });
  }

  it("US-PAIR-008: v3 init scaffolds pairing (the deliberate divergence is present)", () => {
    const tf = freshUnknown();
    const t = tsInit(tf, [], {});
    expect(t.stdout).toMatch(/Scaffold cross-agent pairing/);
    expect(t.stdout).toMatch(/\.roll\/pairing\.yaml/);
    expect(t.stdout).toMatch(/roll pair status/);
    expect(read(join(tf.proj, ".roll", "pairing.yaml"))).toContain("# .roll/pairing.yaml");
  });

  it("idempotent re-run: second init over a TS-scaffolded fresh project", () => {
    // Build one fixture, run TS init twice; compare the SECOND run to a bash
    // run over a separately TS-initialized identical project.
    const bf = freshUnknown();
    const tf = freshUnknown();
    // First pass on both (now both have AGENTS.md → re-init path next).
    tsInit(bf, [], {});
    tsInit(tf, [], {});
    const b = norm(bashInit(bf, [], {}), bf.proj);
    const t = norm(tsInit(tf, [], {}), tf.proj);
    expect(stripPairing(t)).toEqual(b);
  });
});
