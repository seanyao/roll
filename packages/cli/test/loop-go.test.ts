import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseGoalYaml } from "@roll/spec";
import { loopGoCommand, type LoopGoDeps } from "../src/commands/loop-go.js";

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

describe("US-GOAL-002 — roll loop go", () => {
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
