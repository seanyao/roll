/**
 * US-V4-008 — Supervisor Agent v0 (observe + advise) deterministic selectors.
 * Covers truth-drift detection, stuck-story detection, route-config + release
 * readiness, budget health, advisory decisions (with owner-confirmation), and the
 * "what next / why stuck" answers.
 */
import { describe, expect, it } from "vitest";
import { observeProject, SUPERVISOR_STUCK_THRESHOLD } from "../src/supervisor/observe.js";
import { adviseProject, explainStuck, recommendNext } from "../src/supervisor/advise.js";
import type { SupervisorInput } from "@roll/spec";

function input(over: Partial<SupervisorInput> = {}): SupervisorInput {
  return {
    backlog: [],
    delivered: [],
    openPrStories: [],
    recentFailures: [],
    routeConfigErrors: [],
    releaseBlockers: [],
    ...over,
  };
}

describe("observeProject", () => {
  it("counts backlog buckets", () => {
    const f = observeProject(
      input({
        backlog: [
          { id: "US-1", status: "📋 Todo" },
          { id: "US-2", status: "🔨 In Progress" },
          { id: "US-3", status: "🔒 Blocked [x]" },
          { id: "US-4", status: "✅ Done" },
        ],
        delivered: ["US-4"],
      }),
    );
    expect(f.counts).toEqual({ todo: 1, inProgress: 1, blocked: 1, done: 1 });
    expect(f.truthDrift).toEqual([]);
  });

  it("flags truth drift: backlog Done but main truth unconfirmed", () => {
    const f = observeProject(input({ backlog: [{ id: "US-9", status: "✅ Done" }], delivered: [] }));
    expect(f.truthDrift).toEqual(["US-9"]);
    expect(f.releaseReadiness.ready).toBe(false);
  });

  it("flags stuck stories at/above the threshold", () => {
    const f = observeProject(
      input({
        recentFailures: [
          { storyId: "US-1", consecutiveFailures: SUPERVISOR_STUCK_THRESHOLD },
          { storyId: "US-2", consecutiveFailures: 1 },
        ],
      }),
    );
    expect(f.stuckStories).toEqual(["US-1"]);
  });

  it("reports budget health", () => {
    expect(observeProject(input({ budget: { spent: 10, cap: 100 } })).budgetHealth.ok).toBe(true);
    expect(observeProject(input({ budget: { spent: 100, cap: 100 } })).budgetHealth.ok).toBe(false);
    expect(observeProject(input({ budget: { spent: 5, cap: null } })).budgetHealth.ok).toBe(true);
  });

  it("surfaces route config errors + open PR count", () => {
    const f = observeProject(input({ routeConfigErrors: ["routing.hard: unknown rig ref"], openPrStories: ["US-1", "US-2"] }));
    expect(f.routeConfigErrors).toHaveLength(1);
    expect(f.openPrCount).toBe(2);
  });
});

describe("adviseProject — advisory, owner-gated", () => {
  it("emits release-readiness on truth drift (owner confirmation required)", () => {
    const f = observeProject(input({ backlog: [{ id: "US-9", status: "✅ Done" }] }));
    const d = adviseProject(f);
    const drift = d.find((x) => x.reason.includes("truth drift"));
    expect(drift?.kind).toBe("release-readiness");
    expect(drift?.requiresOwner).toBe(true);
  });

  it("escalates stuck stories", () => {
    const f = observeProject(input({ recentFailures: [{ storyId: "US-1", consecutiveFailures: 3 }] }));
    expect(adviseProject(f).some((x) => x.kind === "escalate" && x.requiresOwner)).toBe(true);
  });

  it("recommends a route change on config errors (never auto-applies)", () => {
    const f = observeProject(input({ routeConfigErrors: ["bad rig"] }));
    const rec = adviseProject(f).find((x) => x.kind === "recommend-route-change");
    expect(rec?.requiresOwner).toBe(true);
  });

  it("pauses when the budget is exhausted", () => {
    const f = observeProject(input({ budget: { spent: 100, cap: 100 } }));
    expect(adviseProject(f).some((x) => x.kind === "pause")).toBe(true);
  });

  it("a healthy project yields no decisions", () => {
    const f = observeProject(input({ backlog: [{ id: "US-1", status: "📋 Todo" }] }));
    expect(adviseProject(f)).toEqual([]);
  });
});

describe("recommendNext — what should Roll do next?", () => {
  it("picks the first ready Todo whose deps are delivered", () => {
    const inp = input({
      backlog: [
        { id: "US-1", status: "📋 Todo", dependsOn: ["US-0"] }, // dep unmet
        { id: "US-2", status: "📋 Todo", dependsOn: ["US-0"] },
      ],
      delivered: ["US-0"],
    });
    expect(recommendNext(inp).storyId).toBe("US-1");
  });

  it("skips Todos with unmet dependencies", () => {
    const inp = input({ backlog: [{ id: "US-1", status: "📋 Todo", dependsOn: ["US-0"] }], delivered: [] });
    expect(recommendNext(inp).storyId).toBeNull();
  });

  it("skips blocked, in-flight, and delivered stories", () => {
    const inp = input({
      backlog: [
        { id: "US-1", status: "🔒 Blocked" },
        { id: "US-2", status: "📋 Todo" },
        { id: "US-3", status: "📋 Todo" },
      ],
      openPrStories: ["US-2"],
    });
    expect(recommendNext(inp).storyId).toBe("US-3");
  });
});

describe("explainStuck — why is the project stuck?", () => {
  it("reports the concrete blockers", () => {
    const f = observeProject(input({ recentFailures: [{ storyId: "US-1", consecutiveFailures: 3 }], backlog: [{ id: "US-9", status: "✅ Done" }] }));
    const why = explainStuck(f);
    expect(why).toContain("repeated failures");
    expect(why).toContain("truth drift");
  });
  it("says not-stuck when work is flowing", () => {
    const f = observeProject(input({ backlog: [{ id: "US-1", status: "📋 Todo" }], openPrStories: ["US-1"] }));
    expect(explainStuck(f)).toContain("not stuck");
  });
});
