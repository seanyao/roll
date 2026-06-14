/**
 * Unit tests for the runner adapter's pure-ish surface: the agent-spawn argv
 * construction (mirrors v2 _agent_argv + loop enhancements), the command→executor
 * dispatch (every CycleCommand kind, via fully faked Ports), the v2-shaped runs
 * row builder, and the dry-run plan. No real git / gh / agent — pure fakes.
 */
import { execFileSync, execSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { CycleCommand, CycleContext, RollEvent } from "@roll/core";
import {
  AGENT_ARGV_TODO,
  AUTORUN_DIRECTIVE,
  type Ports,
  bootstrapWorktreeDeps,
  bootstrapWorktreeSkills,
  buildClaudeArgv,
  buildRunRow,
  buildSpawnCommand,
  buildTerminalRecord,
  dryRunPlan,
  executeCommand,
  parseEstMin,
  realAgentSpawn,
  RESUME_DISABLED_ENV,
  resolveResumeBase,
  revertPrematureDone,
  withPtyWrap,
} from "../src/runner/index.js";

/** Temp dirs created by FIX-207 attest-gate executor tests; cleaned at end. */
const execDirs: string[] = [];
afterAll(() => {
  for (const d of execDirs) execSync(`rm -rf '${d}'`);
});

const CTX: CycleContext = {
  cycleId: "20260605-000000-1",
  branch: "loop/cycle-20260605-000000-1",
  loop: "ci" as never,
  storyId: "US-RUN-001",
  agent: "claude",
  model: "",
};

describe("buildClaudeArgv — v2 flag set, fixed arg order", () => {
  it("binds the prompt to -p (v2's prompt-after---add-dir order is a live bug vs claude ≥2.1.x)", () => {
    const { bin, args } = buildClaudeArgv({ worktree: "/wt", skillBody: "DO WORK", bin: "claude" });
    expect(bin).toBe("claude");
    expect(args[0]).toBe("-p");
    // The prompt is the DIRECT -p value = autorun directive + skill body.
    expect(args[1]).toBe(`${AUTORUN_DIRECTIVE}DO WORK`);
    expect(args.slice(2)).toEqual([
      "--verbose",
      "--dangerously-skip-permissions",
      "--output-format",
      "stream-json",
      "--add-dir",
      "/wt",
    ]);
  });

  it("FIX-204B: storyId pins the scheduler's pick between directive and skill body", () => {
    const { args } = buildClaudeArgv({
      worktree: "/wt",
      skillBody: "DO WORK",
      storyId: "FIX-042",
      bin: "claude",
    });
    const prompt = args[1] ?? "";
    expect(prompt.startsWith(AUTORUN_DIRECTIVE)).toBe(true);
    expect(prompt).toContain("[本周期指定故事] 调度器已锁定 FIX-042");
    expect(prompt.endsWith("DO WORK")).toBe(true);
    // pin sits between directive and body
    expect(prompt.indexOf("FIX-042")).toBeGreaterThan(AUTORUN_DIRECTIVE.length - 1);
    expect(prompt.indexOf("FIX-042")).toBeLessThan(prompt.indexOf("DO WORK"));
  });

  it("FIX-204B: absent/empty storyId keeps the prompt byte-identical to the pre-pin shape", () => {
    const legacy = buildClaudeArgv({ worktree: "/wt", skillBody: "DO WORK", bin: "claude" });
    const empty = buildClaudeArgv({ worktree: "/wt", skillBody: "DO WORK", storyId: "", bin: "claude" });
    expect(legacy.args[1]).toBe(`${AUTORUN_DIRECTIVE}DO WORK`);
    expect(empty.args).toEqual(legacy.args);
  });

  it("FIX-220: interactive mode drops --verbose and --output-format stream-json for human readability", () => {
    const { args } = buildClaudeArgv({ worktree: "/wt", skillBody: "DO WORK", bin: "claude", interactive: true });
    expect(args.slice(2)).toEqual(["--dangerously-skip-permissions", "--add-dir", "/wt"]);
    expect(args).not.toContain("--verbose");
    expect(args).not.toContain("--output-format");
    expect(args).not.toContain("stream-json");
  });

  it("FIX-220: default (non-interactive) keeps --verbose and stream-json for cost tracking", () => {
    const { args } = buildClaudeArgv({ worktree: "/wt", skillBody: "DO WORK", bin: "claude" });
    expect(args.slice(2)).toEqual([
      "--verbose",
      "--dangerously-skip-permissions",
      "--output-format",
      "stream-json",
      "--add-dir",
      "/wt",
    ]);
  });
});

describe("buildSpawnCommand — US-PORT-010 agent argv shapes", () => {
  const prompt = `${AUTORUN_DIRECTIVE}DO WORK`;

  it("claude (default) gets full loop-enhanced argv", () => {
    const { bin, args } = buildSpawnCommand("claude", { cwd: "/wt", skillBody: "DO WORK" });
    expect(bin).toBe("claude");
    expect(args[0]).toBe("-p");
    expect(args.slice(2)).toEqual([
      "--verbose",
      "--dangerously-skip-permissions",
      "--output-format",
      "stream-json",
      "--add-dir",
      "/wt",
    ]);
  });

  it("pi: pi -p <prompt>", () => {
    const { bin, args } = buildSpawnCommand("pi", { cwd: "/wt", skillBody: "DO WORK" });
    expect(bin).toBe("pi");
    expect(args).toEqual(["-p", prompt]);
  });

  it("kimi: kimi -p <prompt>", () => {
    const { bin, args } = buildSpawnCommand("kimi", { cwd: "/wt", skillBody: "DO WORK" });
    expect(bin).toBe("kimi");
    expect(args).toEqual(["-p", prompt]);
  });

  it("codex: codex exec <prompt>", () => {
    const { bin, args } = buildSpawnCommand("codex", { cwd: "/wt", skillBody: "DO WORK" });
    expect(bin).toBe("codex");
    expect(args).toEqual(["exec", prompt]);
  });

  it("FIX-253: codex gets explicit workspace-write roots for symlinked .roll and durable alerts", () => {
    const { bin, args } = buildSpawnCommand("codex", {
      cwd: "/wt",
      skillBody: "DO WORK",
      writableRoots: ["/repo/.roll-real", "/repo/.roll-real/loop"],
    });
    expect(bin).toBe("codex");
    expect(args).toEqual([
      "exec",
      "--cd",
      "/wt",
      "--sandbox",
      "workspace-write",
      "--add-dir",
      "/repo/.roll-real",
      "--add-dir",
      "/repo/.roll-real/loop",
      prompt,
    ]);
  });

  it("deepseek: deepseek <prompt> (positional)", () => {
    const { bin, args } = buildSpawnCommand("deepseek", { cwd: "/wt", skillBody: "DO WORK" });
    expect(bin).toBe("deepseek");
    expect(args).toEqual([prompt]);
  });

  it("qwen: qwen <prompt> (positional)", () => {
    const { bin, args } = buildSpawnCommand("qwen", { cwd: "/wt", skillBody: "DO WORK" });
    expect(bin).toBe("qwen");
    expect(args).toEqual([prompt]);
  });

  it("agy: agy --dangerously-skip-permissions -p <prompt> (FIX-296: flag before -p so -p does not swallow it)", () => {
    const { bin, args } = buildSpawnCommand("agy", { cwd: "/wt", skillBody: "DO WORK" });
    expect(bin).toBe("agy");
    expect(args).toEqual(["--dangerously-skip-permissions", "-p", prompt]);
  });

  it("gemini aliases to agy argv (FIX-296 order)", () => {
    const { bin, args } = buildSpawnCommand("gemini", { cwd: "/wt", skillBody: "DO WORK" });
    expect(bin).toBe("agy");
    expect(args).toEqual(["--dangerously-skip-permissions", "-p", prompt]);
  });

  it("antigravity aliases to agy argv (FIX-296 order)", () => {
    const { bin, args } = buildSpawnCommand("antigravity", { cwd: "/wt", skillBody: "DO WORK" });
    expect(bin).toBe("agy");
    expect(args).toEqual(["--dangerously-skip-permissions", "-p", prompt]);
  });

  it("throws a loud, documented error for an un-ported agent (fail-loud, not silent)", () => {
    expect(() => buildSpawnCommand("opencode", { cwd: "/wt", skillBody: "x" })).toThrow(
      /agent 'opencode' argv not yet ported/,
    );
    expect(Object.keys(AGENT_ARGV_TODO)).toContain("opencode");
  });
});

describe("parseEstMin", () => {
  it("reads est_min from a desc tag, undefined when absent", () => {
    expect(parseEstMin("foo est_min:12 bar")).toBe(12);
    expect(parseEstMin("foo est-min: 7")).toBe(7);
    expect(parseEstMin("no estimate")).toBeUndefined();
  });
});

describe("buildRunRow — v2 runs.jsonl shape", () => {
  it("done/built credits built[]; failed leaves it empty", () => {
    const done = buildRunRow(
      { kind: "append_run", status: "done", outcome: "delivered", cycleId: CTX.cycleId },
      CTX,
    );
    expect(done["built"]).toEqual(["US-RUN-001"]);
    expect(done["status"]).toBe("done");
    expect(done["agent"]).toBe("claude");
    expect(done["run_id"]).toBe(CTX.cycleId);

    const failed = buildRunRow(
      { kind: "append_run", status: "failed", outcome: "failed", cycleId: CTX.cycleId },
      CTX,
    );
    expect(failed["built"]).toEqual([]);
  });

  it("FIX-208: tcr_count comes from ctx (was hardcoded 0); cost fields mirror ctx.cost", () => {
    const withFacts: CycleContext = {
      ...CTX,
      tcrCount: 5,
      cost: {
        cycleId: CTX.cycleId,
        agent: "claude",
        model: "claude-opus-4-8",
        tokensIn: 150,
        tokensOut: 60,
        estimatedCost: 0.42,
        revertCount: 0,
        effectiveCost: 0.42,
      },
    };
    const row = buildRunRow(
      { kind: "append_run", status: "done", outcome: "delivered", cycleId: CTX.cycleId },
      withFacts,
    );
    expect(row["tcr_count"]).toBe(5);
    expect(row["cost_usd"]).toBe(0.42);
    expect(row["tokens_in"]).toBe(150);
    expect(row["tokens_out"]).toBe(60);
    // FIX-249: model + effective cost are RECORDED on the row (observability kept;
    // the budget gate that consumed effective cost was removed).
    expect(row["model"]).toBe("claude-opus-4-8");
    expect(row["cost_effective_usd"]).toBe(0.42);
  });

  it("FIX-249: cache split rides the row when the adapter reported one", () => {
    const withCache: CycleContext = {
      ...CTX,
      cost: {
        cycleId: CTX.cycleId,
        agent: "pi",
        model: "deepseek-v4-pro",
        tokensIn: 10,
        tokensOut: 20,
        cacheRead: 3000,
        cacheWrite: 400,
        estimatedCost: 0.01,
        revertCount: 0,
        effectiveCost: 0.01,
      },
    };
    const row = buildRunRow(
      { kind: "append_run", status: "published", outcome: "published_pending_merge", cycleId: CTX.cycleId },
      withCache,
    );
    expect(row["tokens_cache_read"]).toBe(3000);
    expect(row["tokens_cache_write"]).toBe(400);
    expect(row["model"]).toBe("deepseek-v4-pro");
  });

  it("FIX-208: absent ctx.cost omits cost fields; absent tcrCount defaults to 0", () => {
    const row = buildRunRow(
      { kind: "append_run", status: "idle", outcome: "idle_no_work", cycleId: CTX.cycleId },
      CTX,
    );
    expect(row["tcr_count"]).toBe(0);
    expect(row).not.toHaveProperty("cost_usd");
  });

  it("FIX-290 AC2/AC3: a failed cycle with unreadable usage still records model (routing) + an unknown marker — not a 0/blank record", () => {
    // usage_credentials_missing → ctx.cost absent. The routed model is fixed at
    // dispatch; record it. tokens/cost are UNKNOWN, flagged so the ledger shows
    // "?" not a misleading $0/0-0.
    const row = buildRunRow(
      { kind: "append_run", status: "failed", outcome: "failed", cycleId: CTX.cycleId },
      { ...CTX, agent: "pi", model: "kimi-k2-instruct" },
      1780688082,
    );
    expect(row["model"]).toBe("kimi-k2-instruct"); // AC2: NEVER blank
    expect(row["usage_unknown"]).toBe(true); // AC3: unknown ≠ 0
    expect(row).not.toHaveProperty("cost_usd"); // no faked $0
    expect(row).not.toHaveProperty("tokens_in");
    expect(row["ts"]).toBe("2026-06-05T19:34:42Z"); // duration/time still present
  });

  it("FIX-290 AC2: model falls back to the agent id when the router left model empty (claude default)", () => {
    const row = buildRunRow(
      { kind: "append_run", status: "idle", outcome: "idle_no_work", cycleId: CTX.cycleId },
      { ...CTX, agent: "claude", model: "" },
    );
    expect(row["model"]).toBe("claude");
  });

  it("FIX-290 AC3: a delivered cycle WITH parsed usage carries no unknown marker (true values, not '?')", () => {
    const row = buildRunRow(
      { kind: "append_run", status: "done", outcome: "delivered", cycleId: CTX.cycleId },
      {
        ...CTX,
        cost: {
          cycleId: CTX.cycleId,
          agent: "claude",
          model: "claude-opus-4-8",
          tokensIn: 1200,
          tokensOut: 400,
          estimatedCost: 0.42,
          effectiveCost: 0.42,
          revertCount: 0,
        },
      },
    );
    expect(row).not.toHaveProperty("usage_unknown");
    expect(row["model"]).toBe("claude-opus-4-8");
  });

  it("FIX-213: nowSec stamps ISO-UTC ts (no millis) + duration_sec from startSec", () => {
    const start = 1780688082; // 2026-06-05T19:34:42Z (UTC; the cycle id's 0334 is UTC+8 local)
    const end = start + 380;
    const row = buildRunRow(
      { kind: "append_run", status: "done", outcome: "delivered", cycleId: CTX.cycleId },
      { ...CTX, startSec: start },
      end,
    );
    expect(row["ts"]).toBe("2026-06-05T19:41:02Z");
    expect(String(row["ts"])).not.toContain("."); // canonical form, no millis
    expect(row["duration_sec"]).toBe(380);
  });

  it("FIX-213: no startSec → ts still stamped, duration_sec omitted (no negative)", () => {
    const row = buildRunRow(
      { kind: "append_run", status: "done", outcome: "delivered", cycleId: CTX.cycleId },
      CTX,
      1780688082,
    );
    expect(row["ts"]).toBe("2026-06-05T19:34:42Z");
    expect(row).not.toHaveProperty("duration_sec");
  });
});

describe("buildTerminalRecord — the cycle:terminal twin (US-TRUTH-001 + FIX-294)", () => {
  it("FIX-294: a failed cycle with UNREADABLE usage still records the routed model on the event", () => {
    // ctx.cost absent (usage_credentials_missing). FIX-290 fixed this on the runs
    // row; the terminal-event twin went through buildTerminalRecord → buildTerminalEvent
    // and lost the model entirely (model only lived inside the usage fact). Now the
    // top-level event.model carries the routed model even when usage is unknown.
    const ev = buildTerminalRecord(
      { kind: "append_run", status: "failed", outcome: "failed", cycleId: CTX.cycleId },
      { ...CTX, agent: "pi", model: "kimi-k2-instruct" },
      "/wt",
      1780688082,
    );
    expect(ev.type).toBe("cycle:terminal");
    expect(ev.model).toBe("kimi-k2-instruct"); // FIX-294: NEVER blank on a routed cycle
    // FIX-290 distinction preserved: usage is reasoned-absent, not a faked 0.
    expect(ev.usage).toEqual({ present: false, reason: "no_parseable_usage" });
    expect(ev.cost).toEqual({ present: false, reason: "no_parseable_usage" });
  });

  it("FIX-294: model falls back to the agent id when the router left model empty (claude default)", () => {
    const ev = buildTerminalRecord(
      { kind: "append_run", status: "idle", outcome: "idle_no_work", cycleId: CTX.cycleId },
      { ...CTX, agent: "claude", model: "" },
      "/wt",
      1780688082,
    );
    expect(ev.model).toBe("claude");
  });

  it("prefers the authoritative model from parsed usage when present", () => {
    const ev = buildTerminalRecord(
      { kind: "append_run", status: "done", outcome: "delivered", cycleId: CTX.cycleId },
      {
        ...CTX,
        agent: "pi",
        model: "kimi-k2-instruct", // routed
        cost: {
          cycleId: CTX.cycleId,
          agent: "pi",
          model: "deepseek-v4-pro", // parsed (authoritative)
          tokensIn: 1200,
          tokensOut: 400,
          estimatedCost: 0.42,
          effectiveCost: 0.42,
          revertCount: 0,
        },
      },
      "/wt",
      1780688082,
    );
    expect(ev.model).toBe("deepseek-v4-pro");
    expect(ev.usage).toEqual({ present: true, value: { model: "deepseek-v4-pro", tokensIn: 1200, tokensOut: 400 } });
  });
});

describe("dryRunPlan", () => {
  it("renders the happy-path command plan without executing anything", () => {
    const plan = dryRunPlan(CTX);
    const joined = plan.join("\n");
    expect(joined).toContain("create_worktree");
    expect(joined).toContain("pick_story");
    expect(joined).toContain("resume_worktree"); // FIX-284: resume re-point step is in the walk
    expect(joined).toContain("spawn_agent");
    expect(joined).toContain("publish_pr");
    expect(joined).toContain("append_run");
  });
});

// ── executeCommand dispatch (every kind, via fakes) ──────────────────────────

function fakePorts(over: Partial<Ports> = {}): { ports: Ports; calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  const rec = (k: string) => (...a: unknown[]): void => {
    (calls[k] ??= []).push(a);
  };
  const ports: Ports = {
    repoCwd: "/repo",
    paths: {
      eventsPath: "/rt/events.ndjson",
      runsPath: "/rt/runs.jsonl",
      alertsPath: "/rt/alerts.log",
      lockPath: "/rt/inner.lock",
      heartbeatPath: "/rt/heartbeat",
      worktreePath: "/rt/wt",
    },
    skillBody: "work",
    clock: () => 42,
    agentSpawn: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false })),
    evidence: {
      openFrame: vi.fn(() => "/repo/.roll/features/demo/US-RUN-001/20260605-000000-1"),
    },
    capture: {
      fromMarker: vi.fn(async () => ({ kind: "web", out: "/frame/screenshots/before-home.png", taken: true })),
    },
    attest: {
      render: vi.fn(async () => 0),
    },
    depsExec: vi.fn(async () => ({})),
    git: {
      fetchOrigin: vi.fn(async () => ({ fetched: true })),
      worktreeAdd: vi.fn(async () => ({ code: 0 })),
      worktreeSubmoduleInit: vi.fn(async () => ({ code: 0 })),
      worktreeRemove: vi.fn(async () => ({ code: 0 })),
      push: vi.fn(async () => ({ code: 0 })),
      commitsAhead: vi.fn(async () => 3),
      mainAhead: vi.fn(async () => 0),
      tcrCount: vi.fn(async () => 4),
      recentCommits: vi.fn(async () => []),
      // RESUME-PRIOR-WORK probes — defaults make every fakePorts cycle base on
      // origin/main (no recorded prior branch in the default runs.jsonl path).
      fetchRemoteBranch: vi.fn(async () => ({ fetched: true })),
      branchMergedIntoMain: vi.fn(async () => false),
      branchCleanlyRebasesOntoMain: vi.fn(async () => true),
      resetWorktreeHard: vi.fn(async () => ({ code: 0 })),
    },
    github: {
      repoSlug: vi.fn(async () => "o/r"),
      runPublishPlan: vi.fn(async () => ({ status: 0 as const, prUrl: "u", ok: true })),
      prState: vi.fn(async () => "MERGED"),
    },
    process: {
      acquireLock: vi.fn(() => ({ acquired: true, heldByPid: undefined })),
      releaseLock: vi.fn(rec("releaseLock")),
      writeHeartbeat: vi.fn(rec("heartbeat")),
    },
    events: {
      ensureEventFiles: vi.fn(rec("ensure")),
      appendEvent: vi.fn(rec("event")),
      upsertRun: vi.fn(rec("run")),
      appendAlert: vi.fn(rec("alert")),
    },
    backlog: {
      read: vi.fn(() => [{ id: "US-RUN-001", desc: "est_min:5", status: "📋 Todo" }]),
    },
    metadata: {
      commit: vi.fn(async () => ({ committed: true, pushed: true, nothingToCommit: false })),
    },
    route: { resolve: vi.fn(() => ({ agent: "claude", model: "" })) },
    ...over,
  };
  return { ports, calls };
}

describe("executeCommand — command → executor mapping", () => {
  it("create_worktree code 0 → worktree_created; non-zero → worktree_failed", async () => {
    const ok = fakePorts();
    const r1 = await executeCommand({ kind: "create_worktree", branch: "b" }, ok.ports, CTX);
    expect(r1.event).toEqual({ type: "worktree_created" });

    const bad = fakePorts({
      git: { ...fakePorts().ports.git, worktreeAdd: vi.fn(async () => ({ code: 1 })) },
    });
    const r2 = await executeCommand({ kind: "create_worktree", branch: "b" }, bad.ports, CTX);
    expect(r2.event).toEqual({ type: "worktree_failed" });
  });

  it("FIX-268: deps bootstrap failure fails the worktree before agent spawn", async () => {
    const wt = realpathSync(mkdtempSync(join(tmpdir(), "roll-deps-command-")));
    execDirs.push(wt);
    writeFileSync(join(wt, "package.json"), "{}\n");
    writeFileSync(join(wt, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    const { ports, calls } = fakePorts({
      paths: { ...fakePorts().ports.paths, worktreePath: wt },
      depsExec: vi.fn(async () => {
        throw new Error("ENOTFOUND registry.npmjs.org");
      }),
    });

    const r = await executeCommand({ kind: "create_worktree", branch: "b" }, ports, CTX);

    expect(r.event).toEqual({ type: "worktree_failed" });
    const alert = (calls["alert"] ?? []).map((a) => (a as unknown[])[1]).join("\n");
    expect(alert).toContain("[FAIL]");
    expect(alert).toContain("worktree deps bootstrap failed");
    expect(alert).toContain("ENOTFOUND");
  });

  it("FIX-302: submodule init failure fails the worktree before agent spawn", async () => {
    const wt = realpathSync(mkdtempSync(join(tmpdir(), "roll-skills-command-")));
    execDirs.push(wt);
    writeFileSync(join(wt, ".gitmodules"), '[submodule "skills"]\n  path = skills\n');
    const base = fakePorts();
    const { ports, calls } = fakePorts({
      paths: { ...base.ports.paths, worktreePath: wt },
      git: { ...base.ports.git, worktreeSubmoduleInit: vi.fn(async () => ({ code: 128 })) },
    });

    const r = await executeCommand({ kind: "create_worktree", branch: "b" }, ports, CTX);

    expect(r.event).toEqual({ type: "worktree_failed" });
    const alert = (calls["alert"] ?? []).map((a) => (a as unknown[])[1]).join("\n");
    expect(alert).toContain("[FAIL] worktree submodule init failed");
    // deps bootstrap must NOT run once skills populate has failed.
    expect(ports.depsExec).not.toHaveBeenCalled();
  });

  // ── RESUME-PRIOR-WORK (un-merged audit-branch reuse) ──────────────────────
  // FIX-284 wiring fix: the resume decision happens at `resume_worktree` (AFTER
  // pick_story, so the story id is known), NOT at `create_worktree` (which now
  // always bases on origin/main — the story id is undefined there). Each scenario
  // writes a runs.jsonl that links the picked story → a prior cycle, then asserts
  // whether `resume_worktree` RE-POINTS the worktree (resetWorktreeHard) and which
  // ALERT it emits. `create_worktree` is verified to always use origin/main.

  /** Build fakePorts whose runs.jsonl records a prior `orphan` cycle for the
   *  picked story (the FIX-284/285 stranded-work shape). */
  function resumePorts(over: Partial<Ports> = {}): { ports: Ports; calls: Record<string, unknown[]>; runsPath: string } {
    const rt = realpathSync(mkdtempSync(join(tmpdir(), "roll-resume-")));
    execDirs.push(rt);
    const runsPath = join(rt, "runs.jsonl");
    writeFileSync(
      runsPath,
      JSON.stringify({ story_id: "US-RUN-001", cycle_id: "20260614-195600-25595", status: "orphan" }) + "\n",
    );
    const base = fakePorts();
    const { ports, calls } = fakePorts({
      paths: { ...base.ports.paths, runsPath },
      ...over,
    });
    return { ports, calls, runsPath };
  }

  it("FIX-284: create_worktree always bases on origin/main and runs NO resume probe (storyId is undefined here)", async () => {
    delete process.env[RESUME_DISABLED_ENV];
    // Even with a resumable branch recorded, create_worktree must NOT resume — the
    // story is not yet picked. (The old bug: resolveResumeBase here saw an
    // undefined storyId and silently fell back, so resume never engaged.)
    const { ports } = resumePorts();
    const r = await executeCommand({ kind: "create_worktree", branch: "loop/cycle-new" }, ports, CTX);
    expect(r.event).toEqual({ type: "worktree_created" });
    expect(ports.git.worktreeAdd).toHaveBeenCalledWith(
      "/repo",
      ports.paths.worktreePath,
      "loop/cycle-new",
      "origin/main",
    );
    // No resume decision is made at create_worktree time.
    expect(ports.git.fetchRemoteBranch).not.toHaveBeenCalled();
    expect(ports.git.resetWorktreeHard).not.toHaveBeenCalled();
  });

  it("resume: a card with a clean un-merged prior cycle branch RE-POINTS the worktree to that branch (resume engages)", async () => {
    delete process.env[RESUME_DISABLED_ENV];
    const { ports, calls } = resumePorts(); // defaults: not merged, clean rebase
    const r = await executeCommand({ kind: "resume_worktree", storyId: "US-RUN-001" }, ports, CTX);
    expect(r.event).toBeUndefined(); // pure side effect, no feedback event
    // The worktree is hard-reset onto the audit branch tip (fetch + reset --hard).
    expect(ports.git.resetWorktreeHard).toHaveBeenCalledWith(
      ports.paths.worktreePath,
      "origin/loop/cycle-20260614-195600-25595",
      "loop/cycle-20260614-195600-25595",
    );
    const alert = (calls["alert"] ?? []).map((a) => (a as unknown[])[1]).join("\n");
    expect(alert).toContain("resume-prior-work");
    expect(alert).toContain("resumes un-merged branch loop/cycle-20260614-195600-25595");
  });

  it("resume: no recorded prior branch → worktree left on origin/main (no re-point)", async () => {
    delete process.env[RESUME_DISABLED_ENV];
    // The default fakePorts runsPath does not exist → no candidates.
    const { ports } = fakePorts();
    const r = await executeCommand({ kind: "resume_worktree", storyId: "US-RUN-001" }, ports, CTX);
    expect(r.event).toBeUndefined();
    expect(ports.git.resetWorktreeHard).not.toHaveBeenCalled();
  });

  it("resume: a prior branch that does NOT cleanly rebase → no re-point + a skip ALERT", async () => {
    delete process.env[RESUME_DISABLED_ENV];
    const base = resumePorts();
    const { ports, calls } = resumePorts({
      git: {
        ...base.ports.git,
        branchMergedIntoMain: vi.fn(async () => false),
        branchCleanlyRebasesOntoMain: vi.fn(async () => false), // conflict
      },
    });
    const r = await executeCommand({ kind: "resume_worktree", storyId: "US-RUN-001" }, ports, CTX);
    expect(r.event).toBeUndefined();
    expect(ports.git.resetWorktreeHard).not.toHaveBeenCalled();
    const alert = (calls["alert"] ?? []).map((a) => (a as unknown[])[1]).join("\n");
    expect(alert).toContain("does NOT cleanly rebase");
    expect(alert).toContain("resume SKIPPED");
  });

  it("resume: a prior branch already merged into origin/main → no re-point, no skip ALERT", async () => {
    delete process.env[RESUME_DISABLED_ENV];
    const base = resumePorts();
    const { ports, calls } = resumePorts({
      git: {
        ...base.ports.git,
        branchMergedIntoMain: vi.fn(async () => true), // already on main
        branchCleanlyRebasesOntoMain: vi.fn(async () => true),
      },
    });
    const r = await executeCommand({ kind: "resume_worktree", storyId: "US-RUN-001" }, ports, CTX);
    expect(r.event).toBeUndefined();
    expect(ports.git.resetWorktreeHard).not.toHaveBeenCalled();
    // A merged branch is not "resumable but skipped" → no conflict ALERT.
    const alert = (calls["alert"] ?? []).map((a) => (a as unknown[])[1]).join("\n");
    expect(alert).not.toContain("resume-prior-work");
  });

  it("resume: a failed re-point (reset --hard non-zero) leaves the cycle fresh on origin/main + an ALERT", async () => {
    delete process.env[RESUME_DISABLED_ENV];
    const base = resumePorts();
    const { ports, calls } = resumePorts({
      git: {
        ...base.ports.git,
        resetWorktreeHard: vi.fn(async () => ({ code: 1 })), // re-point blip
      },
    });
    // resolveResumeBase already alerted "resumes un-merged branch …"; the re-point
    // failure must NOT topple the cycle — it returns cleanly and alerts the FAIL.
    const r = await executeCommand({ kind: "resume_worktree", storyId: "US-RUN-001" }, ports, CTX);
    expect(r.event).toBeUndefined();
    expect(ports.git.resetWorktreeHard).toHaveBeenCalled();
    const alert = (calls["alert"] ?? []).map((a) => (a as unknown[])[1]).join("\n");
    expect(alert).toContain("re-point of worktree onto origin/loop/cycle-20260614-195600-25595");
    expect(alert).toContain("FAILED");
  });

  it("resume: ROLL_LOOP_NO_RESUME=1 → no re-point, no probes run (kill switch)", async () => {
    process.env[RESUME_DISABLED_ENV] = "1";
    try {
      const { ports } = resumePorts(); // a resumable branch IS recorded
      const r = await executeCommand({ kind: "resume_worktree", storyId: "US-RUN-001" }, ports, CTX);
      expect(r.event).toBeUndefined();
      expect(ports.git.resetWorktreeHard).not.toHaveBeenCalled();
      // Disabled → the git resume probes are never consulted.
      expect(ports.git.fetchRemoteBranch).not.toHaveBeenCalled();
      expect(ports.git.branchMergedIntoMain).not.toHaveBeenCalled();
    } finally {
      delete process.env[RESUME_DISABLED_ENV];
    }
  });

  it("resolveResumeBase: an empty storyId falls back to origin/main without probing", async () => {
    delete process.env[RESUME_DISABLED_ENV];
    const { ports } = resumePorts();
    const base = await resolveResumeBase(ports, "");
    expect(base).toBe("origin/main");
    expect(ports.git.fetchRemoteBranch).not.toHaveBeenCalled();
  });

  it("FIX-209: preflight fetches origin main before the worktree branches off it", async () => {
    const { ports, calls } = fakePorts();
    const r = await executeCommand({ kind: "preflight" }, ports, CTX);
    expect(r.event).toEqual({ type: "preflight_done" });
    expect(ports.git.fetchOrigin).toHaveBeenCalledWith("/repo", "main");
    // success → no WARN noise.
    expect(calls["alert"]).toBeUndefined();
  });

  it("FIX-209: a failed preflight fetch leaves a WARN trace and still proceeds (lenient)", async () => {
    const { ports, calls } = fakePorts({
      git: { ...fakePorts().ports.git, fetchOrigin: vi.fn(async () => ({ fetched: false })) },
    });
    const r = await executeCommand({ kind: "preflight" }, ports, CTX);
    // Lenient: the cycle is NOT toppled by a fetch failure.
    expect(r.event).toEqual({ type: "preflight_done" });
    // A WARN trace was written to the alerts log.
    const warn = (calls["alert"] ?? []).map((a) => (a as unknown[])[1]).join("\n");
    expect(warn).toContain("[WARN]");
    expect(warn).toContain("fetch origin main failed");
  });

  it("pick_story returns story_picked when a Todo exists, no_story when empty", async () => {
    const has = fakePorts();
    const r1 = await executeCommand({ kind: "pick_story" }, has.ports, CTX);
    expect(r1.event).toEqual({ type: "story_picked", storyId: "US-RUN-001" });

    const none = fakePorts({ backlog: { read: () => [] } });
    const r2 = await executeCommand({ kind: "pick_story" }, none.ports, CTX);
    expect(r2.event).toEqual({ type: "no_story" });
  });

  it("US-EVID-001: pick_story opens an evidence frame before spawn and records the run dir", async () => {
    const { ports, calls } = fakePorts();
    const r = await executeCommand({ kind: "pick_story" }, ports, CTX);
    expect(ports.evidence.openFrame).toHaveBeenCalledWith("/repo", "US-RUN-001", CTX.cycleId);
    expect(r.ctxPatch?.evidenceRunDir).toBe("/repo/.roll/features/demo/US-RUN-001/20260605-000000-1");
    const events = (calls["event"] ?? []).map((a) => (a as unknown[])[1] as RollEvent);
    expect(events).toContainEqual({
      type: "evidence:frame-opened",
      cycleId: CTX.cycleId,
      storyId: "US-RUN-001",
      runDir: "/repo/.roll/features/demo/US-RUN-001/20260605-000000-1",
      ts: 42,
    });
  });

  it("spawn_agent → agent_exited with the agent exit code", async () => {
    const { ports } = fakePorts();
    const r = await executeCommand({ kind: "spawn_agent", agent: "claude", attempt: 1 }, ports, CTX);
    expect(r.event).toEqual({ type: "agent_exited", exit: 0, timedOut: false });
  });

  it("US-EVID-001: spawn_agent passes the opened run dir explicitly to the child", async () => {
    const { ports } = fakePorts();
    await executeCommand(
      { kind: "spawn_agent", agent: "claude", attempt: 1 },
      ports,
      { ...CTX, evidenceRunDir: "/frame" },
    );
    expect(ports.agentSpawn).toHaveBeenCalledWith(
      "claude",
      expect.objectContaining({ runDir: "/frame" }),
    );
  });

  it("FIX-253: spawn_agent passes writable roots for the real .roll and alert directory", async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "roll-253-repo-")));
    execDirs.push(repo);
    mkdirSync(join(repo, ".roll", "loop"), { recursive: true });
    const wt = join(repo, "wt");
    mkdirSync(wt, { recursive: true });
    const base = fakePorts();
    const { ports } = fakePorts({
      repoCwd: repo,
      paths: {
        ...base.ports.paths,
        worktreePath: wt,
        alertsPath: join(repo, ".roll", "loop", "ALERT-roll-test.md"),
      },
    });
    await executeCommand({ kind: "spawn_agent", agent: "codex", attempt: 1 }, ports, CTX);
    expect(ports.agentSpawn).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({
        writableRoots: [join(repo, ".roll"), join(repo, ".roll", "loop")],
      }),
    );
  });

  it("FIX-253: spawn_agent persists worktree-local ALERT files before cleanup can delete them", async () => {
    const wt = realpathSync(mkdtempSync(join(tmpdir(), "roll-253-alert-wt-")));
    execDirs.push(wt);
    const { ports, calls } = fakePorts({
      paths: { ...fakePorts().ports.paths, worktreePath: wt },
      agentSpawn: vi.fn(async (_agent, opts) => {
        writeFileSync(join(opts.cwd, "ALERT-US-RUN-001.md"), "# ALERT\n\nblocked by sandbox\n");
        return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
      }),
    });
    await executeCommand({ kind: "spawn_agent", agent: "codex", attempt: 1 }, ports, CTX);
    const alerts = (calls["alert"] ?? []).map((a) => String((a as unknown[])[1]));
    expect(alerts.join("\n")).toContain("worktree alert persisted");
    expect(alerts.join("\n")).toContain("blocked by sandbox");
  });

  it("US-EVID-003: spawn_agent listens for capture markers and dispatches screenshots into the run frame", async () => {
    const { ports } = fakePorts({
      agentSpawn: vi.fn(async (_agent, opts) => {
        opts.onChunk?.(Buffer.from("agent says hi\n::roll-capture before web home https://app.test\n"));
        return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
      }),
    });

    await executeCommand(
      { kind: "spawn_agent", agent: "claude", attempt: 1 },
      ports,
      { ...CTX, evidenceRunDir: "/frame" },
    );

    expect(ports.capture.fromMarker).toHaveBeenCalledWith(
      { phase: "before", kind: "web", stem: "home", target: "https://app.test" },
      "/frame",
    );
  });

  it("US-EVID-003: capture skips are recorded as evidence instead of placeholders", async () => {
    const runDir = realpathSync(mkdtempSync(join(tmpdir(), "roll-capture-log-")));
    execDirs.push(runDir);
    const { ports } = fakePorts({
      agentSpawn: vi.fn(async (_agent, opts) => {
        opts.onChunk?.(Buffer.from("::roll-capture gate terminal cli tmux:roll-loop-demo\n"));
        return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
      }),
      capture: {
        fromMarker: vi.fn(async () => ({
          kind: "terminal",
          out: join(runDir, "screenshots", "gate-cli.png"),
          taken: false,
          skipped: "not macOS",
        })),
      },
    });

    await executeCommand(
      { kind: "spawn_agent", agent: "claude", attempt: 1 },
      ports,
      { ...CTX, evidenceRunDir: runDir },
    );

    const log = readFileSync(join(runDir, "evidence", "capture-markers.log"), "utf8");
    expect(log).toContain('"taken":false');
    expect(log).toContain('"skipped":"not macOS"');
    expect(log).toContain('"phase":"gate"');
  });

  it("FIX-208: spawn_agent parses claude stream-json stdout → ctxPatch.cost", async () => {
    const stream = [
      JSON.stringify({ type: "assistant", message: { model: "claude-opus-4-8", usage: { input_tokens: 120, output_tokens: 30 } } }),
      JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 0.05 }),
    ].join("\n");
    const { ports } = fakePorts({
      agentSpawn: vi.fn(async () => ({ stdout: stream, stderr: "", exitCode: 0, timedOut: false })),
    });
    const r = await executeCommand({ kind: "spawn_agent", agent: "claude", attempt: 1 }, ports, CTX);
    expect(r.ctxPatch?.cost).toBeDefined();
    expect(r.ctxPatch?.cost?.tokensIn).toBe(120);
    expect(r.ctxPatch?.cost?.tokensOut).toBe(30);
    expect(r.ctxPatch?.cost?.model).toBe("claude-opus-4-8");
  });

  it("FIX-208: spawn_agent with no parseable usage → no cost patch (no fake zero)", async () => {
    const { ports } = fakePorts(); // default stdout is "" → sumClaudeStream null
    const r = await executeCommand({ kind: "spawn_agent", agent: "claude", attempt: 1 }, ports, CTX);
    expect(r.ctxPatch?.cost).toBeUndefined();
  });

  // FIX-249 — the two missing adapter lanes: stdout-scrape agents (openai/
  // gemini/kimi/qwen print a usage footer) and pi (no stdout usage at all —
  // recovered from its session store, scoped to the cycle worktree + window).
  it("FIX-249: spawn_agent scrapes a stdout-footer agent (openai) → ctxPatch.cost", async () => {
    const stdout = ["model: gpt-5.2", "input tokens: 1,200", "output tokens: 300", "total: 1,500", "cost: $0.07"].join("\n");
    const { ports } = fakePorts({
      agentSpawn: vi.fn(async () => ({ stdout, stderr: "", exitCode: 0, timedOut: false })),
    });
    const r = await executeCommand({ kind: "spawn_agent", agent: "openai", attempt: 1 }, ports, { ...CTX, agent: "openai" });
    expect(r.ctxPatch?.cost?.tokensIn).toBe(1200);
    expect(r.ctxPatch?.cost?.tokensOut).toBe(300);
    expect(r.ctxPatch?.cost?.model).toBe("gpt-5.2");
  });

  it("FIX-249: spawn_agent recovers pi usage from the session store (cwd-scoped)", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "roll-249-pi-")));
    execDirs.push(root);
    // pi encodes the cwd into the session dir name; the executor's worktree is /rt/wt.
    const dir = join(root, "--rt-wt--");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "s.jsonl"),
      JSON.stringify({
        type: "message",
        message: { role: "assistant", model: "deepseek-v4-pro", usage: { input: 42, output: 17, cacheRead: 500, cacheWrite: 20, cost: { total: 0.02 } } },
      }) + "\n",
    );
    const prev = process.env["ROLL_PI_SESSIONS_ROOT"];
    process.env["ROLL_PI_SESSIONS_ROOT"] = root;
    try {
      const { ports } = fakePorts({
        agentSpawn: vi.fn(async () => ({ stdout: "plain text, no usage", stderr: "", exitCode: 0, timedOut: false })),
      });
      const r = await executeCommand({ kind: "spawn_agent", agent: "pi", attempt: 1 }, ports, { ...CTX, agent: "pi" });
      expect(r.ctxPatch?.cost?.tokensIn).toBe(42);
      expect(r.ctxPatch?.cost?.tokensOut).toBe(17);
      expect(r.ctxPatch?.cost?.model).toBe("deepseek-v4-pro");
      expect(r.ctxPatch?.cost?.cacheRead).toBe(500);
    } finally {
      if (prev === undefined) delete process.env["ROLL_PI_SESSIONS_ROOT"];
      else process.env["ROLL_PI_SESSIONS_ROOT"] = prev;
    }
  });

  it("capture_facts reads commits ahead via git port", async () => {
    const { ports } = fakePorts();
    const r = await executeCommand({ kind: "capture_facts" }, ports, CTX);
    expect(r.event).toMatchObject({ type: "facts_captured", facts: { commitsAhead: 3, usedWorktree: true } });
  });

  it("FIX-252: capture_facts records local main drift so zero branch commits cannot become idle", async () => {
    const base = fakePorts();
    const { ports } = fakePorts({
      git: {
        ...base.ports.git,
        commitsAhead: vi.fn(async () => 0),
        mainAhead: vi.fn(async () => 2),
      },
    });
    const r = await executeCommand({ kind: "capture_facts" }, ports, CTX);
    expect(r.event).toMatchObject({ type: "facts_captured", facts: { commitsAhead: 0, mainAhead: 2 } });
  });

  it("FIX-208: capture_facts returns real tcr count via git port → ctxPatch.tcrCount", async () => {
    const { ports } = fakePorts();
    const r = await executeCommand({ kind: "capture_facts" }, ports, CTX);
    expect(r.ctxPatch?.tcrCount).toBe(4);
  });

  it("US-EVID-004: capture_facts renders attest into the opened run frame before the attest gate", async () => {
    const order: string[] = [];
    const base = fakePorts();
    const { ports } = fakePorts({
      attest: {
        render: vi.fn(async () => {
          order.push("attest:render");
          return 0;
        }),
      },
      events: {
        ...base.ports.events,
        appendEvent: vi.fn((_path, event: RollEvent) => {
          order.push(event.type);
        }),
      },
    });

    await executeCommand(
      { kind: "capture_facts" },
      ports,
      { ...CTX, evidenceRunDir: "/frame" },
    );

    expect(ports.attest.render).toHaveBeenCalledWith("/rt/wt", "US-RUN-001", "/frame");
    expect(order.indexOf("attest:render")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("attest:gate")).toBeGreaterThan(order.indexOf("attest:render"));
  });

  it("US-EVID-004: absent run frame means no deterministic render, preserving idle/back-compat paths", async () => {
    const { ports } = fakePorts();
    await executeCommand({ kind: "capture_facts" }, ports, CTX);
    expect(ports.attest.render).not.toHaveBeenCalled();
  });

  // FIX-207 — attest gate is wired into capture_facts (delivery without a fresh
  // acceptance report). Soft (default) records an event + alert but never blocks;
  // hard (policy.yaml) captures a failed exit so the story is not marked Done.
  it("capture_facts policy-soft attest gate: missing report → attest:gate event + alert, NOT blocked", async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "roll-207-soft-")));
    execDirs.push(repo);
    mkdirSync(join(repo, ".roll"), { recursive: true });
    writeFileSync(join(repo, ".roll", "policy.yaml"), "loop_safety:\n  attest_gate: soft\n");
    const { ports, calls } = fakePorts({ repoCwd: repo, paths: { ...fakePorts().ports.paths, worktreePath: join(repo, "wt") } });
    const r = await executeCommand({ kind: "capture_facts" }, ports, CTX);
    expect(r.event).toMatchObject({ type: "facts_captured", facts: { agentExit: 0 } });
    const events = (calls["event"] ?? []).map((a) => (a as unknown[])[1] as RollEvent);
    expect(events.some((e) => e.type === "attest:gate" && e.verdict === "skipped")).toBe(true);
    expect((calls["alert"] ?? []).length).toBeGreaterThan(0);
  });

  it("capture_facts default-hard attest gate: missing report → captured as failed (agentExit 1)", async () => {
    const { ports } = fakePorts();
    const r = await executeCommand({ kind: "capture_facts" }, ports, { ...CTX, startSec: 1 });
    expect(r.event).toMatchObject({ type: "facts_captured", facts: { agentExit: 1 } });
  });

  // FIX-246 — ac-map omission remediation. Agents consistently skip skill step
  // 10.6 (ac-map.json) even on real deliveries, so the hard gate killed every
  // cycle. capture_facts now spawns the SAME agent once with a surgical
  // write-the-ac-map prompt BEFORE rendering attest, and records the outcome
  // as an `attest:remediation` event. Honesty red line untouched.
  function remediationFixture(opts: { withAcMap?: boolean; withAcBlock?: boolean } = {}): string {
    const wt = realpathSync(mkdtempSync(join(tmpdir(), "roll-246-exec-")));
    execDirs.push(wt);
    const dir = join(wt, ".roll", "features", "uncategorized", "US-RUN-001");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "spec.md"),
      opts.withAcBlock === false
        ? "# US-RUN-001\n\nprose only\n"
        : "# US-RUN-001\n\n**AC:**\n- [ ] AC1 works\n",
    );
    if (opts.withAcMap === true) writeFileSync(join(dir, "ac-map.json"), "[]\n");
    return wt;
  }

  it("FIX-246: delivery with AC block and NO ac-map → one remediation spawn before render + attest:remediation event", async () => {
    const wt = remediationFixture();
    const order: string[] = [];
    const spawn = vi.fn(async () => {
      order.push("remediation:spawn");
      return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
    });
    const base = fakePorts();
    const { ports, calls } = fakePorts({
      paths: { ...base.ports.paths, worktreePath: wt },
      agentSpawn: spawn,
      attest: {
        render: vi.fn(async () => {
          order.push("attest:render");
          return 0;
        }),
      },
    });
    await executeCommand({ kind: "capture_facts" }, ports, { ...CTX, startSec: 1, evidenceRunDir: "/frame" });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [agent, opts] = spawn.mock.calls[0] as unknown as [string, { skillBody: string; cwd: string; timeoutMs: number; runDir: string }];
    expect(agent).toBe("claude"); // the SAME agent that delivered
    expect(opts.cwd).toBe(wt);
    expect(opts.runDir).toBe("/frame");
    expect(opts.skillBody).toContain("ac-map.json");
    expect(opts.skillBody).toContain(join(wt, ".roll", "features", "uncategorized", "US-RUN-001", "ac-map.json"));
    expect(order.indexOf("remediation:spawn")).toBeLessThan(order.indexOf("attest:render")); // remediate, THEN render once
    const events = (calls["event"] ?? []).map((a) => (a as unknown[])[1] as RollEvent);
    expect(events.some((e) => e.type === "attest:remediation" && e.outcome === "still-missing")).toBe(true);
  });

  it("FIX-246: remediation agent writes the ac-map → event outcome 'written'", async () => {
    const wt = remediationFixture();
    const base = fakePorts();
    const { ports, calls } = fakePorts({
      paths: { ...base.ports.paths, worktreePath: wt },
      agentSpawn: vi.fn(async () => {
        writeFileSync(join(wt, ".roll", "features", "uncategorized", "US-RUN-001", "ac-map.json"), "[]\n");
        return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
      }),
    });
    await executeCommand({ kind: "capture_facts" }, ports, { ...CTX, startSec: 1, evidenceRunDir: "/frame" });
    const events = (calls["event"] ?? []).map((a) => (a as unknown[])[1] as RollEvent);
    expect(events.some((e) => e.type === "attest:remediation" && e.outcome === "written")).toBe(true);
  });

  it("FIX-246: ac-map already present → no remediation spawn", async () => {
    const wt = remediationFixture({ withAcMap: true });
    const base = fakePorts();
    const { ports } = fakePorts({ paths: { ...base.ports.paths, worktreePath: wt } });
    await executeCommand({ kind: "capture_facts" }, ports, { ...CTX, startSec: 1, evidenceRunDir: "/frame" });
    expect(ports.agentSpawn).not.toHaveBeenCalled();
  });

  it("FIX-246: story without AC block → no remediation spawn", async () => {
    const wt = remediationFixture({ withAcBlock: false });
    const base = fakePorts();
    const { ports } = fakePorts({ paths: { ...base.ports.paths, worktreePath: wt } });
    await executeCommand({ kind: "capture_facts" }, ports, { ...CTX, startSec: 1, evidenceRunDir: "/frame" });
    expect(ports.agentSpawn).not.toHaveBeenCalled();
  });

  it("FIX-246: remediation spawn throws → outcome 'spawn-failed', capture still completes", async () => {
    const wt = remediationFixture();
    const base = fakePorts();
    const { ports, calls } = fakePorts({
      paths: { ...base.ports.paths, worktreePath: wt },
      agentSpawn: vi.fn(async () => {
        throw new Error("agent unavailable");
      }),
    });
    const r = await executeCommand({ kind: "capture_facts" }, ports, { ...CTX, startSec: 1, evidenceRunDir: "/frame" });
    expect(r.event).toMatchObject({ type: "facts_captured" });
    const events = (calls["event"] ?? []).map((a) => (a as unknown[])[1] as RollEvent);
    expect(events.some((e) => e.type === "attest:remediation" && e.outcome === "spawn-failed")).toBe(true);
  });

  // FIX-244 — phantom-failure probe: a hard-blocked delivery whose work is
  // already out as a PR is "published", not a no-output failure. The capture
  // step probes the cycle branch's PR state into the facts so the classifier
  // (core classifyCaptured) can see it.
  it("FIX-244: hard-blocked capture probes the cycle-branch PR state into facts", async () => {
    const { ports } = fakePorts();
    const r = await executeCommand({ kind: "capture_facts" }, ports, { ...CTX, startSec: 1 });
    expect(ports.github.prState).toHaveBeenCalledWith("/repo", CTX.branch);
    expect(r.event).toMatchObject({ type: "facts_captured", facts: { agentExit: 1, prState: "MERGED" } });
  });

  it("FIX-244: probe failure (gh down) degrades to plain failed facts — no crash, no prState", async () => {
    const base = fakePorts();
    const { ports } = fakePorts({
      github: { ...base.ports.github, prState: vi.fn(async () => { throw new Error("gh down"); }) },
    });
    const r = await executeCommand({ kind: "capture_facts" }, ports, { ...CTX, startSec: 1 });
    expect(r.event).toMatchObject({ type: "facts_captured", facts: { agentExit: 1 } });
    const facts = (r.event as { facts: Record<string, unknown> }).facts;
    expect(facts["prState"]).toBeUndefined();
  });

  it("FIX-244: a clean capture (gate not blocking) never probes PR state", async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "roll-244-soft-")));
    execDirs.push(repo);
    mkdirSync(join(repo, ".roll"), { recursive: true });
    writeFileSync(join(repo, ".roll", "policy.yaml"), "loop_safety:\n  attest_gate: soft\n");
    const base = fakePorts();
    const { ports } = fakePorts({ repoCwd: repo, paths: { ...base.ports.paths, worktreePath: join(repo, "wt") } });
    await executeCommand({ kind: "capture_facts" }, ports, { ...CTX, startSec: 1 });
    expect(ports.github.prState).not.toHaveBeenCalled();
  });

  // FIX-293 — the peer gate now has teeth (was: verdict discarded, cycle
  // self-scored anyway). A high-complexity delivery with no peer review BLOCKS
  // (agentExit 1, so Done is withheld) and the executor re-attempts the consult
  // ONCE. The complexity check keys on a real cycle diff, so these tests build a
  // real git worktree whose branch is N files ahead of origin/main.
  function highComplexityWorktree(): string {
    const proj = realpathSync(mkdtempSync(join(tmpdir(), "roll-293-exec-")));
    execDirs.push(proj);
    const git = (cmd: string): void => execSync(`git ${cmd}`, { cwd: proj, stdio: "pipe" });
    git("init -q -b main");
    git("config user.email t@t");
    git("config user.name t");
    git("config commit.gpgsign false");
    // A story spec WITH NO AC block → the attest gate is a no-op (storyHasAcBlock
    // false), isolating the peer gate as the only thing that can block.
    const specDir = join(proj, ".roll", "features", "uncategorized", "US-RUN-001");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "spec.md"), "# US-RUN-001\n\nprose only, no AC block\n");
    writeFileSync(join(proj, "seed.txt"), "s\n");
    git("add -A");
    git('commit -q -m seed');
    git("update-ref refs/remotes/origin/main HEAD");
    git("checkout -q -b loop/cycle-x");
    for (let i = 0; i < 5; i++) writeFileSync(join(proj, `f${i}.txt`), `${i}\n`); // >3 → high
    git("add -A");
    git('commit -q -m "tcr: work"');
    return proj;
  }

  it("FIX-293 AC-H1/H2: high-complexity + no peer review (hard) → BLOCKED, agentExit 1, escalation alert", async () => {
    const wt = highComplexityWorktree();
    const rt = realpathSync(mkdtempSync(join(tmpdir(), "roll-293-rt-")));
    execDirs.push(rt);
    const base = fakePorts();
    const { ports, calls } = fakePorts({
      paths: { ...base.ports.paths, worktreePath: wt, eventsPath: join(rt, "events.ndjson"), alertsPath: join(rt, "alerts.log") },
      // Pin a deterministic peer pool: codex is heterogeneous from claude, so the
      // retry DOES consult — but the peer spawn fails (exit 1 → reviewPeer null →
      // timeout) so no evidence is produced and the cycle stays blocked NOT-Done.
      installedAgents: () => ["claude", "codex"],
      agentSpawn: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 1, timedOut: false })),
    });
    const r = await executeCommand({ kind: "capture_facts" }, ports, { ...CTX, startSec: 1 });
    expect(r.event).toMatchObject({ type: "facts_captured", facts: { agentExit: 1 } });
    expect(ports.agentSpawn).toHaveBeenCalled(); // the retry fired exactly once
    const events = (calls["event"] ?? []).map((a) => (a as unknown[])[1] as RollEvent);
    expect(events.some((e) => e.type === "peer:gate" && e.verdict === "skipped")).toBe(true);
    const alerts = (calls["alert"] ?? []).map((a) => (a as unknown[])[1] as string);
    expect(alerts.some((m) => m.includes("peer gate (hard)") && m.includes("BLOCKED"))).toBe(true);
  });

  it("FIX-293 AC-H3: retry produces peer evidence → gate re-runs consulted, NOT blocked (agentExit 0)", async () => {
    const wt = highComplexityWorktree();
    const rt = realpathSync(mkdtempSync(join(tmpdir(), "roll-293-rt2-")));
    execDirs.push(rt);
    const base = fakePorts();
    // The retry's consult writes the canonical evidence file the gate reads — we
    // simulate a successful peer by having agentSpawn drop it on disk (so the
    // re-run sees `consulted` regardless of which heterogeneous peer was picked).
    const { ports, calls } = fakePorts({
      paths: { ...base.ports.paths, worktreePath: wt, eventsPath: join(rt, "events.ndjson"), alertsPath: join(rt, "alerts.log") },
      installedAgents: () => ["claude", "codex"], // codex is the heterogeneous reviewer
      agentSpawn: vi.fn(async () => {
        // A successful peer consult: retryPeerConsult writes the canonical
        // evidence file on a non-null review (exit 0, parseable VERDICT).
        return { stdout: "VERDICT: agree\n", stderr: "", exitCode: 0, timedOut: false };
      }),
    });
    const r = await executeCommand({ kind: "capture_facts" }, ports, { ...CTX, startSec: 1 });
    // The re-run sees evidence on disk → consulted → not blocked → accept path.
    expect(r.event).toMatchObject({ type: "facts_captured", facts: { agentExit: 0 } });
    const events = (calls["event"] ?? []).map((a) => (a as unknown[])[1] as RollEvent);
    expect(events.some((e) => e.type === "peer:gate" && e.verdict === "consulted")).toBe(true);
  });

  it("FIX-312: single-agent / single-vendor env → self-review is an ALLOWED recorded fallback, NOT blocked (agentExit 0)", async () => {
    // FIX-312 supersedes the FIX-293 same-type-retry workaround for #711's
    // over-blocking. With NO heterogeneous (different-vendor) peer available
    // (heteroAvailable=false), self-review is the OWNER-ALLOWED fallback: the gate
    // records a `self-review-allowed` peer:gate event with a reason and NEVER
    // blocks. The self path is preserved for future single-agent users, not
    // removed. No forced retry spawn is needed when hetero is genuinely impossible.
    const wt = highComplexityWorktree();
    const rt = realpathSync(mkdtempSync(join(tmpdir(), "roll-312-self-")));
    execDirs.push(rt);
    const base = fakePorts();
    const { ports, calls } = fakePorts({
      paths: { ...base.ports.paths, worktreePath: wt, eventsPath: join(rt, "events.ndjson"), alertsPath: join(rt, "alerts.log") },
      installedAgents: () => ["claude"], // ONLY the working agent's vendor — no heterogeneous peer
    });
    const r = await executeCommand({ kind: "capture_facts" }, ports, { ...CTX, startSec: 1 });
    // NOT blocked — self-review is the recorded fallback when hetero is unavailable.
    expect(r.event).toMatchObject({ type: "facts_captured", facts: { agentExit: 0 } });
    const events = (calls["event"] ?? []).map((a) => (a as unknown[])[1] as RollEvent);
    const gate = events.find((e) => e.type === "peer:gate");
    expect(gate).toBeDefined();
    expect((gate as { verdict: string }).verdict).toBe("self-review-allowed");
    // The fallback is RECORDED (auditable alert), not silent.
    const alerts = (calls["alert"] ?? []).map((a) => (a as unknown[])[1] as string);
    expect(alerts.some((m) => m.includes("self-review fallback"))).toBe(true);
  });

  it("FIX-312: multi-vendor env + self-reviewed (no peer evidence) → VIOLATION, BLOCKED (agentExit 1)", async () => {
    // The mirror of the case above: when a heterogeneous peer WAS available
    // (heteroAvailable=true) but the cycle shipped with no peer evidence, that is
    // a self-review VIOLATION. The gate blocks, re-attempts the consult once, and
    // when that still yields no evidence the cycle ends NOT-Done with an
    // escalation alert. (Reproduces the FIX-284 root cause: multi-vendor configured
    // yet self-scored.)
    const wt = highComplexityWorktree();
    const rt = realpathSync(mkdtempSync(join(tmpdir(), "roll-312-violation-")));
    execDirs.push(rt);
    const base = fakePorts();
    const { ports, calls } = fakePorts({
      paths: { ...base.ports.paths, worktreePath: wt, eventsPath: join(rt, "events.ndjson"), alertsPath: join(rt, "alerts.log") },
      installedAgents: () => ["claude", "codex"], // codex is heterogeneous from claude → hetero IS available
      agentSpawn: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 1, timedOut: false })), // retry spawn fails → no evidence
    });
    const r = await executeCommand({ kind: "capture_facts" }, ports, { ...CTX, startSec: 1 });
    expect(r.event).toMatchObject({ type: "facts_captured", facts: { agentExit: 1 } });
    expect(ports.agentSpawn).toHaveBeenCalled(); // the bounded retry DID fire
    const events = (calls["event"] ?? []).map((a) => (a as unknown[])[1] as RollEvent);
    expect(events.some((e) => e.type === "peer:gate" && e.verdict === "skipped")).toBe(true);
    const alerts = (calls["alert"] ?? []).map((a) => (a as unknown[])[1] as string);
    expect(alerts.some((m) => m.includes("peer gate (hard)") && m.includes("BLOCKED"))).toBe(true);
  });

  it("FIX-293 AC-H4: policy peer_gate=soft → high-complexity + no review records but does NOT block", async () => {
    const wt = highComplexityWorktree();
    const rt = realpathSync(mkdtempSync(join(tmpdir(), "roll-293-rt3-")));
    execDirs.push(rt);
    mkdirSync(join(wt, ".roll"), { recursive: true });
    writeFileSync(join(wt, ".roll", "policy.yaml"), "loop_safety:\n  peer_gate: soft\n");
    const base = fakePorts();
    const { ports, calls } = fakePorts({
      repoCwd: wt, // policy.yaml is read from repoCwd
      paths: { ...base.ports.paths, worktreePath: wt, eventsPath: join(rt, "events.ndjson"), alertsPath: join(rt, "alerts.log") },
      // FIX-312: pin a heterogeneous pool so heteroAvailable resolves deterministically
      // (true) regardless of the real installed-agent env (local multi-vendor vs CI
      // single-vendor). Without this the executor falls back to agentsInstalled(realAgentEnv())
      // and the verdict flips "skipped"↔"self-review-allowed" by environment. This test's
      // intent is the SOFT-mode contract: a gated delivery records "skipped" but does NOT
      // block — which requires the gated (hetero-available) path.
      installedAgents: () => ["claude", "codex"],
    });
    const r = await executeCommand({ kind: "capture_facts" }, ports, { ...CTX, startSec: 1 });
    expect(r.event).toMatchObject({ type: "facts_captured", facts: { agentExit: 0 } });
    const events = (calls["event"] ?? []).map((a) => (a as unknown[])[1] as RollEvent);
    expect(events.some((e) => e.type === "peer:gate" && e.verdict === "skipped")).toBe(true);
    // soft → never invokes the retry spawn.
    expect(ports.agentSpawn).not.toHaveBeenCalled();
  });

  it("FIX-293: prior peer evidence present → consulted, no retry, not blocked", async () => {
    const wt = highComplexityWorktree();
    const rt = realpathSync(mkdtempSync(join(tmpdir(), "roll-293-rt4-")));
    execDirs.push(rt);
    mkdirSync(join(rt, "peer"), { recursive: true });
    writeFileSync(join(rt, "peer", `cycle-${CTX.cycleId}.md`), "[PEER_REVIEW] AGREE\n");
    const base = fakePorts();
    const { ports } = fakePorts({
      paths: { ...base.ports.paths, worktreePath: wt, eventsPath: join(rt, "events.ndjson"), alertsPath: join(rt, "alerts.log") },
    });
    const r = await executeCommand({ kind: "capture_facts" }, ports, { ...CTX, startSec: 1 });
    expect(r.event).toMatchObject({ type: "facts_captured", facts: { agentExit: 0 } });
    expect(ports.agentSpawn).not.toHaveBeenCalled(); // no retry needed
  });

  it("FIX-293: low-complexity delivery → peer gate not-required, no retry spawn, no peer:gate event", async () => {
    // The default fake worktree is not a git repo → cycleChangedFiles=[] → not
    // high → the peer gate is not-required: no retry, no peer:gate event. (The
    // attest gate is a separate concern and may still block on a missing report.)
    const { ports, calls } = fakePorts();
    await executeCommand({ kind: "capture_facts" }, ports, CTX);
    expect(ports.agentSpawn).not.toHaveBeenCalled(); // no peer-gate retry
    const events = (calls["event"] ?? []).map((a) => (a as unknown[])[1] as RollEvent);
    expect(events.some((e) => e.type === "peer:gate")).toBe(false);
  });

  // US-TRUTH-001 — append_run writes the versioned complete-or-reasoned
  // terminal twin alongside the runs row, from the SAME ctx facts.
  it("US-TRUTH-001: append_run appends a cycle:terminal event with present-or-reasoned facts", async () => {
    const { ports, calls } = fakePorts();
    await executeCommand(
      { kind: "append_run", status: "published", outcome: "published_pending_merge", cycleId: CTX.cycleId },
      ports,
      {
        ...CTX,
        startSec: 100,
        tcrCount: 3,
        prUrl: "https://github.com/o/r/pull/7",
        cost: {
          cycleId: CTX.cycleId,
          agent: "pi",
          model: "deepseek-v4-pro",
          tokensIn: 10,
          tokensOut: 5,
          cacheRead: 100,
          estimatedCost: 0.02,
          revertCount: 0,
          effectiveCost: 0.02,
        },
      },
    );
    const events = (calls["event"] ?? []).map((a) => (a as unknown[])[1] as RollEvent);
    const t = events.find((e) => e.type === "cycle:terminal");
    expect(t).toBeDefined();
    expect(t).toMatchObject({
      schema: 1,
      outcome: "published_pending_merge",
      pr: { present: true, value: { url: "https://github.com/o/r/pull/7", state: "OPEN" } },
      tcr: { present: true, value: 3 },
      usage: { present: true, value: { model: "deepseek-v4-pro", tokensIn: 10, tokensOut: 5, cacheRead: 100 } },
      cost: { present: true, value: { estimatedUsd: 0.02, effectiveUsd: 0.02 } },
    });
  });

  it("US-TRUTH-001: missing usage/attest become enumerated absent reasons, never zeros", async () => {
    const { ports, calls } = fakePorts();
    await executeCommand(
      { kind: "append_run", status: "failed", outcome: "failed", cycleId: CTX.cycleId },
      ports,
      { ...CTX, startSec: 100 },
    );
    const t = (calls["event"] ?? [])
      .map((a) => (a as unknown[])[1] as RollEvent)
      .find((e) => e.type === "cycle:terminal");
    expect(t).toMatchObject({
      outcome: "failed",
      pr: { present: false, reason: "no_publish_attempted" },
      usage: { present: false, reason: "no_parseable_usage" },
      cost: { present: false, reason: "no_parseable_usage" },
      attest: { present: false, reason: "acmap_missing" },
      tcr: { present: false, reason: "not_recorded" },
    });
  });

  it("FIX-253: idle terminal releases the claimed story back to Todo", async () => {
    const markStatus = vi.fn();
    const { ports } = fakePorts({ backlog: { read: vi.fn(() => []), markStatus } });
    await executeCommand(
      { kind: "append_run", status: "idle", outcome: "idle_no_work", cycleId: CTX.cycleId },
      ports,
      CTX,
    );
    expect(markStatus).toHaveBeenCalledWith("/repo", "US-RUN-001", "📋 Todo");
  });

  it("US-TRUTH-001: publish_pr success patches ctx.prUrl for the terminal record", async () => {
    const base = fakePorts();
    const { ports } = fakePorts({
      github: {
        ...base.ports.github,
        prState: vi.fn(async () => "UNKNOWN"), // fresh branch — no pre-existing PR (FIX-245 probe)
        runPublishPlan: vi.fn(async () => ({ status: 0 as const, prUrl: "https://github.com/o/r/pull/42", ok: true })),
      },
    });
    const r = await executeCommand({ kind: "publish_pr", branch: "b", docOnly: false }, ports, CTX);
    expect(r.ctxPatch).toMatchObject({ prUrl: "https://github.com/o/r/pull/42" });
  });

  it("publish_pr with a slug runs the publish plan → published(status 0)", async () => {
    const { ports } = fakePorts();
    const r = await executeCommand({ kind: "publish_pr", branch: "b", docOnly: false }, ports, CTX);
    expect(r.event).toEqual({ type: "published", result: { status: 0, manualMerge: false } });
  });

  it("US-DOSSIER-007 AC2: publish_pr mounts the execution section onto the story dossier at PR-open", async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "roll-exec-mount-")));
    execDirs.push(repo);
    const dir = join(repo, ".roll", "features", "uncategorized", "US-RUN-001");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "index.html"),
      '<html><section class="phase phase-pending" data-phase="execution"><h2>x</h2><p>e</p></section></html>',
      "utf8",
    );
    const { ports } = fakePorts({
      repoCwd: repo,
      github: {
        ...fakePorts().ports.github,
        prState: vi.fn(async () => "UNKNOWN"), // fresh branch (FIX-245 probe)
        runPublishPlan: async () => ({ status: 0 as const, prUrl: "https://github.com/o/r/pull/321", ok: true }),
      },
    });
    const r = await executeCommand({ kind: "publish_pr", branch: "b", docOnly: false }, ports, CTX);
    expect(r.event).toEqual({ type: "published", result: { status: 0, manualMerge: false } });
    const out = readFileSync(join(dir, "index.html"), "utf8");
    expect(out).toContain("PR #321");
    expect(out).toContain('class="phase phase-done" data-phase="execution"');
  });

  it("FIX-290 AC5/AC6: a non-delivery (idle) cycle terminal triggers a dossier refresh so it surfaces on #loop", async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "roll-290-idle-refresh-")));
    execDirs.push(repo);
    const featuresDir = join(repo, ".roll", "features");
    mkdirSync(featuresDir, { recursive: true });
    writeFileSync(join(repo, ".roll", "backlog.md"), "## Backlog\n\n- 📋 Todo US-RUN-001 demo card\n", "utf8");
    // A STALE index.html carrying a marker the real regen never emits — if the
    // idle terminal refreshes the dossier, the regenerate overwrites it and the
    // marker is gone (the FIX-290 bug was: only DELIVERY regenerated the board).
    const indexPath = join(featuresDir, "index.html");
    writeFileSync(indexPath, "<!-- STALE-BEFORE-FIX290 -->", "utf8");
    const { ports } = fakePorts({ repoCwd: repo });
    await executeCommand(
      { kind: "append_run", status: "idle", outcome: "idle_no_work", cycleId: CTX.cycleId },
      ports,
      CTX,
    );
    const out = readFileSync(indexPath, "utf8");
    expect(out).not.toContain("STALE-BEFORE-FIX290"); // refresh ran → board regenerated
    expect(out.length).toBeGreaterThan(100); // a real console, not the stale stub
  });

  it("FIX-245: a pre-existing OPEN PR on the cycle branch is ADOPTED — no second create, discipline alert logged", async () => {
    const base = fakePorts();
    const { ports, calls } = fakePorts({
      github: {
        ...base.ports.github,
        prState: vi.fn(async () => "OPEN"), // the agent self-published mid-cycle
      },
    });
    const r = await executeCommand({ kind: "publish_pr", branch: "loop/cycle-x", docOnly: false }, ports, CTX);
    expect(r.event).toEqual({ type: "published", result: { status: 0, manualMerge: false } });
    expect(ports.github.runPublishPlan).not.toHaveBeenCalled(); // adopted, not duplicated (I3)
    const alerts = (calls["alert"] ?? []).map((a) => String((a as unknown[])[1]));
    expect(alerts.some((m) => m.includes("discipline") && m.includes("self-published"))).toBe(true);
  });

  it("publish_pr with no slug → gh-missing tier (status 2)", async () => {
    const { ports } = fakePorts({
      github: { ...fakePorts().ports.github, repoSlug: async () => undefined },
    });
    const r = await executeCommand({ kind: "publish_pr", branch: "b", docOnly: false }, ports, CTX);
    expect(r.event).toEqual({ type: "published", result: { status: 2, mergedBack: false, orphanPushed: false, manualMerge: false } });
  });

  it("US-EVID-014: manual-merge story keeps gh-missing publish from local merge-back success", async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "roll-manual-merge-publish-")));
    execDirs.push(repo);
    mkdirSync(join(repo, ".roll"), { recursive: true });
    writeFileSync(
      join(repo, ".roll", "backlog.md"),
      "| ID | Description | Status |\n|----|-------------|--------|\n| US-RUN-001 | autofix [roll:manual-merge] | 🔨 In Progress |\n",
      "utf8",
    );
    const { ports } = fakePorts({
      repoCwd: repo,
      github: { ...fakePorts().ports.github, repoSlug: async () => undefined },
    });
    const r = await executeCommand({ kind: "publish_pr", branch: "b", docOnly: false }, ports, CTX);
    expect(r.event).toEqual({ type: "published", result: { status: 2, mergedBack: false, orphanPushed: false, manualMerge: true } });
  });

  it("wait_merge polls prState → merge_polled", async () => {
    const { ports } = fakePorts();
    const r = await executeCommand({ kind: "wait_merge", branch: "b", elapsedSec: 30 }, ports, CTX);
    expect(r.event).toEqual({ type: "merge_polled", state: "MERGED", elapsedSec: 30 });
  });

  it("emit_event stamps the clock ts and appends", async () => {
    const { ports, calls } = fakePorts();
    const ev: RollEvent = { type: "cycle:end", cycleId: CTX.cycleId, outcome: "delivered", cost: zeroCost(), ts: 0 };
    await executeCommand({ kind: "emit_event", event: ev }, ports, CTX);
    expect(calls["event"]?.[0]).toBeDefined();
    const appended = (calls["event"]?.[0] as unknown[])[1] as RollEvent;
    expect(appended.ts).toBe(42);
  });

  it("append_run upserts a v2-shaped row keyed by story+cycle", async () => {
    const { ports, calls } = fakePorts();
    await executeCommand(
      { kind: "append_run", status: "done", outcome: "delivered", cycleId: CTX.cycleId },
      ports,
      CTX,
    );
    const args = calls["run"]?.[0] as unknown[];
    expect(args[1]).toEqual({ storyId: "US-RUN-001", cycleId: CTX.cycleId });
    expect((args[2] as Record<string, unknown>)["status"]).toBe("done");
  });

  // ── FIX-295 AC-FIX1: done ≡ merged — a `done`/`published` terminal flips the
  // backlog card ONLY on confirmed MERGED evidence; a cycle that opened a PR but
  // did not merge (committed-but-unmerged) leaves the card NOT Done. ───────────
  it("FIX-295 (AC-FIX1): append_run `done` flips Done ONLY when the PR is MERGED", async () => {
    const markStatus = vi.fn();
    const { ports } = fakePorts({
      backlog: { read: vi.fn(() => [{ id: "US-RUN-001", desc: "", status: "🔨 In Progress" }]), markStatus },
      github: { ...fakePorts().ports.github, prState: vi.fn(async () => "MERGED") },
    });
    await executeCommand(
      { kind: "append_run", status: "done", outcome: "delivered", cycleId: CTX.cycleId },
      ports,
      CTX,
    );
    expect(markStatus).toHaveBeenCalledWith("/repo", "US-RUN-001", "✅ Done");
  });

  it("FIX-295 (AC-FIX1): a delivered cycle whose PR is still OPEN does NOT flip Done", async () => {
    const markStatus = vi.fn();
    const { ports } = fakePorts({
      backlog: { read: vi.fn(() => [{ id: "US-RUN-001", desc: "", status: "🔨 In Progress" }]), markStatus },
      github: { ...fakePorts().ports.github, prState: vi.fn(async () => "OPEN") },
    });
    await executeCommand(
      { kind: "append_run", status: "done", outcome: "delivered", cycleId: CTX.cycleId },
      ports,
      CTX,
    );
    // Committed-but-not-merged: the card rests at 🔨 (pending merge), never ✅ Done.
    const flips = markStatus.mock.calls.filter((c) => c[2] === "✅ Done");
    expect(flips).toHaveLength(0);
  });

  it("FIX-295 (AC-FIX1/AC-FIX2): a published terminal with an unmerged/unknown PR does NOT flip Done", async () => {
    const markStatus = vi.fn();
    const { ports } = fakePorts({
      backlog: { read: vi.fn(() => [{ id: "US-RUN-001", desc: "", status: "🔨 In Progress" }]), markStatus },
      // gh down / PR never opened → prState probe rejects → "UNKNOWN" fallback.
      github: { ...fakePorts().ports.github, prState: vi.fn(async () => Promise.reject(new Error("gh down"))) },
    });
    await executeCommand(
      { kind: "append_run", status: "published", outcome: "published_pending_merge", cycleId: CTX.cycleId },
      ports,
      CTX,
    );
    const flips = markStatus.mock.calls.filter((c) => c[2] === "✅ Done");
    expect(flips).toHaveLength(0);
  });

  // ── FIX-304: enforce done ≡ merged — a cycle that did NOT merge must NOT
  // leave a PREMATURE ✅ Done. The roll-build skill tells the agent to flip its
  // card Done in the symlinked .roll backlog (FIX-204C); a non-merged terminal
  // (failed cycle, or a `done`/`published` whose PR never merged) reverts that
  // false-Done to the pre-cycle status captured at pick time. ────────────────
  it("FIX-304: pick_story captures the story's pre-cycle status into ctxPatch", async () => {
    const has = fakePorts(); // default row is 📋 Todo
    const r = await executeCommand({ kind: "pick_story" }, has.ports, CTX);
    expect(r.ctxPatch?.preCycleStatus).toBe("📋 Todo");
  });

  // The aborted-fallback path (run-cycle.ts finally) calls this helper directly
  // rather than the executor's append_run, so cover it in isolation.
  it("FIX-304: revertPrematureDone flips a ✅ Done row back to the pre-cycle status", () => {
    const markStatus = vi.fn();
    const { ports } = fakePorts({
      backlog: { read: vi.fn(() => [{ id: "US-RUN-001", desc: "", status: "✅ Done" }]), markStatus },
    });
    revertPrematureDone(ports, "US-RUN-001", "📋 Todo");
    expect(markStatus).toHaveBeenCalledWith("/repo", "US-RUN-001", "📋 Todo");
  });

  it("FIX-304: revertPrematureDone leaves a 🔨 In Progress row untouched (not a premature flip)", () => {
    const markStatus = vi.fn();
    const { ports } = fakePorts({
      backlog: { read: vi.fn(() => [{ id: "US-RUN-001", desc: "", status: "🔨 In Progress" }]), markStatus },
    });
    revertPrematureDone(ports, "US-RUN-001", "📋 Todo");
    expect(markStatus).not.toHaveBeenCalled();
  });

  it("FIX-304: a `done` terminal whose PR did NOT merge reverts the agent's premature ✅ Done to the pre-cycle status", async () => {
    const markStatus = vi.fn();
    const { ports } = fakePorts({
      // The agent already flipped the row ✅ Done inside the worktree (symlinked .roll).
      backlog: { read: vi.fn(() => [{ id: "US-RUN-001", desc: "", status: "✅ Done" }]), markStatus },
      github: { ...fakePorts().ports.github, prState: vi.fn(async () => "OPEN") },
    });
    await executeCommand(
      { kind: "append_run", status: "done", outcome: "delivered", cycleId: CTX.cycleId },
      ports,
      { ...CTX, preCycleStatus: "📋 Todo" },
    );
    // No false-Done left behind; the row is reverted to its pre-cycle Todo.
    expect(markStatus).not.toHaveBeenCalledWith("/repo", "US-RUN-001", "✅ Done");
    expect(markStatus).toHaveBeenCalledWith("/repo", "US-RUN-001", "📋 Todo");
  });

  it("FIX-304: a FAILED terminal reverts the agent's premature ✅ Done (the FIX-284/FIX-285 false-Done)", async () => {
    const markStatus = vi.fn();
    const { ports } = fakePorts({
      backlog: { read: vi.fn(() => [{ id: "US-RUN-001", desc: "", status: "✅ Done" }]), markStatus },
    });
    await executeCommand(
      { kind: "append_run", status: "failed", outcome: "failed", cycleId: CTX.cycleId },
      ports,
      { ...CTX, preCycleStatus: "📋 Todo" },
    );
    expect(markStatus).toHaveBeenCalledWith("/repo", "US-RUN-001", "📋 Todo");
    expect(markStatus).not.toHaveBeenCalledWith("/repo", "US-RUN-001", "✅ Done");
  });

  it("FIX-304: a genuinely MERGED `done` terminal KEEPS ✅ Done (no revert)", async () => {
    const markStatus = vi.fn();
    const { ports } = fakePorts({
      backlog: { read: vi.fn(() => [{ id: "US-RUN-001", desc: "", status: "✅ Done" }]), markStatus },
      github: { ...fakePorts().ports.github, prState: vi.fn(async () => "MERGED") },
    });
    await executeCommand(
      { kind: "append_run", status: "done", outcome: "delivered", cycleId: CTX.cycleId },
      ports,
      { ...CTX, preCycleStatus: "📋 Todo" },
    );
    // Merged → Done is true; it is (re)affirmed, never reverted to Todo.
    expect(markStatus).toHaveBeenCalledWith("/repo", "US-RUN-001", "✅ Done");
    expect(markStatus).not.toHaveBeenCalledWith("/repo", "US-RUN-001", "📋 Todo");
  });

  it("FIX-304: a non-merged `done` row that already rests at 🔨 (no premature flip) is left untouched", async () => {
    const markStatus = vi.fn();
    const { ports } = fakePorts({
      backlog: { read: vi.fn(() => [{ id: "US-RUN-001", desc: "", status: "🔨 In Progress" }]), markStatus },
      github: { ...fakePorts().ports.github, prState: vi.fn(async () => "OPEN") },
    });
    await executeCommand(
      { kind: "append_run", status: "done", outcome: "delivered", cycleId: CTX.cycleId },
      ports,
      { ...CTX, preCycleStatus: "📋 Todo" },
    );
    // Delivered-pending-merge legitimately rests at 🔨 — never force it to Todo.
    expect(markStatus).not.toHaveBeenCalledWith("/repo", "US-RUN-001", "📋 Todo");
    expect(markStatus).not.toHaveBeenCalledWith("/repo", "US-RUN-001", "✅ Done");
  });

  it("FIX-304: a premature ✅ Done with no captured pre-cycle status falls back to 📋 Todo (re-pickable, never falsely Done)", async () => {
    const markStatus = vi.fn();
    const { ports } = fakePorts({
      backlog: { read: vi.fn(() => [{ id: "US-RUN-001", desc: "", status: "✅ Done" }]), markStatus },
    });
    await executeCommand(
      { kind: "append_run", status: "blocked", outcome: "blocked", cycleId: CTX.cycleId },
      ports,
      CTX, // no preCycleStatus captured
    );
    expect(markStatus).toHaveBeenCalledWith("/repo", "US-RUN-001", "📋 Todo");
  });

  // ── FIX-306: the RUNNER commits the `.roll` metadata repo, NOT the sandboxed
  // agent. codex runs under `--sandbox workspace-write` and can WRITE files under
  // `.roll` (passed via --add-dir) but CANNOT git-commit inside it — the
  // `.roll` repo's git-internal dir (`.git/worktrees/roll-meta-*/`) lives outside
  // the sandbox writable roots, so `git -C .roll add -A` fails on index.lock.
  // The runner (unsandboxed) owns the commit at cycle finalization, uniformly for
  // every agent — no per-agent special-casing. ──────────────────────────────────
  it("FIX-306: append_run commits the .roll metadata repo via the runner (not the agent)", async () => {
    const commit = vi.fn(async () => ({ committed: true, pushed: true, nothingToCommit: false }));
    const { ports } = fakePorts({ metadata: { commit } });
    await executeCommand(
      { kind: "append_run", status: "done", outcome: "delivered", cycleId: CTX.cycleId },
      ports,
      CTX,
    );
    // The runner is the one that commits .roll, against the MAIN repo (repoCwd) —
    // the agent never runs `git -C .roll commit`.
    expect(commit).toHaveBeenCalledTimes(1);
    expect((commit.mock.calls[0] as unknown[])[0]).toBe("/repo");
  });

  it("FIX-306: a failed metadata push surfaces a clear ALERT (no silent false-success)", async () => {
    const commit = vi.fn(async () => ({
      committed: true,
      pushed: false,
      nothingToCommit: false,
      error: "push rejected: non-fast-forward",
    }));
    const { ports, calls } = fakePorts({ metadata: { commit } });
    await executeCommand(
      { kind: "append_run", status: "done", outcome: "delivered", cycleId: CTX.cycleId },
      ports,
      CTX,
    );
    const alerts = (calls["alert"] ?? []).map((a) => (a as unknown[])[1]).join("\n");
    expect(alerts).toContain(".roll");
    expect(alerts.toLowerCase()).toContain("push");
  });

  it("FIX-306: a clean .roll (nothing to commit) no-ops without an ALERT", async () => {
    const commit = vi.fn(async () => ({ committed: false, pushed: false, nothingToCommit: true }));
    const { ports, calls } = fakePorts({ metadata: { commit } });
    await executeCommand(
      { kind: "append_run", status: "idle", outcome: "idle_no_work", cycleId: CTX.cycleId },
      ports,
      CTX,
    );
    expect(commit).toHaveBeenCalledTimes(1);
    const alerts = (calls["alert"] ?? []).map((a) => (a as unknown[])[1]).join("\n");
    expect(alerts).not.toContain(".roll metadata");
  });

  it("release_lock reports lockReleased", async () => {
    const { ports } = fakePorts();
    const r = await executeCommand({ kind: "release_lock" }, ports, CTX);
    expect(r.lockReleased).toBe(true);
  });

  it("cleanup_worktree calls the git remove port", async () => {
    const { ports } = fakePorts();
    await executeCommand({ kind: "cleanup_worktree", branch: "b" }, ports, CTX);
    expect(ports.git.worktreeRemove).toHaveBeenCalled();
  });
});

function zeroCost(): RollEvent extends { type: "cycle:end"; cost: infer C } ? C : never {
  return {
    cycleId: CTX.cycleId,
    agent: "claude",
    model: "",
    tokensIn: 0,
    tokensOut: 0,
    estimatedCost: 0,
    revertCount: 0,
    effectiveCost: 0,
  } as never;
}

// Touch a CycleCommand type so the import is load-bearing in the test file.
const _sample: CycleCommand = { kind: "release_lock" };
void _sample;

describe("withPtyWrap — FIX-224 non-claude agents get a PTY (v2 _AGENT_PTY_PREFIX)", () => {
  it("pi on darwin wraps in `script -q /dev/null` preserving argv order", () => {
    const w = withPtyWrap({ bin: "pi", args: ["-p", "PROMPT"] }, "pi", "darwin");
    expect(w).toEqual({ bin: "script", args: ["-q", "/dev/null", "pi", "-p", "PROMPT"], pty: true });
  });

  it("kimi on darwin wraps too (any non-claude agent)", () => {
    const w = withPtyWrap({ bin: "kimi", args: ["-p", "X"] }, "kimi", "darwin");
    expect(w.bin).toBe("script");
    expect(w.pty).toBe(true);
  });

  it("claude is NEVER wrapped — stream-json stays on plain pipes", () => {
    const w = withPtyWrap({ bin: "claude", args: ["-p", "X"] }, "claude", "darwin");
    expect(w).toEqual({ bin: "claude", args: ["-p", "X"], pty: false });
  });

  it("non-darwin platforms are not wrapped (util-linux script needs -c quoting)", () => {
    const w = withPtyWrap({ bin: "pi", args: ["-p", "X"] }, "pi", "linux");
    expect(w).toEqual({ bin: "pi", args: ["-p", "X"], pty: false });
  });

  it("bin override (test shims) still wraps — script runs the shim", () => {
    const w = withPtyWrap({ bin: "/tmp/shim/pi", args: ["-p", "X"] }, "pi", "darwin");
    expect(w.args).toEqual(["-q", "/dev/null", "/tmp/shim/pi", "-p", "X"]);
  });
});

describe.runIf(process.platform === "darwin")("FIX-224 darwin integration — real script PTY", () => {
  it("pi shim under script: stdout streams through and exit code survives", async () => {
    const shimDir = mkdtempSync(join(tmpdir(), "roll-pty-shim-"));
    const shim = join(shimDir, "pi");
    writeFileSync(shim, "#!/bin/sh\n[ -t 1 ] && echo TTY=yes || echo TTY=no\necho HELLO-FROM-PI\nexit 0\n");
    chmodSync(shim, 0o755);
    const chunks: string[] = [];
    const r = await realAgentSpawn("pi", {
      cwd: shimDir,
      skillBody: "X",
      bin: shim,
      timeoutMs: 15000,
      onChunk: (d) => chunks.push(d.toString("utf8")),
    });
    expect(r.exitCode).toBe(0);
    // The agent saw a PTY (the whole point of the wrap)…
    expect(r.stdout).toContain("TTY=yes");
    // …and its output streamed through onChunk to the live log.
    expect(chunks.join("")).toContain("HELLO-FROM-PI");
    execFileSync("rm", ["-rf", shimDir]);
  });

  it("timeout group-kill reaps the agent UNDER script (no haunted worktree)", async () => {
    const shimDir = mkdtempSync(join(tmpdir(), "roll-pty-kill-"));
    const marker = `roll-fix224-${process.pid}`;
    const shim = join(shimDir, "pi");
    writeFileSync(shim, `#!/bin/sh\necho ALIVE ${marker}\nsleep 600\n`);
    chmodSync(shim, 0o755);
    const r = await realAgentSpawn("pi", {
      cwd: shimDir,
      skillBody: "X",
      bin: shim,
      timeoutMs: 1500,
    });
    expect(r.timedOut).toBe(true);
    // One settle tick later, NOTHING carrying the marker may survive —
    // neither script nor the sleeping shim under it.
    await new Promise((res) => setTimeout(res, 500));
    let survivors = "";
    try {
      survivors = execFileSync("pgrep", ["-lf", marker]).toString("utf8");
    } catch {
      /* pgrep exit 1 = no match = good */
    }
    expect(survivors).toBe("");
    execFileSync("rm", ["-rf", shimDir]);
  }, 20000);
});

describe("FIX-268 — worktree deps bootstrap before agent spawn", () => {
  function tmpWorktree(): string {
    const d = realpathSync(mkdtempSync(join(tmpdir(), "roll-deps-")));
    execDirs.push(d);
    return d;
  }
  function alertSink(): { events: { appendAlert: ReturnType<typeof vi.fn> }; alerts: string[] } {
    const alerts: string[] = [];
    return { events: { appendAlert: vi.fn((_p: string, msg: string) => alerts.push(msg)) }, alerts };
  }

  it("skips a non-Node worktree (no package.json) without exec or alert", async () => {
    const wt = tmpWorktree();
    const exec = vi.fn(async () => ({}));
    const { events, alerts } = alertSink();
    await bootstrapWorktreeDeps(wt, join(wt, "alerts.md"), events as never, exec);
    expect(exec).not.toHaveBeenCalled();
    expect(alerts).toEqual([]);
  });

  it("runs pnpm install --prefer-offline in a pnpm worktree", async () => {
    const wt = tmpWorktree();
    writeFileSync(join(wt, "package.json"), "{}\n");
    writeFileSync(join(wt, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    const exec = vi.fn(async () => ({}));
    const { events } = alertSink();
    await bootstrapWorktreeDeps(wt, join(wt, "alerts.md"), events as never, exec);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0]?.[0]).toBe("pnpm");
    expect(exec.mock.calls[0]?.[1]).toEqual(["install", "--prefer-offline"]);
    expect(exec.mock.calls[0]?.[2]).toMatchObject({ cwd: wt });
  });

  it("runs npm ci for a package-lock worktree", async () => {
    const wt = tmpWorktree();
    writeFileSync(join(wt, "package.json"), "{}\n");
    writeFileSync(join(wt, "package-lock.json"), "{}\n");
    const exec = vi.fn(async () => ({}));
    const { events } = alertSink();
    await bootstrapWorktreeDeps(wt, join(wt, "alerts.md"), events as never, exec);
    expect(exec.mock.calls[0]?.[0]).toBe("npm");
    expect(exec.mock.calls[0]?.[1]).toEqual(["ci", "--prefer-offline"]);
  });

  it("skips when node_modules already exists (idempotent re-entry)", async () => {
    const wt = tmpWorktree();
    writeFileSync(join(wt, "package.json"), "{}\n");
    writeFileSync(join(wt, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    mkdirSync(join(wt, "node_modules"));
    const exec = vi.fn(async () => ({}));
    const { events } = alertSink();
    await bootstrapWorktreeDeps(wt, join(wt, "alerts.md"), events as never, exec);
    expect(exec).not.toHaveBeenCalled();
  });

  it("an install failure leaves a FAIL alert and reports failure (strict)", async () => {
    const wt = tmpWorktree();
    writeFileSync(join(wt, "package.json"), "{}\n");
    writeFileSync(join(wt, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    const exec = vi.fn(async () => {
      throw new Error("ENOTFOUND registry.npmjs.org");
    });
    const { events, alerts } = alertSink();
    await expect(bootstrapWorktreeDeps(wt, join(wt, "alerts.md"), events as never, exec)).resolves.toBe(false);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("[FAIL] worktree deps bootstrap failed");
    expect(alerts[0]).toContain("ENOTFOUND");
  });
});

describe("FIX-302 — worktree submodule (skills/) populate before agent spawn", () => {
  function tmpWorktree(): string {
    const d = realpathSync(mkdtempSync(join(tmpdir(), "roll-skills-")));
    execDirs.push(d);
    return d;
  }
  function alertSink(): { events: { appendAlert: ReturnType<typeof vi.fn> }; alerts: string[] } {
    const alerts: string[] = [];
    return { events: { appendAlert: vi.fn((_p: string, msg: string) => alerts.push(msg)) }, alerts };
  }

  it("skips a non-submodule worktree (no .gitmodules) without init or alert", async () => {
    const wt = tmpWorktree();
    const init = vi.fn(async () => ({ code: 0 }));
    const { events, alerts } = alertSink();
    await expect(bootstrapWorktreeSkills(wt, join(wt, "alerts.md"), events as never, init)).resolves.toBe(true);
    expect(init).not.toHaveBeenCalled();
    expect(alerts).toEqual([]);
  });

  it("runs submodule init and verifies skills/ is populated (AC1/AC2)", async () => {
    const wt = tmpWorktree();
    writeFileSync(join(wt, ".gitmodules"), '[submodule "skills"]\n  path = skills\n');
    // init double materializes skills/ like a real `git submodule update`.
    const init = vi.fn(async () => {
      mkdirSync(join(wt, "skills", "roll-build"), { recursive: true });
      writeFileSync(join(wt, "skills", "roll-build", "SKILL.md"), "# skill\n");
      return { code: 0 };
    });
    const { events, alerts } = alertSink();
    await expect(bootstrapWorktreeSkills(wt, join(wt, "alerts.md"), events as never, init)).resolves.toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0]?.[0]).toBe(wt);
    expect(readdirSync(join(wt, "skills")).length).toBeGreaterThan(0);
    expect(alerts).toEqual([]);
  });

  it("skips when skills/ is already populated (idempotent re-entry)", async () => {
    const wt = tmpWorktree();
    writeFileSync(join(wt, ".gitmodules"), '[submodule "skills"]\n  path = skills\n');
    mkdirSync(join(wt, "skills", "roll-build"), { recursive: true });
    writeFileSync(join(wt, "skills", "roll-build", "SKILL.md"), "# skill\n");
    const init = vi.fn(async () => ({ code: 0 }));
    const { events } = alertSink();
    await expect(bootstrapWorktreeSkills(wt, join(wt, "alerts.md"), events as never, init)).resolves.toBe(true);
    expect(init).not.toHaveBeenCalled();
  });

  it("a non-zero init code leaves a FAIL alert and reports failure (AC3)", async () => {
    const wt = tmpWorktree();
    writeFileSync(join(wt, ".gitmodules"), '[submodule "skills"]\n  path = skills\n');
    const init = vi.fn(async () => ({ code: 128 }));
    const { events, alerts } = alertSink();
    await expect(bootstrapWorktreeSkills(wt, join(wt, "alerts.md"), events as never, init)).resolves.toBe(false);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("[FAIL] worktree submodule init failed");
    expect(alerts[0]).toContain("skills/");
  });

  it("a thrown init (network/auth) leaves a FAIL alert and reports failure (AC3)", async () => {
    const wt = tmpWorktree();
    writeFileSync(join(wt, ".gitmodules"), '[submodule "skills"]\n  path = skills\n');
    const init = vi.fn(async () => {
      throw new Error("Permission denied (publickey)");
    });
    const { events, alerts } = alertSink();
    await expect(bootstrapWorktreeSkills(wt, join(wt, "alerts.md"), events as never, init)).resolves.toBe(false);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("[FAIL] worktree submodule init failed");
    expect(alerts[0]).toContain("Permission denied");
  });

  it("init reports success but skills/ stays empty → honest FAIL (AC3)", async () => {
    const wt = tmpWorktree();
    writeFileSync(join(wt, ".gitmodules"), '[submodule "skills"]\n  path = skills\n');
    const init = vi.fn(async () => ({ code: 0 })); // lies: leaves skills/ empty
    const { events, alerts } = alertSink();
    await expect(bootstrapWorktreeSkills(wt, join(wt, "alerts.md"), events as never, init)).resolves.toBe(false);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("still empty");
  });
});
