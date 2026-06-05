/**
 * Tests for the `loop run-once` CLI wiring + the real agentSpawn child-process
 * path (driven against a PATH shim 'claude', never a real agent).
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dispatch, isPorted, registerAll } from "../src/index.js";
import { realAgentSpawn } from "../src/runner/index.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) {
    try {
      execFileSync("rm", ["-rf", d]);
    } catch {
      /* best effort */
    }
  }
});
function tmp(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `roll-runonce-${tag}-`));
  dirs.push(d);
  return realpathSync(d);
}

describe("loop run-once CLI wiring", () => {
  it("registers `loop` TS-first (run-once + status are ported)", () => {
    registerAll();
    expect(isPorted("loop")).toBe(true);
  });

  it("--dry-run prints the command plan without executing (exit 0)", async () => {
    registerAll();
    const write = process.stdout.write.bind(process.stdout);
    let out = "";
    process.stdout.write = ((s: string) => {
      out += s;
      return true;
    }) as typeof process.stdout.write;
    try {
      const r = await dispatch(["loop", "run-once", "--dry-run"]);
      expect(r.status).toBe(0);
    } finally {
      process.stdout.write = write;
    }
    expect(out).toContain("command plan (orchestrator → executor)");
    expect(out).toContain("spawn_agent");
    expect(out).toContain("nothing executed");
  });
});

describe("realAgentSpawn child-process path (PATH shim, no real claude)", () => {
  it("spawns a shim 'claude' in the worktree cwd and captures its exit + stdout", async () => {
    const dir = tmp("shim");
    // A fake `claude` that just echoes its cwd and exits 0 — proves the spawn
    // path runs the resolved binary with the worktree as cwd.
    const shim = join(dir, "claude");
    writeFileSync(shim, "#!/bin/sh\necho \"model: claude\"\necho \"cwd=$(pwd)\"\nexit 0\n", "utf8");
    chmodSync(shim, 0o755);

    const res = await realAgentSpawn("claude", {
      cwd: dir,
      skillBody: "do work",
      bin: shim, // inject the shim directly (no PATH mutation needed)
    });
    expect(res.exitCode).toBe(0);
    expect(res.timedOut).toBe(false);
    expect(res.stdout).toContain("model: claude");
    expect(res.stdout).toContain(`cwd=${dir}`);
  });

  it("times out and SIGKILLs a hanging shim (timedOut=true)", async () => {
    const dir = tmp("hang");
    const shim = join(dir, "claude");
    writeFileSync(shim, "#!/bin/sh\nsleep 30\n", "utf8");
    chmodSync(shim, 0o755);
    const res = await realAgentSpawn("claude", {
      cwd: dir,
      skillBody: "x",
      bin: shim,
      // generous margin: slow CI runners need spawn headroom before the timer
      timeoutMs: 800,
    });
    expect(res.timedOut).toBe(true);
    expect(res.exitCode).not.toBe(0);
  });
});
