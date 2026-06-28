/**
 * US-V4-013 — Supervisor Live Board pure projection.
 */
import { describe, expect, it } from "vitest";
import { buildSupervisorLiveBoard } from "../src/supervisor/live-board.js";
import type { RollEvent } from "@roll/spec";

const cost = { cycleId: "C", agent: "codex", model: "m", tokensIn: 0, tokensOut: 0, estimatedCost: 0, revertCount: 0, effectiveCost: 0, currency: "USD" };

function start(cycleId: string, storyId: string, ts: number): RollEvent {
  return { type: "cycle:start", cycleId, storyId, agent: "codex", model: "gpt", ts };
}

describe("buildSupervisorLiveBoard", () => {
  it("renders planned profile panes and handoffs from events", () => {
    const board = buildSupervisorLiveBoard([
      start("C1", "US-1", 1),
      { type: "execution:profile", cycleId: "C1", storyId: "US-1", profile: "planned", reason: "planned: cross-module", ts: 2 },
      { type: "cycle:phase", cycleId: "C1", phase: "execute", ts: 3 },
      { type: "cycle:phase", cycleId: "C1", phase: "publish", ts: 4 },
      { type: "peer:gate", cycleId: "C1", verdict: "consulted", reasons: [], ts: 5 },
    ]);
    const row = board.rows[0]!;
    expect(row.profile).toBe("planned");
    expect(row.roles.map((r) => [r.role, r.state])).toEqual([
      ["planner", "done"],
      ["builder", "done"],
      ["evaluator", "done"],
    ]);
    expect(row.handoffs.map((h) => [h.from, h.to, h.state])).toEqual([
      ["planner", "builder", "ready"],
      ["builder", "evaluator", "ready"],
      ["evaluator", "builder", "ready"],
    ]);
  });

  it("shows not_required panes for a standard builder-only row", () => {
    const board = buildSupervisorLiveBoard([start("C2", "US-2", 10)]);
    expect(board.rows[0]?.roles.map((r) => [r.role, r.state])).toEqual([
      ["planner", "not_required"],
      ["builder", "pending"],
      ["evaluator", "not_required"],
    ]);
  });

  it("shows not_available when a required evaluator cannot run", () => {
    const board = buildSupervisorLiveBoard([
      start("C3", "US-3", 20),
      { type: "execution:profile", cycleId: "C3", storyId: "US-3", profile: "verified", reason: "verified: user-visible", ts: 21 },
      { type: "cycle:phase", cycleId: "C3", phase: "execute", ts: 22 },
      { type: "cycle:phase", cycleId: "C3", phase: "publish", ts: 23 },
      { type: "pair:none-available", cycleId: "C3", stage: "score", reason: "no heterogeneous evaluator", ts: 24 },
    ]);
    const row = board.rows[0]!;
    expect(row.status).toBe("not_available");
    expect(row.roles.find((r) => r.role === "evaluator")).toMatchObject({
      state: "not_available",
      reason: "no heterogeneous evaluator",
    });
  });

  it("marks terminal failures without pretending an agent is still working", () => {
    const board = buildSupervisorLiveBoard([
      start("C4", "US-4", 30),
      { type: "cycle:phase", cycleId: "C4", phase: "execute", ts: 31 },
      { type: "cycle:end", cycleId: "C4", outcome: "failed", cost, ts: 32 },
    ]);
    expect(board.rows[0]?.status).toBe("failed");
    expect(board.rows[0]?.roles.find((r) => r.role === "builder")?.state).toBe("failed");
  });
});
