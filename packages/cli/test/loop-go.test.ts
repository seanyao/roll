import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseGoalYaml } from "@roll/spec";
import { loopGoCommand, spawnFinalReviewAgent, type LoopGoDeps } from "../src/commands/loop-go.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function project(): string {
  const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-go-")));
  dirs.push(p);
  mkdirSync(join(p, ".roll", "loop"), { recursive: true });
  return p;
}

function capture(fn: () => Promise<number>): Promise<{ code: number; out: string; err: string }> {
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

function readEvents(p: string): Array<Record<string, unknown>> {
  return readFileSync(join(p, ".roll", "loop", "events.ndjson"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function writeBacklog(p: string, rows: string[]): void {
  mkdirSync(join(p, ".roll"), { recursive: true });
  writeFileSync(
    join(p, ".roll", "backlog.md"),
    ["| ID | Title | Status |", "|---|---|---|", ...rows].join("\n") + "\n",
  );
}

function writeIndex(p: string, stories: Record<string, string>): void {
  writeFileSync(join(p, ".roll", "index.json"), `${JSON.stringify({ stories }, null, 2)}\n`);
}

function completeGoalDeps(p: string, review?: NonNullable<LoopGoDeps["finalReview"]>): LoopGoDeps {
  let calls = 0;
  const deps: LoopGoDeps = {
    identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
    pid: () => 12345,
    nowSec: () => 1_780_000_000 + calls,
    nowIso: () => `2026-06-11T10:00:0${calls}Z`,
    hasTmux: () => false,
    startTmux: () => false,
    prEvidence: () => Promise.resolve({ state: "MERGED", mergedAtSec: 1_779_999_000 }),
    runOnce: async ({ projectPath }) => {
      calls += 1;
      writeFileSync(
        join(projectPath, ".roll", "loop", "events.ndjson"),
        `${JSON.stringify({ type: "cycle:start", cycleId: `cycle-${calls}`, storyId: "US-DONE", agent: "", model: "", ts: 1_780_000_000 + calls })}\n`,
        { flag: "a" },
      );
      writeFileSync(
        join(projectPath, ".roll", "loop", "runs.jsonl"),
        `${JSON.stringify({ story_id: "US-DONE", cycle_id: `cycle-${calls}`, ts: `2026-06-11T10:00:0${calls}Z`, agent: "claude", status: "done" })}\n`,
        { flag: "a" },
      );
      return 0;
    },
  };
  if (review !== undefined) deps.finalReview = review;
  return deps;
}

const approveFinalReview: NonNullable<LoopGoDeps["finalReview"]> = async () => ({
  effectiveMode: "hetero",
  reviewer: "codex",
  provider: "openai",
  verdict: "APPROVE",
  reason: "accepted",
  findings: [],
});

describe("US-GOAL-002 — roll loop go", () => {
  it("prints help for review modes without starting a session", async () => {
    const p = project();
    const r = await capture(() => loopGoCommand(["--help"], completeGoalDeps(p)));
    expect(r.code).toBe(0);
    expect(r.out).toContain("Usage: roll loop go");
    expect(r.out).toContain("--budget <usd>");
    expect(r.out).toContain("--for <duration>");
    expect(r.out).toContain("--usage-threshold <ratio>");
    expect(r.out).toContain("--no-wait");
    expect(r.out).toContain("Safety gates");
    expect(r.out).toContain("--review <mode>");
    expect(r.out).toContain("hetero");
    expect(r.out).toContain("goal:final_review SKIPPED");
    expect(existsSync(join(p, ".roll", "loop", "goal.yaml"))).toBe(false);
    expect(r.err).toBe("");
  });

  it("fails loud for invalid safety gate option values before starting a session", async () => {
    const cases: Array<{ args: string[]; message: string }> = [
      { args: ["--worker", "--budget", "abc"], message: "--budget must be a non-negative number" },
      { args: ["--worker", "--budget="], message: "--budget must be a non-negative number" },
      { args: ["--worker", "--for", "never"], message: "--for must be a duration" },
      { args: ["--worker", "--usage-threshold", "2"], message: "--usage-threshold must be a ratio between 0 and 1" },
    ];

    for (const item of cases) {
      const p = project();
      let identityCalls = 0;
      const deps: LoopGoDeps = {
        ...completeGoalDeps(p),
        identity: () => {
          identityCalls += 1;
          return Promise.resolve({ path: p, slug: "proj-abc123" });
        },
      };

      await expect(loopGoCommand(item.args, deps)).rejects.toThrow(item.message);
      expect(identityCalls).toBe(0);
      expect(existsSync(join(p, ".roll", "loop", "goal.yaml"))).toBe(false);
    }
  });

  it("runs cycles back-to-back until a pause marker, then pauses the goal at the cycle boundary", async () => {
    const p = project();
    let calls = 0;
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_000_000 + calls,
      nowIso: () => `2026-06-11T08:00:0${calls}Z`,
      hasTmux: () => false,
      startTmux: () => false,
      runOnce: async ({ projectPath }) => {
        calls += 1;
        const rt = join(projectPath, ".roll", "loop");
        const cycle = `cycle-${calls}`;
        writeFileSync(
          join(rt, "events.ndjson"),
          `${JSON.stringify({ type: "cycle:start", cycleId: cycle, storyId: `US-${calls}`, agent: "claude", model: "m", ts: 1_780_000_000 + calls })}\n` +
            `${JSON.stringify({ type: "cycle:end", cycleId: cycle, outcome: "delivered", cost: { cycleId: cycle, agent: "claude", model: "m", tokensIn: 0, tokensOut: 0, estimatedCost: calls, revertCount: 0, effectiveCost: calls }, ts: 1_780_000_100 + calls })}\n`,
          { flag: "a" },
        );
        writeFileSync(
          join(rt, "runs.jsonl"),
          `${JSON.stringify({ story_id: `US-${calls}`, cycle_id: cycle, ts: `2026-06-11T08:00:0${calls}Z`, cost_usd: calls, cost_effective_usd: calls, status: "done" })}\n`,
          { flag: "a" },
        );
        if (calls === 2) writeFileSync(join(rt, "PAUSE-proj-abc123"), "owner pause\n");
        return 0;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker"], deps));

    expect(r.code).toBe(0);
    expect(calls).toBe(2);
    expect(existsSync(join(p, ".roll", "loop", "go.lock"))).toBe(false);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.status).toBe("paused");
    expect(goal.scope).toEqual({ kind: "all" });
    expect(goal.usage).toEqual({ cycles: 2, costUsd: 3 });
    expect(goal.lastDecisionReason).toContain("pause");
    const types = readEvents(p).map((e) => e.type);
    expect(types).toContain("goal:created");
    expect(types).toContain("goal:session_start");
    expect(types).toContain("goal:state");
    expect(types).toContain("goal:session_end");
    expect(readEvents(p).find((e) => e.type === "goal:created")).toMatchObject({ review: "auto" });
  });

  it("refuses a second go worker while the go session lock is held", async () => {
    const p = project();
    writeFileSync(join(p, ".roll", "loop", "go.lock"), `${process.pid}:1780000000\n`);
    let calls = 0;
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 99999,
      nowSec: () => 1_780_000_001,
      nowIso: () => "2026-06-11T08:00:00Z",
      hasTmux: () => false,
      startTmux: () => false,
      runOnce: async () => {
        calls += 1;
        return 0;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker"], deps));

    expect(r.code).toBe(0);
    expect(calls).toBe(0);
    expect(r.out).toContain("go session already active");
    const events = readEvents(p);
    expect(events.some((e) => e.type === "goal:tick_skipped" && e.reason === "go_session_lock")).toBe(true);
  });
});

describe("US-GOAL-003 — goal truth adjudication", () => {
  it("--cards scope completes only through merge-backed story truth", async () => {
    const p = project();
    writeBacklog(p, [
      "| [US-DONE](.roll/features/goal-mode/US-DONE/spec.md) | done | ✅ Done · PR#1 |",
      "| [FIX-DONE](.roll/features/goal-mode/FIX-DONE/spec.md) | done | ✅ Done · PR#2 |",
    ]);
    let calls = 0;
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_000_000 + calls,
      nowIso: () => `2026-06-11T09:00:0${calls}Z`,
      hasTmux: () => false,
      startTmux: () => false,
      prEvidence: () => Promise.resolve({ state: "MERGED", mergedAtSec: 1_779_999_000 }),
      finalReview: approveFinalReview,
      runOnce: async ({ projectPath }) => {
        calls += 1;
        writeFileSync(
          join(projectPath, ".roll", "loop", "runs.jsonl"),
          `${JSON.stringify({ story_id: "US-DONE", cycle_id: `cycle-${calls}`, ts: `2026-06-11T09:00:0${calls}Z`, cost_usd: 1, cost_effective_usd: 1, status: "done" })}\n`,
          { flag: "a" },
        );
        return 0;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker", "--cards", "US-DONE,FIX-DONE"], deps));

    expect(r.code).toBe(0);
    expect(calls).toBe(1);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.status).toBe("complete");
    expect(goal.scope).toEqual({ kind: "cards", cards: ["US-DONE", "FIX-DONE"] });
    expect(goal.lastDecisionReason).toContain("all_delivered");
    const events = readEvents(p);
    expect(events.some((e) => e.type === "goal:evaluated" && e.status === "complete")).toBe(true);
    expect(events.some((e) => e.type === "goal:state" && e.to === "complete" && e.actor === "adjudicator")).toBe(true);
  });

  it("premature Done truth failure never completes the goal", async () => {
    const p = project();
    writeBacklog(p, [
      "| [US-DRIFT-1](.roll/features/e/US-DRIFT-1/spec.md) | premature done | ✅ Done · PR#10 |",
    ]);
    let calls = 0;
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_000_000 + calls,
      nowIso: () => `2026-06-11T09:10:0${calls}Z`,
      hasTmux: () => false,
      startTmux: () => false,
      prEvidence: () => Promise.resolve({ state: "OPEN" }),
      runOnce: async ({ projectPath }) => {
        calls += 1;
        writeFileSync(
          join(projectPath, ".roll", "loop", "runs.jsonl"),
          `${JSON.stringify({ story_id: "US-DRIFT-1", cycle_id: `cycle-${calls}`, ts: `2026-06-11T09:10:0${calls}Z`, cost_usd: 1, status: "done" })}\n`,
          { flag: "a" },
        );
        return 0;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker", "--cards", "US-DRIFT-1", "--max-cycles", "1"], deps));

    expect(r.code).toBe(0);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.status).not.toBe("complete");
    const evaluated = readEvents(p).find((e) => e.type === "goal:evaluated");
    expect(evaluated).toMatchObject({
      status: "continue",
      reason: "blocked:US-DRIFT-1:premature_done",
    });
  });

  it("--epic scope resolves through index.json and ignores other epics", async () => {
    const p = project();
    writeBacklog(p, [
      "| [US-A](.roll/features/goal-mode/US-A/spec.md) | a | ✅ Done · PR#1 |",
      "| [US-B](.roll/features/other/US-B/spec.md) | b | 📋 Todo |",
    ]);
    writeIndex(p, { "US-A": "goal-mode", "US-B": "other" });
    let calls = 0;
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_000_000 + calls,
      nowIso: () => `2026-06-11T09:20:0${calls}Z`,
      hasTmux: () => false,
      startTmux: () => false,
      prEvidence: () => Promise.resolve({ state: "MERGED", mergedAtSec: 1_779_999_000 }),
      finalReview: approveFinalReview,
      runOnce: async ({ projectPath }) => {
        calls += 1;
        writeFileSync(
          join(projectPath, ".roll", "loop", "runs.jsonl"),
          `${JSON.stringify({ story_id: "US-A", cycle_id: `cycle-${calls}`, ts: `2026-06-11T09:20:0${calls}Z`, status: "done" })}\n`,
          { flag: "a" },
        );
        return 0;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker", "--epic", "goal-mode"], deps));

    expect(r.code).toBe(0);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.status).toBe("complete");
    expect(goal.scope).toEqual({ kind: "epic", epic: "goal-mode" });
    const evaluated = readEvents(p).find((e) => e.type === "goal:evaluated");
    expect(evaluated).toMatchObject({ total: 1, delivered: 1, status: "complete" });
  });

  it("default all scope completes once no backlog Todo rows remain", async () => {
    const p = project();
    writeBacklog(p, [
      "| [US-DONE](.roll/features/goal-mode/US-DONE/spec.md) | done | ✅ Done · PR#1 |",
    ]);
    let calls = 0;
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_000_000 + calls,
      nowIso: () => `2026-06-11T09:30:0${calls}Z`,
      hasTmux: () => false,
      startTmux: () => false,
      finalReview: approveFinalReview,
      runOnce: async ({ projectPath }) => {
        calls += 1;
        writeFileSync(
          join(projectPath, ".roll", "loop", "runs.jsonl"),
          `${JSON.stringify({ story_id: "US-DONE", cycle_id: `cycle-${calls}`, ts: `2026-06-11T09:30:0${calls}Z`, status: "done" })}\n`,
          { flag: "a" },
        );
        return 0;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker"], deps));

    expect(r.code).toBe(0);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.status).toBe("complete");
    expect(goal.scope).toEqual({ kind: "all" });
    const evaluated = readEvents(p).find((e) => e.type === "goal:evaluated");
    expect(evaluated).toMatchObject({ total: 0, delivered: 0, status: "complete", reason: "all_delivered" });
  });
});

describe("US-GOAL-004 — no-progress suppression", () => {
  it("skips a scoped card after two zero-delivery attempts and pauses when all scoped cards are skipped", async () => {
    const p = project();
    writeBacklog(p, [
      "| [REFACTOR-048](.roll/features/goal-mode/REFACTOR-048/spec.md) | stale merged card | 📋 Todo |",
    ]);
    let calls = 0;
    const allowed: Array<string[] | undefined> = [];
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_000_000 + calls,
      nowIso: () => `2026-06-11T10:00:0${calls}Z`,
      hasTmux: () => false,
      startTmux: () => false,
      runOnce: async ({ projectPath, allowedCards }) => {
        calls += 1;
        allowed.push(allowedCards);
        writeFileSync(
          join(projectPath, ".roll", "loop", "runs.jsonl"),
          `${JSON.stringify({
            story_id: "REFACTOR-048",
            cycle_id: `cycle-${calls}`,
            ts: `2026-06-11T10:00:0${calls}Z`,
            status: "failed",
            outcome: "failed",
            tcr_count: 0,
          })}\n`,
          { flag: "a" },
        );
        return 1;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker", "--cards", "REFACTOR-048", "--max-cycles", "5"], deps));

    expect(r.code).toBe(0);
    expect(calls).toBe(2);
    expect(allowed).toEqual([["REFACTOR-048"], ["REFACTOR-048"]]);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.status).toBe("paused");
    expect(goal.lastDecisionReason).toContain("no_progress_on_all_cards");
    const events = readEvents(p);
    expect(events.some((e) => e.type === "goal:card_skipped" && e.storyId === "REFACTOR-048")).toBe(true);
    expect(events.some((e) => e.type === "goal:state" && e.to === "paused" && e.reason === "no_progress_on_all_cards")).toBe(true);
    const alert = readFileSync(join(p, ".roll", "loop", "ALERT-proj-abc123.md"), "utf8");
    expect(alert).toContain("REFACTOR-048");
    expect(alert).toContain("zero delivery");
  });

  it("passes only unskipped scoped cards to run-once after a card is skipped", async () => {
    const p = project();
    writeBacklog(p, [
      "| [US-STUCK](.roll/features/goal-mode/US-STUCK/spec.md) | stuck | 📋 Todo |",
      "| [US-NEXT](.roll/features/goal-mode/US-NEXT/spec.md) | next | 📋 Todo |",
    ]);
    let calls = 0;
    const allowed: Array<string[] | undefined> = [];
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_000_100 + calls,
      nowIso: () => `2026-06-11T10:10:0${calls}Z`,
      hasTmux: () => false,
      startTmux: () => false,
      runOnce: async ({ projectPath, allowedCards }) => {
        calls += 1;
        allowed.push(allowedCards);
        const story = calls <= 2 ? "US-STUCK" : "US-NEXT";
        writeFileSync(
          join(projectPath, ".roll", "loop", "runs.jsonl"),
          `${JSON.stringify({
            story_id: story,
            cycle_id: `cycle-${calls}`,
            ts: `2026-06-11T10:10:0${calls}Z`,
            status: "failed",
            outcome: "failed",
            tcr_count: 0,
          })}\n`,
          { flag: "a" },
        );
        return 1;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker", "--cards", "US-STUCK,US-NEXT", "--max-cycles", "3"], deps));

    expect(r.code).toBe(0);
    expect(calls).toBe(3);
    expect(allowed[0]).toEqual(["US-STUCK", "US-NEXT"]);
    expect(allowed[1]).toEqual(["US-STUCK", "US-NEXT"]);
    expect(allowed[2]).toEqual(["US-NEXT"]);
  });
});

describe("US-GOAL-005 — goal safety gates", () => {
  it("--budget moves the goal to budget_limited and records the actual cost reading", async () => {
    const p = project();
    writeBacklog(p, [
      "| [US-COST](.roll/features/goal-mode/US-COST/spec.md) | cost | 📋 Todo |",
    ]);
    let calls = 0;
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_000_500 + calls,
      nowIso: () => `2026-06-11T11:00:0${calls}Z`,
      hasTmux: () => false,
      startTmux: () => false,
      runOnce: async ({ projectPath }) => {
        calls += 1;
        writeFileSync(
          join(projectPath, ".roll", "loop", "runs.jsonl"),
          `${JSON.stringify({ story_id: "US-COST", cycle_id: "cycle-1", ts: "2026-06-11T11:00:01Z", cost_usd: 6, cost_effective_usd: 6, status: "failed" })}\n`,
          { flag: "a" },
        );
        return 1;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker", "--cards", "US-COST", "--budget", "5"], deps));

    expect(r.code).toBe(0);
    expect(calls).toBe(1);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.status).toBe("budget_limited");
    expect(goal.lastDecisionReason).toBe("budget_exceeded");
    expect(goal.safety?.lastGate).toBe("budget");
    expect(goal.safety?.lastReading).toContain("$6.00 / $5.00");
    const event = readEvents(p).find((e) => e.type === "goal:gate_tripped" && e.gate === "budget");
    expect(event).toMatchObject({ action: "budget_limited", reason: "budget_exceeded", reading: { costUsd: 6, budgetUsd: 5 } });
  });

  it("--budget treats missing usage_cost fields as unknown, not zero", async () => {
    const p = project();
    writeBacklog(p, [
      "| [US-UNKNOWN](.roll/features/goal-mode/US-UNKNOWN/spec.md) | unknown | 📋 Todo |",
    ]);
    let calls = 0;
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_000_600 + calls,
      nowIso: () => `2026-06-11T11:10:0${calls}Z`,
      hasTmux: () => false,
      startTmux: () => false,
      runOnce: async ({ projectPath }) => {
        calls += 1;
        writeFileSync(
          join(projectPath, ".roll", "loop", "runs.jsonl"),
          `${JSON.stringify({ story_id: "US-UNKNOWN", cycle_id: "cycle-1", ts: "2026-06-11T11:10:01Z", status: "failed" })}\n`,
          { flag: "a" },
        );
        return 1;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker", "--cards", "US-UNKNOWN", "--budget", "10"], deps));

    expect(r.code).toBe(0);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.status).toBe("budget_limited");
    expect(goal.usage.costUnknownRows).toBe(1);
    expect(goal.lastDecisionReason).toBe("budget_unknown_cost");
    const event = readEvents(p).find((e) => e.type === "goal:gate_tripped" && e.gate === "budget");
    expect(event).toMatchObject({ reason: "budget_unknown_cost", reading: { unknownCostRows: 1, budgetUsd: 10 } });
  });

  it("--budget blocks an already over-budget resumed goal before starting another cycle", async () => {
    const p = project();
    writeFileSync(
      join(p, ".roll", "loop", "goal.yaml"),
      `schema: goal.v1
scope:
  kind: all
review: auto
budgetUsd: 5
limits:
status: active
usage:
  cycles: 2
  costUsd: 6
createdAt: 2026-06-11T11:15:00Z
updatedAt: 2026-06-11T11:15:00Z
`,
    );
    let calls = 0;
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_000_650,
      nowIso: () => "2026-06-11T11:15:30Z",
      hasTmux: () => false,
      startTmux: () => false,
      runOnce: async () => {
        calls += 1;
        return 0;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker", "--budget", "5"], deps));

    expect(r.code).toBe(0);
    expect(calls).toBe(0);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.status).toBe("budget_limited");
    expect(goal.lastDecisionReason).toBe("budget_exceeded");
    expect(readEvents(p).some((e) => e.type === "goal:gate_tripped" && e.gate === "budget" && e.action === "budget_limited")).toBe(true);
  });

  it("FIX-279: a flagless go does not inherit a prior session's budget — budget is explicit per go", async () => {
    const p = project();
    // Stale goal from a prior session: $2 budget, capped at 1 cycle, already
    // budget_limited with a leftover unknown-cost row. Today's flagless `go`
    // must NOT inherit any of that — no --budget means no budget this run.
    writeFileSync(
      join(p, ".roll", "loop", "goal.yaml"),
      `schema: goal.v1
scope:
  kind: epic
  epic: US-CLI
review: auto
budgetUsd: 2
limits:
  maxCycles: 1
status: budget_limited
usage:
  cycles: 1
  costUsd: 0
  costUnknownRows: 1
createdAt: 2026-06-11T16:11:49Z
updatedAt: 2026-06-12T00:00:00Z
`,
    );
    let calls = 0;
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_000_650,
      nowIso: () => "2026-06-13T06:31:30Z",
      hasTmux: () => false,
      startTmux: () => false,
      runOnce: async () => {
        calls += 1;
        return 0;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker", "--epic", "US-CLI"], deps));

    expect(r.code).toBe(0);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    // budget cleared (not inherited), and the stale maxCycles:1 cap dropped.
    expect(goal.budgetUsd).toBeUndefined();
    expect(goal.limits.maxCycles).toBeUndefined();
    // no budget gate trip — the run is not bricked before doing any work.
    expect(goal.lastDecisionReason).not.toBe("budget_unknown_cost");
    expect(readEvents(p).some((e) => e.type === "goal:gate_tripped" && e.action === "budget_limited")).toBe(false);
  });

  it("FIX-259: explicit --cards replaces a resumed paused all-backlog goal scope", async () => {
    const p = project();
    writeBacklog(p, [
      "| [FIX-256](.roll/features/documentation/FIX-256/spec.md) | docs | 📋 Todo |",
      "| [US-OTHER](.roll/features/documentation/US-OTHER/spec.md) | other | 📋 Todo |",
    ]);
    writeFileSync(
      join(p, ".roll", "loop", "goal.yaml"),
      `schema: goal.v1
scope:
  kind: all
review: auto
limits:
status: paused
usage:
  cycles: 0
  costUsd: 0
createdAt: 2026-06-11T16:11:49Z
updatedAt: 2026-06-11T16:12:26Z
lastDecisionReason: no_cycle_terminal
`,
    );
    const allowed: Array<string[] | undefined> = [];
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_004_000,
      nowIso: () => "2026-06-12T00:10:00Z",
      hasTmux: () => false,
      startTmux: () => false,
      runOnce: async ({ allowedCards }) => {
        allowed.push(allowedCards);
        return 1;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker", "--cards", "FIX-256"], deps));

    expect(r.code).toBe(0);
    expect(allowed).toEqual([["FIX-256"]]);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.scope).toEqual({ kind: "cards", cards: ["FIX-256"] });
    const sessionStart = readEvents(p).find((e) => e.type === "goal:session_start");
    expect(sessionStart).toMatchObject({ scope: { kind: "cards", cards: ["FIX-256"] } });
  });

  it("FIX-260: a run-once refusal bubbles the ALERT reason into the goal terminal reason", async () => {
    const p = project();
    writeBacklog(p, [
      "| [FIX-256](.roll/features/documentation/FIX-256/spec.md) | docs | 📋 Todo |",
    ]);
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_004_100,
      nowIso: () => "2026-06-12T00:11:00Z",
      hasTmux: () => false,
      startTmux: () => false,
      runOnce: async ({ projectPath }) => {
        writeFileSync(
          join(projectPath, ".roll", "loop", "ALERT-proj-abc123.md"),
          "[2026-06-11T16:11:49.869Z] ALERT egress blocked (proxy?): network pre-check failed — cycle 20260612-001149-63334 refused to start\n",
        );
        return 1;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker", "--cards", "FIX-256"], deps));

    expect(r.code).toBe(0);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.status).toBe("paused");
    expect(goal.lastDecisionReason).toContain("no_cycle_terminal");
    expect(goal.lastDecisionReason).toContain("egress blocked");
    const end = readEvents(p).find((e) => e.type === "goal:session_end");
    expect(end).toMatchObject({ reason: expect.stringContaining("egress blocked") });
  });

  it("--budget 0 blocks a new goal before starting the first cycle", async () => {
    const p = project();
    let calls = 0;
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_000_675,
      nowIso: () => "2026-06-11T11:17:00Z",
      hasTmux: () => false,
      startTmux: () => false,
      runOnce: async () => {
        calls += 1;
        return 0;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker", "--budget", "0"], deps));

    expect(r.code).toBe(0);
    expect(calls).toBe(0);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.status).toBe("budget_limited");
    expect(goal.lastDecisionReason).toBe("budget_exceeded");
    expect(readEvents(p).some((e) => e.type === "goal:gate_tripped" && e.gate === "budget" && e.action === "budget_limited")).toBe(true);
  });

  it("usage limit waits for the next window by default, then resumes at the boundary", async () => {
    const p = project();
    writeBacklog(p, [
      "| [US-LIMIT](.roll/features/goal-mode/US-LIMIT/spec.md) | limit | 📋 Todo |",
    ]);
    let calls = 0;
    let usageReads = 0;
    let sleeps = 0;
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_000_700 + calls + usageReads,
      nowIso: () => `2026-06-11T11:20:0${calls + usageReads}Z`,
      hasTmux: () => false,
      startTmux: () => false,
      readUsageLimits: async () => {
        usageReads += 1;
        if (usageReads === 1) {
          return { status: "known", windows: [{ window: "five_hour", used: 86, limit: 100, resetAtSec: 1_780_003_000 }] };
        }
        return { status: "known", windows: [{ window: "five_hour", used: 20, limit: 100, resetAtSec: 1_780_006_000 }] };
      },
      sleep: async () => {
        sleeps += 1;
      },
      runOnce: async ({ projectPath }) => {
        calls += 1;
        writeFileSync(
          join(projectPath, ".roll", "loop", "runs.jsonl"),
          `${JSON.stringify({ story_id: "US-LIMIT", cycle_id: "cycle-1", ts: "2026-06-11T11:20:03Z", cost_usd: 1, cost_effective_usd: 1, status: "failed" })}\n`,
          { flag: "a" },
        );
        return 1;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker", "--cards", "US-LIMIT", "--max-cycles", "1"], deps));

    expect(r.code).toBe(0);
    expect(calls).toBe(1);
    expect(sleeps).toBe(1);
    const events = readEvents(p);
    expect(events.some((e) => e.type === "goal:gate_tripped" && e.gate === "usage" && e.action === "paused" && e.waitUntilSec === 1_780_003_000)).toBe(true);
    expect(events.some((e) => e.type === "goal:state" && e.from === "paused" && e.to === "active" && e.reason === "usage_window_recovered")).toBe(true);
  });

  it("--no-wait leaves usage limit pauses for a human instead of resuming", async () => {
    const p = project();
    let calls = 0;
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_000_800,
      nowIso: () => "2026-06-11T11:30:00Z",
      hasTmux: () => false,
      startTmux: () => false,
      readUsageLimits: async () => ({ status: "known", windows: [{ window: "weekly", used: 85, limit: 100, resetAtSec: 1_780_500_000 }] }),
      runOnce: async () => {
        calls += 1;
        return 0;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker", "--no-wait"], deps));

    expect(r.code).toBe(0);
    expect(calls).toBe(0);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.status).toBe("paused");
    expect(goal.lastDecisionReason).toBe("usage_limit_threshold");
  });

  it("unknown usage limit reads are audited but do not block a cycle", async () => {
    const p = project();
    let calls = 0;
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_000_900 + calls,
      nowIso: () => `2026-06-11T11:40:0${calls}Z`,
      hasTmux: () => false,
      startTmux: () => false,
      readUsageLimits: async () => ({ status: "unknown", reason: "usage_api_unreachable" }),
      runOnce: async ({ projectPath }) => {
        calls += 1;
        writeFileSync(
          join(projectPath, ".roll", "loop", "runs.jsonl"),
          `${JSON.stringify({ story_id: "US-UNKNOWN-LIMIT", cycle_id: "cycle-1", ts: "2026-06-11T11:40:01Z", cost_usd: 1, status: "failed" })}\n`,
          { flag: "a" },
        );
        return 1;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker", "--max-cycles", "1"], deps));

    expect(r.code).toBe(0);
    expect(calls).toBe(1);
    expect(readEvents(p).some((e) => e.type === "goal:gate_tripped" && e.gate === "usage" && e.action === "audit" && e.reason === "usage_api_unreachable")).toBe(true);
  });

  it("--for stops after the current cycle reaches the wall-clock box", async () => {
    const p = project();
    let calls = 0;
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => (calls === 0 ? 1_780_001_000 : 1_780_001_002),
      nowIso: () => (calls === 0 ? "2026-06-11T11:50:00Z" : "2026-06-11T11:50:02Z"),
      hasTmux: () => false,
      startTmux: () => false,
      runOnce: async ({ projectPath }) => {
        calls += 1;
        writeFileSync(
          join(projectPath, ".roll", "loop", "runs.jsonl"),
          `${JSON.stringify({ story_id: "US-TIME", cycle_id: "cycle-1", ts: "2026-06-11T11:50:02Z", cost_usd: 1, cost_effective_usd: 1, status: "failed" })}\n`,
          { flag: "a" },
        );
        return 1;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker", "--for", "1s"], deps));

    expect(r.code).toBe(0);
    expect(calls).toBe(1);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.status).toBe("paused");
    expect(goal.lastDecisionReason).toBe("timebox");
    expect(goal.limits.maxHours).toBeCloseTo(1 / 3600, 8);
    expect(readEvents(p).some((e) => e.type === "goal:gate_tripped" && e.gate === "timebox" && e.reason === "timebox")).toBe(true);
  });

  it("preserves an existing goal review mode unless --review is explicit", async () => {
    const p = project();
    writeFileSync(
      join(p, ".roll", "loop", "goal.yaml"),
      `schema: goal.v1
scope:
  kind: all
review: self
limits:
status: active
usage:
  cycles: 0
  costUsd: 0
createdAt: 2026-06-11T12:00:00Z
updatedAt: 2026-06-11T12:00:00Z
`,
    );
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_001_100,
      nowIso: () => "2026-06-11T12:10:00Z",
      hasTmux: () => false,
      startTmux: () => false,
      runOnce: async () => 0,
    };

    const r = await capture(() => loopGoCommand(["--worker", "--max-cycles", "0"], deps));

    expect(r.code).toBe(0);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.review.mode).toBe("self");
  });
});

describe("US-GOAL-006 — goal final review gate", () => {
  it("APPROVE completes the goal and records the final review event", async () => {
    const p = project();
    writeBacklog(p, [
      "| [US-DONE](.roll/features/goal-mode/US-DONE/spec.md) | done | ✅ Done · PR#1 |",
    ]);
    const deps = completeGoalDeps(p, async (input) => {
      expect(input.mode).toBe("auto");
      expect(input.evaluation.reason).toBe("all_delivered");
      return {
        effectiveMode: "hetero",
        reviewer: "codex",
        provider: "openai",
        commandFamily: "codex",
        verdict: "APPROVE",
        reason: "accepted",
        findings: ["AC and tests line up"],
        durationMs: 1250,
        transcriptPath: join(p, ".roll", "peer", "transcripts", "review.txt"),
        evidencePath: join(p, ".roll", "peer", "runs.jsonl"),
      };
    });

    const r = await capture(() => loopGoCommand(["--worker", "--cards", "US-DONE"], deps));

    expect(r.code).toBe(0);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.status).toBe("complete");
    const events = readEvents(p);
    expect(
      events.some(
        (e) =>
          e.type === "goal:final_review" &&
          e.verdict === "APPROVE" &&
          e.reviewer === "codex" &&
          e.commandFamily === "codex" &&
          e.durationMs === 1250 &&
          typeof e.transcriptPath === "string" &&
          typeof e.evidencePath === "string",
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === "goal:state" && e.to === "complete" && e.actor === "adjudicator")).toBe(true);
  });

  it("REQUEST_CHANGES pauses the goal and records the review reason", async () => {
    const p = project();
    writeIndex(p, { "US-DONE": "goal-mode" });
    writeBacklog(p, [
      "| [US-DONE](.roll/features/goal-mode/US-DONE/spec.md) | done | ✅ Done · PR#1 |",
    ]);
    const deps = completeGoalDeps(p, async () => ({
      effectiveMode: "hetero",
      reviewer: "codex",
      provider: "openai",
      verdict: "REQUEST_CHANGES",
      reason: "missing edge test",
      findings: ["Add regression coverage for empty scope"],
    }));

    const r = await capture(() => loopGoCommand(["--worker", "--cards", "US-DONE", "--max-cycles", "1"], deps));

    expect(r.code).toBe(0);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.status).toBe("paused");
    expect(goal.lastDecisionReason).toContain("missing edge test");
    const events = readEvents(p);
    expect(events.some((e) => e.type === "goal:final_review" && e.verdict === "REQUEST_CHANGES")).toBe(true);
    expect(events.some((e) => e.type === "goal:state" && e.to === "complete")).toBe(false);
    expect(events.some((e) => e.type === "goal:state" && e.to === "paused" && String(e.reason).includes("missing edge test"))).toBe(true);
    const note = readFileSync(
      join(p, ".roll", "features", "goal-mode", "US-DONE", "notes", "final-review-goal-20260611100000-12345.md"),
      "utf8",
    );
    expect(note).toContain("missing edge test");
    expect(note).toContain("Add regression coverage");
  });

  it("REQUEST_CHANGES stops the default go session instead of looping idle cycles", async () => {
    const p = project();
    writeIndex(p, { "US-DONE": "goal-mode" });
    writeBacklog(p, [
      "| [US-DONE](.roll/features/goal-mode/US-DONE/spec.md) | done | ✅ Done · PR#1 |",
    ]);
    let reviewCalls = 0;
    const deps = completeGoalDeps(p, async (input) => {
      reviewCalls += 1;
      expect(input.workerAgents).toEqual(["claude"]);
      return {
        effectiveMode: "hetero",
        reviewer: "codex",
        provider: "openai",
        verdict: "REQUEST_CHANGES",
        reason: "missing replay evidence",
        findings: [],
      };
    });

    const r = await capture(() => loopGoCommand(["--worker", "--cards", "US-DONE"], deps));

    expect(r.code).toBe(0);
    expect(reviewCalls).toBe(1);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.status).toBe("paused");
    const events = readEvents(p);
    expect(events.filter((e) => e.type === "goal:final_review")).toHaveLength(1);
    expect(events.some((e) => e.type === "goal:session_end" && String(e.reason).includes("missing replay evidence"))).toBe(true);
  });

  it("anchors the reviewer verdict line and fails closed on quoted APPROVE text", async () => {
    const p = project();
    writeIndex(p, { "US-DONE": "goal-mode" });
    writeBacklog(p, [
      "| [US-DONE](.roll/features/goal-mode/US-DONE/spec.md) | done | ✅ Done · PR#1 |",
    ]);
    const bin = join(p, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "claude"),
      "#!/bin/sh\nprintf 'VERDICT: REQUEST_CHANGES\\nREASON: quoted approve is not approval\\nFINDING: do not treat VERDICT: APPROVE examples as approval\\n'\n",
      "utf8",
    );
    chmodSync(join(bin, "claude"), 0o755);
    const prevPath = process.env["PATH"];
    process.env["PATH"] = `${bin}:${prevPath ?? ""}`;
    try {
      const r = await capture(() => loopGoCommand(["--worker", "--cards", "US-DONE", "--review", "self"], completeGoalDeps(p)));
      expect(r.code).toBe(0);
      const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
      expect(goal.status).toBe("paused");
      const events = readEvents(p);
      expect(events.some((e) => e.type === "goal:final_review" && e.verdict === "REQUEST_CHANGES")).toBe(true);
      expect(events.some((e) => e.type === "goal:state" && e.to === "complete")).toBe(false);
    } finally {
      if (prevPath === undefined) delete process.env["PATH"];
      else process.env["PATH"] = prevPath;
    }
  });

  it("--review off writes a skipped final_review event and completes", async () => {
    const p = project();
    writeBacklog(p, [
      "| [US-DONE](.roll/features/goal-mode/US-DONE/spec.md) | done | ✅ Done · PR#1 |",
    ]);
    let reviewCalled = false;
    const deps = completeGoalDeps(p, async () => {
      reviewCalled = true;
      return {
        effectiveMode: "hetero",
        reviewer: "codex",
        provider: "openai",
        verdict: "APPROVE",
        reason: "accepted",
        findings: [],
      };
    });

    const r = await capture(() => loopGoCommand(["--worker", "--cards", "US-DONE", "--review", "off"], deps));

    expect(r.code).toBe(0);
    expect(reviewCalled).toBe(false);
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.status).toBe("complete");
    expect(goal.review.mode).toBe("off");
    const events = readEvents(p);
    expect(events.some((e) => e.type === "goal:final_review" && e.effectiveMode === "off" && e.verdict === "SKIPPED")).toBe(true);
  });

  it("auto single-agent degradation is recorded before completion", async () => {
    const p = project();
    writeBacklog(p, [
      "| [US-DONE](.roll/features/goal-mode/US-DONE/spec.md) | done | ✅ Done · PR#1 |",
    ]);
    const deps = completeGoalDeps(p, async () => ({
      effectiveMode: "self",
      reviewer: "claude",
      provider: "anthropic",
      verdict: "APPROVE",
      reason: "accepted_self_review",
      findings: [],
      degradedReason: "single_provider_available",
    }));

    const r = await capture(() => loopGoCommand(["--worker", "--cards", "US-DONE"], deps));

    expect(r.code).toBe(0);
    const events = readEvents(p);
    expect(events.some((e) => e.type === "goal:review_degraded" && e.to === "self" && e.reason === "single_provider_available")).toBe(true);
    expect(events.some((e) => e.type === "goal:final_review" && e.effectiveMode === "self" && e.verdict === "APPROVE")).toBe(true);
  });

  it("final review timeout resolves without waiting for process close", async () => {
    const p = project();
    const bin = join(p, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "claude"), "#!/bin/sh\nsleep 30\n", "utf8");
    chmodSync(join(bin, "claude"), 0o755);
    const prevPath = process.env["PATH"];
    process.env["PATH"] = `${bin}:${prevPath ?? ""}`;
    const started = Date.now();
    try {
      const result = await spawnFinalReviewAgent("claude", p, "prompt", 50);
      expect(result.status).toBe("timeout");
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      if (prevPath === undefined) delete process.env["PATH"];
      else process.env["PATH"] = prevPath;
    }
  });
});

describe("FIX-269 — goal session waits for a running scheduled cycle", () => {
  function heldLock(p: string, ts: number): void {
    writeFileSync(join(p, ".roll", "loop", "inner.lock"), `${process.pid}:${ts}\n`);
  }

  it("waits on a held inner.lock, then runs the cycle once the lock frees", async () => {
    const p = project();
    heldLock(p, 1_780_000_000);
    let sleeps = 0;
    let runs = 0;
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => 1_780_000_010,
      nowIso: () => "2026-06-12T02:00:00Z",
      hasTmux: () => false,
      startTmux: () => false,
      sleep: async () => {
        sleeps += 1;
        // The scheduled cycle finishes during the second poll interval.
        if (sleeps === 2) execSync(`rm -f '${join(p, ".roll", "loop", "inner.lock")}'`);
      },
      runOnce: async ({ projectPath }) => {
        runs += 1;
        const rt = join(projectPath, ".roll", "loop");
        writeFileSync(
          join(rt, "runs.jsonl"),
          `${JSON.stringify({ story_id: "US-1", cycle_id: "cycle-1", ts: "2026-06-12T02:05:00Z", cost_usd: 1, status: "done" })}\n`,
          { flag: "a" },
        );
        writeFileSync(join(rt, "PAUSE-proj-abc123"), "owner pause\n");
        return 0;
      },
    };

    const r = await capture(() => loopGoCommand(["--worker"], deps));

    expect(r.code).toBe(0);
    expect(sleeps).toBe(2);
    expect(runs).toBe(1);
    const types = readEvents(p).map((e) => e.type);
    expect(types).toContain("goal:waiting_inner_lock");
    const waiting = readEvents(p).find((e) => e.type === "goal:waiting_inner_lock");
    expect(waiting).toMatchObject({ heldByPid: process.pid });
  });

  it("pauses with inner_lock_busy when the lock never frees within the ceiling", async () => {
    const p = project();
    let now = 1_780_000_010;
    const deps: LoopGoDeps = {
      identity: () => Promise.resolve({ path: p, slug: "proj-abc123" }),
      pid: () => 12345,
      nowSec: () => now,
      nowIso: () => "2026-06-12T02:00:00Z",
      hasTmux: () => false,
      startTmux: () => false,
      sleep: async () => {
        // Keep the holder fresh so the lock never goes stale while we wait.
        now += 20;
        heldLock(p, now);
      },
      runOnce: async () => {
        throw new Error("runOnce must not be called while the inner lock is held");
      },
    };
    heldLock(p, now);

    const r = await capture(() => loopGoCommand(["--worker"], deps));

    expect(r.code).toBe(0);
    expect(r.out).toContain("inner_lock_busy");
    const goal = parseGoalYaml(readFileSync(join(p, ".roll", "loop", "goal.yaml"), "utf8"));
    expect(goal.status).toBe("paused");
    expect(goal.lastDecisionReason).toBe("inner_lock_busy");
  });
});
