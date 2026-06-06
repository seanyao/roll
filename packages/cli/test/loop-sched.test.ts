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
import type { LaunchctlResult } from "@roll/infra";

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
        isLoaded: (uid, label) => {
          calls.push(`isLoaded ${uid} ${label}`);
          return Promise.resolve(true);
        },
      },
    },
  };
}

/**
 * FIX-212 fake: reinstall fails for the first `failBefore[label]` attempts, and
 * `isLoaded` reports loaded only once that label has been (re)installed past its
 * failing attempts. Mirrors the bootout+bootstrap race (FIX-027/098) where the
 * job silently does not mount.
 */
function fakeFlakyDeps(
  proj: string,
  shared: string,
  launchdDir: string,
  failBefore: Record<string, number>,
): { deps: LoopSchedDeps; attempts: Record<string, number> } {
  const attempts: Record<string, number> = {};
  return {
    attempts,
    deps: {
      identity: () => Promise.resolve({ path: proj, slug: "proj-abc123" }),
      uid: () => 501,
      sharedRoot: () => shared,
      launchdDir: () => launchdDir,
      launchd: {
        reinstall: (_uid, label) => {
          attempts[label] = (attempts[label] ?? 0) + 1;
          const fails = (failBefore[label] ?? 0) >= attempts[label];
          return Promise.resolve({
            code: fails ? 5 : 0,
            stdout: "",
            stderr: fails ? `Bootstrap failed: 5: Input/output error` : "",
          });
        },
        uninstall: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
        isLoaded: (_uid, label) =>
          Promise.resolve((attempts[label] ?? 0) > (failBefore[label] ?? 0)),
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

function captureBoth(
  fn: () => Promise<number>,
): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (out.push(String(c)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (c: string | Uint8Array): boolean => (err.push(String(c)), true);
  return fn()
    .then((code) => ({ code, out: out.join(""), err: err.join("") }))
    .finally(() => {
      process.stdout.write = realOut;
      process.stderr.write = realErr;
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
      // These cases assert the DIRECT-run contract — pin the FIX-204E opt-out
      // so a tmux on the host PATH can't hijack the sandbox.
      ROLL_LOOP_NO_TMUX: "1",
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

describe("FIX-212 — loop on verifies the mount & fails loud", () => {
  function project(): { proj: string; shared: string; ld: string } {
    const proj = tmp("f212");
    mkdirSync(join(proj, ".roll"), { recursive: true });
    writeFileSync(join(proj, ".roll", "local.yaml"), "loop_schedule:\n  period_minutes: 30\n");
    return { proj, shared: tmp("f212sh"), ld: tmp("f212ld") };
  }

  it("AC1: bootstrap failing persistently → non-zero exit naming the failed label", async () => {
    const { proj, shared, ld } = project();
    // loop label never mounts (race never resolves); pr mounts fine.
    const { deps } = fakeFlakyDeps(proj, shared, ld, { "com.roll.loop.proj-abc123": 99 });
    const { code, err } = await captureBoth(() => loopOnCommand([], deps));
    expect(code).not.toBe(0);
    expect(err).toContain("com.roll.loop.proj-abc123");
    expect(err.toLowerCase()).toContain("mount"); // EN error
    expect(err).toContain("挂载"); // ZH error
  });

  it("AC3: a transient bootstrap failure recovers on the single retry → exit 0", async () => {
    const { proj, shared, ld } = project();
    // both labels fail their first attempt, succeed on the retry.
    const { deps, attempts } = fakeFlakyDeps(proj, shared, ld, {
      "com.roll.loop.proj-abc123": 1,
      "com.roll.pr.proj-abc123": 1,
    });
    const { code } = await captureBoth(() => loopOnCommand([], deps));
    expect(code).toBe(0);
    expect(attempts["com.roll.loop.proj-abc123"]).toBe(2); // one retry, no more
    expect(attempts["com.roll.pr.proj-abc123"]).toBe(2);
  });

  it("does NOT retry more than once — a third attempt is never made", async () => {
    const { proj, shared, ld } = project();
    const { deps, attempts } = fakeFlakyDeps(proj, shared, ld, { "com.roll.loop.proj-abc123": 99 });
    await captureBoth(() => loopOnCommand([], deps));
    expect(attempts["com.roll.loop.proj-abc123"]).toBe(2); // initial + 1 retry, capped
  });

  it("AC2: success path output carries the verified-mount evidence for both labels", async () => {
    const proj = tmp("f212ok");
    mkdirSync(join(proj, ".roll"), { recursive: true });
    writeFileSync(join(proj, ".roll", "local.yaml"), "loop_schedule:\n  period_minutes: 30\n");
    const { deps, calls } = fakeDeps(proj, tmp("f212oksh"), tmp("f212okld"));
    const { code, out } = await captureBoth(() => loopOnCommand([], deps));
    expect(code).toBe(0);
    // evidence line (bilingual) + the two verified labels
    expect(out).toContain("已验证挂载");
    expect(out.toLowerCase()).toContain("verified");
    expect(out).toContain("com.roll.loop.proj-abc123");
    expect(out).toContain("com.roll.pr.proj-abc123");
    // the mount was actually probed, not assumed
    expect(calls.some((c) => c.startsWith("isLoaded 501 com.roll.loop.proj-abc123"))).toBe(true);
    expect(calls.some((c) => c.startsWith("isLoaded 501 com.roll.pr.proj-abc123"))).toBe(true);
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

  it("isLegacyRunner: bare-engine calls, non-run-once wrappers AND tmux-less v3 runners are legacy", () => {
    expect(isLegacyRunner('#!/bin/bash -l\n_loop_migrate_legacy_paths "x"\n')).toBe(true);
    expect(isLegacyRunner("#!/bin/bash\nsomething else entirely\n")).toBe(true);
    // FIX-204E: a pre-observation-window v3 runner regenerates too
    expect(isLegacyRunner('#!/bin/bash -l\n"$ROLL_BIN" loop run-once >> "$LOG" 2>&1\n')).toBe(true);
    expect(isLegacyRunner(buildLoopRunnerScript({ projectPath: "/p", slug: "x", activeStart: 0, activeEnd: 24 }))).toBe(false);
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
    writeFileSync(runner, buildLoopRunnerScript({ projectPath: proj, slug: "proj-abc123", activeStart: 0, activeEnd: 24 }), { mode: 0o755 });

    const { code, out } = await captureStdout(() => loopNowCommand([], deps));
    expect(code).toBe(7);
    expect(out).not.toContain("FIX-197");
    expect(calls).toHaveLength(0);
  });
});

describe("FIX-204E — tmux observation window in the runner template", () => {
  const s = buildLoopRunnerScript({ projectPath: "/p", slug: "s9", activeStart: 0, activeEnd: 24 });

  it("wraps the cycle into tmux session roll-loop-<slug> with a live.log watch window", () => {
    expect(s).toContain('_sess="roll-loop-s9"');
    expect(s).toContain('"$TMUX_BIN" has-session');
    expect(s).toContain('"$TMUX_BIN" new-session -d -s');
    expect(s).toContain("-x 200 -y 50"); // v2 oracle geometry
    expect(s).toContain("tail -n +1 -F '$RT/live.log'");
    expect(s).toContain('"$TMUX_BIN" new-window -d');
    expect(s).toContain("ROLL_TMUX_WRAPPED=1");
  });

  it("US-PORT-012: pipes the live.log tail through `roll loop fmt` (three-tier window)", () => {
    // the raw stream still lands in live.log upstream (AC3); the WATCH window
    // tails it through the formatter so the pane shows key nodes, not raw JSON.
    expect(s).toMatch(/tail -n \+1 -F '\$RT\/live\.log' \| '\$ROLL_BIN' loop fmt/);
  });

  it("the wrap precedes caffeinate AND the cycle invocation; guards allow opt-out + re-entry", () => {
    expect(s.indexOf("new-window")).toBeLessThan(s.indexOf("caffeinate"));
    expect(s.indexOf("new-window")).toBeLessThan(s.indexOf('loop run-once >>'));
    expect(s).toContain('[ -z "$ROLL_TMUX_WRAPPED" ]');
    expect(s).toContain('[ -z "$ROLL_LOOP_NO_TMUX" ]');
    expect(s).toContain('command -v "$TMUX_BIN"');
    // PAUSE short-circuits BEFORE any tmux session is spawned
    expect(s.indexOf("PAUSE-s9")).toBeLessThan(s.indexOf("has-session"));
  });

  it("generation-time rollBin override is baked verbatim", () => {
    const o = buildLoopRunnerScript({ projectPath: "/p", slug: "s9", activeStart: 0, activeEnd: 24, rollBin: "/dev/roll-cli.js" });
    expect(o).toContain('ROLL_BIN="${ROLL_BIN:-/dev/roll-cli.js}"');
  });
});

describe("FIX-204E — tmux path EXECUTION in a sandbox", () => {
  function tmuxSandbox(opts: { hasSession?: boolean } = {}): {
    dir: string;
    rollArgv: string;
    tmuxArgv: string;
  } {
    const dir = tmp("tmuxsb");
    const rollArgv = join(dir, "roll-argv.log");
    const tmuxArgv = join(dir, "tmux-argv.log");
    writeFileSync(join(dir, "roll"), `#!/bin/sh\necho "$@" >> "${rollArgv}"\nexit 0\n`, { mode: 0o755 });
    // fake tmux: records argv; has-session reflects the fixture's wish
    writeFileSync(
      join(dir, "tmux"),
      `#!/bin/sh\necho "$@" >> "${tmuxArgv}"\ncase "$1" in has-session) exit ${opts.hasSession === true ? 0 : 1} ;; esac\nexit 0\n`,
      { mode: 0o755 },
    );
    return { dir, rollArgv, tmuxArgv };
  }

  function runOuter(
    proj: string,
    slug: string,
    sb: { dir: string },
    env: Record<string, string> = {},
  ): number {
    const script = buildLoopRunnerScript({ projectPath: proj, slug, activeStart: 0, activeEnd: 24 });
    const sp = join(sb.dir, "runner.sh");
    writeFileSync(sp, script, { mode: 0o755 });
    const r = execSync(`bash '${sp}'; echo rc=$?`, {
      // ROLL_TMUX_BIN pins the SHIM — the template's PATH bootstrap prepends
      // brew dirs, which would shadow the sandbox with the real tmux.
      env: {
        PATH: `${sb.dir}:/usr/bin:/bin`,
        HOME: proj,
        ROLL_BIN: join(sb.dir, "roll"),
        ROLL_TMUX_BIN: join(sb.dir, "tmux"),
        ...env,
      },
      encoding: "utf8",
    });
    return Number(/rc=(\d+)/.exec(r)?.[1] ?? "1");
  }

  it("outer invocation dispatches into tmux (session + window) and does NOT run the cycle itself", () => {
    const proj = tmp("tmux1");
    const sb = tmuxSandbox();
    const rc = runOuter(proj, "t1", sb);
    expect(rc).toBe(0);
    expect(existsSync(sb.rollArgv)).toBe(false); // no direct run
    const calls = readFileSync(sb.tmuxArgv, "utf8");
    expect(calls).toContain("has-session");
    expect(calls).toContain("new-session -d -s roll-loop-t1");
    expect(calls).toContain("new-window -d -t roll-loop-t1");
    expect(calls).toContain("ROLL_TMUX_WRAPPED=1");
    // the cycle log stays untouched — the WRAPPED run owns it
    expect(existsSync(join(proj, ".roll", "loop", "cron.log"))).toBe(false);
  });

  it("existing session → no second new-session, still a new cycle window", () => {
    const proj = tmp("tmux2");
    const sb = tmuxSandbox({ hasSession: true });
    runOuter(proj, "t2", sb);
    const calls = readFileSync(sb.tmuxArgv, "utf8");
    expect(calls).not.toContain("new-session");
    expect(calls).toContain("new-window -d -t roll-loop-t2");
  });

  it("ROLL_TMUX_WRAPPED=1 (inside the window) runs the cycle directly", () => {
    const proj = tmp("tmux3");
    const sb = tmuxSandbox();
    const rc = runOuter(proj, "t3", sb, { ROLL_TMUX_WRAPPED: "1" });
    expect(rc).toBe(0);
    expect(readFileSync(sb.rollArgv, "utf8").trim()).toBe("loop run-once");
    expect(readFileSync(join(proj, ".roll", "loop", "cron.log"), "utf8")).toContain("cycle end rc=0");
    expect(existsSync(sb.tmuxArgv)).toBe(false); // no tmux calls in the wrapped run
  });

  it("ROLL_LOOP_NO_TMUX=1 opts out — direct run even with tmux present", () => {
    const proj = tmp("tmux4");
    const sb = tmuxSandbox();
    const rc = runOuter(proj, "t4", sb, { ROLL_LOOP_NO_TMUX: "1" });
    expect(rc).toBe(0);
    expect(readFileSync(sb.rollArgv, "utf8").trim()).toBe("loop run-once");
    expect(existsSync(sb.tmuxArgv)).toBe(false);
  });
});

describe("FIX-204E — loop now UX branches (injected deps)", () => {
  async function nowWith(hasTmux: boolean, observeSpy: { called: number }): Promise<{ code: number; out: string }> {
    const proj = tmp("nowux");
    const shared = tmp("nowuxsh");
    const { deps } = fakeDeps(proj, shared, tmp("nowuxld"));
    deps.execRunner = (): Promise<number> => Promise.resolve(0);
    deps.hasTmux = (): boolean => hasTmux;
    deps.observe = (): Promise<void> => {
      observeSpy.called += 1;
      return Promise.resolve();
    };
    const runner = join(shared, "loop", "run-proj-abc123.sh");
    mkdirSync(join(shared, "loop"), { recursive: true });
    writeFileSync(runner, buildLoopRunnerScript({ projectPath: proj, slug: "proj-abc123", activeStart: 0, activeEnd: 24 }), { mode: 0o755 });
    const { loopNowCommand } = await import("../src/commands/loop-sched.js");
    return captureStdout(() => loopNowCommand([], deps));
  }

  it("tmux available: prints the attach hint and observes until the cycle ends", async () => {
    const spy = { called: 0 };
    const { code, out } = await nowWith(true, spy);
    expect(code).toBe(0);
    expect(out).toContain("tmux attach -t roll-loop-proj-abc123");
    expect(out).toContain("Ctrl-C");
    expect(spy.called).toBe(1);
    expect(out).toContain("cycle finished");
  });

  it("no tmux: inline message, no observation pass", async () => {
    const spy = { called: 0 };
    const { code, out } = await nowWith(false, spy);
    expect(code).toBe(0);
    expect(out).toContain("no tmux");
    expect(spy.called).toBe(0);
  });
});
