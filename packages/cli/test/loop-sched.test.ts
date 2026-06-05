/**
 * US-LOOP-009 — `roll loop on|off|pause|resume` (TS scheduling surface) and the
 * v3 runner template that replaces the v2 bash inner as the cycle heart.
 *
 * DELIBERATE v2 DIVERGENCE (whitelisted, see AGENTS.md bridge table): the v2
 * outer/inner pair (tmux popup, baked agent argv, engine sourcing) is replaced
 * by a self-contained wrapper that delegates the whole cycle to
 * `roll loop run-once`. No difftest applies — these tests pin the NEW contract:
 *   - runner template: self-contained (no bash-engine function calls — the
 *     FIX-197 family bug), honors PAUSE marker, active window, ROLL_LOOP_FORCE,
 *     logs to .roll/loop/cron.log, delegates to `loop run-once`.
 *   - pr runner template: transcribed v2 shape (lock + _loop_pr_inbox drive).
 *   - on/off: plist install/uninstall via injected launchd ops (no real
 *     launchctl in tests), dream service left untouched (FIX-197 lineage).
 *   - pause/resume: PAUSE-<slug> marker file under <project>/.roll/loop/.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildLoopRunnerScript,
  buildPrRunnerScript,
  parseLoopPeriodMinutes,
  loopOnCommand,
  loopOffCommand,
  loopPauseCommand,
  loopResumeCommand,
  type LoopSchedDeps,
} from "../src/commands/loop-sched.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function tmp(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `roll-sched-${tag}-`)));
  dirs.push(d);
  return d;
}

/** Deps fake: records launchd ops, pins identity/paths to a sandbox. */
function fakeDeps(proj: string, shared: string, launchdDir: string): {
  deps: LoopSchedDeps;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      identity: () => Promise.resolve({ path: proj, slug: "proj-abc123" }),
      uid: () => 501,
      sharedRoot: () => shared,
      launchdDir: () => launchdDir,
      launchd: {
        reinstall: (uid, label, plist) => {
          calls.push(`reinstall ${uid} ${label} ${plist}`);
          return Promise.resolve({ code: 0, stdout: "", stderr: "" });
        },
        uninstall: (uid, label) => {
          calls.push(`uninstall ${uid} ${label}`);
          return Promise.resolve({ code: 0, stdout: "", stderr: "" });
        },
      },
    },
  };
}

function captureStdout(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const real = process.stdout.write.bind(process.stdout);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (chunks.push(String(c)), true);
  return fn()
    .then((code) => ({ code, out: chunks.join("") }))
    .finally(() => {
      process.stdout.write = real;
    });
}

describe("v3 loop runner template", () => {
  const script = buildLoopRunnerScript({
    projectPath: "/Users/u/proj",
    slug: "proj-abc123",
    activeStart: 0,
    activeEnd: 24,
  });

  it("delegates the cycle to `roll loop run-once` (the v3 heart)", () => {
    expect(script).toContain("loop run-once");
    expect(script).toContain('cd "/Users/u/proj"');
  });

  it("is self-contained — calls NO bash-engine functions (FIX-197 family)", () => {
    expect(script).not.toMatch(/_loop_migrate|_agents_migrate|_loop_runtime_dir|_loop_cycle_agent_cmd/);
    expect(script).not.toContain("source ");
  });

  it("honors the PAUSE marker before any work", () => {
    expect(script).toContain("PAUSE-proj-abc123");
    const pauseIdx = script.indexOf("PAUSE-proj-abc123");
    const runIdx = script.indexOf('"$ROLL_BIN" loop run-once'); // the invocation, not the comment
    expect(pauseIdx).toBeGreaterThan(-1);
    expect(pauseIdx).toBeLessThan(runIdx);
  });

  it("enforces the active window but lets ROLL_LOOP_FORCE bypass it", () => {
    expect(script).toContain("ROLL_LOOP_FORCE");
    const s = buildLoopRunnerScript({ projectPath: "/p", slug: "s", activeStart: 9, activeEnd: 18 });
    expect(s).toContain("-lt 9");
    expect(s).toContain("-ge 18");
  });

  it("logs to the project-local cron.log and keeps the box awake", () => {
    expect(script).toContain('RT="/Users/u/proj/.roll/loop"');
    expect(script).toContain('LOG="$RT/cron.log"');
    expect(script).toContain("caffeinate");
  });

  it("resolves the roll binary from PATH with a brew fallback", () => {
    expect(script).toMatch(/command -v roll/);
  });
});

describe("v3 loop runner — EXECUTION in a sandbox (the contract that matters)", () => {
  /** Build a shim dir: fake `roll` records argv; `date` reports a fixed hour. */
  function shimDir(hour: string): { dir: string; argvLog: string } {
    const dir = tmp("shim");
    const argvLog = join(dir, "roll-argv.log");
    writeFileSync(join(dir, "roll"), `#!/bin/sh\necho "$@" >> "${argvLog}"\nexit 0\n`, { mode: 0o755 });
    writeFileSync(join(dir, "date"), `#!/bin/sh\ncase "$1" in +%H) echo ${hour} ;; *) /bin/date "$@" ;; esac\n`, {
      mode: 0o755,
    });
    return { dir, argvLog };
  }

  function runScript(proj: string, slug: string, hour: string, opts: { start?: number; end?: number; force?: string } = {}): {
    status: number;
    argvLog: string;
  } {
    const { dir, argvLog } = shimDir(hour);
    const script = buildLoopRunnerScript({
      projectPath: proj,
      slug,
      activeStart: opts.start ?? 0,
      activeEnd: opts.end ?? 24,
    });
    const sp = join(dir, "runner.sh");
    writeFileSync(sp, script, { mode: 0o755 });
    const env: Record<string, string> = {
      PATH: `${dir}:/usr/bin:/bin`,
      HOME: proj,
      // The template's PATH bootstrap prepends brew dirs, which would shadow
      // the shim with a REAL installed roll — pin via the ROLL_BIN override
      // (a supported contract: launchd env / operators may set it too).
      ROLL_BIN: join(dir, "roll"),
      ...(opts.force !== undefined ? { ROLL_LOOP_FORCE: opts.force } : {}),
    };
    const r = execSync(`bash '${sp}'; echo rc=$?`, { env, encoding: "utf8" });
    return { status: Number(/rc=(\d+)/.exec(r)?.[1] ?? "1"), argvLog };
  }

  it("really invokes `roll loop run-once` and logs the cycle", () => {
    const proj = tmp("exec1");
    const { status, argvLog } = runScript(proj, "s1", "12");
    expect(status).toBe(0);
    expect(readFileSync(argvLog, "utf8").trim()).toBe("loop run-once");
    const log = readFileSync(join(proj, ".roll", "loop", "cron.log"), "utf8");
    expect(log).toContain("cycle start (v3 run-once)");
    expect(log).toContain("cycle end rc=0");
  });

  it("PAUSE marker short-circuits before any invocation", () => {
    const proj = tmp("exec2");
    mkdirSync(join(proj, ".roll", "loop"), { recursive: true });
    writeFileSync(join(proj, ".roll", "loop", "PAUSE-s2"), "paused\n");
    const { status, argvLog } = runScript(proj, "s2", "12");
    expect(status).toBe(0);
    expect(existsSync(argvLog)).toBe(false);
  });

  it("hour 08 inside an [8,9) window RUNS — the v2 octal printf bug is fixed", () => {
    const proj = tmp("exec3");
    const { argvLog } = runScript(proj, "s3", "08", { start: 8, end: 9 });
    expect(existsSync(argvLog)).toBe(true); // v2's printf %d "08" → 0 → wrongly skipped
  });

  it("outside the window exits silently; ROLL_LOOP_FORCE bypasses", () => {
    const proj = tmp("exec4");
    const a = runScript(proj, "s4", "20", { start: 9, end: 18 });
    expect(existsSync(a.argvLog)).toBe(false);
    const b = runScript(proj, "s4", "20", { start: 9, end: 18, force: "1" });
    expect(existsSync(b.argvLog)).toBe(true);
  });
});

describe("pr runner template (transcribed v2 shape)", () => {
  const script = buildPrRunnerScript({
    projectPath: "/Users/u/proj",
    rollBin: "/opt/homebrew/lib/node_modules/@seanyao/roll/bin/roll",
  });

  it("drives _loop_pr_inbox through the bash engine with a single-flight lock", () => {
    expect(script).toContain("_loop_pr_inbox");
    expect(script).toContain(".pr-loop.lock");
    expect(script).toContain("900"); // 15-min staleness self-heal
    expect(script).toContain("/Users/u/proj/.roll/loop/pr.log");
  });
});

describe("parseLoopPeriodMinutes", () => {
  it("reads loop_schedule.period_minutes from local.yaml text", () => {
    expect(parseLoopPeriodMinutes("loop_schedule:\n  period_minutes: 30\n  offset_minute: 7\n")).toBe(30);
  });
  it("falls back to 30 on missing/malformed", () => {
    expect(parseLoopPeriodMinutes("")).toBe(30);
    expect(parseLoopPeriodMinutes("loop_schedule:\n  period_minutes: abc\n")).toBe(30);
    expect(parseLoopPeriodMinutes("agent: kimi\n")).toBe(30);
  });
});

describe("loop on/off (injected launchd)", () => {
  it("on: writes loop+pr runners & plists, reinstalls both labels, skips dream", async () => {
    const proj = tmp("proj");
    mkdirSync(join(proj, ".roll"), { recursive: true });
    writeFileSync(join(proj, ".roll", "local.yaml"), "loop_schedule:\n  period_minutes: 30\n");
    const shared = tmp("shared");
    const ld = tmp("launchd");
    const { deps, calls } = fakeDeps(proj, shared, ld);

    const { code, out } = await captureStdout(() => loopOnCommand([], deps));
    expect(code).toBe(0);

    const loopRunner = join(shared, "loop", "run-proj-abc123.sh");
    const prRunner = join(shared, "pr", "run-proj-abc123.sh");
    expect(existsSync(loopRunner)).toBe(true);
    expect(existsSync(prRunner)).toBe(true);
    expect(readFileSync(loopRunner, "utf8")).toContain("loop run-once");
    expect(existsSync(join(ld, "com.roll.loop.proj-abc123.plist"))).toBe(true);
    expect(existsSync(join(ld, "com.roll.pr.proj-abc123.plist"))).toBe(true);
    const plist = readFileSync(join(ld, "com.roll.loop.proj-abc123.plist"), "utf8");
    expect(plist).toContain("<integer>1800</integer>"); // 30min × 60

    expect(calls.some((c) => c.startsWith("reinstall 501 com.roll.loop.proj-abc123"))).toBe(true);
    expect(calls.some((c) => c.startsWith("reinstall 501 com.roll.pr.proj-abc123"))).toBe(true);
    expect(calls.some((c) => c.includes("dream"))).toBe(false); // FIX-197 lineage: untouched

    expect(out).toContain("Loop enabled");
    expect(out).toContain("run-once"); // the new heart is stated
  });

  it("off: boots out loop+dream+pr labels", async () => {
    const proj = tmp("proj2");
    const { deps, calls } = fakeDeps(proj, tmp("sh2"), tmp("ld2"));
    const { code } = await captureStdout(() => loopOffCommand([], deps));
    expect(code).toBe(0);
    expect(calls).toContain("uninstall 501 com.roll.loop.proj-abc123");
    expect(calls).toContain("uninstall 501 com.roll.dream.proj-abc123");
    expect(calls).toContain("uninstall 501 com.roll.pr.proj-abc123");
  });
});

describe("loop pause/resume (marker file)", () => {
  it("pause writes PAUSE-<slug> under .roll/loop, resume removes it", async () => {
    const proj = tmp("proj3");
    const { deps } = fakeDeps(proj, tmp("sh3"), tmp("ld3"));
    const marker = join(proj, ".roll", "loop", "PAUSE-proj-abc123");

    const p = await captureStdout(() => loopPauseCommand([], deps));
    expect(p.code).toBe(0);
    expect(existsSync(marker)).toBe(true);

    const p2 = await captureStdout(() => loopPauseCommand([], deps));
    expect(p2.code).toBe(0); // idempotent

    const r = await captureStdout(() => loopResumeCommand([], deps));
    expect(r.code).toBe(0);
    expect(existsSync(marker)).toBe(false);

    const r2 = await captureStdout(() => loopResumeCommand([], deps));
    expect(r2.code).toBe(0); // idempotent
  });
});

describe("FIX-197 — loop now legacy self-heal", async () => {
  const { isLegacyRunner, loopNowCommand } = await import("../src/commands/loop-sched.js");

  it("isLegacyRunner: bare-engine-call templates and non-run-once wrappers are legacy", () => {
    expect(isLegacyRunner('#!/bin/bash -l\n_loop_migrate_legacy_paths "x"\n')).toBe(true);
    expect(isLegacyRunner("#!/bin/bash\nsomething else entirely\n")).toBe(true);
    expect(isLegacyRunner('#!/bin/bash -l\n"$ROLL_BIN" loop run-once >> "$LOG" 2>&1\n')).toBe(false);
  });

  it("legacy runner → regenerated via loop on, then executed with the v3 template", async () => {
    const proj = tmp("nowproj");
    const shared = tmp("nowshared");
    const ld = tmp("nowld");
    const { deps, calls } = fakeDeps(proj, shared, ld);
    const execed: string[] = [];
    deps.execRunner = (p): Promise<number> => {
      execed.push(readFileSync(p, "utf8").includes("loop run-once") ? "v3" : "legacy");
      return Promise.resolve(0);
    };
    const runner = join(shared, "loop", "run-proj-abc123.sh");
    mkdirSync(join(shared, "loop"), { recursive: true });
    writeFileSync(runner, '#!/bin/bash -l\n_loop_migrate_legacy_paths "proj-abc123"\n', { mode: 0o755 });

    const { code, out } = await captureStdout(() => loopNowCommand([], deps));
    expect(code).toBe(0);
    expect(out).toContain("FIX-197");
    expect(execed).toEqual(["v3"]); // regenerated BEFORE execution
    expect(calls.some((c) => c.startsWith("reinstall 501 com.roll.loop"))).toBe(true);
  });

  it("fresh v3 runner → no regeneration, straight exec; rc propagates", async () => {
    const proj = tmp("nowproj2");
    const shared = tmp("nowshared2");
    const { deps, calls } = fakeDeps(proj, shared, tmp("nowld2"));
    deps.execRunner = (): Promise<number> => Promise.resolve(7);
    const runner = join(shared, "loop", "run-proj-abc123.sh");
    mkdirSync(join(shared, "loop"), { recursive: true });
    writeFileSync(runner, '#!/bin/bash -l\n"$ROLL_BIN" loop run-once >> "$LOG" 2>&1\n', { mode: 0o755 });

    const { code, out } = await captureStdout(() => loopNowCommand([], deps));
    expect(code).toBe(7);
    expect(out).not.toContain("FIX-197");
    expect(calls).toHaveLength(0);
  });
});

describe("US-PORT-011 — observation window in the runner template", () => {
  const s = buildLoopRunnerScript({ projectPath: "/p", slug: "s9", activeStart: 0, activeEnd: 24 });

  it("pops a Terminal tail of live.log only when unmuted, before the cycle", () => {
    expect(s).toContain('mute-s9');
    expect(s).toContain("osascript");
    expect(s).toContain("live.log");
    expect(s.indexOf("osascript")).toBeLessThan(s.indexOf('loop run-once >>'));
    // both mute flags gate the popup
    expect(s).toContain('MUTE1="$RT/mute-s9"');
    expect(s).toContain('loop/mute-s9');
  });

  it("generation-time rollBin override is baked verbatim", () => {
    const o = buildLoopRunnerScript({ projectPath: "/p", slug: "s9", activeStart: 0, activeEnd: 24, rollBin: "/dev/roll-cli.js" });
    expect(o).toContain('ROLL_BIN="${ROLL_BIN:-/dev/roll-cli.js}"');
  });
});
