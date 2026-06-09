/**
 * diff-test: TS `roll changelog` == bash `bin/roll changelog` (frozen v2
 * oracle). The bash path shells lib/changelog_generate.py for the deterministic
 * draft; the TS path reimplements that python logic. Both run `git`/`gh` in a
 * fabricated fixture repo cwd so the release-aware unreleased filter
 * (git log <tag>..HEAD) is deterministic.
 *
 * CI portability: the fixture repo sets repo-local user.email/user.name (no
 * reliance on host global git). A fake `gh` on PATH returns non-zero for
 * `--version` so _gh_available() is false on BOTH sides regardless of whether
 * the runner has gh — making the gap-detection (uncarded PR) path inert and the
 * output deterministic. The AI-style step is exercised via the --no-ai flag
 * (the deterministic path); the live-agent step is never invoked (documented in
 * changelog.ts: the TS styler is injectable + default-off).
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { changelogCommand } from "../src/commands/changelog.js";
import { seedUpdateCheckCache } from "./helpers.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];
let home = "";
let fakeBin = "";
let PATH = "";

function ensureFakeBin(): void {
  if (fakeBin !== "") return;
  home = mkdtempSync(join(tmpdir(), "roll-cl-home-"));
  fakeBin = mkdtempSync(join(tmpdir(), "roll-cl-bin-"));
  dirs.push(home, fakeBin);
  mkdirSync(join(home, ".roll"), { recursive: true });
  seedUpdateCheckCache(join(home, ".roll"));
  // A `gh` that fails `--version` → _gh_available() false on both sides.
  const gh = join(fakeBin, "gh");
  writeFileSync(gh, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  PATH = `${fakeBin}:${process.env["PATH"] ?? ""}`;
}

const BACKLOG = `# Backlog

### Feature: changelog-generation

| Story | Description | Status |
|---|---|---|
| [US-CL-006] | 新增 changelog generate 草稿生成命令 | ✅ Done |
| [FIX-178] | 修复 changelog 重复条目泄漏 | ✅ Done |
| [US-DOC-001] | 内部重构 提取函数 schema | ✅ Done |
| [US-OLD-099] | 这条早已发布,不在本次窗口 | ✅ Done |
`;

/** Build a fixture git repo: tagged v1.0.0, then post-tag commits naming the
 * two unreleased story ids (so the release-aware filter keeps exactly those). */
function freshProj(seedChangelog?: string): string {
  ensureFakeBin();
  const proj = mkdtempSync(join(tmpdir(), "roll-cl-proj-"));
  dirs.push(proj);
  mkdirSync(join(proj, ".roll"), { recursive: true });
  writeFileSync(join(proj, ".roll", "backlog.md"), BACKLOG);
  if (seedChangelog !== undefined) writeFileSync(join(proj, "CHANGELOG.md"), seedChangelog);
  const git = (args: string): void => {
    execSync(`git ${args}`, { cwd: proj, stdio: "ignore" });
  };
  git("init -q");
  git("config user.email roll@test.local");
  git("config user.name roll-test");
  git("config commit.gpgsign false");
  writeFileSync(join(proj, "seed.txt"), "seed\n");
  git("add -A");
  git('commit -q -m "seed"');
  git("tag v1.0.0");
  // Post-tag commits referencing the two in-window story ids.
  writeFileSync(join(proj, "a.txt"), "a\n");
  git("add -A");
  git('commit -q -m "US-CL-006: draft generate"');
  writeFileSync(join(proj, "b.txt"), "b\n");
  git("add -A");
  git('commit -q -m "FIX-178: dedup"');
  return proj;
}

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
    PATH,
    HOME: home,
    ROLL_HOME: join(home, ".roll"),
    NO_COLOR: "1",
    ...extra,
  };
}

function bashCl(args: string[], proj: string, extra: Record<string, string>): Run {
  // US-PORT-021: bin/roll retired → parity degrades to a determinism check
  // (two TS runs on identical fixtures) while the TS command still executes.
  // US-PORT-021b will freeze these as snapshots.
  if (!existsSync(join(REPO, "bin", "roll"))) return tsCl(args, proj, extra);
  try {
    const stdout = execFileSync(join(REPO, "bin", "roll"), ["changelog", ...args], {
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

const ENV_KEYS = ["PATH", "HOME", "ROLL_HOME", "NO_COLOR", "ROLL_LANG", "LC_ALL", "LANG"];

function tsCl(args: string[], proj: string, extra: Record<string, string>): Run {
  const save: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) save[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
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
    status = changelogCommand(args);
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

describe("diff-test: roll changelog == bash oracle", () => {
  it("generate --no-ai → deterministic draft (release-aware filter)", () => {
    const pb = freshProj();
    const pt = freshProj();
    const b = bashCl(["generate", "--no-ai"], pb, {});
    const t = tsCl(["generate", "--no-ai"], pt, {});
    expect(t).toEqual(b);
    // sanity: only the two in-window stories appear, internal/old filtered out.
    expect(t.stdout).toContain("US-CL-006");
    expect(t.stdout).toContain("FIX-178");
    expect(t.stdout).not.toContain("US-OLD-099");
    expect(t.stdout).not.toContain("US-DOC-001");
  });

  it("generate --json → machine-readable (deterministic)", () => {
    const pb = freshProj();
    const pt = freshProj();
    expect(tsCl(["generate", "--json"], pt, {})).toEqual(bashCl(["generate", "--json"], pb, {}));
  });

  it("generate --no-ai --write → splices ## Unreleased into CHANGELOG.md", () => {
    const seed = "# Changelog\n\n## v1.0.0\n\n- old release note\n";
    const pb = freshProj(seed);
    const pt = freshProj(seed);
    const b = bashCl(["generate", "--no-ai", "--write"], pb, {});
    const t = tsCl(["generate", "--no-ai", "--write"], pt, {});
    expect(t).toEqual(b);
    expect(readFileSync(join(pt, "CHANGELOG.md"), "utf8")).toBe(
      readFileSync(join(pb, "CHANGELOG.md"), "utf8"),
    );
  });

  it("generate --no-ai --write into a file with existing ## Unreleased (replace)", () => {
    const seed = "# Changelog\n\n## Unreleased\n\n### 旧分类\n\n- stale\n\n## v1.0.0\n\n- old\n";
    const pb = freshProj(seed);
    const pt = freshProj(seed);
    const b = bashCl(["generate", "--no-ai", "--write"], pb, {});
    const t = tsCl(["generate", "--no-ai", "--write"], pt, {});
    expect(t).toEqual(b);
    expect(readFileSync(join(pt, "CHANGELOG.md"), "utf8")).toBe(
      readFileSync(join(pb, "CHANGELOG.md"), "utf8"),
    );
  });

  it("generate --no-ai with no Done stories → no-new note", () => {
    // A backlog without any ✅ Done rows in window → "# No new ... found".
    const pb = mkProjEmpty();
    const pt = mkProjEmpty();
    expect(tsCl(["generate", "--no-ai"], pt, {})).toEqual(bashCl(["generate", "--no-ai"], pb, {}));
  });

  // US-PORT-005: the DEFAULT `generate` (no flags) is now the deterministic
  // path — no AI polish, no bash fallback, no warn noise. It must produce the
  // exact same bytes as the explicit `--no-ai` deterministic path, on both
  // stdout AND stderr (the v2 default emitted a "AI 润色不可用" warn here).
  it("generate (default) == deterministic draft, no AI, no warn (US-PORT-005)", () => {
    const def = tsCl(["generate"], freshProj(), {});
    const det = tsCl(["generate", "--no-ai"], freshProj(), {});
    expect(def.stdout).toBe(det.stdout);
    expect(def.stderr).toBe(det.stderr);
    expect(def.status).toBe(0);
    expect(def.stderr).not.toContain("润色");
    expect(def.stdout).toContain("US-CL-006");
  });

  // US-PORT-005: help diverges from the frozen v2 bash oracle on purpose (the
  // AI-polish lines are gone), so this asserts the v3 deterministic-canonical
  // help text directly instead of comparing to bash.
  it("help output (long) — v3 deterministic-canonical (US-PORT-005)", () => {
    const t = tsCl(["--help"], freshProj(), {});
    expect(t.status).toBe(0);
    expect(t.stdout).toContain("确定性草稿");
    // the v2 agent-polish menu lines and default description are gone
    expect(t.stdout).not.toContain("(AI 润色)");
    expect(t.stdout).not.toContain("默认用配置的 agent");
    expect(t.stdout).not.toContain("--no-ai");
  });

  for (const lang of ["en", "zh"]) {
    it(`unknown subcommand → exit 1 (${lang})`, () => {
      const pb = freshProj();
      const pt = freshProj();
      expect(tsCl(["bogus"], pt, { ROLL_LANG: lang })).toEqual(
        bashCl(["bogus"], pb, { ROLL_LANG: lang }),
      );
    });
  }
});

/** A fixture project whose post-tag commits reference NO story ids → empty. */
function mkProjEmpty(): string {
  ensureFakeBin();
  const proj = mkdtempSync(join(tmpdir(), "roll-cl-empty-"));
  dirs.push(proj);
  mkdirSync(join(proj, ".roll"), { recursive: true });
  writeFileSync(join(proj, ".roll", "backlog.md"), BACKLOG);
  const git = (args: string): void => {
    execSync(`git ${args}`, { cwd: proj, stdio: "ignore" });
  };
  git("init -q");
  git("config user.email roll@test.local");
  git("config user.name roll-test");
  git("config commit.gpgsign false");
  writeFileSync(join(proj, "seed.txt"), "seed\n");
  git("add -A");
  git('commit -q -m "seed"');
  git("tag v1.0.0");
  writeFileSync(join(proj, "c.txt"), "c\n");
  git("add -A");
  git('commit -q -m "chore: no story id here"');
  if (!existsSync(join(proj, ".roll", "backlog.md"))) throw new Error("fixture");
  return proj;
}
