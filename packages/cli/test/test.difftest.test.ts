/**
 * diff-test: TS `roll test` == bash `bin/roll test` (frozen v2 oracle) — for
 * the surface that REMAINS oracle-aligned after REFACTOR-046 removed the tart
 * isolation lane.
 *
 * cmd_test routes through the isolation dispatcher, so every scenario
 * fabricates a cwd with a `.roll/local.yaml` pinning `test_isolation.type`,
 * plus PATH shims for the external binaries the none adapter touches (`npm`).
 * Both sides run the SAME shims, so the forwarded child stdout/stderr stays
 * byte-identical and the routing/exec verdicts agree regardless of host OS.
 *
 * Still difftested (byte-identical vs the oracle):
 *   - --where on type=none → `host`.
 *   - --where on an unknown type → `unknown:<type>` (the `<type>:<detail>`
 *     token format survives as the adapter extension point).
 *   - default exec on type=none → forwarded `npm test -- --affected`; explicit
 *     `-- tests/` passthrough.
 *   - --reset on type=none → "nothing to reset" note (exit 0); a held lock →
 *     fast-fail (exit 1).
 *
 * WHITELISTED divergences (REFACTOR-046 — TS-only assertions below):
 *   - `--help`: the oracle still documents the tart lane; the TS help is
 *     tart-free. Asserted TS-only (exit 0, mentions type:none, no tart).
 *   - unknown-type EXEC error: both sides err + exit 1, but the oracle lists
 *     `supported types: none, tart` while TS lists `none` only. Asserted
 *     TS-only. A stale `type: tart` config lands exactly here — fail-loud,
 *     never a silent host fallback.
 *
 * One harness subtlety: bash's `_isolation_get_type` shells `python3`+PyYAML to
 * read `.roll/local.yaml`, and PyYAML is imported from the *user* site-packages
 * under $HOME — which our sandboxed HOME hides, so the real python would fail to
 * import yaml and fall back to type=none, diverging from the TS native parser.
 * To make BOTH sides resolve the type identically and host-independently, every
 * shim dir carries a tiny `python3` shim that prints `test_isolation.type` with
 * a stdlib-only regex reader (no yaml import).
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testCommand } from "../src/commands/test.js";
import { seedUpdateCheckCache } from "./helpers.js";

const dirs: string[] = [];
let home = "";
let defaultPkgDir = "";

// Shim dir: npm recorder + python3 yaml-reader (see header).
let binNpm = "";

/**
 * A POSIX-sh `python3` that mirrors `_isolation_get_type`'s yaml read for the
 * trivial fixtures here: drain the heredoc script from stdin, then print the
 * indented `type:` scalar under a top-level `test_isolation:` block in
 * .roll/local.yaml (empty if absent).
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

beforeAll(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "roll-test-home-")));
  dirs.push(home);
  mkdirSync(join(home, ".roll"), { recursive: true });
  seedUpdateCheckCache(join(home, ".roll"));
  defaultPkgDir = realpathSync(mkdtempSync(join(tmpdir(), "roll-test-pkg-")));
  dirs.push(defaultPkgDir);
  mkdirSync(join(defaultPkgDir, "skills", "roll-onboard"), { recursive: true });
  writeFileSync(join(defaultPkgDir, "skills", "roll-onboard", "SKILL.md"), "# roll-onboard\n");

  // npm shim: record argv + emit a canned line on stdout, exit 0.
  binNpm = realpathSync(mkdtempSync(join(tmpdir(), "roll-test-npm-")));
  dirs.push(binNpm);
  writeFileSync(
    join(binNpm, "npm"),
    ["#!/bin/sh", 'echo "npm-shim ran: $*"', "exit 0", ""].join("\n"),
    { mode: 0o755 },
  );
  writeFileSync(join(binNpm, "python3"), PY_SHIM, { mode: 0o755 });
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
    ROLL_PKG_DIR: defaultPkgDir,
    PWD: proj,
    ...extra,
  };
}

const ENV_KEYS = [
  "PATH",
  "HOME",
  "ROLL_HOME",
  "NO_COLOR",
  "ROLL_LANG",
  "LC_ALL",
  "LANG",
  "PWD",
  "ROLL_RUN_DIR",
  "ROLL_EVIDENCE_DIR",
  "ROLL_SCREENSHOTS_DIR",
  "ROLL_PKG_DIR",
  "GIT_RECORD",
];

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
// US-PORT-021b: bash oracle retired → freeze the proven-correct TS output as a
// snapshot. Scrub per-run temp paths so it is stable across machines (CI is the
// cross-platform gate; locale pinned via env in tsTest).
function scrub(r: Run, ...dirs: string[]): Run {
  const n = (s: string): string => {
    let o = s;
    for (const d of dirs) o = o.split(d).join("<DIR>");
    return o.replace(/\/(?:var\/folders|tmp)\/[^\s"':)]*/g, "<TMP>");
  };
  return { status: r.status, stdout: n(r.stdout), stderr: n(r.stderr) };
}

function both(
  buildType: string | null,
  args: string[],
  shimDir: string,
  extra: Record<string, string> = {},
): void {
  const tp = projWith(buildType);
  expect(scrub(tsTest(tp, args, shimDir, extra), tp, shimDir)).toMatchSnapshot();
}

describe("diff-test: roll test == bash oracle (post-REFACTOR-046 surface)", () => {
  it("--where type=none → host", () => {
    both("none", ["--where"], binNpm);
  });

  it("--where unknown type → unknown:<type> token (extension point)", () => {
    both("docker", ["--where"], binNpm);
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
    const tp = build();
    expect(scrub(tsTest(tp, ["--reset"], binNpm), tp, binNpm)).toMatchSnapshot();
  });
});

describe("REFACTOR-046 whitelisted divergences (TS-only)", () => {
  it("--help: tart-free usage, exit 0", () => {
    const t = tsTest(projWith("none"), ["--help"], binNpm);
    expect(t.status).toBe(0);
    expect(t.stdout).toContain("type: none");
    expect(t.stdout).not.toMatch(/tart/i);
  });

  it("-h after another arg still shows help", () => {
    const t = tsTest(projWith("none"), ["--reset", "-h"], binNpm);
    expect(t.status).toBe(0);
    expect(t.stdout).toContain("Usage: roll test");
  });

  it("unknown-type exec fails loud, lists only none, never falls back to host", () => {
    const t = tsTest(projWith("docker"), [], binNpm);
    expect(t.status).toBe(1);
    expect(t.stderr).toContain("unknown type 'docker'");
    expect(t.stderr).toContain("supported types: none");
    expect(t.stderr).not.toMatch(/tart/i);
    expect(t.stdout).not.toContain("npm-shim ran"); // host suite NOT executed
  });

  it("a stale `type: tart` config is now an unknown type — fail-loud", () => {
    const where = tsTest(projWith("tart"), ["--where"], binNpm);
    expect(where.status).toBe(0);
    expect(where.stdout).toBe("unknown:tart\n");

    const exec = tsTest(projWith("tart"), [], binNpm);
    expect(exec.status).toBe(1);
    expect(exec.stderr).toContain("unknown type 'tart'");
    expect(exec.stdout).not.toContain("npm-shim ran"); // no silent host fallback
  });

  it("US-EVID-002: existing run frame receives roll test output, summary, and e2e child artifacts", () => {
    const shimDir = realpathSync(mkdtempSync(join(tmpdir(), "roll-test-evidence-npm-")));
    dirs.push(shimDir);
    writeFileSync(
      join(shimDir, "npm"),
      [
        "#!/bin/sh",
        'echo "npm-shim ran: $*"',
        'echo "child ROLL_RUN_DIR=$ROLL_RUN_DIR"',
        'echo "child ROLL_EVIDENCE_DIR=$ROLL_EVIDENCE_DIR"',
        'echo "child ROLL_SCREENSHOTS_DIR=$ROLL_SCREENSHOTS_DIR"',
        'printf "e2e artifact\\n" > "$ROLL_EVIDENCE_DIR/e2e-artifact.txt"',
        'printf "PNG\\n" > "$ROLL_SCREENSHOTS_DIR/e2e-shot.png"',
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    const proj = projWith("none");
    const runDir = join(proj, ".roll", "features", "demo", "US-EVID-002", "cycle-1");
    mkdirSync(runDir, { recursive: true });

    const t = tsTest(proj, ["--", "e2e"], shimDir, { ROLL_RUN_DIR: runDir });

    expect(t.status).toBe(0);
    expect(t.stdout).toContain("npm-shim ran: test -- e2e");
    expect(t.stdout).toContain("child ROLL_RUN_DIR=");
    expect(t.stdout).not.toContain(`child ROLL_RUN_DIR=${runDir}`);
    expect(readFileSync(join(runDir, "evidence", "roll-test-output.log"), "utf8")).toContain("npm-shim ran: test -- e2e");
    expect(readFileSync(join(runDir, "evidence", "roll-test-summary.txt"), "utf8")).toContain('"exitCode":0');
    expect(readFileSync(join(runDir, "evidence", "e2e-artifact.txt"), "utf8")).toBe("e2e artifact\n");
    expect(readFileSync(join(runDir, "screenshots", "e2e-shot.png"), "utf8")).toBe("PNG\n");
  });

  it("US-EVID-002: missing frame is a no-op, not an error", () => {
    const proj = projWith("none");
    const missing = join(proj, ".roll", "features", "demo", "US-EVID-002", "missing-cycle");

    const t = tsTest(proj, [], binNpm, { ROLL_RUN_DIR: missing });

    expect(t.status).toBe(0);
    expect(t.stdout).toContain("npm-shim ran: test -- --affected");
    expect(existsSync(missing)).toBe(false);
  });

  it("FIX-264: empty skills submodule is initialized before running the suite", () => {
    const proj = projWith("none");
    const pkg = realpathSync(mkdtempSync(join(tmpdir(), "roll-test-empty-skills-pkg-")));
    dirs.push(pkg);
    mkdirSync(join(pkg, "skills"), { recursive: true });
    writeFileSync(join(pkg, ".git"), "gitdir: /tmp/fake\n");
    writeFileSync(join(pkg, ".gitmodules"), "[submodule \"skills\"]\n\tpath = skills\n\turl = git@github.com:seanyao/roll-skills.git\n");

    const shimDir = realpathSync(mkdtempSync(join(tmpdir(), "roll-test-submodule-bin-")));
    dirs.push(shimDir);
    const record = join(shimDir, "git-record.txt");
    writeFileSync(
      join(shimDir, "git"),
      [
        "#!/bin/sh",
        'echo "$*" >> "$GIT_RECORD"',
        'if [ "$1" = "submodule" ]; then',
        '  mkdir -p "$ROLL_PKG_DIR/skills/roll-onboard"',
        '  echo "# onboard" > "$ROLL_PKG_DIR/skills/roll-onboard/SKILL.md"',
        "  exit 0",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    writeFileSync(join(shimDir, "npm"), "#!/bin/sh\necho npm-after-skills\nexit 0\n", { mode: 0o755 });

    const t = tsTest(proj, [], shimDir, { ROLL_PKG_DIR: pkg, GIT_RECORD: record });
    expect(t.status).toBe(0);
    expect(t.stdout).toContain("npm-after-skills");
    expect(readFileSync(record, "utf8")).toContain("submodule update --init --recursive --quiet skills");
    expect(existsSync(join(pkg, "skills", "roll-onboard", "SKILL.md"))).toBe(true);
  });

  it("FIX-264: failed skills initialization is loud and does not run npm", () => {
    const proj = projWith("none");
    const pkg = realpathSync(mkdtempSync(join(tmpdir(), "roll-test-empty-skills-pkg-fail-")));
    dirs.push(pkg);
    mkdirSync(join(pkg, "skills"), { recursive: true });
    writeFileSync(join(pkg, ".git"), "gitdir: /tmp/fake\n");
    writeFileSync(join(pkg, ".gitmodules"), "[submodule \"skills\"]\n\tpath = skills\n");

    const shimDir = realpathSync(mkdtempSync(join(tmpdir(), "roll-test-submodule-bin-fail-")));
    dirs.push(shimDir);
    writeFileSync(join(shimDir, "git"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    writeFileSync(join(shimDir, "npm"), "#!/bin/sh\necho npm-should-not-run\nexit 0\n", { mode: 0o755 });

    const t = tsTest(proj, [], shimDir, { ROLL_PKG_DIR: pkg });
    expect(t.status).toBe(1);
    expect(t.stderr).toContain("roll test: skills submodule is empty");
    expect(t.stderr).toContain("git submodule update --init --recursive skills");
    expect(t.stdout).not.toContain("npm-should-not-run");
    rmSync(join(pkg, "skills"), { recursive: true, force: true });
  });
});
