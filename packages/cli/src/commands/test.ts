/**
 * `roll test` — TS port of bin/roll cmd_test (6849-6942) plus the isolation
 * dispatcher it drives: `_cmd_test_where` (6821-6847), `_isolation_get_type`
 * (6552-6577), `_isolation_dispatch` (6582-6617), the `none` adapter
 * (6623-6633), and the reset-lock helpers (6640-6661).
 *
 * Mirrored byte-for-byte: arg parse (`--help`/`-h` anywhere before `--` wins;
 * `--` forwards verbatim; `--where`; `--reset`), the `--where` routing tokens
 * (`host`, `unknown:<type>`), the reset-lock fast-fail messages, the
 * unknown-isolation-type error, and the default exec path (`npm test -- <args>`
 * with `--affected` default), including the dispatcher's "no config → falling
 * back to type=none" stderr INFO line.
 *
 * ISOLATION SURFACE (REFACTOR-046): only `type: none` is supported. The tart
 * VM lane was REMOVED — its real-VM path was never CI-exercised and the v3
 * suite is hermetic by construction. Any other configured type (incl. a stale
 * `tart`) fails loud: explicit error + exit 1, never a silent host fallback.
 * The `--where` token format (`<type>:<detail>`) survives as the extension
 * point for future adapters (e.g. `docker:running`).
 *
 * IO SEAM (so a difftest never runs the real suite): `npm` is invoked through
 * spawnSync against PATH, so a difftest shims it (records argv, returns canned
 * output). Both bash and TS run the SAME shim; the child stdout/stderr is
 * captured + re-emitted so the env-swap harness sees byte-identical output
 * (mirrors update.ts's runForward).
 *
 * WHITELISTED divergences:
 *   - `_isolation_get_type` shells python3+yaml to read .roll/local.yaml's
 *     nested `test_isolation.type`. The TS port parses that one scalar key
 *     natively; malformed YAML and a missing file both resolve to `none`,
 *     matching the bash fail-soft.
 *   - The frozen v2 oracle still carries its tart adapter; the TS side treats
 *     `tart` as an unknown type (fail-loud). The unknown-type ERROR path lists
 *     only `none` and intentionally differs from the oracle's list — covered
 *     by a TS-only test, while the `--where` unknown TOKEN stays difftested.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// ─── bash UI helpers (bin/roll:41-56) ────────────────────────────────────────
function pal(): { CYAN: string; GREEN: string; YELLOW: string; RED: string; NC: string } {
  const noColor = (process.env["NO_COLOR"] ?? "") !== "";
  return noColor
    ? { CYAN: "", GREEN: "", YELLOW: "", RED: "", NC: "" }
    : { CYAN: "\x1b[0;36m", GREEN: "\x1b[0;32m", YELLOW: "\x1b[0;33m", RED: "\x1b[0;31m", NC: "\x1b[0m" };
}
/** `info ... >&2`: CYAN-prefixed [roll] line written to STDERR (dispatcher). */
function infoErr(line: string): void {
  const { CYAN, NC } = pal();
  process.stderr.write(`${CYAN}[roll]${NC} ${line}\n`);
}
function err(line: string): void {
  const { RED, NC } = pal();
  process.stderr.write(`${RED}[roll]${NC} ${line}\n`);
}

const SUPPORTED_TYPES = ["none"] as const;

interface EvidenceFrameEnv {
  runDir: string;
  evidenceDir: string;
  screenshotsDir: string;
}

function currentEvidenceFrame(): EvidenceFrameEnv | null {
  const raw = (process.env["ROLL_RUN_DIR"] ?? "").trim();
  if (raw === "") return null;
  const runDir = resolve(raw);
  if (!existsSync(runDir)) return null;
  const frame = {
    runDir,
    evidenceDir: join(runDir, "evidence"),
    screenshotsDir: join(runDir, "screenshots"),
  };
  try {
    mkdirSync(frame.evidenceDir, { recursive: true });
    mkdirSync(frame.screenshotsDir, { recursive: true });
  } catch {
    return null;
  }
  return frame;
}

function childEnvForEvidence(frame: EvidenceFrameEnv | null): NodeJS.ProcessEnv | undefined {
  const hasEvidenceInput =
    process.env["ROLL_RUN_DIR"] !== undefined ||
    process.env["ROLL_EVIDENCE_DIR"] !== undefined ||
    process.env["ROLL_SCREENSHOTS_DIR"] !== undefined;
  if (frame === null) {
    if (!hasEvidenceInput) return undefined;
    const env = { ...process.env };
    delete env["ROLL_RUN_DIR"];
    delete env["ROLL_EVIDENCE_DIR"];
    delete env["ROLL_SCREENSHOTS_DIR"];
    return env;
  }
  return {
    ...process.env,
    ROLL_RUN_DIR: frame.runDir,
    ROLL_EVIDENCE_DIR: frame.evidenceDir,
    ROLL_SCREENSHOTS_DIR: frame.screenshotsDir,
  };
}

function appendRollTestEvidence(
  frame: EvidenceFrameEnv,
  cmd: string,
  argv: readonly string[],
  status: number,
  stdout: string,
  stderr: string,
): void {
  try {
    const ts = new Date().toISOString();
    const command = [cmd, ...argv];
    appendFileSync(
      join(frame.evidenceDir, "roll-test-output.log"),
      [
        `===== roll test ${ts} exit=${status} =====`,
        `$ ${command.join(" ")}`,
        "--- stdout ---",
        stdout,
        "--- stderr ---",
        stderr,
        "",
      ].join("\n"),
      "utf8",
    );
    appendFileSync(
      join(frame.evidenceDir, "roll-test-summary.txt"),
      JSON.stringify({
        ts,
        command,
        exitCode: status,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
      }) + "\n",
      "utf8",
    );
  } catch {
    /* evidence deposit is best-effort; roll test result remains authoritative */
  }
}

// ─── _isolation_get_type (6552) ──────────────────────────────────────────────
/**
 * Read test_isolation.type from .roll/local.yaml; "none" when the file or key
 * is missing or the YAML is malformed (bash fail-soft). The bash oracle shells
 * python3+yaml for nested-key parsing; we parse the single scalar natively.
 */
function isolationGetType(): string {
  const file = join(process.cwd(), ".roll", "local.yaml");
  if (!existsSync(file)) return "none";
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return "none";
  }
  const val = parseTestIsolationType(text);
  return val !== "" ? val : "none";
}

/**
 * Extract `test_isolation.type` from a small YAML doc. Mirrors the python
 * `data.get("test_isolation")` → dict → `.get("type")` → non-empty str path:
 * find the top-level `test_isolation:` mapping, then its indented `type:`
 * scalar. Anything that doesn't shape up that way yields "".
 */
function parseTestIsolationType(text: string): string {
  const lines = text.split("\n");
  let inSection = false;
  let sectionIndent = -1;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (!inSection) {
      if (/^test_isolation:\s*$/.test(line.trim() === line ? line : line.trimStart()) && indent === 0) {
        inSection = true;
        sectionIndent = indent;
      }
      continue;
    }
    // Inside the section: a key at <= section indent ends it.
    if (indent <= sectionIndent) break;
    const mm = /^type:\s*(.*)$/.exec(line.trim());
    if (mm) {
      let v = (mm[1] ?? "").trim();
      // strip quotes + inline comment
      v = v.replace(/\s+#.*$/, "").trim();
      v = v.replace(/^["']|["']$/g, "");
      return v;
    }
  }
  return "";
}

// ─── _cmd_test_where (6821) ──────────────────────────────────────────────────
// Routing tokens: `host` for the none adapter; `unknown:<type>` for anything
// else (the `<type>:<detail>` shape is the extension point future adapters
// reuse — REFACTOR-046 removed the only non-none adapter, tart).
function cmdTestWhere(): void {
  const type = isolationGetType();
  if (type === "none") {
    process.stdout.write("host\n");
    return;
  }
  process.stdout.write(`unknown:${type}\n`);
}

// ─── reset-lock helpers (6640-6661) ──────────────────────────────────────────
// bin/roll prints this path verbatim (relative to cwd) in its lock messages;
// keep it relative so the error text matches byte-for-byte.
function resetLockPath(): string {
  return ".roll/.iso-reset.lock";
}
function resetLockHeld(): boolean {
  return existsSync(resetLockPath());
}
function resetAcquireLock(): boolean {
  const lock = resetLockPath();
  if (existsSync(lock)) return false;
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, `${process.pid}\n`);
  return true;
}
function resetReleaseLock(): void {
  rmSync(resetLockPath(), { force: true });
}

/**
 * Forward a (shimmed) child's stdout/stderr through our process streams so the
 * env-swap difftest harness captures it byte-identically (mirrors update.ts).
 */
function runForward(cmd: string, argv: string[]): number {
  const frame = currentEvidenceFrame();
  const r = spawnSync(cmd, argv, { encoding: "utf8", env: childEnvForEvidence(frame) });
  const stdout = typeof r.stdout === "string" ? r.stdout : "";
  const stderr = typeof r.stderr === "string" ? r.stderr : "";
  const status = r.status ?? 1;
  if (stdout !== "") process.stdout.write(stdout);
  if (stderr !== "") process.stderr.write(stderr);
  if (frame !== null) appendRollTestEvidence(frame, cmd, argv, status, stdout, stderr);
  return status;
}

// ─── _isolation_dispatch exec / reset (6582) ─────────────────────────────────
/** Returns the dispatch exit status, or null when the type is unknown-but-handled. */
function isolationDispatch(method: "exec" | "reset", args: string[]): number {
  const type = isolationGetType();
  if (type === "none" && !existsSync(join(process.cwd(), ".roll", "local.yaml"))) {
    infoErr("isolation: no test_isolation config, falling back to type=none (host)");
  }
  if (!(SUPPORTED_TYPES as readonly string[]).includes(type)) {
    err(`isolation: unknown type '${type}' in .roll/local.yaml`);
    process.stderr.write(`  supported types: ${SUPPORTED_TYPES.join(", ")}\n`);
    return 1;
  }
  // type === "none" (the only supported adapter — REFACTOR-046).
  if (method === "reset") {
    err("isolation type 'none' has nothing to reset (host execution is stateless)");
    return 0;
  }
  // _isolation_none_exec: run the command in the host shell unchanged.
  return runForward(args[0] ?? "", args.slice(1));
}

const HELP = `Usage: roll test [--where | --reset] [--] [<extra-args>...]

Runs the project's test suite through the isolation adapter chosen in
.roll/local.yaml:

  test_isolation:
    type: none   (default)   Direct host execution — same shell as \`npm test\`.

Any other configured type is rejected with an explicit error (exit 1) —
never a silent host fallback. The \`<type>:<detail>\` routing token printed
by --where is the extension point for future adapters.

Flags:
  --where        Print where tests will run, then exit (e.g. \`host\`,
                 \`unknown:<type>\`).
  --reset        Reset the isolation environment.
                 type=none: prints a note and exits 0 (host is stateless).
                 Holds a lockfile under .roll/.iso-reset.lock; concurrent
                 \`roll test\` invocations fast-fail with a clear error.
  --help, -h     Show this help.

Examples:
  roll test                    Run affected tests (default: --affected HEAD~1).
  roll test -- tests/          Run the full suite explicitly.
  roll test -- --tier=fast     Forward arguments to npm test.
  roll test --where            Don't run; just report routing.
`;

// ─── cmd_test (6849) ─────────────────────────────────────────────────────────
export function testCommand(args: string[]): number {
  // --help/-h anywhere before `--` wins; `--` stops interception.
  let argv = args;
  for (const a of args) {
    if (a === "--") break;
    if (a === "--help" || a === "-h") {
      argv = ["--help"];
      break;
    }
  }

  const first = argv[0] ?? "";
  if (first === "--help" || first === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (first === "--where") {
    cmdTestWhere();
    return 0;
  }
  if (first === "--reset") {
    if (resetLockHeld()) {
      err("roll test --reset: another reset is already in progress");
      process.stderr.write(`  lock: ${resetLockPath()} (delete manually if stale)\n`);
      return 1;
    }
    if (!resetAcquireLock()) {
      err("roll test --reset: failed to acquire reset lock");
      return 1;
    }
    try {
      return isolationDispatch("reset", []);
    } finally {
      resetReleaseLock();
    }
  }
  if (first === "--") {
    argv = argv.slice(1);
  }

  // Test-execution path. Bail if a reset is in progress.
  if (resetLockHeld()) {
    err(`roll test: a reset is in progress (lock: ${resetLockPath()})`);
    process.stderr.write("  re-run once the reset completes, or delete the lockfile if stale\n");
    return 1;
  }

  let npmArgs = argv;
  if (npmArgs.length === 0) npmArgs = ["--affected"];
  return isolationDispatch("exec", ["npm", "test", "--", ...npmArgs]);
}
