/**
 * diff-test: TS `roll setup` == bash `bin/roll setup` (frozen v2 oracle, which
 * shells lib/roll-setup.py for the v2 UI). The TS port reimplements the install
 * pipeline + the python UI renderer. Both read the SAME fabricated ROLL_PKG_DIR
 * (a copy of the repo's conventions/ tree + a tiny skills/ tree, with NO
 * .git/.gitmodules so the submodule guard is a no-op) and the SAME fabricated
 * ROLL_HOME, and run with cwd = a fabricated (non-git) project dir so the
 * git-hooks-path step is a deterministic skip on both sides.
 *
 * cmd_setup mutates ROLL_HOME (+ host AI dirs under HOME), so each scenario is
 * built TWICE (one fixture for bash, one for TS) from an identical builder and
 * we byte-compare stdout/stderr/exit. The "already synced" scenario seeds both
 * fixtures from a SINGLE golden ROLL_HOME produced by one bash run, so the
 * snapshot-diff verdict (unchanged → ↷) is identical regardless of cksum bytes.
 *
 * CI portability: fabricated HOME + ROLL_HOME (seeded update-check cache);
 * config carries only ai_claude so convention/skill sync touches just the
 * sandboxed $HOME/.claude; a PATH-shimmed `tmux` makes step 6 a deterministic
 * skip; the cwd is not a git repo so step 5 is a deterministic skip. No network,
 * no launchd. Locale pinned (en/zh cases override).
 */
import { execFileSync, execSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupCommand } from "../src/commands/setup.js";
import { binRollVersion } from "./helpers.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];
let fakeBin = "";
let pkgDir = "";

beforeAll(() => {
  // PATH shim: a fake `tmux` so the tmux step is a deterministic skip.
  fakeBin = realpathSync(mkdtempSync(join(tmpdir(), "roll-setup-bin-")));
  dirs.push(fakeBin);
  writeFileSync(join(fakeBin, "tmux"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  // Fabricated ROLL_PKG_DIR: conventions + a tiny skills tree, NO .git/.gitmodules.
  pkgDir = realpathSync(mkdtempSync(join(tmpdir(), "roll-setup-pkg-")));
  dirs.push(pkgDir);
  cpSync(join(REPO, "conventions"), join(pkgDir, "conventions"), { recursive: true });
  // The bash oracle sources lib/i18n.sh etc. and shells lib/roll-setup.py +
  // lib/roll_render.py from ROLL_PKG_DIR; bring lib/ along so the override dir
  // is a complete enough package root for the renderer to run.
  cpSync(join(REPO, "lib"), join(pkgDir, "lib"), { recursive: true });
  // Also stage the top-level agent-routes templates the way `roll setup` expects
  // them under conventions/templates (kept minimal — not needed by setup itself).
  for (const s of ["roll-alpha", "roll-beta"]) {
    mkdirSync(join(pkgDir, "skills", s), { recursive: true });
    writeFileSync(join(pkgDir, "skills", s, "SKILL.md"), `# ${s}\n`);
  }
});

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

interface Fixture {
  home: string;
  proj: string;
}

function seedHome(home: string): void {
  mkdirSync(join(home, ".roll"), { recursive: true });
  const v = binRollVersion();
  writeFileSync(join(home, ".roll", ".update-check"), `${Math.floor(Date.now() / 1000)} ${v} ${v}\n`);
}

/** A fresh, empty HOME + non-git project dir. */
function freshFixture(): Fixture {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "roll-setup-home-")));
  dirs.push(home);
  // config with ONLY ai_claude so sync is scoped to the sandboxed ~/.claude.
  mkdirSync(join(home, ".roll"), { recursive: true });
  writeFileSync(
    join(home, ".roll", "config.yaml"),
    "# Roll config\nlang: en\nai_claude: ~/.claude|CLAUDE.md|CLAUDE.md\n",
  );
  seedHome(home);
  const proj = realpathSync(mkdtempSync(join(tmpdir(), "roll-setup-proj-")));
  dirs.push(proj);
  return { home, proj };
}

/** Two fixtures sharing a SINGLE golden ROLL_HOME (already synced by one bash run). */
function syncedPair(): [Fixture, Fixture] {
  // Produce the golden state with one bash run over a throwaway HOME.
  const golden = freshFixture();
  bashSetup(golden, [], { ROLL_LANG: "en" });
  const mk = (): Fixture => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "roll-setup-home-")));
    dirs.push(home);
    cpSync(join(golden.home, ".roll"), join(home, ".roll"), { recursive: true });
    // Copy the synced ~/.claude too so step 2/3 see no change.
    try {
      cpSync(join(golden.home, ".claude"), join(home, ".claude"), { recursive: true });
    } catch {
      /* may not exist */
    }
    seedHome(home);
    const proj = realpathSync(mkdtempSync(join(tmpdir(), "roll-setup-proj-")));
    dirs.push(proj);
    return { home, proj };
  };
  return [mk(), mk()];
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function envBase(fx: Fixture, extra: Record<string, string>): Record<string, string> {
  return {
    PATH: `${fakeBin}:${process.env["PATH"] ?? ""}`,
    HOME: fx.home,
    ROLL_HOME: join(fx.home, ".roll"),
    ROLL_PKG_DIR: pkgDir,
    NO_COLOR: "1",
    ROLL_LANG: "en",
    PWD: fx.proj,
    ...extra,
  };
}

function bashSetup(fx: Fixture, args: string[], extra: Record<string, string>): Run {
  try {
    const stdout = execFileSync(join(REPO, "bin", "roll"), ["setup", ...args], {
      cwd: fx.proj,
      encoding: "utf8",
      env: { ...envBase(fx, extra), PWD: fx.proj },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

const ENV_KEYS = [
  "PATH", "HOME", "ROLL_HOME", "ROLL_PKG_DIR", "NO_COLOR", "ROLL_LANG", "LC_ALL", "LANG", "PWD",
];

function tsSetup(fx: Fixture, args: string[], extra: Record<string, string>): Run {
  const target = { ...envBase(fx, extra), PWD: fx.proj };
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
  process.stdout.write = (cnk: string | Uint8Array): boolean => (outChunks.push(String(cnk)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (cnk: string | Uint8Array): boolean => (errChunks.push(String(cnk)), true);
  let status: number | null;
  try {
    status = setupCommand(args);
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

function both(build: () => Fixture, args: string[], extra: Record<string, string> = {}): void {
  const bf = build();
  const tf = build();
  const b = bashSetup(bf, args, extra);
  const t = tsSetup(tf, args, extra);
  expect(t).toEqual(b);
}

describe("diff-test: roll setup == bash oracle", () => {
  for (const lang of ["en", "zh"]) {
    it(`fresh setup → install + sync, all ok (${lang})`, () => {
      both(freshFixture, [], { ROLL_LANG: lang });
    });

    it(`--force fresh setup → forced markers (${lang})`, () => {
      both(freshFixture, ["--force"], { ROLL_LANG: lang });
    });

    it(`unknown argument → err + exit 1 (${lang})`, () => {
      both(freshFixture, ["--bogus"], { ROLL_LANG: lang });
    });
  }

  it("already-synced re-run → all skip (no changes)", () => {
    const [bf, tf] = syncedPair();
    const b = bashSetup(bf, [], { ROLL_LANG: "en" });
    const t = tsSetup(tf, [], { ROLL_LANG: "en" });
    expect(t).toEqual(b);
  });

  it("already-synced --force re-run → forced markers", () => {
    const [bf, tf] = syncedPair();
    const b = bashSetup(bf, ["--force"], { ROLL_LANG: "en" });
    const t = tsSetup(tf, ["--force"], { ROLL_LANG: "en" });
    expect(t).toEqual(b);
  });
});
