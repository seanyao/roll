/**
 * Frozen-expectation test: TS `roll feedback`.
 *
 * `feedbackCommand` was proven byte-equal to the bash oracle `bin/roll feedback`
 * under diff-test. Per US-PORT-009c the oracle is retired: the `bin/roll feedback`
 * spawn is dropped and each case freezes the TS output as an inline snapshot
 * (zero engine spawn). The gh invocation still runs through a PATH-installed fake
 * `gh` shim (a fabricated binary, not the v2 engine — paradigm-exempt) that
 * records its argv; gh-create cases freeze that recorded argv.
 *
 * Portability: repo is pinned via ROLL_FEEDBACK_REPO, SHELL + LANG are pinned so
 * the env block's shell/language lines are deterministic. The env block's
 * `roll version` / `OS` (uname -srm) / `project` (basename cwd) lines are
 * host-specific → scrubbed to `<VER>` / `<OS>` / `<PROJECT>` (raw cases) or the
 * whole URL-encoded env appendix replaced with `<ENV>` (print-url case), so the
 * frozen value stays portable across machines.
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { feedbackCommand } from "../src/commands/feedback.js";
import { seedUpdateCheckCache, pathWithout } from "./helpers.js";

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

// Scrub the host-specific env-block lines (raw form, as recorded in gh argv).
const scrubEnvRaw = (s: string): string =>
  s
    .replace(/- roll version: .*/g, "- roll version: <VER>")
    .replace(/- OS: .*/g, "- OS: <OS>")
    .replace(/- project: .*/g, "- project: <PROJECT>");

// Scrub the URL-encoded env appendix: everything from the encoded `\n---\n`
// onward is the host-specific Environment block → replace with a marker.
const scrubEnvUrl = (s: string): string => s.replace(/%0A---%0A.*/s, "%0A---%0A<ENV>");

describe("frozen: roll feedback", () => {
  // ── --print-url path (no env block; exact URL bytes) ─────────────────────
  it("--print-url --no-env bug → exact prefilled URL", () => {
    const args = ["--print-url", "--no-env", "--title", "Crash on `roll loop`", "--body", "boom & co", "--type", "bug"];
    expect(tsFb(args, PATH_WITH_GH)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "https://github.com/acme/widgets/issues/new?title=Crash%20on%20%60roll%20loop%60&body=boom%20%26%20co&labels=bug%2CFIX
      ",
      }
    `);
  });

  it("--print-url --no-env idea (label set) with special chars", () => {
    const args = ["--print-url", "--no-env", "--type", "idea", "--title", "Add 100% coverage + e=mc²", "--body", "线程/并发 issue?"];
    expect(tsFb(args, PATH_WITH_GH)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "https://github.com/acme/widgets/issues/new?title=Add%20100%25%20coverage%20%2B%20e%3Dmc%C2%B2&body=%E7%BA%BF%E7%A8%8B%2F%E5%B9%B6%E5%8F%91%20issue%3F&labels=idea%2Cenhancement%2CUS
      ",
      }
    `);
  });

  it("--print-url --no-env ux (default body empty)", () => {
    const args = ["--print-url", "--no-env", "--type", "ux", "--title", "tighten spacing"];
    expect(tsFb(args, PATH_WITH_GH)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "https://github.com/acme/widgets/issues/new?title=tighten%20spacing&body=&labels=ux%2Cenhancement
      ",
      }
    `);
  });

  // ── --print-url WITH env block: the deterministic URL prefix is frozen; the
  // host-specific encoded Environment appendix is scrubbed to <ENV>. ──────────
  it("--print-url WITH env block → URL incl. composed env appendix", () => {
    const args = ["--print-url", "--type", "bug", "--title", "T", "--body", "B"];
    const t = tsFb(args, PATH_WITH_GH);
    expect(t.stdout).toContain("%0A---%0A%0A%23%23%23%20Environment");
    expect({ status: t.status, stdout: scrubEnvUrl(t.stdout), stderr: t.stderr }).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "https://github.com/acme/widgets/issues/new?title=T&body=B%0A---%0A<ENV>",
      }
    `);
  });

  // ── gh fallback when gh is ABSENT → auto print-url ───────────────────────
  it("no gh on PATH → auto print-url (no env)", () => {
    const args = ["--no-env", "--title", "no gh here", "--body", "x"];
    expect(tsFb(args, PATH_NO_GH)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "https://github.com/acme/widgets/issues/new?title=no%20gh%20here&body=x&labels=bug%2CFIX
      ",
      }
    `);
  });

  // ── gh issue create path → freeze the recorded gh argv ───────────────────
  // gh's own stdout (the canned URL) is passed through INHERITED stdio, so it is
  // not capturable via the process.stdout override; the contract frozen here is
  // the EXIT code + the recorded gh argv (repo/title/body/label, incl. body).
  it("gh issue create → argv (repo/title/body/label)", () => {
    const args = ["--no-env", "--type", "idea", "--title", "Ship it", "--body", "please & thanks"];
    const t = tsFb(args, PATH_WITH_GH);
    const tLog = readGhLog();
    expect(t.status).toBe(0);
    expect(tLog).toContain("--label\nidea,enhancement,US\n");
    expect(tLog).toContain("--repo\nacme/widgets\n");
    expect(tLog).toMatchInlineSnapshot(`
      "issue
      create
      --repo
      acme/widgets
      --title
      Ship it
      --body
      please & thanks
      --label
      idea,enhancement,US
      "
    `);
  });

  it("gh issue create WITH env block → argv (incl. body env appendix)", () => {
    const args = ["--type", "bug", "--title", "with env", "--body", "see below"];
    const t = tsFb(args, PATH_WITH_GH);
    const tLog = readGhLog();
    expect(t.status).toBe(0);
    expect(tLog).toContain("### Environment");
    expect(scrubEnvRaw(tLog)).toMatchInlineSnapshot(`
      "issue
      create
      --repo
      acme/widgets
      --title
      with env
      --body
      see below
      ---

      ### Environment
      - roll version: <VER>
      - OS: <OS>
      - shell: zsh
      - current agent: claude
      - language: en_US.UTF-8
      - project: <PROJECT>
      --label
      bug,FIX
      "
    `);
  });

  // ── repo resolution: .roll/local.yaml feedback_repo ──────────────────────
  it("repo from .roll/local.yaml feedback_repo (no env override)", () => {
    mkdirSync(join(proj, ".roll"), { recursive: true });
    writeFileSync(join(proj, ".roll", "local.yaml"), 'feedback_repo: "local/repo"\nagent: kimi\n');
    const args = ["--print-url", "--no-env", "--title", "from local yaml"];
    // Drop ROLL_FEEDBACK_REPO so the yaml field wins.
    const extra = { ROLL_FEEDBACK_REPO: "" };
    expect(tsFb(args, PATH_WITH_GH, extra)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "https://github.com/local/repo/issues/new?title=from%20local%20yaml&body=&labels=bug%2CFIX
      ",
      }
    `);
    rmSync(join(proj, ".roll", "local.yaml"), { force: true });
  });

  // ── error paths ──────────────────────────────────────────────────────────
  it("missing --title → exit 1", () => {
    expect(tsFb(["--type", "bug"], PATH_WITH_GH)).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] feedback: --title is required
      ",
        "stdout": "",
      }
    `);
  });

  it("unknown --type → exit 1", () => {
    expect(tsFb(["--type", "weird", "--title", "x"], PATH_WITH_GH)).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] feedback: unknown --type 'weird' (expected one of: bug, idea, ux)
      ",
        "stdout": "",
      }
    `);
  });

  it("unknown flag → exit 1", () => {
    expect(tsFb(["--bogus", "--title", "x"], PATH_WITH_GH)).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] feedback: unknown flag --bogus
      ",
        "stdout": "",
      }
    `);
  });

  it("cannot derive repo (no env, no yaml, no origin) → exit 1", () => {
    const args = ["--print-url", "--no-env", "--title", "x"];
    const extra = { ROLL_FEEDBACK_REPO: "" };
    expect(tsFb(args, PATH_NO_GH, extra)).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] feedback: cannot derive owner/repo from origin; pass --repo owner/repo
      ",
        "stdout": "",
      }
    `);
  });

  it("--help → usage, exit 0", () => {
    expect(tsFb(["--help"], PATH_WITH_GH)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "Usage: roll feedback [options]
              roll feedback (一句话提反馈)

      Open a GitHub issue from the CLI. Type auto-labels (bug → FIX label;
      idea → US label; ux → ux label).

      Options:
        --type <bug|idea|ux>      Classify the feedback (default: bug)
        --title <text>            Issue title (required)
        --body <text>             Issue body
        --repo <owner/repo>       Target repo (default: derived from origin)
        --no-env                  Skip the auto-attached Environment section
                                  (roll version, OS, agent, language, project)
        --print-url               Print the prefilled github.com URL instead of
                                  invoking \`gh\`. Falls back to this automatically
                                  when \`gh\` is not installed.
      ",
      }
    `);
  });
});
