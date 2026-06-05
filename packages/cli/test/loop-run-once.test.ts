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
import { readSkillBody } from "../src/commands/loop-run-once.js";
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

describe("FIX-204A — skill resolution + blind-agent refusal", () => {
  function proj(tag: string): string {
    return tmp(`skill-${tag}`);
  }

  it("resolves the skills/ submodule path when .roll/skills is absent", () => {
    const p = proj("submodule");
    execFileSync("mkdir", ["-p", join(p, "skills", "roll-loop")]);
    writeFileSync(
      join(p, "skills", "roll-loop", "SKILL.md"),
      "---\nname: roll-loop\n---\n\n# Loop\n\nDo the work.\n",
    );
    expect(readSkillBody(p)).toBe("# Loop\n\nDo the work.");
  });

  it("legacy .roll/skills wins over the submodule copy when both exist", () => {
    const p = proj("legacy");
    execFileSync("mkdir", ["-p", join(p, ".roll", "skills", "roll-loop")]);
    execFileSync("mkdir", ["-p", join(p, "skills", "roll-loop")]);
    writeFileSync(join(p, ".roll", "skills", "roll-loop", "SKILL.md"), "legacy body\n");
    writeFileSync(join(p, "skills", "roll-loop", "SKILL.md"), "submodule body\n");
    expect(readSkillBody(p)).toBe("legacy body");
  });

  it("ROLL_LOOP_SKILL env override wins over both file locations", () => {
    const p = proj("env");
    execFileSync("mkdir", ["-p", join(p, "skills", "roll-loop")]);
    writeFileSync(join(p, "skills", "roll-loop", "SKILL.md"), "submodule body\n");
    const override = join(p, "custom-skill.md");
    writeFileSync(override, "---\nx: y\n---\noverride body\n");
    process.env["ROLL_LOOP_SKILL"] = override;
    try {
      expect(readSkillBody(p)).toBe("override body");
    } finally {
      delete process.env["ROLL_LOOP_SKILL"];
    }
  });

  it("frontmatter-only / whitespace-only candidates are skipped, not returned empty", () => {
    const p = proj("hollow");
    execFileSync("mkdir", ["-p", join(p, ".roll", "skills", "roll-loop")]);
    execFileSync("mkdir", ["-p", join(p, "skills", "roll-loop")]);
    writeFileSync(join(p, ".roll", "skills", "roll-loop", "SKILL.md"), "---\nname: hollow\n---\n  \n");
    writeFileSync(join(p, "skills", "roll-loop", "SKILL.md"), "real body\n");
    expect(readSkillBody(p)).toBe("real body");
  });

  it("returns null when nothing resolves", () => {
    expect(readSkillBody(proj("none"))).toBeNull();
  });

  it("run-once refuses to start a cycle on a null skill body: rc=1 + ALERT, no lock/worktree", async () => {
    registerAll();
    const p = proj("refuse");
    execFileSync("git", ["init", "-q", p]);
    const rt = join(p, ".roll", "loop");
    const prevCwd = process.cwd();
    const prevRt = process.env["ROLL_PROJECT_RUNTIME_DIR"];
    process.env["ROLL_PROJECT_RUNTIME_DIR"] = rt;
    let err = "";
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((s: string) => {
      err += s;
      return true;
    }) as typeof process.stderr.write;
    try {
      process.chdir(p);
      const r = await dispatch(["loop", "run-once"]);
      expect(r.status).toBe(1);
    } finally {
      process.stderr.write = write;
      process.chdir(prevCwd);
      if (prevRt === undefined) delete process.env["ROLL_PROJECT_RUNTIME_DIR"];
      else process.env["ROLL_PROJECT_RUNTIME_DIR"] = prevRt;
    }
    expect(err).toContain("refusing to spawn a blind agent");
    const { readFileSync: rf, existsSync: ex } = await import("node:fs");
    expect(rf(join(rt, "alerts.log"), "utf8")).toContain("SKILL.md not found");
    expect(ex(join(rt, "inner.lock"))).toBe(false);
    expect(ex(join(rt, "worktrees"))).toBe(false);
  });
});
