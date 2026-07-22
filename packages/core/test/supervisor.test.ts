/**
 * US-V4-008 — Prime Agent v0 (observe + advise) deterministic selectors.
 * Covers truth-drift detection, stuck-story detection, route-config + release
 * readiness, budget health, advisory decisions (with owner-confirmation), and the
 * "what next / why stuck" answers.
 */
import { describe, expect, it } from "vitest";
import { observeProject, SUPERVISOR_STUCK_THRESHOLD } from "../src/supervisor/observe.js";
import { adviseProject, buildSupervisorRunbookState, explainStuck, recommendNext } from "../src/supervisor/advise.js";
import { assessBacklog, type BacklogItem } from "../src/index.js";
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
          { id: "US-2", status: "🔨 In Progress (local implementation validated; await PR/main before Done)" },
          { id: "US-3", status: "🔒 Blocked [x]" },
          { id: "US-4", status: "✅ Done" },
          { id: "IDEA-1", status: "🚫 Hold (planning idea only; split before implementation)" },
        ],
        delivered: ["US-4"],
      }),
    );
    expect(f.counts).toEqual({ todo: 1, inProgress: 1, blocked: 2, done: 1 });
    expect(f.truthDrift).toEqual([]);
  });

  it("flags truth drift: backlog Done but main truth unconfirmed", () => {
    const f = observeProject(input({ backlog: [{ id: "US-9", status: "✅ Done" }], delivered: [] }));
    expect(f.truthDrift).toEqual(["US-9"]);
    expect(f.releaseReadiness.ready).toBe(true);
  });

  it("keeps release readiness tied to explicit release blockers, not legacy truth coverage", () => {
    const f = observeProject(
      input({
        backlog: [{ id: "US-9", status: "✅ Done" }],
        delivered: [],
        releaseBlockers: ["US-10: release delta missing delivery truth"],
      }),
    );
    expect(f.truthDrift).toEqual(["US-9"]);
    expect(f.releaseReadiness).toEqual({ ready: false, blockers: ["US-10: release delta missing delivery truth"] });
  });

  it("flags stuck stories at/above the threshold", () => {
    const f = observeProject(
      input({
        recentFailures: [
          { storyId: "US-1", consecutiveFailures: SUPERVISOR_STUCK_THRESHOLD },
          { storyId: " ", consecutiveFailures: SUPERVISOR_STUCK_THRESHOLD },
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
  it("summarizes truth coverage without turning legacy Done rows into release blockers", () => {
    const f = observeProject(input({ backlog: [{ id: "US-9", status: "✅ Done" }] }));
    const d = adviseProject(f);
    const drift = d.find((x) => x.reason.includes("truth coverage"));
    expect(drift?.kind).toBe("escalate");
    expect(drift?.requiresOwner).toBe(true);
    expect(d.some((x) => x.reason.includes("release blocked"))).toBe(false);
  });

  it("caps long truth coverage advice", () => {
    const f = observeProject(
      input({
        backlog: Array.from({ length: 12 }, (_, i) => ({ id: `US-${i + 1}`, status: "✅ Done" })),
      }),
    );
    const drift = adviseProject(f).find((x) => x.reason.includes("truth coverage"));
    expect(drift?.reason).toContain("12 Done row(s)");
    expect(drift?.reason).toContain("US-1, US-2, US-3, US-4, US-5");
    expect(drift?.reason).toContain("… +7 more");
  });

  it("escalates stuck stories", () => {
    const f = observeProject(input({ recentFailures: [{ storyId: "US-1", consecutiveFailures: 3 }] }));
    expect(adviseProject(f).some((x) => x.kind === "escalate" && x.requiresOwner)).toBe(true);
  });

  it("caps long stuck-story advice", () => {
    const f = observeProject(
      input({
        recentFailures: Array.from({ length: 8 }, (_, i) => ({ storyId: `US-STUCK-${i + 1}`, consecutiveFailures: 3 })),
      }),
    );
    const stuck = adviseProject(f).find((x) => x.reason.includes("stuck stories"));
    expect(stuck?.reason).toContain("US-STUCK-1, US-STUCK-2, US-STUCK-3, US-STUCK-4, US-STUCK-5");
    expect(stuck?.reason).toContain("… +3 more");
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

  it("US-V4-021: freezes the FIX-301 vs US-OBS-032 divergence", () => {
    const inp = input({
      backlog: [
        { id: "FIX-301", status: "✅ Done" },
        { id: "US-OBS-032", status: "📋 Todo" },
      ],
      delivered: ["FIX-301"],
    });
    const next = recommendNext(inp);
    expect(next.storyId).toBe("US-OBS-032");
    expect(next.reason).toContain("US/FIX/REFACTOR");
  });

  it("US-V4-021: continues past Bug Fixes when User Stories and Refactors remain", () => {
    const us = recommendNext(
      input({
        backlog: [
          { id: "FIX-1", status: "✅ Done" },
          { id: "US-1", status: "📋 Todo" },
          { id: "REFACTOR-1", status: "📋 Todo" },
        ],
        delivered: ["FIX-1"],
      }),
    );
    expect(us.storyId).toBe("US-1");

    const refactor = recommendNext(
      input({
        backlog: [
          { id: "FIX-1", status: "✅ Done" },
          { id: "US-1", status: "✅ Done" },
          { id: "REFACTOR-1", status: "📋 Todo" },
        ],
        delivered: ["FIX-1", "US-1"],
      }),
    );
    expect(refactor.storyId).toBe("REFACTOR-1");
  });

  it("US-V4-021: diagnoses repeated failure instead of blindly retrying the same card", () => {
    const state = buildSupervisorRunbookState(
      input({
        backlog: [{ id: "US-1", status: "📋 Todo" }],
        recentFailures: [{ storyId: "US-1", consecutiveFailures: SUPERVISOR_STUCK_THRESHOLD }],
      }),
    );
    expect(state.next.kind).toBe("diagnose_failure");
    expect(state.next.storyId).toBe("US-1");
    expect(state.next.ownerAction).toContain("root-cause");
  });

  it("US-V4-021: surfaces manual-merge PRs before starting new backlog work", () => {
    const state = buildSupervisorRunbookState(
      input({
        backlog: [
          { id: "US-1", status: "📋 Todo" },
          { id: "US-2", status: "📋 Todo" },
        ],
        openPrStories: ["US-1"],
        manualMergeGates: [
          {
            storyId: "US-1",
            prNumber: 42,
            ciState: "success",
            reviewState: "APPROVED",
            mergeable: "CLEAN",
            action: "manual_merge_required",
            detail: "ci=success evaluator=APPROVED merge=CLEAN action=manual_merge_required",
            source: "gh pr view 42",
          },
        ],
      }),
    );
    expect(state.next.kind).toBe("manual_merge_gate");
    expect(state.next.storyId).toBe("US-1");
    expect(state.next.ownerAction).toContain("PR #42");
    expect(state.next.schedulerAction).toContain("do not start another card");
    expect(state.truth.manualMergeGates).toHaveLength(1);
  });

  it("US-V4-021: diagnoses zero-TCR dirty-worktree handoff before retrying", () => {
    const state = buildSupervisorRunbookState(
      input({
        backlog: [
          { id: "US-1", status: "📋 Todo" },
          { id: "US-2", status: "📋 Todo" },
        ],
        structuralFailures: [
          {
            storyId: "US-1",
            kind: "zero_tcr_dirty_worktree",
            detail: "zero TCR with dirty preserved worktree; owner must inspect or rescue before retry",
            source: "cycle:end/C1",
          },
        ],
      }),
    );
    expect(state.next.kind).toBe("diagnose_failure");
    expect(state.next.storyId).toBe("US-1");
    expect(state.next.reason).toContain("zero TCR");
    expect(state.next.ownerAction).toContain("inspect or rescue");
    expect(state.blockedCards[0]).toMatchObject({ storyId: "US-1", reason: "structural_failure" });
  });

  it("US-V4-021: ignores stale structural failures after delivered truth exists", () => {
    const state = buildSupervisorRunbookState(
      input({
        backlog: [
          { id: "US-1", status: "📋 Todo" },
          { id: "US-2", status: "📋 Todo" },
        ],
        delivered: ["US-1"],
        structuralFailures: [
          {
            storyId: "US-1",
            kind: "zero_tcr_dirty_worktree",
            detail: "older handoff without TCR",
            source: "cycle:end/C-old",
          },
        ],
      }),
    );
    expect(state.next.kind).toBe("run_card");
    expect(state.next.storyId).toBe("US-2");
    expect(state.blockedCards).toContainEqual({
      storyId: "US-1",
      reason: "delivered",
      detail: "delivery truth already marks this card delivered",
    });
  });

  it("US-V4-021: ignores historical repeated failures outside the live scope", () => {
    const state = buildSupervisorRunbookState(
      input({
        backlog: [
          { id: "FIX-382", status: "✅ Done" },
          { id: "US-OBS-035", status: "📋 Todo" },
        ],
        recentFailures: [{ storyId: "FIX-382", consecutiveFailures: SUPERVISOR_STUCK_THRESHOLD }],
      }),
    );
    expect(state.next.kind).toBe("run_card");
    expect(state.next.storyId).toBe("US-OBS-035");
  });

  it("US-V4-022: surfaces agent toolchain health issues in the runbook state", () => {
    const state = buildSupervisorRunbookState(
      input({
        backlog: [{ id: "US-1", status: "📋 Todo" }],
        agentHealthIssues: [
          {
            agent: "reasonix",
            classification: "setup_skill_root_pollution",
            severity: "warning",
            action: "create_fix",
            reason: "setup skill root pollution on reasonix",
            detail: 'skill "skill-authoring" has no description',
            source: "setup",
            routing: "delivery_team",
          },
        ],
      }),
    );
    expect(state.agentHealth.summary).toBe("1 active issue(s)");
    expect(state.agentHealth.issues[0]?.classification).toBe("setup_skill_root_pollution");
    expect(state.agentHealth.issues[0]?.action).toBe("create_fix");
    expect(state.next.storyId).toBe("US-1");
  });

  it("US-V4-021: reports the whole live backlog scope by family", () => {
    const state = buildSupervisorRunbookState(
      input({
        backlog: [
          { id: "FIX-1", status: "📋 Todo" },
          { id: "FIX-2", status: "🚫 Hold" },
          { id: "US-1", status: "🔨 In Progress" },
          { id: "REFACTOR-1", status: "📋 Todo" },
          { id: "IDEA-1", status: "📋 Todo" },
        ],
      }),
    );
    expect(state.scope.families).toEqual(["FIX", "US", "REFACTOR"]);
    expect(state.scope.remainingByFamily).toEqual({ FIX: 1, US: 1, REFACTOR: 1 });
    expect(state.scope.excluded).toContain("IDEA-1: outside supervisor backlog-clearing scope");
    expect(state.scope.excluded).toContain("FIX-2: hold");
  });
});

describe("FIX-1212 — pending-publish without open PR is stale, supervisor agrees with picker", () => {
  it("does NOT block a stale pending-publish card (no open PR) — card is runnable", () => {
    // FIX-1212: pending-publish without an open PR is a stale marker.
    // The supervisor must NOT block the card — it should be advertised as runnable.
    const state = buildSupervisorRunbookState(
      input({
        backlog: [{ id: "FIX-1042", status: "📋 Todo" }],
        pendingPublish: ["FIX-1042"],
      }),
    );
    expect(state.next.kind).toBe("run_card");
    expect(state.next.storyId).toBe("FIX-1042");
    // The card should NOT appear in blockedCards for pending-publish reason.
    expect(state.blockedCards.filter((c) => c.storyId === "FIX-1042" && c.reason === "pending_publish")).toEqual([]);
  });

  it("supervisor next agrees with the picker assessBacklog verdict (stale → runnable)", () => {
    const items: BacklogItem[] = [{ id: "FIX-1042", status: "📋 Todo", desc: "" }];
    const pending = new Set<string>(["FIX-1042"]);

    // STALE: pending-publish without open PR → both agree the card is runnable.
    const pickerRunnable = assessBacklog(items, { hasPendingPublish: (id) => pending.has(id) });
    const supervisorRunnable = buildSupervisorRunbookState(
      input({ backlog: [{ id: "FIX-1042", status: "📋 Todo" }], pendingPublish: [...pending] }),
    );
    expect(pickerRunnable.hasWork).toBe(true);
    expect(supervisorRunnable.next.kind).toBe("run_card");
    expect(supervisorRunnable.next.storyId).toBe("FIX-1042");

    // CLEARED: same as stale marker — card is runnable either way.
    pending.delete("FIX-1042");
    const pickerCleared = assessBacklog(items, { hasPendingPublish: (id) => pending.has(id) });
    const supervisorCleared = buildSupervisorRunbookState(
      input({ backlog: [{ id: "FIX-1042", status: "📋 Todo" }], pendingPublish: [...pending] }),
    );
    expect(pickerCleared.hasWork).toBe(true);
    expect(supervisorCleared.next.kind).toBe("run_card");
    expect(supervisorCleared.next.storyId).toBe("FIX-1042");
  });

  it("still selects another runnable card when only one of several is stale pending-publish", () => {
    // FIX-1212: stale pending-publish should not block; other cards are still
    // selected first by type/file order priority.
    const state = buildSupervisorRunbookState(
      input({
        backlog: [
          { id: "FIX-1042", status: "📋 Todo" },
          { id: "FIX-1050", status: "📋 Todo" },
        ],
        pendingPublish: ["FIX-1042"],
      }),
    );
    expect(state.next.kind).toBe("run_card");
    expect(state.next.storyId).toBe("FIX-1042"); // first by file order, stale marker doesn't block
    // None of the blocked cards should be for pending-publish reason.
    expect(state.blockedCards.filter((c) => c.reason === "pending_publish")).toEqual([]);
  });

  it("blocks a card with BOTH pending-publish AND open PR (open PR gate catches it)", () => {
    // FIX-1212 AC2: real open PR still blocks re-dispatch. The open PR gate
    // (not pending-publish) is what stops re-picking.
    const state = buildSupervisorRunbookState(
      input({
        backlog: [{ id: "FIX-1042", status: "📋 Todo" }],
        pendingPublish: ["FIX-1042"],
        openPrStories: ["FIX-1042"],
      }),
    );
    expect(state.next.kind).toBe("no_work");
    expect(state.next.storyId).toBeNull();
    // Blocked by open PR gate, not pending-publish.
    expect(state.blockedCards).toContainEqual({
      storyId: "FIX-1042",
      reason: "open_pr",
      detail: "open PR already exists",
    });
  });
});

describe("explainStuck — why is the project stuck?", () => {
  it("reports the concrete blockers", () => {
    const f = observeProject(input({ recentFailures: [{ storyId: "US-1", consecutiveFailures: 3 }], backlog: [{ id: "US-9", status: "✅ Done" }] }));
    const why = explainStuck(f);
    expect(why).toContain("repeated failures");
    expect(why).toContain("truth coverage");
  });
  it("says not-stuck when work is flowing", () => {
    const f = observeProject(input({ backlog: [{ id: "US-1", status: "📋 Todo" }], openPrStories: ["US-1"] }));
    expect(explainStuck(f)).toContain("not stuck");
  });
});
