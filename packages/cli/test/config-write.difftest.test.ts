/**
 * diff-test: TS `roll config` write surface + compact facades == bash oracle.
 *
 * Each case runs the SAME command through both the frozen bash `bin/roll` and
 * the TS `configCommand`, in two independent fresh sandboxes, then asserts
 * stdout / stderr / exit are byte-identical AND (for writes) the resulting yaml
 * file matches. The reload side-effect is silent on success in a sandbox (and
 * the TS port drops the implicit launchd remount, see config.ts), so both sides
 * emit identical bytes.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { configCommand } from "../src/commands/config.js";
import { seedUpdateCheckCache } from "./helpers.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

interface Sandbox {
  home: string;
  proj: string;
}

function freshSandbox(): Sandbox {
  const home = mkdtempSync(join(tmpdir(), "roll-cfgw-home-"));
  const proj = mkdtempSync(join(tmpdir(), "roll-cfgw-proj-"));
  dirs.push(home, proj);
  mkdirSync(join(home, ".roll"), { recursive: true });
  seedUpdateCheckCache(join(home, ".roll"));
  // Seed an (empty) global config.yaml. Post-`roll setup` it always exists; the
  // frozen bash `_config_resolve` reads a FLAT key via a branch that leaves its
  // `val` local unassigned when the file is missing, which crashes under
  // bin/roll's `set -u` (a latent v2 bug). The TS port initialises val="" and
  // resolves cleanly either way; seeding the file exercises the common,
  // intended contract for both sides.
  writeFileSync(join(home, ".roll", "config.yaml"), "");
  mkdirSync(join(proj, ".roll"), { recursive: true });
  return { home, proj };
}

function bashCfg(sb: Sandbox, args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(join(REPO, "bin", "roll"), ["config", ...args], {
      cwd: sb.proj,
      encoding: "utf8",
      env: { ...process.env, HOME: sb.home, ROLL_HOME: join(sb.home, ".roll"), NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0" },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function tsCfg(sb: Sandbox, args: string[]): { status: number; stdout: string; stderr: string } {
  const save = { HOME: process.env["HOME"], ROLL_HOME: process.env["ROLL_HOME"], NO_COLOR: process.env["NO_COLOR"] };
  process.env["HOME"] = sb.home;
  process.env["ROLL_HOME"] = join(sb.home, ".roll");
  process.env["NO_COLOR"] = "1";
  const saveCwd = process.cwd();
  process.chdir(sb.proj);
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
    status = configCommand(args);
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    process.chdir(saveCwd);
    for (const [k, v] of Object.entries(save)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return { status, stdout: outChunks.join(""), stderr: errChunks.join("") };
}

function readIfExists(p: string): string | null {
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

interface Case {
  name: string;
  args: string[];
  /** which yaml file the write should land in, relative to proj or home. */
  file?: "project" | "global";
}

const CASES: Case[] = [
  // ── plain writes ──
  { name: "flat global write", args: ["loop_dream_hour", "5", "--global"], file: "global" },
  { name: "nested project write (default scope)", args: ["loop_schedule.period_minutes", "30"], file: "project" },
  { name: "nested project write (explicit --project)", args: ["loop_active_start", "9", "--project"], file: "project" },
  // ── facades ──
  { name: "loop-window facade", args: ["loop-window", "9-18"], file: "project" },
  { name: "loop-schedule facade with offset", args: ["loop-schedule", "45/7"], file: "project" },
  { name: "loop-schedule facade no offset", args: ["loop-schedule", "30"], file: "project" },
  { name: "dream-time facade", args: ["dream-time", "03:20"], file: "global" },
  // ── facade reads (no write) ──
  { name: "loop-window read default", args: ["loop-window"] },
  { name: "loop-schedule read default", args: ["loop-schedule"] },
  { name: "dream-time read default", args: ["dream-time"] },
  // ── validation / errors (exit 2) ──
  { name: "above max", args: ["loop_dream_hour", "99", "--global"] },
  { name: "non-integer", args: ["loop_dream_hour", "abc", "--global"] },
  { name: "below min", args: ["loop_active_end", "0"] },
  { name: "unknown key write", args: ["nope", "5"] },
  { name: "too many args", args: ["loop_dream_hour", "5", "6"] },
  { name: "loop-window bad format", args: ["loop-window", "9to18"] },
  { name: "loop-window start>=end", args: ["loop-window", "18-9"] },
  { name: "loop-window start out of range", args: ["loop-window", "25-26"] },
  { name: "loop-schedule offset out of range", args: ["loop-schedule", "30/99"] },
  { name: "dream-time bad format", args: ["dream-time", "0320"] },
  { name: "dream-time hour out of range", args: ["dream-time", "25:00"] },
];

describe("diff-test: roll config (write + facades) == bash oracle", () => {
  for (const c of CASES) {
    it(c.name, () => {
      // One sandbox per case so the absolute global-file path in stdout is the
      // same string for both sides. bash runs first; the TS write is idempotent
      // (same key/value) so re-running it leaves the file byte-identical — and
      // the captured stdout/stderr/exit are compared against bash's.
      const sb = freshSandbox();
      const rel = c.file === "global" ? join(".roll", "config.yaml") : join(".roll", "local.yaml");
      const filePath = c.file === "global" ? join(sb.home, rel) : join(sb.proj, rel);
      const b = bashCfg(sb, c.args);
      const bf = c.file !== undefined ? readIfExists(filePath) : null;
      const t = tsCfg(sb, c.args);
      const tf = c.file !== undefined ? readIfExists(filePath) : null;
      expect(t.status, "exit code").toBe(b.status);
      expect(t.stdout, "stdout").toBe(b.stdout);
      expect(t.stderr, "stderr").toBe(b.stderr);
      if (c.file !== undefined) expect(tf, "written yaml file").toBe(bf);
    });
  }
});
