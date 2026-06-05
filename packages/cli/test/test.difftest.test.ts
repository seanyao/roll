/**
 * diff-test: TS `roll test` == bash `bin/roll test` (frozen v2 oracle).
 *
 * cmd_test routes through the isolation dispatcher, so every scenario fabricates
 * a cwd with a `.roll/local.yaml` pinning `test_isolation.type`, plus PATH shims
 * for the external binaries the adapters touch (`npm`, `tart`, `uname`, `ssh`).
 * Both sides run the SAME shims, so the forwarded child stdout/stderr stays
 * byte-identical and the routing/exec verdicts agree regardless of host OS.
 *
 * Covered:
 *   - --help / -h, and `--help` appearing after other pre-`--` args (en/zh).
 *   - --where on type=none → `host`.
 *   - --where on type=tart with a present+ready VM (uname/tart/ssh shimmed) →
 *     `tart:<ip>`, and with the tart binary absent → `tart:not-installed`.
 *   - default exec on type=none → forwarded `npm test -- --affected` (shim npm
 *     records argv + emits canned output); explicit `-- tests/` passthrough.
 *   - --reset on type=none → "nothing to reset" note (exit 0); a held lock →
 *     fast-fail (exit 1).
 *   - the UNREACHABLE-VM contract: type=tart with no tart binary on the exec
 *     path → explicit error + exit 1, NO silent host fallback.
 *
 * CI portability: fabricated HOME/ROLL_HOME (seeded update-check cache), all
 * external binaries shimmed on a sandboxed PATH, cwd is a throwaway dir (not a
 * git repo — cmd_test never shells git), locale pinned. No network, no real VM.
 *
 * One harness subtlety: bash's `_isolation_get_type` shells `python3`+PyYAML to
 * read `.roll/local.yaml`, and PyYAML is imported from the *user* site-packages
 * under $HOME — which our sandboxed HOME hides, so the real python would fail to
 * import yaml and fall back to type=none, diverging from the TS native parser.
 * To make BOTH sides resolve the type identically and host-independently, every
 * shim dir carries a tiny `python3` shim that prints `test_isolation.type` with
 * a stdlib-only regex reader (no yaml import). The TS port's native parser and
 * this shim agree on the trivial fixtures used here.
 */
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testCommand } from "../src/commands/test.js";
import { seedUpdateCheckCache } from "./helpers.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];
let home = "";

// Shim dirs: a `none` shim set (npm only) and a `tart-ready` shim set.
let binNpm = ""; // npm recorder
let binTartReady = ""; // uname=Darwin/arm64 + tart(list/ip) + ssh ok
let binNoTart = ""; // uname=Darwin/arm64, NO tart

const FAKE_IP = "192.168.64.42";

/**
 * A POSIX-sh `python3` that mirrors `_isolation_get_type`'s yaml read for the
 * trivial fixtures here: drain the heredoc script from stdin, then print the
 * indented `type:` scalar under a top-level `test_isolation:` block in
 * .roll/local.yaml (empty if absent). Avoids the PyYAML-under-$HOME import that
 * the sandboxed HOME would break — and avoids `env python3` recursion (the shim
 * shadows the real interpreter on PATH), so it's plain awk, not python.
 */
const PY_SHIM = [
  "#!/bin/sh",
  "cat >/dev/null", // consume the `python3 - <<PY` heredoc body
  "[ -f .roll/local.yaml ] || exit 0",
  "awk '",
  "  /^[^[:space:]]/ { insec = ($0 ~ /^test_isolation:[[:space:]]*$/) }",
  "  insec && /^[[:space:]]+type:/ {",
  "    line=$0; sub(/^[[:space:]]*type:[[:space:]]*/, \"\", line);",
  "    sub(/[[:space:]]*#.*$/, \"\", line); gsub(/^[\"\\x27]|[\"\\x27]$/, \"\", line);",
  "    if (line != \"\") { print line; exit }",
  "  }",
  "' .roll/local.yaml",
  "",
].join("\n");

function writePyShim(dir: string): void {
  writeFileSync(join(dir, "python3"), PY_SHIM, { mode: 0o755 });
}

beforeAll(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "roll-test-home-")));
  dirs.push(home);
  mkdirSync(join(home, ".roll"), { recursive: true });
  seedUpdateCheckCache(join(home, ".roll"));

  // npm shim: record argv + emit a canned line on stdout, exit 0.
  binNpm = realpathSync(mkdtempSync(join(tmpdir(), "roll-test-npm-")));
  dirs.push(binNpm);
  writeFileSync(
    join(binNpm, "npm"),
    ["#!/bin/sh", 'echo "npm-shim ran: $*"', "exit 0", ""].join("\n"),
    { mode: 0o755 },
  );
  writePyShim(binNpm);

  // tart-ready shim: uname reports Apple Silicon; tart list shows the VM
  // running; tart ip returns a fixed IP; ssh true → exit 0 (ready).
  binTartReady = realpathSync(mkdtempSync(join(tmpdir(), "roll-test-tart-")));
  dirs.push(binTartReady);
  writeFileSync(
    join(binTartReady, "uname"),
    ["#!/bin/sh", 'if [ "$1" = "-m" ]; then echo arm64; else echo Darwin; fi', ""].join("\n"),
    { mode: 0o755 },
  );
  writeFileSync(
    join(binTartReady, "tart"),
    [
      "#!/bin/sh",
      'if [ "$1" = "list" ]; then',
      '  printf "%s\\n" "Source Name State"',
      `  printf "%s\\n" "local roll-dev-test running"`,
      "  exit 0",
      "fi",
      'if [ "$1" = "ip" ]; then',
      `  echo ${FAKE_IP}`,
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  writeFileSync(join(binTartReady, "ssh"), ["#!/bin/sh", "exit 0", ""].join("\n"), { mode: 0o755 });
  writePyShim(binTartReady);

  // no-tart shim: Apple Silicon uname, but NO tart binary on PATH.
  binNoTart = realpathSync(mkdtempSync(join(tmpdir(), "roll-test-notart-")));
  dirs.push(binNoTart);
  writeFileSync(
    join(binNoTart, "uname"),
    ["#!/bin/sh", 'if [ "$1" = "-m" ]; then echo arm64; else echo Darwin; fi', ""].join("\n"),
    { mode: 0o755 },
  );
  writePyShim(binNoTart);
});

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

/** A throwaway cwd with a pinned isolation type. */
function projWith(type: string | null): string {
  const proj = realpathSync(mkdtempSync(join(tmpdir(), "roll-test-proj-")));
  dirs.push(proj);
  if (type !== null) {
    mkdirSync(join(proj, ".roll"), { recursive: true });
    writeFileSync(join(proj, ".roll", "local.yaml"), `test_isolation:\n  type: ${type}\n`);
  }
  return proj;
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function baseEnv(proj: string, shimDir: string, extra: Record<string, string>): Record<string, string> {
  return {
    PATH: `${shimDir}:/usr/bin:/bin`,
    HOME: home,
    ROLL_HOME: join(home, ".roll"),
    NO_COLOR: "1",
    ROLL_LANG: "en",
    PWD: proj,
    ...extra,
  };
}

function bashTest(proj: string, args: string[], shimDir: string, extra: Record<string, string> = {}): Run {
  // Capture stdout AND stderr (cmd_test routes notes/errors to stderr even on
  // exit 0, so a stdout-only capture would drop them).
  const r = spawnSync(join(REPO, "bin", "roll"), ["test", ...args], {
    cwd: proj,
    encoding: "utf8",
    env: baseEnv(proj, shimDir, extra),
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const ENV_KEYS = ["PATH", "HOME", "ROLL_HOME", "NO_COLOR", "ROLL_LANG", "LC_ALL", "LANG", "PWD"];

function tsTest(proj: string, args: string[], shimDir: string, extra: Record<string, string> = {}): Run {
  const target = baseEnv(proj, shimDir, extra);
  const save: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) save[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(target)) process.env[k] = v;
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
    status = testCommand(args);
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

/** Run both against FRESH projects built from the same spec, byte-compare. */
function both(
  buildType: string | null,
  args: string[],
  shimDir: string,
  extra: Record<string, string> = {},
): void {
  const bp = projWith(buildType);
  const tp = projWith(buildType);
  const b = bashTest(bp, args, shimDir, extra);
  const t = tsTest(tp, args, shimDir, extra);
  expect(t).toEqual(b);
}

describe("diff-test: roll test == bash oracle", () => {
  for (const lang of ["en", "zh"]) {
    it(`--help → usage + exit 0 (${lang})`, () => {
      both("none", ["--help"], binNpm, { ROLL_LANG: lang });
    });
    it(`-h after another arg still shows help (${lang})`, () => {
      both("none", ["--reset", "--help"], binNpm, { ROLL_LANG: lang });
    });
  }

  it("--where type=none → host", () => {
    both("none", ["--where"], binNpm);
  });

  it("--where type=tart ready VM → tart:<ip>", () => {
    both("tart", ["--where"], binTartReady);
  });

  it("--where type=tart, tart binary absent → tart:not-installed", () => {
    both("tart", ["--where"], binNoTart);
  });

  it("default exec type=none → forwarded npm test -- --affected", () => {
    both("none", [], binNpm);
  });

  it("explicit -- tests/ passthrough type=none", () => {
    both("none", ["--", "tests/"], binNpm);
  });

  it("--reset type=none → nothing-to-reset note, exit 0", () => {
    both("none", ["--reset"], binNpm);
  });

  it("--reset with a held lock → fast-fail exit 1", () => {
    const build = (): string => {
      const proj = projWith("none");
      mkdirSync(join(proj, ".roll"), { recursive: true });
      writeFileSync(join(proj, ".roll", ".iso-reset.lock"), "99999\n");
      return proj;
    };
    const bp = build();
    const tp = build();
    const b = bashTest(bp, ["--reset"], binNpm);
    const t = tsTest(tp, ["--reset"], binNpm);
    expect(t).toEqual(b);
  });

  it("UNREACHABLE-VM: type=tart exec with no tart binary → error, exit 1 (no host fallback)", () => {
    both("tart", [], binNoTart);
  });
});
