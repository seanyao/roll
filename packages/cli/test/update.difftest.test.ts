/**
 * diff-test: TS `roll update` == bash `bin/roll update` (frozen v2 oracle).
 *
 * cmd_update upgrades the install then chains `roll setup` + `_show_changelog`.
 * The REAL install is never run: `npm` and `curl` are PATH-shimmed (recording
 * argv, returning canned output), so both bash and TS drive the identical fake
 * binaries and the passed-through child stdout/stderr stays byte-identical.
 *
 * Three paths are covered:
 *   - npm happy path: shimmed `npm install` succeeds; `npm view` returns empty
 *     so `_check_installed_version_or_retry` is a clean no-op. Full stdout
 *     (current-version → upgrading → setup UI → changelog) compared, en+zh.
 *   - curl happy path: install-method=curl, ROLL_VERSION pinned (so
 *     `_resolve_remote_version` skips the network), shimmed `curl` copies a
 *     canned tarball whose contents are IDENTICAL to the fabricated ROLL_PKG_DIR.
 *     The oracle's atomic swap therefore lands an identical tree, so its
 *     post-swap setup+changelog match the TS port (which reads the new VERSION
 *     from the post-extract tree and skips the irreversible swap — the
 *     whitelisted gap). curl argv recording is asserted identical.
 *   - version-resolve failure: install-method=curl, no ROLL_VERSION, shimmed
 *     curl fails the releases fetch → resolve-fail err + exit 1, en+zh.
 *
 * CI portability: fabricated HOME/ROLL_HOME (seeded update-check cache) +
 * fabricated ROLL_PKG_DIR (conventions/lib/skills/bin/roll/CHANGELOG, NO
 * .git/.gitmodules). PATH shims for npm/curl/tmux; real tar. cwd = non-git proj
 * (deterministic hooks-path skip). No network, no launchd. Locale pinned.
 */
import { execFileSync, execSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateCommand } from "../src/commands/update.js";
import { binRollVersion } from "./helpers.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];
let fakeBin = "";
let pkgDir = "";
let tarball = "";
let curlLog = "";

function writeShim(dir: string, name: string, body: string): void {
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  chmodSync(p, 0o755);
}

beforeAll(() => {
  fakeBin = realpathSync(mkdtempSync(join(tmpdir(), "roll-up-bin-")));
  dirs.push(fakeBin);
  curlLog = join(fakeBin, "curl-argv.log");

  // tmux: present → setup step 6 skip.
  writeShim(fakeBin, "tmux", "exit 0");

  // npm shim: install/cache exit 0 (silent); view → empty; root → empty.
  writeShim(
    fakeBin,
    "npm",
    [
      'case "$1" in',
      "  view) exit 0 ;;",
      "  root) exit 0 ;;",
      "  install) exit 0 ;;",
      "  cache) exit 0 ;;",
      "  *) exit 0 ;;",
      "esac",
    ].join("\n"),
  );

  // Fabricated ROLL_PKG_DIR (full enough for the chained `roll setup`).
  pkgDir = realpathSync(mkdtempSync(join(tmpdir(), "roll-up-pkg-")));
  dirs.push(pkgDir);
  cpSync(join(REPO, "conventions"), join(pkgDir, "conventions"), { recursive: true });
  cpSync(join(REPO, "lib"), join(pkgDir, "lib"), { recursive: true });
  cpSync(join(REPO, "CHANGELOG.md"), join(pkgDir, "CHANGELOG.md"));
  mkdirSync(join(pkgDir, "bin"), { recursive: true });
  cpSync(join(REPO, "bin", "roll"), join(pkgDir, "bin", "roll"));
  for (const s of ["roll-alpha", "roll-beta"]) {
    mkdirSync(join(pkgDir, "skills", s), { recursive: true });
    writeFileSync(join(pkgDir, "skills", s, "SKILL.md"), `# ${s}\n`);
  }

  // Canned tarball whose extracted tree (strip-components=1) is IDENTICAL to
  // pkgDir: tar a parent dir "roll-pkg/<pkg contents>".
  const stage = realpathSync(mkdtempSync(join(tmpdir(), "roll-up-stage-")));
  dirs.push(stage);
  cpSync(pkgDir, join(stage, "roll-pkg"), { recursive: true });
  tarball = join(fakeBin, "canned.tar.gz");
  const tr = spawnSync("tar", ["-czf", tarball, "-C", stage, "roll-pkg"], { encoding: "utf8" });
  if (tr.status !== 0) throw new Error(`tar pack failed: ${tr.stderr}`);

  // curl shim: record argv; if a release-JSON fetch is requested AND
  // ROLL_FAIL_CURL is set, exit 1 (resolve failure); else if downloading
  // (-o present) copy the canned tarball to the target; releases fetch prints
  // canned JSON. Records every argv line for argv-equality assertions.
  writeShim(
    fakeBin,
    "curl",
    [
      `: > '${curlLog}'`,
      'for a in "$@"; do printf "%s\\n" "$a" >> ' + `'${curlLog}'; done`,
      'out=""; prev=""',
      'for a in "$@"; do if [ "$prev" = "-o" ]; then out="$a"; fi; prev="$a"; done',
      'case "$*" in',
      "  *releases/latest*)",
      '    if [ -n "$ROLL_FAIL_CURL" ]; then exit 1; fi',
      '    printf \'{"tag_name": "v9.9.9"}\\n\'',
      "    exit 0 ;;",
      "esac",
      'if [ -n "$out" ]; then cp ' + `'${tarball}'` + ' "$out"; exit 0; fi',
      "exit 0",
    ].join("\n"),
  );
});

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

interface Fixture {
  home: string;
  proj: string;
  installMethod: "npm" | "curl";
}

function buildFixture(installMethod: "npm" | "curl"): Fixture {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "roll-up-home-")));
  dirs.push(home);
  mkdirSync(join(home, ".roll"), { recursive: true });
  writeFileSync(
    join(home, ".roll", "config.yaml"),
    "# Roll config\nlang: en\nai_claude: ~/.claude|CLAUDE.md|CLAUDE.md\n",
  );
  const v = binRollVersion();
  writeFileSync(join(home, ".roll", ".update-check"), `${Math.floor(Date.now() / 1000)} ${v} ${v}\n`);
  const proj = realpathSync(mkdtempSync(join(tmpdir(), "roll-up-proj-")));
  dirs.push(proj);
  return { home, proj, installMethod };
}

/** Set/clear the per-pkgDir install-method marker (shared pkgDir). */
function setInstallMethod(method: "npm" | "curl"): void {
  const f = join(pkgDir, ".install-method");
  if (method === "npm") rmSync(f, { force: true });
  else writeFileSync(f, "curl\n");
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

function readCurlLog(): string {
  let s = "";
  try {
    s = readFileSync(curlLog, "utf8");
  } catch {
    s = "";
  }
  rmSync(curlLog, { force: true });
  return s;
}

function bashUp(fx: Fixture, extra: Record<string, string>): Run {
  setInstallMethod(fx.installMethod);
  try {
    const stdout = execFileSync(join(REPO, "bin", "roll"), ["update"], {
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
  "PATH", "HOME", "ROLL_HOME", "ROLL_PKG_DIR", "NO_COLOR", "ROLL_LANG", "LC_ALL", "LANG",
  "PWD", "ROLL_VERSION", "ROLL_FAIL_CURL",
];

function tsUp(fx: Fixture, extra: Record<string, string>): Run {
  setInstallMethod(fx.installMethod);
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
    status = updateCommand([]);
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

describe("diff-test: roll update == bash oracle", () => {
  for (const lang of ["en", "zh"]) {
    it(`npm happy path → upgrade + setup + changelog (${lang})`, () => {
      const bf = buildFixture("npm");
      const tf = buildFixture("npm");
      const b = bashUp(bf, { ROLL_LANG: lang });
      const t = tsUp(tf, { ROLL_LANG: lang });
      expect(t).toEqual(b);
    });

    it(`curl version-resolve failure → exit 1 (${lang})`, () => {
      const bf = buildFixture("curl");
      const tf = buildFixture("curl");
      const b = bashUp(bf, { ROLL_LANG: lang, ROLL_FAIL_CURL: "1" });
      const t = tsUp(tf, { ROLL_LANG: lang, ROLL_FAIL_CURL: "1" });
      expect(t).toEqual(b);
    });
  }

  it("curl happy path → download/extract + setup + changelog, curl argv identical", () => {
    const bf = buildFixture("curl");
    const b = bashUp(bf, { ROLL_VERSION: "v9.9.9" });
    const bLog = readCurlLog();
    const tf = buildFixture("curl");
    const t = tsUp(tf, { ROLL_VERSION: "v9.9.9" });
    const tLog = readCurlLog();
    expect(t).toEqual(b);
    // The recorded `-o <tmp>/roll.tar.gz` target uses each side's own mktemp dir
    // (bash `mktemp -d` vs Node `mkdtempSync`); normalize the random temp path so
    // the argv comparison asserts the SHAPE (flags + URL + -o … roll.tar.gz).
    const normLog = (s: string): string => s.replace(/^.*\/roll\.tar\.gz$/m, "<TMP>/roll.tar.gz");
    expect(normLog(tLog)).toBe(normLog(bLog));
    expect(bLog).toContain("v9.9.9.tar.gz");
  });
});
