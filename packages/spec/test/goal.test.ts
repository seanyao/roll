import { describe, expect, it } from "vitest";
import {
  GOAL_SCHEMA_VERSION,
  GOAL_STATUSES,
  parseGoalYaml,
  renderGoalYaml,
  transitionGoal,
  type GoalStatus,
} from "../src/types/goal.js";

const GOAL_YAML = `schema: goal.v1
scope:
  kind: cards
  cards: [US-GOAL-001, US-GOAL-002]
limits:
  maxCycles: 7
  maxHours: 5
status: active
usage:
  cycles: 2
  costUsd: 0.42
progress:
  zeroStreaks:
    US-GOAL-002: 1
  skippedCards: [US-GOAL-003]
  noProgressCycles: 2
safety:
  lastGate: progress
  lastReason: no_progress_breaker
  lastAt: 2026-06-11T07:20:00Z
  lastReading: 3 consecutive no-progress cycles >= 3
createdAt: 2026-06-11T07:00:00Z
updatedAt: 2026-06-11T07:30:00Z
lastDecisionReason: waiting_for_merge
`;

describe("US-GOAL-001 — goal.yaml schema", () => {
  it("parses the persisted v1 goal shape", () => {
    const goal = parseGoalYaml(GOAL_YAML);
    expect(goal.schema).toBe(GOAL_SCHEMA_VERSION);
    expect(goal.scope).toEqual({ kind: "cards", cards: ["US-GOAL-001", "US-GOAL-002"] });
    expect(goal.review.mode).toBe("auto");
    expect(goal.budgetUsd).toBeUndefined();
    expect(goal.limits).toEqual({ maxCycles: 7, maxHours: 5 });
    expect(goal.status).toBe("active");
    expect(goal.usage).toEqual({ cycles: 2, costUsd: 0.42 });
    expect(goal.progress).toEqual({
      zeroStreaks: { "US-GOAL-002": 1 },
      skippedCards: ["US-GOAL-003"],
      noProgressCycles: 2,
    });
    expect(goal.safety).toEqual({
      lastGate: "progress",
      lastReason: "no_progress_breaker",
      lastAt: "2026-06-11T07:20:00Z",
      lastReading: "3 consecutive no-progress cycles >= 3",
    });
    expect(goal.lastDecisionReason).toBe("waiting_for_merge");
  });

  it("defaults old goal.yaml files without review to auto", () => {
    expect(parseGoalYaml(GOAL_YAML).review).toEqual({ mode: "auto" });
  });

  it("parses an explicit final review mode", () => {
    const goal = parseGoalYaml(GOAL_YAML.replace("status: active", "review: hetero\nstatus: active"));
    expect(goal.review.mode).toBe("hetero");
  });

  it("renders an explicit, re-parseable goal.yaml (progress round-trips)", () => {
    const goal = parseGoalYaml(GOAL_YAML);
    const rendered = renderGoalYaml(goal);
    expect(rendered).toContain("schema: goal.v1");
    expect(rendered).toContain("cards: [US-GOAL-001, US-GOAL-002]");
    expect(rendered).toContain("review: auto");
    expect(rendered).toContain("noProgressCycles: 2");
    expect(rendered).toContain("US-GOAL-002: 1");
    expect(rendered).toContain("lastGate: progress");
    expect(parseGoalYaml(rendered)).toEqual(goal);
  });

  it("tolerates a legacy goal.yaml: budgetUsd/costUnknownRows ignored, budget_limited→paused", () => {
    const legacy = `schema: goal.v1
scope:
  kind: all
review: auto
budgetUsd: 12.5
limits:
  maxCycles: 7
status: budget_limited
usage:
  cycles: 2
  costUsd: 0.42
  costUnknownRows: 1
safety:
  lastGate: usage
  lastReason: usage_limit_threshold
  lastAt: 2026-06-11T07:20:00Z
  lastReading: five_hour 86/100 (86.0%)
createdAt: 2026-06-11T07:00:00Z
updatedAt: 2026-06-11T07:30:00Z
`;
    const goal = parseGoalYaml(legacy);
    // The retired budget status maps to paused, never throws.
    expect(goal.status).toBe("paused");
    // The retired cost-control fields are simply dropped.
    expect(goal.budgetUsd).toBeUndefined();
    expect(goal.usage).toEqual({ cycles: 2, costUsd: 0.42 });
    // A legacy cost gate label maps to the surviving `progress` gate.
    expect(goal.safety?.lastGate).toBe("progress");
  });
});

describe("US-GOAL-001 — closed goal state machine", () => {
  it("has exactly the three persisted states (budget_limited removed)", () => {
    expect(GOAL_STATUSES satisfies readonly GoalStatus[]).toEqual(["active", "paused", "complete"]);
  });

  it("allows ordinary control-plane pauses and resumes", () => {
    const active = parseGoalYaml(GOAL_YAML);
    const paused = transitionGoal(active, "paused", { actor: "system", reason: "owner_pause", at: "2026-06-11T08:00:00Z" });
    expect(paused.status).toBe("paused");
    expect(paused.updatedAt).toBe("2026-06-11T08:00:00Z");
    expect(paused.lastDecisionReason).toBe("owner_pause");

    const resumed = transitionGoal(paused, "active", { actor: "owner", reason: "resume", at: "2026-06-11T08:05:00Z" });
    expect(resumed.status).toBe("active");
  });

  it("does not expose worker/agent completion; only adjudication can complete", () => {
    const active = parseGoalYaml(GOAL_YAML);
    expect(() => transitionGoal(active, "complete", { actor: "worker", reason: "looks_done", at: "2026-06-11T08:00:00Z" })).toThrow(
      "only adjudicator",
    );
    expect(transitionGoal(active, "complete", { actor: "adjudicator", reason: "all_scope_delivered", at: "2026-06-11T08:00:00Z" }).status).toBe(
      "complete",
    );
  });

  it("rejects illegal jumps and complete is terminal", () => {
    const active = parseGoalYaml(GOAL_YAML);
    const complete = transitionGoal(active, "complete", { actor: "adjudicator", reason: "done", at: "2026-06-11T08:00:00Z" });
    expect(() => transitionGoal(complete, "active", { actor: "owner", reason: "restart", at: "2026-06-11T08:01:00Z" })).toThrow("terminal");
    expect(() => transitionGoal(active, "active", { actor: "owner", reason: "noop", at: "2026-06-11T08:01:00Z" })).toThrow("illegal");
  });
});
