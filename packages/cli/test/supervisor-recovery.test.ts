/**
 * FIX-1049 — `roll supervisor why` surfaces the no-progress recovery facts when
 * the dead-loop breaker stopped a goal: blocked card, zero-delivery streak, last
 * failed Builder, the handoff to inspect, and the recovery command. Absent when
 * the goal is healthy/active (no spurious recovery block).
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderGoalYaml, type RollEvent, type RollGoal } from "@roll/spec";
import { supervisorCommand } from "../src/commands/supervisor.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const BACKLOG = "| ID | Description | Status |\n|----|----|----|\n| [REFACTOR-055](x) | demo | 🔨 In Progress |\n";

function project(goal: RollGoal | undefined, events: RollEvent[]): string {
  const d = mkdtempSync(join(tmpdir(), "roll-sup-rec-"));
  dirs.push(d);
  mkdirSync(join(d, ".roll", "loop"), { recursive: true });
  writeFileSync(join(d, ".roll", "backlog.md"), BACKLOG);
  if (goal !== undefined) writeFileSync(join(d, ".roll", "loop", "goal.yaml"), renderGoalYaml(goal));
  writeFileSync(join(d, ".roll", "loop", "events.ndjson"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return d;
}

function run(cwd: string, args: string[]): { code: number; out: string } {
  const save = process.cwd();
  const chunks: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (chunks.push(String(c)), true);
  process.chdir(cwd);
  let code = 1;
  try {
    code = supervisorCommand(args);
  } finally {
    process.chdir(save);
    process.stdout.write = realOut;
  }
  return { code, out: chunks.join("") };
}

const stalledGoal: RollGoal = {
  schema: "goal.v1",
  scope: { kind: "cards", cards: ["REFACTOR-055"] },
  review: { mode: "auto" },
  limits: {},
  status: "paused",
  usage: { cycles: 2, costUsd: 0 },
  progress: { skippedCards: ["REFACTOR-055"], zeroStreaks: { "REFACTOR-055": 2 }, noProgressCycles: 2 },
  createdAt: "2026-06-30T00:00:00Z",
  updatedAt: "2026-06-30T01:00:00Z",
  lastDecisionReason: "no_progress_on_all_cards",
};
const cs = (cycleId: string, agent: string, ts: number): RollEvent => ({
  type: "cycle:start",
  cycleId,
  storyId: "REFACTOR-055",
  agent: agent as never,
  model: "m",
  ts,
});
const ce = (cycleId: string, outcome: string, ts: number): RollEvent =>
  ({ type: "cycle:end", cycleId, outcome: outcome as never, cost: {} as never, ts }) as RollEvent;

describe("supervisor why — no-progress recovery", () => {
  it("surfaces the recovery facts when the breaker stopped the goal", () => {
    const cwd = project(stalledGoal, [cs("c1", "agy", 1), ce("c1", "gave_up", 2), cs("c2", "pi", 3), ce("c2", "handoff_without_tcr", 4)]);
    const r = run(cwd, ["why"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/no-progress recovery:/);
    expect(r.out).toMatch(/stopped by: no_progress_on_all_cards/);
    expect(r.out).toMatch(/blocked cards: REFACTOR-055/);
    expect(r.out).toMatch(/last failed Builder: pi/);
    expect(r.out).toMatch(/handoff: cycle c2/);
    expect(r.out).toMatch(/roll loop recover REFACTOR-055/);
  });

  it("omits the recovery block for an active/healthy goal", () => {
    const cwd = project({ ...stalledGoal, status: "active", lastDecisionReason: undefined, progress: undefined }, []);
    const r = run(cwd, ["why"]);
    expect(r.out).not.toMatch(/no-progress recovery:/);
  });

  it("--json includes the noProgressRecovery facts", () => {
    const cwd = project(stalledGoal, [cs("c2", "pi", 3), ce("c2", "blocked", 4)]);
    const r = run(cwd, ["why", "--json"]);
    const parsed = JSON.parse(r.out) as { noProgressRecovery: { reason: string; lastBuilder?: string } | null };
    expect(parsed.noProgressRecovery).not.toBeNull();
    expect(parsed.noProgressRecovery!.reason).toBe("no_progress_on_all_cards");
    expect(parsed.noProgressRecovery!.lastBuilder).toBe("pi");
  });
});
