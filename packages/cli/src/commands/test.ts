/**
 * `roll test` — TS port of bin/roll cmd_test (6849-6942) plus the isolation
 * dispatcher + adapter surface it drives: `_cmd_test_where` (6821-6847),
 * `_isolation_get_type` (6552-6577), `_isolation_dispatch` (6582-6617), the
 * `none` adapter (6623-6633), the reset-lock helpers (6640-6661), and the
 * `tart` adapter's read/probe surface (6669-6730, 6761-6783).
 *
 * Mirrored byte-for-byte: arg parse (`--help`/`-h` anywhere before `--` wins;
 * `--` forwards verbatim; `--where`; `--reset`), the `--where` routing tokens
 * (`host`, `tart:<ip>`, `tart:<state>`, `unknown:<type>`), the reset-lock
 * fast-fail messages, the unknown-isolation-type error, and the default exec
 * path (`npm test -- <args>` with `--affected` default), including the
 * dispatcher's "no config → falling back to type=none" stderr INFO line.
 *
 * IO SEAMS (so a difftest never spawns a VM or runs the real suite):
 *   - `npm` is invoked through spawnSync against PATH, so a difftest shims it
 *     (records argv, returns canned output). Both bash and TS run the SAME
 *     shim; the child stdout/stderr is captured + re-emitted so the env-swap
 *     harness sees byte-identical output (mirrors update.ts's runForward).
 *   - `tart` / `ssh` / `uname` are likewise PATH/spawn seams; the difftest's
 *     tart-present and tart-unreachable cases drive them through shims.
 *
 * UNREACHABLE-VM CONTRACT (US-ISO-003, called out by the porting card): when
 * type=tart and the VM can't be reached, `_isolation_tart_exec` runs its
 * platform/binary checks (which `err` + return 1) and never falls back to host
 * execution. The TS port reproduces this exactly — a tart exec whose checks
 * fail returns the non-zero status with the same stderr; it does NOT silently
 * run the suite on the host.
 *
 * WHITELISTED divergences (no stdout contribution; FS/exec-only):
 *   - `_isolation_get_type` shells python3+yaml to read .roll/local.yaml's
 *     nested `test_isolation.type`. The TS port parses that one scalar key
 *     natively (the only value the dispatcher reads); malformed YAML and a
 *     missing file both resolve to `none`, matching the bash fail-soft.
 *   - The tart exec path's background `tart run` VM-boot + 30s IP poll and the
 *     ssh remote-command launch are reproduced as guarded spawns; they emit
 *     nothing to test's own stdout on the darwin/arm64 hardware path and are
 *     never reached on the CI (non-arm64-darwin) platform, where the check
 *     gates short-circuit to an explicit error.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { onPath } from "./setup-shared.js";

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

const SUPPORTED_TYPES = ["none", "tart"] as const;

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

// ─── tart adapter read/probe surface (6669-6730) ─────────────────────────────
function tartVmName(): string {
  return process.env["_TART_VM_NAME"] ?? "roll-dev-test";
}
function tartSshUser(): string {
  return process.env["_TART_SSH_USER"] ?? "admin";
}

function uname(arg?: string): string {
  const r = spawnSync("uname", arg ? [arg] : [], { encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "").trim() : "";
}

/** _isolation_tart_check_platform (6673) — returns true on Apple Silicon. */
function tartCheckPlatform(silent: boolean): boolean {
  if (uname() !== "Darwin" || uname("-m") !== "arm64") {
    if (!silent) {
      err("Tart 仅支持 Apple Silicon macOS");
      err("Tart only supports Apple Silicon macOS");
    }
    return false;
  }
  return true;
}

/** _isolation_tart_check_binary (6682). */
function tartCheckBinary(silent: boolean): boolean {
  if (!onPath("tart")) {
    if (!silent) {
      err("tart binary not found");
      err("  install via: brew install cirruslabs/cli/tart");
    }
    return false;
  }
  return true;
}

/** _isolation_tart_vm_present (6693). */
function tartVmPresent(): boolean {
  const name = tartVmName();
  const r = spawnSync("tart", ["list"], { encoding: "utf8" });
  if (r.status !== 0 && (r.stdout ?? "") === "") return false;
  for (const line of (r.stdout ?? "").split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols[1] === name) return true;
  }
  return false;
}

/** _isolation_tart_ip (6700) — IP when running; null otherwise. */
function tartIp(): string | null {
  const name = tartVmName();
  const list = spawnSync("tart", ["list"], { encoding: "utf8" });
  let running = false;
  for (const line of (list.stdout ?? "").split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols[1] === name && cols[cols.length - 1] === "running") running = true;
  }
  if (!running) return null;
  const ipr = spawnSync("tart", ["ip", name], { encoding: "utf8" });
  if (ipr.status !== 0) return null;
  const ip = (ipr.stdout ?? "").trim();
  return /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(ip) ? ip : null;
}

/** _isolation_tart_status (6712) — not-installed | stopped | running | ready. */
function tartStatus(): string {
  if (!tartCheckPlatform(true)) return "not-installed";
  if (!onPath("tart")) return "not-installed";
  if (!tartVmPresent()) return "not-installed";
  const ip = tartIp();
  if (ip === null) return "stopped";
  const user = tartSshUser();
  const ssh = spawnSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=3", "-o", "StrictHostKeyChecking=no", `${user}@${ip}`, "true"],
    { stdio: "ignore" },
  );
  return ssh.status === 0 ? "ready" : "running";
}

// ─── _cmd_test_where (6821) ──────────────────────────────────────────────────
function cmdTestWhere(): void {
  const type = isolationGetType();
  if (type === "none") {
    process.stdout.write("host\n");
    return;
  }
  if (type === "tart") {
    const st = tartStatus();
    if (st === "ready" || st === "running") {
      const ip = tartIp();
      process.stdout.write(ip !== null ? `tart:${ip}\n` : `tart:${st}\n`);
    } else {
      process.stdout.write(`tart:${st}\n`);
    }
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
  const r = spawnSync(cmd, argv, { encoding: "utf8" });
  if (typeof r.stdout === "string" && r.stdout !== "") process.stdout.write(r.stdout);
  if (typeof r.stderr === "string" && r.stderr !== "") process.stderr.write(r.stderr);
  return r.status ?? 1;
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
  if (type === "none") {
    if (method === "reset") {
      err("isolation type 'none' has nothing to reset (host execution is stateless)");
      return 0;
    }
    // _isolation_none_exec: run the command in the host shell unchanged.
    return runForward(args[0] ?? "", args.slice(1));
  }
  // type === "tart"
  if (method === "reset") return tartReset();
  return tartExec(args);
}

/** _isolation_tart_reset (6789). */
function tartReset(): number {
  if (!tartCheckPlatform(false)) return 1;
  if (!tartCheckBinary(false)) return 1;
  const name = tartVmName();
  const img = process.env["_TART_BASE_IMAGE"] ?? "ghcr.io/cirruslabs/macos-tahoe-base:latest";
  spawnSync("tart", ["stop", name], { stdio: "ignore" });
  spawnSync("tart", ["delete", name], { stdio: "ignore" });
  const clone = spawnSync("tart", ["clone", img, name], { stdio: "inherit" });
  if ((clone.status ?? 1) !== 0) return clone.status ?? 1;
  // provision may fail mid-reset; surfaced via subsequent status check.
  tartProvision();
  return 0;
}

function tartProvision(): void {
  if (!tartCheckPlatform(false)) return;
  if (!tartCheckBinary(false)) return;
  const ip = tartIp();
  if (ip === null) {
    err("tart provision: VM not running");
    return;
  }
  const user = tartSshUser();
  spawnSync(
    "ssh",
    [
      "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", `${user}@${ip}`,
      "export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH; brew list bats >/dev/null 2>&1 || brew install bats-core; brew list node >/dev/null 2>&1 || brew install node; brew list bash >/dev/null 2>&1 || brew install bash",
    ],
    { stdio: "inherit" },
  );
}

/**
 * _isolation_tart_exec (6761). Auto-starts the VM when stopped; runs the
 * command over ssh inside the VM. On the non-arm64-darwin CI the platform
 * check fails first → explicit error + non-zero (NO host fallback).
 */
function tartExec(args: string[]): number {
  if (!tartCheckPlatform(false)) return 1;
  if (!tartCheckBinary(false)) return 1;
  const name = tartVmName();
  let ip = tartIp();
  if (ip === null) {
    const repoRootPath = process.cwd();
    // Mirror bash's backgrounded `tart run ... &`: detached, no wait.
    const boot = spawn("tart", ["run", "--no-graphics", `--dir=roll:${repoRootPath}`, name], {
      stdio: "ignore",
      detached: true,
    });
    boot.unref();
    for (let i = 0; i < 30 && ip === null; i++) {
      ip = tartIp();
      if (ip !== null) break;
      spawnSync("sleep", ["1"]);
    }
    if (ip === null) {
      err("tart exec: VM failed to start in 30s");
      return 1;
    }
  }
  const user = tartSshUser();
  const remoteCmd = args.map((a) => shQuote(a)).join(" ") + " ";
  const ssh = spawnSync(
    "ssh",
    [
      "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", `${user}@${ip}`,
      `export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH; cd '/Volumes/My Shared Files/roll' && ${remoteCmd}`,
    ],
    { encoding: "utf8" },
  );
  if (typeof ssh.stdout === "string" && ssh.stdout !== "") process.stdout.write(ssh.stdout);
  if (typeof ssh.stderr === "string" && ssh.stderr !== "") process.stderr.write(ssh.stderr);
  return ssh.status ?? 1;
}

/** printf %q-equivalent for the ssh remote command assembly. */
function shQuote(s: string): string {
  if (s === "") return "''";
  if (/^[A-Za-z0-9_./:=-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

const HELP = `Usage: roll test [--where | --reset] [--] [<extra-args>...]

Runs the project's test suite through the isolation adapter chosen in
.roll/local.yaml:

  test_isolation:
    type: none   (default)   Direct host execution — same shell as \`npm test\`.
    type: tart               Inside the Apple-Silicon \`roll-dev-test\` Tart VM,
                             so tests can't reach the host's launchd / shared
                             roll state. Tart isn't auto-installed; run
                             \`brew install cirruslabs/cli/tart\` first.

Flags:
  --where        Print where tests will run, then exit (e.g. \`host\`,
                 \`tart:192.168.64.5\`, \`tart:stopped\`).
  --reset        Rebuild the isolation environment to a clean baseline.
                 type=tart: stop → delete → clone → provision (~90s).
                 type=none: prints a note and exits 0 (host is stateless).
                 Holds a lockfile under .roll/.iso-reset.lock; concurrent
                 \`roll test\` invocations fast-fail with a clear error.
  --help, -h     Show this help.

Examples:
  roll test                    Run affected tests (default: --affected HEAD~1).
  roll test -- tests/          Run the full suite explicitly.
  roll test -- --tier=fast     Forward arguments to npm test.
  roll test --where            Don't run; just report routing.
  roll test --reset            Rebuild the VM (or host no-op).

When type=tart and the VM can't be reached, the command exits non-zero
rather than silently falling back to host execution.
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
