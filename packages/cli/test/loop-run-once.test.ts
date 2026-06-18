/**
 * Tests for the `loop run-once` CLI wiring + the real agentSpawn child-process
 * path (driven against a PATH shim 'claude', never a real agent).
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dispatch, isPorted, registerAll } from "../src/index.js";
import { RUN_ONCE_USAGE, buildLoopRouteDeps, loopRunOnceCommand, readExternalBlock, readSkillBody, shouldSuppressGoalChildFailureCounter } from "../src/commands/loop-run-once.js";
import { resolveRoute } from "@roll/core";
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

  it("FIX-351: --help prints usage and exits 0 WITHOUT running a cycle (no side effects)", async () => {
    const write = process.stdout.write.bind(process.stdout);
    let out = "";
    process.stdout.write = ((s: string) => {
      out += s;
      return true;
    }) as typeof process.stdout.write;
    let r: number;
    try {
      // Called directly (not via dispatch): the --help guard is the FIRST thing
      // in loopRunOnceCommand, BEFORE projectIdentity / lock / network probe /
      // agent spawn. If it ran a cycle it would touch git/gh and hang or throw
      // in this hermetic test env — returning fast with usage proves it short-circuits.
      r = await loopRunOnceCommand(["--help"]);
    } finally {
      process.stdout.write = write;
    }
    expect(r).toBe(0);
    // Output is EXACTLY the usage text — proving no cycle ran (a real cycle
    // prints "loop run-once: cycle <id> → <terminal>" and other progress lines).
    expect(out).toBe(`${RUN_ONCE_USAGE}\n`);
    expect(out).toContain("Usage: roll loop run-once");
    expect(out).not.toContain("loop run-once: cycle");
    expect(out).not.toContain("→ unknown");
  });

  it("FIX-351: -h is also a help flag (prints usage, no cycle)", async () => {
    const write = process.stdout.write.bind(process.stdout);
    let out = "";
    process.stdout.write = ((s: string) => {
      out += s;
      return true;
    }) as typeof process.stdout.write;
    let r: number;
    try {
      r = await loopRunOnceCommand(["-h"]);
    } finally {
      process.stdout.write = write;
    }
    expect(r).toBe(0);
    expect(out).toContain("Usage: roll loop run-once");
  });

  it("does not count goal-child zero-delivery failures as consecutive failures", () => {
    expect(shouldSuppressGoalChildFailureCounter({ isGoalChild: true, terminal: "failed", tcrCount: 0 })).toBe(true);
    expect(shouldSuppressGoalChildFailureCounter({ isGoalChild: true, terminal: "blocked", tcrCount: 0 })).toBe(true);
    expect(shouldSuppressGoalChildFailureCounter({ isGoalChild: true, terminal: "failed", tcrCount: 1 })).toBe(false);
    expect(shouldSuppressGoalChildFailureCounter({ isGoalChild: false, terminal: "failed", tcrCount: 0 })).toBe(false);
  });

  it("readExternalBlock — FIX-363: attributes a failed cycle to a reviewer auth/network block", () => {
    const dir = mkdtempSync(join(tmpdir(), "roll-extblock-"));
    const ev = join(dir, "events.ndjson");
    const w = (o: object): void => appendFileSync(ev, `${JSON.stringify(o)}\n`, "utf8");
    writeFileSync(ev, "", "utf8");
    // unrelated events + a block for a DIFFERENT cycle must be ignored
    w({ type: "pair:consult", cycleId: "c1", peer: "kimi", outcome: "timeout", ts: 1 });
    w({ type: "agent:blocked", cycleId: "other", agent: "claude", cause: "auth", stage: "review", detail: "403", ts: 2 });
    expect(readExternalBlock(ev, "c1")).toBeNull();

    // auth block for c1 → attributed auth (auth wins over network)
    w({ type: "agent:blocked", cycleId: "c1", agent: "codex", cause: "network", stage: "review", detail: "ENOTFOUND", ts: 3 });
    w({ type: "agent:blocked", cycleId: "c1", agent: "claude", cause: "auth", stage: "score", detail: "Please run /login", ts: 4 });
    const got = readExternalBlock(ev, "c1");
    expect(got?.cause).toBe("auth");
    expect(got?.agents).toContain("claude");

    // a missing events file is a safe null (never throws)
    expect(readExternalBlock(join(dir, "nope.ndjson"), "c1")).toBeNull();
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

  it("US-EVID-001: explicit runDir is exported to the child and overrides ambient ROLL_RUN_DIR", async () => {
    const dir = tmp("run-dir-env");
    const shim = join(dir, "claude");
    writeFileSync(
      shim,
      [
        "#!/bin/sh",
        "echo \"ROLL_RUN_DIR=$ROLL_RUN_DIR\"",
        "echo \"ROLL_EVIDENCE_DIR=$ROLL_EVIDENCE_DIR\"",
        "echo \"ROLL_SCREENSHOTS_DIR=$ROLL_SCREENSHOTS_DIR\"",
        "exit 0",
        "",
      ].join("\n"),
      "utf8",
    );
    chmodSync(shim, 0o755);
    const runDir = join(dir, "frame");
    const previous = process.env["ROLL_RUN_DIR"];
    process.env["ROLL_RUN_DIR"] = "/wrong/frame";
    try {
      const res = await realAgentSpawn("claude", {
        cwd: dir,
        skillBody: "x",
        bin: shim,
        runDir,
      });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain(`ROLL_RUN_DIR=${runDir}`);
      expect(res.stdout).toContain(`ROLL_EVIDENCE_DIR=${join(runDir, "evidence")}`);
      expect(res.stdout).toContain(`ROLL_SCREENSHOTS_DIR=${join(runDir, "screenshots")}`);
      expect(res.stdout).not.toContain("/wrong/frame");
    } finally {
      if (previous === undefined) delete process.env["ROLL_RUN_DIR"];
      else process.env["ROLL_RUN_DIR"] = previous;
    }
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

  it("falls back to ~/.roll/skills/ when project-local paths are absent (no-submodule project)", () => {
    const p = proj("global-fallback");
    const homeSkills = join(tmpdir(), `.roll-skill-test-${process.pid}`, ".roll", "skills", "roll-loop");
    execFileSync("mkdir", ["-p", homeSkills]);
    writeFileSync(join(homeSkills, "SKILL.md"), "# Loop\n\nglobal fallback body\n");
    const prevHome = process.env["HOME"];
    process.env["HOME"] = join(tmpdir(), `.roll-skill-test-${process.pid}`);
    try {
      expect(readSkillBody(p)).toBe("# Loop\n\nglobal fallback body");
    } finally {
      process.env["HOME"] = prevHome;
      try { execFileSync("rm", ["-rf", join(tmpdir(), `.roll-skill-test-${process.pid}`)]); } catch { /* ok */ }
    }
  });

  it("returns null when nothing resolves (no project files, no ~/.roll/skills)", () => {
    const prevHome = process.env["HOME"];
    process.env["HOME"] = join(tmpdir(), `.roll-skill-none-${process.pid}`);
    try {
      expect(readSkillBody(proj("none"))).toBeNull();
    } finally {
      process.env["HOME"] = prevHome;
    }
  });

  it("run-once refuses to start a cycle on a null skill body: rc=1 + ALERT, no lock/worktree", async () => {
    registerAll();
    const p = proj("refuse");
    execFileSync("git", ["init", "-q", p]);
    const rt = join(p, ".roll", "loop");
    const prevCwd = process.cwd();
    const prevRt = process.env["ROLL_PROJECT_RUNTIME_DIR"];
    const prevHome = process.env["HOME"];
    process.env["ROLL_PROJECT_RUNTIME_DIR"] = rt;
    // Isolate HOME so the new ~/.roll/skills/ fallback doesn't resolve
    // against the developer's real ~/.roll/skills/roll-loop/SKILL.md.
    process.env["HOME"] = join(tmpdir(), `.roll-skill-refuse-${process.pid}`);
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
      process.env["HOME"] = prevHome;
      if (prevRt === undefined) delete process.env["ROLL_PROJECT_RUNTIME_DIR"];
      else process.env["ROLL_PROJECT_RUNTIME_DIR"] = prevRt;
    }
    // The network guard may block the cycle before the skill check. Older
    // egress-only paths say "egress blocked"; the shared guard says the command
    // needs the network. On a network-clear machine, the skill check fails with
    // "refusing to spawn a blind agent". All are valid early-exit paths.
    const blockedByEgress = err.includes("egress blocked") || err.includes("egress_blocked");
    const blockedByNetworkGuard = err.includes("needs the network") || err.includes("network unreachable");
    const blockedBySkill = err.includes("refusing to spawn a blind agent");
    expect(blockedByEgress || blockedByNetworkGuard || blockedBySkill).toBe(true);
    const { readFileSync: rf, existsSync: ex } = await import("node:fs");
    const { readdirSync: rds } = await import("node:fs");
    const alertFiles = rds(rt).filter((f) => f.startsWith("ALERT-") && f.endsWith(".md"));
    expect(alertFiles.length).toBe(1);
    const alertBody = rf(join(rt, alertFiles[0]), "utf8");
    const alertOk =
      alertBody.includes("SKILL.md not found") ||
      alertBody.includes("egress blocked") ||
      alertBody.includes("egress_blocked") ||
      alertBody.includes("needs the network") ||
      alertBody.includes("network unreachable");
    expect(alertOk).toBe(true);
    expect(ex(join(rt, "inner.lock"))).toBe(false);
    expect(ex(join(rt, "worktrees"))).toBe(false);
  });
});

describe("FIX-204D — signal teardown keeps I8 on the kill paths", () => {
  function teardownFixture(tag: string): {
    rt: string;
    paths: { eventsPath: string; runsPath: string; lockPath: string };
  } {
    const rt = tmp(`sig-${tag}`);
    return {
      rt,
      paths: {
        eventsPath: join(rt, "events.ndjson"),
        runsPath: join(rt, "runs.jsonl"),
        lockPath: join(rt, "inner.lock"),
      },
    };
  }

  it("owned lock: writes aborted cycle:end + runs row, releases the lock, kills agents, exit 143", async () => {
    const { cycleSignalTeardown } = await import("../src/commands/loop-run-once.js");
    const { paths: p } = teardownFixture("owned");
    writeFileSync(p.lockPath, `${process.pid}:1780680000\n`, "utf8");
    let exitCode = -1;
    let killed = 0;
    cycleSignalTeardown(p, "20260606-040000-9001", "loop/cycle-20260606-040000-9001", "SIGTERM", {
      killAgents: () => {
        killed += 1;
        return 1;
      },
      exit: (c) => {
        exitCode = c;
      },
      now: () => 1780680123,
    });
    expect(exitCode).toBe(143);
    expect(killed).toBe(1);
    const { readFileSync: rf, existsSync: ex } = await import("node:fs");
    const events = rf(p.eventsPath, "utf8");
    expect(events).toContain('"cycle:end"');
    expect(events).toContain("20260606-040000-9001");
    expect(events).toContain("aborted");
    const runs = rf(p.runsPath, "utf8");
    expect(runs).toContain('"status":"aborted"');
    expect(runs).toContain("20260606-040000-9001");
    expect(ex(p.lockPath)).toBe(false);
  });

  it("foreign lock (skip-on-contention path): touches NOTHING, still exits with the signal code", async () => {
    const { cycleSignalTeardown } = await import("../src/commands/loop-run-once.js");
    const { paths: p } = teardownFixture("foreign");
    writeFileSync(p.lockPath, `99999999:1780680000\n`, "utf8");
    let exitCode = -1;
    cycleSignalTeardown(p, "20260606-040000-9002", "loop/cycle-x", "SIGINT", {
      killAgents: () => 0,
      exit: (c) => {
        exitCode = c;
      },
    });
    expect(exitCode).toBe(130); // SIGINT = 128+2
    const { existsSync: ex } = await import("node:fs");
    expect(ex(p.eventsPath)).toBe(false);
    expect(ex(p.runsPath)).toBe(false);
    expect(ex(p.lockPath)).toBe(true); // the live owner's lock survives
  });

  it("SIGHUP maps to 129", async () => {
    const { cycleSignalTeardown } = await import("../src/commands/loop-run-once.js");
    const { paths: p } = teardownFixture("hup");
    let exitCode = -1;
    cycleSignalTeardown(p, "c", "b", "SIGHUP", { killAgents: () => 0, exit: (c) => { exitCode = c; } });
    expect(exitCode).toBe(129);
  });

  it("killLiveAgents reaps a hanging registered agent (registry path, no timeout involved)", async () => {
    const { killLiveAgents } = await import("../src/runner/index.js");
    const dir = tmp("reap");
    const shim = join(dir, "claude");
    writeFileSync(shim, "#!/bin/sh\nsleep 30\n", "utf8");
    chmodSync(shim, 0o755);
    const pending = realAgentSpawn("claude", { cwd: dir, skillBody: "x", bin: shim });
    await new Promise((r) => setTimeout(r, 300)); // let it spawn + register
    const n = killLiveAgents("SIGKILL");
    expect(n).toBe(1);
    const res = await pending;
    expect(res.exitCode).not.toBe(0); // killed, promise still settles
  });
});

describe("FIX-216 — auto-PAUSE on consecutive failures", () => {
  it("increments the failure counter + writes PAUSE marker at threshold", async () => {
    // Dynamically import fs functions not in the top-level imports.
    const { readFileSync: rf, existsSync: ex, mkdirSync: mks } =
      await import("node:fs");

    const p = tmp("consec-fail");
    execFileSync("git", ["init", "-q", p]);
    const rt = join(p, ".roll", "loop");
    mks(rt, { recursive: true });
    const counterFile = join(rt, "consecutive-fails");

    // Seed: 2 prior failures.
    writeFileSync(counterFile, "2", "utf8");

    // Force a deterministic slug so PAUSE-<slug> and ALERT-<slug>.md are predictable.
    const prevRt = process.env["ROLL_PROJECT_RUNTIME_DIR"];
    const prevSlug = process.env["ROLL_MAIN_SLUG"];
    process.env["ROLL_PROJECT_RUNTIME_DIR"] = rt;
    process.env["ROLL_MAIN_SLUG"] = "default";
    registerAll();

    // Suppress stderr noise.
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    const prevCwd = process.cwd();
    try {
      process.chdir(p);
      const r = await dispatch(["loop", "run-once"]);
      expect(r.status).toBe(1);
    } finally {
      process.stderr.write = write;
      process.chdir(prevCwd);
      if (prevRt === undefined) delete process.env["ROLL_PROJECT_RUNTIME_DIR"];
      else process.env["ROLL_PROJECT_RUNTIME_DIR"] = prevRt;
      if (prevSlug === undefined) delete process.env["ROLL_MAIN_SLUG"];
      else process.env["ROLL_MAIN_SLUG"] = prevSlug;
    }

    // FIX-232: the egress pre-check may block the cycle before the skill
    // check. If egress is blocked, the counter stays at 2 because the cycle
    // never reached the failure path. If egress is clear, the counter
    // increments to 3 and a PAUSE marker is written.
    const counterVal = rf(counterFile, "utf8").trim();
    const pauseMarker = join(p, ".roll", "loop", "PAUSE-default");
    if (counterVal === "2") {
      // Egress-blocked — cycle was refused before the failure path.
      // The counter stays at 2, no PAUSE marker.
      expect(ex(pauseMarker)).toBe(false);
    } else {
      expect(counterVal).toBe("3");
      expect(ex(pauseMarker)).toBe(true);
    }
    if (counterVal !== "2") {
      const body = rf(pauseMarker, "utf8");
      expect(body).toContain("# ALERT — loop auto-paused");
      expect(body).toContain("roll loop resume");
      const events = rf(join(rt, "events.ndjson"), "utf8");
      expect(events).toContain('"type":"policy:safety_pause"');
      expect(events).toContain('"type":"alert:notify"');
    }
  });

  it("honors policy.yaml max_consecutive_failures before PAUSE", async () => {
    const { existsSync: ex, mkdirSync: mks } = await import("node:fs");
    const p = tmp("consec-policy");
    execFileSync("git", ["init", "-q", p]);
    mks(join(p, ".roll", "loop"), { recursive: true });
    writeFileSync(join(p, ".roll", "policy.yaml"), "loop_safety:\n  max_consecutive_failures: 4\n");
    writeFileSync(join(p, ".roll", "loop", "consecutive-fails"), "2", "utf8");

    const prevRt = process.env["ROLL_PROJECT_RUNTIME_DIR"];
    const prevSlug = process.env["ROLL_MAIN_SLUG"];
    process.env["ROLL_PROJECT_RUNTIME_DIR"] = join(p, ".roll", "loop");
    process.env["ROLL_MAIN_SLUG"] = "default";
    registerAll();
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    const prevCwd = process.cwd();
    try {
      process.chdir(p);
      const r = await dispatch(["loop", "run-once"]);
      expect(r.status).toBe(1);
    } finally {
      process.stderr.write = write;
      process.chdir(prevCwd);
      if (prevRt === undefined) delete process.env["ROLL_PROJECT_RUNTIME_DIR"];
      else process.env["ROLL_PROJECT_RUNTIME_DIR"] = prevRt;
      if (prevSlug === undefined) delete process.env["ROLL_MAIN_SLUG"];
      else process.env["ROLL_MAIN_SLUG"] = prevSlug;
    }

    expect(ex(join(p, ".roll", "loop", "PAUSE-default"))).toBe(false);
  });
});

describe("FIX-223 — loop agent selection (tier routing vs local.yaml collapse)", () => {
  /** A project with both local.yaml `agent:` and per-tier agents.yaml. */
  function project(files: Record<string, string>): string {
    const p = tmp("route");
    mkdirSync(join(p, ".roll"), { recursive: true });
    for (const [name, body] of Object.entries(files)) writeFileSync(join(p, ".roll", name), body);
    return p;
  }

  const AGENTS_YAML = 'schema: v3\neasy: { agent: pi }\ndefault: { agent: pi }\nhard: { agent: claude }\nfallback: { agent: kimi }\n';

  it("agents.yaml tier slots win — local.yaml `agent:` must NOT collapse tiers", () => {
    const p = project({ "local.yaml": "agent: pi\n", "agents.yaml": AGENTS_YAML });
    const deps = buildLoopRouteDeps(p);
    expect(resolveRoute("hard", deps).agent).toBe("claude");
    expect(resolveRoute("easy", deps).agent).toBe("pi");
    expect(resolveRoute("default", deps).agent).toBe("pi");
  });

  it("ROLL_LOOP_AGENT is routing output, never a selection input", () => {
    const p = project({ "local.yaml": "agent: pi\n", "agents.yaml": AGENTS_YAML });
    const prev = process.env["ROLL_LOOP_AGENT"];
    process.env["ROLL_LOOP_AGENT"] = "deepseek";
    try {
      expect(resolveRoute("hard", buildLoopRouteDeps(p)).agent).toBe("claude");
    } finally {
      if (prev === undefined) delete process.env["ROLL_LOOP_AGENT"];
      else process.env["ROLL_LOOP_AGENT"] = prev;
    }
  });

  it("empty tier slot falls to the default slot", () => {
    const p = project({ "agents.yaml": "schema: v3\ndefault: { agent: kimi }\n" });
    const d = resolveRoute("hard", buildLoopRouteDeps(p));
    expect(d.agent).toBe("kimi");
  });

  it("no agents.yaml → local.yaml single-agent default (with router WARN)", () => {
    const p = project({ "local.yaml": "agent: pi\n" });
    const d = resolveRoute("hard", buildLoopRouteDeps(p));
    expect(d.agent).toBe("pi");
    expect(d.warning).toBeTruthy();
  });

  it("installed-agent scan actually probes PATH (missing binaries are skipped)", () => {
    const p = project({});
    const shim = tmp("shim");
    // Only a `kimi` executable exists on PATH; HOME is empty (no GUI agents).
    writeFileSync(join(shim, "kimi"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(shim, "kimi"), 0o755);
    const home = tmp("home");
    const prevPath = process.env["PATH"];
    const prevHome = process.env["HOME"];
    process.env["PATH"] = shim;
    process.env["HOME"] = home;
    try {
      expect(buildLoopRouteDeps(p).firstInstalled()).toBe("kimi");
      // Nothing installed at all → undefined (router then throws, like bash).
      process.env["PATH"] = home;
      expect(buildLoopRouteDeps(p).firstInstalled()).toBeUndefined();
    } finally {
      process.env["PATH"] = prevPath;
      if (prevHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = prevHome;
    }
  });
});

describe("IDEA-001 — offline degrade probe", () => {
  it("online: resolver succeeds → not offline", async () => {
    const { isOffline } = await import("../src/commands/loop-run-once.js");
    expect(await isOffline(() => Promise.resolve([{ address: "1.2.3.4" }]))).toBe(false);
  });
  it("offline: resolver rejects (ENOTFOUND) → offline", async () => {
    const { isOffline } = await import("../src/commands/loop-run-once.js");
    expect(await isOffline(() => Promise.reject(new Error("ENOTFOUND")))).toBe(true);
  });
  it("dead network: resolver hangs → 1.5s timeout → offline", async () => {
    const { isOffline } = await import("../src/commands/loop-run-once.js");
    const start = Date.now();
    expect(await isOffline(() => new Promise(() => {}))).toBe(true);
    expect(Date.now() - start).toBeLessThan(3000);
  });
});

describe("FIX-232 AC2 — egress pre-check", () => {
  it("DNS fails → offline, not proxy-poisoned (not blocked)", async () => {
    const { egressBlocked } = await import("../src/commands/loop-run-once.js");
    expect(
      await egressBlocked(() => Promise.reject(new Error("ENOTFOUND")))
    ).toBe(false);
  });

  it("resolver hangs → DNS timeout → offline (not blocked)", async () => {
    const { egressBlocked } = await import("../src/commands/loop-run-once.js");
    const start = Date.now();
    expect(
      await egressBlocked(() => new Promise(() => {}))
    ).toBe(false);
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it("non-darwin platform → skip egress check entirely (not blocked)", async () => {
    const { egressBlocked } = await import("../src/commands/loop-run-once.js");
    // Override platform to simulate Linux/Windows.
    const save = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      expect(await egressBlocked()).toBe(false);
    } finally {
      Object.defineProperty(process, "platform", { value: save, configurable: true });
    }
  });

  it("Darwin DNS ok + TCP probe ok → not blocked", async () => {
    const { egressBlocked } = await import("../src/commands/loop-run-once.js");
    const save = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    try {
      expect(
        await egressBlocked(
          () => Promise.resolve([{ address: "140.82.113.4" }]),
          () => Promise.resolve()
        )
      ).toBe(false);
    } finally {
      Object.defineProperty(process, "platform", { value: save, configurable: true });
    }
  });

  it("Darwin DNS ok + TCP probe fails → blocked", async () => {
    const { egressBlocked } = await import("../src/commands/loop-run-once.js");
    const save = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    try {
      expect(
        await egressBlocked(
          () => Promise.resolve([{ address: "140.82.113.4" }]),
          () => Promise.reject(new Error("ECONNREFUSED"))
        )
      ).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", { value: save, configurable: true });
    }
  });

  it("on Darwin with real DNS resolve → returns boolean (best-effort probe)", async () => {
    // This test verifies the code path runs without throwing. The result
    // depends on actual network state: github.com:443 reachable → false;
    // unreachable → true. Both are valid — the probe is best-effort.
    if (process.platform !== "darwin") return;
    const { egressBlocked } = await import("../src/commands/loop-run-once.js");
    const result = await egressBlocked();
    expect(typeof result).toBe("boolean");
  });
});

describe("announceReport — card-layout report surface (US-META-002c follow-through)", () => {
  it("finds the report in the card folder and announces it", async () => {
    const { announceReport } = await import("../src/commands/loop-run-once.js");
    const p = tmp("announce");
    const dir = join(p, ".roll", "features", "uncategorized", "FIX-9", "latest");
    execFileSync("mkdir", ["-p", dir]);
    writeFileSync(join(dir, "FIX-9-report.html"), "<html></html>");
    const opened: string[] = [];
    // mute flag absent → opener fires; capture instead of really opening.
    const w = process.stdout.write.bind(process.stdout);
    let out = "";
    // @ts-expect-error capture-only
    process.stdout.write = (s: string): boolean => ((out += String(s)), true);
    let got: string | null;
    try {
      got = announceReport(p, "slug-x", "FIX-9", (path) => opened.push(path));
    } finally {
      process.stdout.write = w;
    }
    expect(got).toContain(join("features", "uncategorized", "FIX-9", "latest", "FIX-9-report.html"));
    expect(out).toContain("验收报告");
    expect(opened).toHaveLength(1);
  });
  it("no report anywhere → null, no announcement", async () => {
    const { announceReport } = await import("../src/commands/loop-run-once.js");
    expect(announceReport(tmp("announce-none"), "slug-x", "FIX-9", () => {})).toBeNull();
  });
});
