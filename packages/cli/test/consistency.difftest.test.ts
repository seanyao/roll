/**
 * diff-test: TS `roll consistency` == bash `bin/roll consistency` (frozen v2
 * oracle, which shells lib/consistency_check.py). The TS port reimplements the
 * python orchestrator; both read a fabricated --project-dir fixture so every
 * dimension (code/docs/i18n/tests/site) is deterministic.
 *
 * Fixtures are derived directly from the py check_* logic: a healthy tree (all
 * pass) plus per-dimension violating trees. Comparison is byte-for-byte over
 * stdout/stderr/exit for human + --json, and en/zh for the i18n'd unknown-
 * subcommand path. No git/gh/network dependency — every check is pure file I/O,
 * so this is CI-portable with no host-specific guards.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consistencyCommand } from "../src/commands/consistency.js";
import { seedUpdateCheckCache } from "./helpers.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];
let home = "";
let cwd = ""; // an empty dir the commands run *in* (project-dir is explicit)

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "roll-cn-home-"));
  cwd = mkdtempSync(join(tmpdir(), "roll-cn-cwd-"));
  dirs.push(home, cwd);
  mkdirSync(join(home, ".roll"), { recursive: true });
  seedUpdateCheckCache(join(home, ".roll"));
});

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function mk(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-cn-proj-"));
  dirs.push(p);
  return p;
}
function w(base: string, rel: string, content: string): void {
  const full = join(base, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

// ── Fixture builders (one per scenario) ──────────────────────────────────────
function healthy(): string {
  const p = mk();
  w(p, ".roll/backlog.md", "# Backlog\n\n### Feature: widget\n\n| [US-W-001] | thing | ✅ Done |\n");
  w(p, ".roll/features.md", "# Features\n\n- widget — does widget things\n");
  w(p, "guide/en/intro.md", "intro\n");
  w(p, "guide/zh/intro.md", "介绍\n");
  w(p, "lib/i18n/x.sh", "_i18n_set en a.b hi\n_i18n_set zh a.b 你好\n");
  w(p, "tests/cmd_widget.bats", "@test widget {\n  true\n}\n");
  w(p, "site/roll-data.js", 'const FEATURE_GROUPS = [{ name: "widget" }];\n');
  return p;
}

function codeViolation(): string {
  const p = mk();
  // Done feature 'orphan' not present in features.md → code gap.
  w(p, ".roll/backlog.md", "# Backlog\n\n### Feature: orphan\n\n| [US-O-001] | x | ✅ Done |\n");
  w(p, ".roll/features.md", "# Features\n\n- something-else\n");
  return p;
}

function i18nViolation(): string {
  const p = mk();
  // guide/en/extra.md has no zh; i18n key only-en and only-zh.
  w(p, "guide/en/intro.md", "intro\n");
  w(p, "guide/en/extra.md", "extra\n");
  w(p, "guide/zh/intro.md", "介绍\n");
  w(p, "lib/i18n/x.sh", "_i18n_set en only.en hi\n_i18n_set zh only.zh 你\n_i18n_set en both.k a\n_i18n_set zh both.k b\n");
  return p;
}

function testsViolation(): string {
  const p = mk();
  // Done feature 'authentication' with no matching test; a stale test file.
  w(p, ".roll/backlog.md", "# Backlog\n\n### Feature: authentication\n\n| [US-A-001] | x | ✅ Done |\n");
  w(p, "tests/stalefeature.bats", "@test x {\n  true\n}\n");
  return p;
}

function siteViolation(): string {
  const p = mk();
  // Done feature 'dashboard' not mentioned on the site (site lists only 'widget').
  w(p, ".roll/backlog.md", "# Backlog\n\n### Feature: dashboard\n\n| [US-D-001] | x | ✅ Done |\n");
  w(p, "site/roll-data.js", 'const FEATURE_GROUPS = [{ name: "widget" }];\n');
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
    ...extra,
  };
}

function bashCn(args: string[], extra: Record<string, string>): Run {
  try {
    const stdout = execFileSync(join(REPO, "bin", "roll"), ["consistency", ...args], {
      cwd,
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

function tsCn(args: string[], extra: Record<string, string>): Run {
  const save: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) save[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(envBase(extra))) process.env[k] = v;
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
    status = consistencyCommand(args);
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

function both(args: string[], extra: Record<string, string> = {}): void {
  expect(tsCn(args, extra)).toEqual(bashCn(args, extra));
}

describe("diff-test: roll consistency == bash oracle", () => {
  const scenarios: Array<[string, () => string]> = [
    ["healthy (all pass)", healthy],
    ["code dimension gap", codeViolation],
    ["i18n dimension gaps (guide parity + key parity)", i18nViolation],
    ["tests dimension gaps (coverage + stale)", testsViolation],
    ["site dimension gap", siteViolation],
  ];

  for (const [label, build] of scenarios) {
    it(`check (human) — ${label}`, () => {
      const proj = build();
      both(["check", "--project-dir", proj]);
    });
    it(`check --json — ${label}`, () => {
      const proj = build();
      both(["check", "--json", "--project-dir", proj]);
    });
  }

  it("check on an empty project-dir → all pass", () => {
    both(["check", "--project-dir", mk()]);
  });

  it("help output (long)", () => {
    both(["--help"]);
  });

  for (const lang of ["en", "zh"]) {
    it(`unknown subcommand → exit 1 (${lang})`, () => {
      both(["bogus"], { ROLL_LANG: lang });
    });
  }
});
