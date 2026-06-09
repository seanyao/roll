/**
 * US-PORT-022 (part 2) — `roll loop reset | mute | unmute` TS ports.
 * Behavior aligned with bin/roll `_loop_reset` / `_loop_mute` / `_loop_unmute`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  healDir,
  loopMuteCommand,
  loopResetCommand,
  loopUnmuteCommand,
  muteFile,
  stateFile,
} from "../src/commands/loop-maint.js";
import { stripAnsi } from "../src/render.js";

const dirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string): void {
  if (!(k in savedEnv)) savedEnv[k] = process.env[k];
  process.env[k] = v;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function capture(fn: () => number): { status: number; out: string; err: string } {
  const o: string[] = [];
  const e: string[] = [];
  const wo = process.stdout.write.bind(process.stdout);
  const we = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((x: string | Uint8Array) => (o.push(String(x)), true)) as typeof process.stdout.write;
  process.stderr.write = ((x: string | Uint8Array) => (e.push(String(x)), true)) as typeof process.stderr.write;
  try {
    const status = fn();
    return { status, out: stripAnsi(o.join("")), err: stripAnsi(e.join("")) };
  } finally {
    process.stdout.write = wo;
    process.stderr.write = we;
  }
}

/** Point the runtime dir + slug + heal dir at a throwaway sandbox. */
function sandbox(): { rt: string; slug: string; heal: string } {
  const rt = tmp("roll-loopmaint-rt-");
  const loopDir = tmp("roll-loopmaint-shared-");
  setEnv("ROLL_PROJECT_RUNTIME_DIR", rt);
  setEnv("ROLL_LOOP_DIR", loopDir);
  setEnv("ROLL_MAIN_SLUG", "sandbox-aaa111");
  setEnv("ROLL_LANG", "en");
  setEnv("NO_COLOR", "1");
  return { rt, slug: "sandbox-aaa111", heal: join(loopDir, "heal") };
}

describe("loop reset — US-PORT-022", () => {
  it("clears an existing state file + reports the cleared message, exit 0", () => {
    const { slug } = sandbox();
    const state = stateFile(slug);
    mkdirSync(join(state, ".."), { recursive: true });
    writeFileSync(state, "head_ci_heal: 3\n");
    const r = capture(() => loopResetCommand([]));
    expect(r.status).toBe(0);
    expect(existsSync(state)).toBe(false);
    expect(r.out).toContain("Loop state cleared");
    expect(r.err).toBe("");
  });

  it("no state file → 'no loop state to clear', exit 0", () => {
    sandbox();
    const r = capture(() => loopResetCommand([]));
    expect(r.status).toBe(0);
    expect(r.out).toContain("No loop state to clear");
  });

  it("removes the heal dir unconditionally", () => {
    const { heal } = sandbox();
    mkdirSync(heal, { recursive: true });
    writeFileSync(join(heal, "counter"), "1");
    const r = capture(() => loopResetCommand([]));
    expect(r.status).toBe(0);
    expect(existsSync(heal)).toBe(false);
  });
});

describe("loop mute / unmute — US-PORT-022", () => {
  it("mute creates the marker (auto-creating its parent), exit 0", () => {
    const { slug } = sandbox();
    const r = capture(() => loopMuteCommand([]));
    expect(r.status).toBe(0);
    expect(existsSync(muteFile(slug))).toBe(true);
    expect(readFileSync(muteFile(slug), "utf8")).toBe("");
    expect(r.out).toContain("muted");
  });

  it("unmute removes the marker, exit 0", () => {
    const { slug } = sandbox();
    capture(() => loopMuteCommand([]));
    expect(existsSync(muteFile(slug))).toBe(true);
    const r = capture(() => loopUnmuteCommand([]));
    expect(r.status).toBe(0);
    expect(existsSync(muteFile(slug))).toBe(false);
    expect(r.out).toContain("unmuted");
  });

  it("unmute when not muted is a no-op, exit 0", () => {
    sandbox();
    const r = capture(() => loopUnmuteCommand([]));
    expect(r.status).toBe(0);
  });

  it("heal dir honors ROLL_LOOP_DIR override", () => {
    const { heal } = sandbox();
    expect(healDir()).toBe(heal);
  });
});
