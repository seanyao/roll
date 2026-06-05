/**
 * diff-test: TS `roll feedback` == bash `bin/roll feedback` (frozen v2 oracle).
 *
 * The gh invocation is dispatched through a PATH-installed fake `gh` that
 * records its argv to a file and prints a canned issue URL (the shim pattern
 * used elsewhere for fake binaries). The composed issue body is byte-compared
 * via that recording: bash and TS each invoke the shim, and we assert the two
 * recorded argv files are identical (so --repo/--title/--body/--label match
 * exactly). The --print-url path is compared directly (URL bytes).
 *
 * CI portability: repo is pinned via ROLL_FEEDBACK_REPO (no git origin needed);
 * SHELL is pinned so the env block's `shell:` line is deterministic; both sides
 * run in the SAME cwd so OS/project/version/agent/lang lines match. The env
 * block's `OS:` line comes from `uname -srm` — identical for both processes on
 * the same host, so no host-specific value leaks into the assertion.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { feedbackCommand } from "../src/commands/feedback.js";
import { seedUpdateCheckCache, pathWithout } from "./helpers.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];
let home = "";
let proj = "";
let fakeBin = "";
let realBin = ""; // a dir holding a real gh symlink set, when needed
let PATH_WITH_GH = "";
let PATH_NO_GH = "";
let ghLog = "";

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "roll-fb-home-"));
  proj = mkdtempSync(join(tmpdir(), "roll-fb-proj-"));
  fakeBin = mkdtempSync(join(tmpdir(), "roll-fb-bin-"));
  realBin = mkdtempSync(join(tmpdir(), "roll-fb-nogh-"));
  dirs.push(home, proj, fakeBin, realBin);
  mkdirSync(join(home, ".roll"), { recursive: true });
  seedUpdateCheckCache(join(home, ".roll"));

  ghLog = join(fakeBin, "gh-argv.log");
  // Fake gh: --version → exit 0 (present). `issue create` → append argv (one
  // arg per line, NUL-free) to the log + print a canned URL. Anything else 0.
  const gh = join(fakeBin, "gh");
  writeFileSync(
    gh,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo "gh version 2.0.0 (test)"; exit 0; fi',
      'if [ "$1" = "issue" ] && [ "$2" = "create" ]; then',
      `  : > '${ghLog}'`,
      '  for a in "$@"; do printf "%s\\n" "$a" >> ' + `'${ghLog}'; done`,
      '  echo "https://github.com/acme/widgets/issues/42"',
      "  exit 0",
      "fi",
      "exit 0",
    ].join("\n") + "\n",
    { mode: 0o755 },
  );
  PATH_WITH_GH = `${fakeBin}:/usr/bin:/bin`;
  // A PATH with NO gh (and no other gh on it) for the auto-print-url fallback.
  PATH_NO_GH = `${realBin}:${pathWithout("gh")}`;
});

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function envBase(path: string, extra: Record<string, string>): Record<string, string> {
  return {
    PATH: path,
    HOME: home,
    ROLL_HOME: join(home, ".roll"),
    NO_COLOR: "1",
    SHELL: "/bin/zsh",
    LANG: "en_US.UTF-8",
    ROLL_FEEDBACK_REPO: "acme/widgets",
    ...extra,
  };
}

function bashFb(args: string[], path: string, extra: Record<string, string> = {}): Run {
  try {
    const stdout = execFileSync(join(REPO, "bin", "roll"), ["feedback", ...args], {
      cwd: proj,
      encoding: "utf8",
      env: envBase(path, extra),
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

const ENV_KEYS = [
  "PATH", "HOME", "ROLL_HOME", "NO_COLOR", "SHELL", "LANG", "LC_ALL",
  "ROLL_LANG", "ROLL_FEEDBACK_REPO",
];

function tsFb(args: string[], path: string, extra: Record<string, string> = {}): Run {
  const save: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) save[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(envBase(path, extra))) process.env[k] = v;
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
    status = feedbackCommand(args);
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

function readGhLog(): string {
  const s = existsSync(ghLog) ? readFileSync(ghLog, "utf8") : "";
  rmSync(ghLog, { force: true });
  return s;
}

describe("diff-test: roll feedback == bash oracle", () => {
  // ── --print-url path (no env block; exact URL bytes) ─────────────────────
  it("--print-url --no-env bug → exact prefilled URL", () => {
    const args = ["--print-url", "--no-env", "--title", "Crash on `roll loop`", "--body", "boom & co", "--type", "bug"];
    expect(tsFb(args, PATH_WITH_GH)).toEqual(bashFb(args, PATH_WITH_GH));
  });

  it("--print-url --no-env idea (label set) with special chars", () => {
    const args = ["--print-url", "--no-env", "--type", "idea", "--title", "Add 100% coverage + e=mc²", "--body", "线程/并发 issue?"];
    expect(tsFb(args, PATH_WITH_GH)).toEqual(bashFb(args, PATH_WITH_GH));
  });

  it("--print-url --no-env ux (default body empty)", () => {
    const args = ["--print-url", "--no-env", "--type", "ux", "--title", "tighten spacing"];
    expect(tsFb(args, PATH_WITH_GH)).toEqual(bashFb(args, PATH_WITH_GH));
  });

  // ── --print-url WITH env block (deterministic under pinned env/cwd) ───────
  it("--print-url WITH env block → URL incl. composed env appendix", () => {
    const args = ["--print-url", "--type", "bug", "--title", "T", "--body", "B"];
    expect(tsFb(args, PATH_WITH_GH)).toEqual(bashFb(args, PATH_WITH_GH));
  });

  // ── gh fallback when gh is ABSENT → auto print-url ───────────────────────
  it("no gh on PATH → auto print-url (no env)", () => {
    const args = ["--no-env", "--title", "no gh here", "--body", "x"];
    expect(tsFb(args, PATH_NO_GH)).toEqual(bashFb(args, PATH_NO_GH));
  });

  // ── gh issue create path → compare recorded argv byte-for-byte ───────────
  // gh's own stdout (the canned URL) is passed through INHERITED stdio in both
  // the oracle and the TS port (spawnSync stdio:"inherit") — so it is identical
  // by construction but NOT capturable through the JS process.stdout override
  // the test uses. We therefore compare the EXIT code + the recorded gh argv
  // (the real contract: repo/title/body/label, incl. the composed body) rather
  // than the child's inherited stdout. (Documented harness boundary.)
  it("gh issue create → argv (repo/title/body/label) byte-identical", () => {
    const args = ["--no-env", "--type", "idea", "--title", "Ship it", "--body", "please & thanks"];
    const b = bashFb(args, PATH_WITH_GH);
    const bLog = readGhLog();
    const t = tsFb(args, PATH_WITH_GH);
    const tLog = readGhLog();
    expect(t.status).toBe(b.status);
    expect(tLog).toBe(bLog); // identical gh argv (incl. composed body)
    expect(bLog).toContain("--label\nidea,enhancement,US\n");
    expect(bLog).toContain("--repo\nacme/widgets\n");
  });

  it("gh issue create WITH env block → argv (incl. body env appendix) identical", () => {
    const args = ["--type", "bug", "--title", "with env", "--body", "see below"];
    const b = bashFb(args, PATH_WITH_GH);
    const bLog = readGhLog();
    const t = tsFb(args, PATH_WITH_GH);
    const tLog = readGhLog();
    expect(t.status).toBe(b.status);
    expect(tLog).toBe(bLog);
    expect(bLog).toContain("### Environment");
  });

  // ── repo resolution: .roll/local.yaml feedback_repo ──────────────────────
  it("repo from .roll/local.yaml feedback_repo (no env override)", () => {
    mkdirSync(join(proj, ".roll"), { recursive: true });
    writeFileSync(join(proj, ".roll", "local.yaml"), 'feedback_repo: "local/repo"\nagent: kimi\n');
    const args = ["--print-url", "--no-env", "--title", "from local yaml"];
    // Drop ROLL_FEEDBACK_REPO so the yaml field wins.
    const extra = { ROLL_FEEDBACK_REPO: "" };
    expect(tsFb(args, PATH_WITH_GH, extra)).toEqual(bashFb(args, PATH_WITH_GH, extra));
    rmSync(join(proj, ".roll", "local.yaml"), { force: true });
  });

  // ── error paths ──────────────────────────────────────────────────────────
  it("missing --title → exit 1", () => {
    const args = ["--type", "bug"];
    expect(tsFb(args, PATH_WITH_GH)).toEqual(bashFb(args, PATH_WITH_GH));
  });

  it("unknown --type → exit 1", () => {
    const args = ["--type", "weird", "--title", "x"];
    expect(tsFb(args, PATH_WITH_GH)).toEqual(bashFb(args, PATH_WITH_GH));
  });

  it("unknown flag → exit 1", () => {
    const args = ["--bogus", "--title", "x"];
    expect(tsFb(args, PATH_WITH_GH)).toEqual(bashFb(args, PATH_WITH_GH));
  });

  it("cannot derive repo (no env, no yaml, no origin) → exit 1", () => {
    // Run in a cwd with no git origin and no feedback_repo anywhere.
    const args = ["--print-url", "--no-env", "--title", "x"];
    const extra = { ROLL_FEEDBACK_REPO: "" };
    expect(tsFb(args, PATH_NO_GH, extra)).toEqual(bashFb(args, PATH_NO_GH, extra));
  });

  it("--help → usage, exit 0", () => {
    expect(tsFb(["--help"], PATH_WITH_GH)).toEqual(bashFb(["--help"], PATH_WITH_GH));
  });
});
