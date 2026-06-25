/**
 * frozen: TS `roll setup` output and side effects.
 *
 * This command was previously proven byte-equal to the frozen bash oracle. The
 * oracle spawn is now retired for US-PORT-014: every case calls the TS command
 * directly and freezes `{status, stdout, stderr}` inline. The fixture still
 * exercises the real setup filesystem side effects in a sandboxed HOME.
 */
import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
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
  fakeBin = realpathSync(mkdtempSync(join(tmpdir(), "roll-setup-bin-")));
  dirs.push(fakeBin);
  writeFileSync(join(fakeBin, "tmux"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  pkgDir = realpathSync(mkdtempSync(join(tmpdir(), "roll-setup-pkg-")));
  dirs.push(pkgDir);
  cpSync(join(REPO, "conventions"), join(pkgDir, "conventions"), { recursive: true });
  for (const s of ["roll-alpha", "roll-beta"]) {
    mkdirSync(join(pkgDir, "skills", s), { recursive: true });
    writeFileSync(join(pkgDir, "skills", s, "SKILL.md"), `# ${s}\n`);
  }
  mkdirSync(join(pkgDir, "skills", "roll-alpha", "references"), { recursive: true });
  writeFileSync(
    join(pkgDir, "skills", "roll-alpha", "references", "full-contract.md"),
    "# roll-alpha full contract\n",
  );
});

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

interface Fixture {
  home: string;
  proj: string;
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function seedHome(home: string): void {
  mkdirSync(join(home, ".roll"), { recursive: true });
  const v = binRollVersion();
  writeFileSync(join(home, ".roll", ".update-check"), `${Math.floor(Date.now() / 1000)} ${v} ${v}\n`);
}

function freshFixture(): Fixture {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "roll-setup-home-")));
  dirs.push(home);
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

function syncedFixture(): Fixture {
  const fx = freshFixture();
  tsSetup(fx, [], { ROLL_LANG: "en" });
  return fx;
}

function envBase(fx: Fixture, extra: Record<string, string>): Record<string, string> {
  return {
    PATH: fakeBin,
    HOME: fx.home,
    ROLL_HOME: join(fx.home, ".roll"),
    ROLL_PKG_DIR: pkgDir,
    NO_COLOR: "1",
    ROLL_LANG: "en",
    PWD: fx.proj,
    ...extra,
  };
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
  let status: number;
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
  return { status, stdout: outChunks.join(""), stderr: errChunks.join("") };
}

function assertFreshSideEffects(fx: Fixture): void {
  expect(readFileSync(join(fx.home, ".roll", "conventions", "global", "AGENTS.md"), "utf8")).toContain(
    "# Agent Conventions",
  );
  expect(readFileSync(join(fx.home, ".claude", "roll.md"), "utf8")).toContain(
    "# Global Preferences — Claude Code",
  );
  expect(readFileSync(join(fx.home, ".claude", "CLAUDE.md"), "utf8")).toContain("@roll.md");
  expect(readFileSync(join(fx.home, ".roll", "skills", "roll-alpha", "SKILL.md"), "utf8")).toBe("# roll-alpha\n");
  expect(readFileSync(join(fx.home, ".roll", "skills", "roll-alpha", "references", "full-contract.md"), "utf8"))
    .toBe("# roll-alpha full contract\n");
  const skillLink = join(fx.home, ".claude", "skills", "roll-alpha");
  expect(lstatSync(skillLink).isSymbolicLink()).toBe(true);
  expect(readlinkSync(skillLink)).toBe(`${join(fx.home, ".roll", "skills", "roll-alpha")}/`);
  expect(readFileSync(join(skillLink, "references", "full-contract.md"), "utf8")).toBe("# roll-alpha full contract\n");
  expect(existsSync(join(fx.home, ".roll", ".peer-state", "logs"))).toBe(true);
}

describe("frozen: roll setup", () => {
  it("fresh setup → install + sync, all ok (en)", () => {
    const fx = freshFixture();
    expect(tsSetup(fx, [], { ROLL_LANG: "en" })).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "  SETUP  ·  初始化                                                                                  
      ────────────────────────────────────────────────────────────────────────────────

        1. ✓  Install templates & conventions to ~/.roll
        2. ✓  Sync conventions to AI tools
        3. ✓  Install skills to ~/.claude
        4. ✓  Initialize peer-review state directory
        5. ↷  Configure git hooks path
        6. ↷  Ensure tmux is installed (already present)

      ────────────────────────────────────────────────────────────────────────────────
        Setup complete (4 items refreshed)  —  run roll init inside a project
      ════════════════════════════════════════════════════════════════════════════════

        No AI agents installed. Run \`roll agent use\` later to set a default, or install one (e.g., claude, kimi, pi).

        → For \`roll release\`: enable "Allow auto-merge" in your repo (Settings → General → Pull Requests),
          or the release will stop and ask you to merge the PR manually.
        → roll release 需要仓库开启 “Allow auto-merge”（Settings → General → Pull Requests），
          否则发版会停下并提示你手动合并 PR。
      ",
      }
    `);
    assertFreshSideEffects(fx);
  });

  it("fresh setup → install + sync, all ok (zh)", () => {
    const fx = freshFixture();
    expect(tsSetup(fx, [], { ROLL_LANG: "zh" })).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "  SETUP  ·  初始化                                                                                  
      ────────────────────────────────────────────────────────────────────────────────

        1. ✓  Install templates & conventions to ~/.roll
        2. ✓  Sync conventions to AI tools
        3. ✓  Install skills to ~/.claude
        4. ✓  Initialize peer-review state directory
        5. ↷  Configure git hooks path
        6. ↷  Ensure tmux is installed (already present)

      ────────────────────────────────────────────────────────────────────────────────
        Setup complete (4 items refreshed)  —  run roll init inside a project
      ════════════════════════════════════════════════════════════════════════════════

        未安装 AI agent。请稍后运行 \`roll agent use\` 设置默认，或先安装一个（如 claude、kimi、pi）。

        → For \`roll release\`: enable "Allow auto-merge" in your repo (Settings → General → Pull Requests),
          or the release will stop and ask you to merge the PR manually.
        → roll release 需要仓库开启 “Allow auto-merge”（Settings → General → Pull Requests），
          否则发版会停下并提示你手动合并 PR。
      ",
      }
    `);
    assertFreshSideEffects(fx);
  });

  it("--force fresh setup → forced markers (en)", () => {
    const fx = freshFixture();
    expect(tsSetup(fx, ["--force"], { ROLL_LANG: "en" })).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "  SETUP  ·  初始化                                                                                  
      ────────────────────────────────────────────────────────────────────────────────

        1. ~  Install templates & conventions to ~/.roll
        2. ~  Sync conventions to AI tools
        3. ~  Install skills to ~/.claude
        4. ~  Initialize peer-review state directory
        5. ↷  Configure git hooks path
        6. ↷  Ensure tmux is installed (already present)

      ────────────────────────────────────────────────────────────────────────────────
        Setup re-installed (forced — 4 items)  —  run roll init inside a project
      ════════════════════════════════════════════════════════════════════════════════

        No AI agents installed. Run \`roll agent use\` later to set a default, or install one (e.g., claude, kimi, pi).

        → For \`roll release\`: enable "Allow auto-merge" in your repo (Settings → General → Pull Requests),
          or the release will stop and ask you to merge the PR manually.
        → roll release 需要仓库开启 “Allow auto-merge”（Settings → General → Pull Requests），
          否则发版会停下并提示你手动合并 PR。
      ",
      }
    `);
    assertFreshSideEffects(fx);
  });

  it("--force fresh setup → forced markers (zh)", () => {
    const fx = freshFixture();
    expect(tsSetup(fx, ["--force"], { ROLL_LANG: "zh" })).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "  SETUP  ·  初始化                                                                                  
      ────────────────────────────────────────────────────────────────────────────────

        1. ~  Install templates & conventions to ~/.roll
        2. ~  Sync conventions to AI tools
        3. ~  Install skills to ~/.claude
        4. ~  Initialize peer-review state directory
        5. ↷  Configure git hooks path
        6. ↷  Ensure tmux is installed (already present)

      ────────────────────────────────────────────────────────────────────────────────
        Setup re-installed (forced — 4 items)  —  run roll init inside a project
      ════════════════════════════════════════════════════════════════════════════════

        未安装 AI agent。请稍后运行 \`roll agent use\` 设置默认，或先安装一个（如 claude、kimi、pi）。

        → For \`roll release\`: enable "Allow auto-merge" in your repo (Settings → General → Pull Requests),
          or the release will stop and ask you to merge the PR manually.
        → roll release 需要仓库开启 “Allow auto-merge”（Settings → General → Pull Requests），
          否则发版会停下并提示你手动合并 PR。
      ",
      }
    `);
    assertFreshSideEffects(fx);
  });

  it("unknown argument → err + exit 1 (en)", () => {
    expect(tsSetup(freshFixture(), ["--bogus"], { ROLL_LANG: "en" })).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] Unknown argument: --bogus
      ",
        "stdout": "",
      }
    `);
  });

  it("unknown argument → err + exit 1 (zh)", () => {
    expect(tsSetup(freshFixture(), ["--bogus"], { ROLL_LANG: "zh" })).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] 未知参数: --bogus
      ",
        "stdout": "",
      }
    `);
  });

  it("already-synced re-run → all skip (no changes)", () => {
    const fx = syncedFixture();
    expect(tsSetup(fx, [], { ROLL_LANG: "en" })).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "  SETUP  ·  初始化                                                                                  
      ────────────────────────────────────────────────────────────────────────────────

        1. ↷  Install templates & conventions to ~/.roll
        2. ↷  Sync conventions to AI tools
        3. ↷  Install skills to ~/.claude
        4. ↷  Initialize peer-review state directory
        5. ↷  Configure git hooks path
        6. ↷  Ensure tmux is installed (already present)

      ────────────────────────────────────────────────────────────────────────────────
        Setup complete (no changes)  —  everything already up to date
      ════════════════════════════════════════════════════════════════════════════════

        No AI agents installed. Run \`roll agent use\` later to set a default, or install one (e.g., claude, kimi, pi).

        → For \`roll release\`: enable "Allow auto-merge" in your repo (Settings → General → Pull Requests),
          or the release will stop and ask you to merge the PR manually.
        → roll release 需要仓库开启 “Allow auto-merge”（Settings → General → Pull Requests），
          否则发版会停下并提示你手动合并 PR。
      ",
      }
    `);
    assertFreshSideEffects(fx);
  });

  it("already-synced --force re-run keeps content stable", () => {
    const fx = syncedFixture();
    expect(tsSetup(fx, ["--force"], { ROLL_LANG: "en" })).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "  SETUP  ·  初始化                                                                                  
      ────────────────────────────────────────────────────────────────────────────────

        1. ↷  Install templates & conventions to ~/.roll
        2. ↷  Sync conventions to AI tools
        3. ↷  Install skills to ~/.claude
        4. ↷  Initialize peer-review state directory
        5. ↷  Configure git hooks path
        6. ↷  Ensure tmux is installed (already present)

      ────────────────────────────────────────────────────────────────────────────────
        Setup complete (no changes)  —  everything already up to date
      ════════════════════════════════════════════════════════════════════════════════

        No AI agents installed. Run \`roll agent use\` later to set a default, or install one (e.g., claude, kimi, pi).

        → For \`roll release\`: enable "Allow auto-merge" in your repo (Settings → General → Pull Requests),
          or the release will stop and ask you to merge the PR manually.
        → roll release 需要仓库开启 “Allow auto-merge”（Settings → General → Pull Requests），
          否则发版会停下并提示你手动合并 PR。
      ",
      }
    `);
    assertFreshSideEffects(fx);
  });

  it("missing conventions source is owned by TS without bash fallback", () => {
    const missingPkg = realpathSync(mkdtempSync(join(tmpdir(), "roll-setup-missing-pkg-")));
    dirs.push(missingPkg);
    const run = tsSetup(freshFixture(), [], { ROLL_LANG: "en", ROLL_PKG_DIR: missingPkg });
    expect({ ...run, stderr: run.stderr.replace(`${missingPkg}/conventions`, "<pkg>/conventions") })
      .toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] Convention source not found at: <pkg>/conventions
      [roll] Run this from the roll repo, or symlink bin/roll to PATH.
      ",
        "stdout": "",
      }
    `);
  });
});
