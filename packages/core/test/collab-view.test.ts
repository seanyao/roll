/**
 * US-OBS-038 — Collab projection base (collab-view.v1).
 *
 * Unit tests for the event→bar mapping, escalation/stance derivation,
 * inferred flag, and degrade-not-guess behavior over the design fixtures.
 */
import { describe, expect, it } from "vitest";
import { projectCollabCycle, projectCollabStream } from "../src/observe/collab-view.js";
import { buildCycleRoleSummary } from "../src/loop/cycle-role-summary.js";
import type {
  CollabStreamView,
  CycleRoleSummary,
  EventSource,
  RollEvent,
} from "@roll/spec";

const SUPERVISOR = "codex";

function makeSummary(cycleId: string, events: RollEvent[]): CycleRoleSummary {
  return buildCycleRoleSummary({
    cycleId,
    events,
    eventsPath: ".roll/loop/events.ndjson",
    peerDir: ".roll/loop/peer",
    cycleLogDir: ".roll/loop/cycle-logs",
  });
}

function fixtureSource(events: RollEvent[], summaries: Record<string, CycleRoleSummary>): EventSource {
  return {
    readEvents: () => events,
    readSummary: (cycleId: string) => summaries[cycleId] ?? null,
    rebuildSummary: () => null,
    supervisor: () => SUPERVISOR,
    goalScope: () => "roll v4 collab observability",
  };
}

// ── Fixture 1: walked_full cycle (FIX-1034 shape) ─────────────────────────────

const WALKED_CYCLE = "20260629-143000-61717";

const walkedEvents: RollEvent[] = [
  {
    type: "cycle:start",
    cycleId: WALKED_CYCLE,
    storyId: "FIX-1034",
    agent: "pi",
    model: "deepseek-v4-pro",
    ts: 1_000,
  },
  {
    type: "execution:profile",
    cycleId: WALKED_CYCLE,
    storyId: "FIX-1034",
    profile: "verified",
    reason: "high-risk fix",
    ts: 1_010,
  },
  { type: "cycle:first_edit", cycleId: WALKED_CYCLE, commitHash: "abc", ts: 1_100 },
  { type: "cycle:tcr", cycleId: WALKED_CYCLE, commitHash: "def", message: "tcr: fix root cause", ts: 1_200 },
  {
    type: "pair:selected",
    cycleId: WALKED_CYCLE,
    workingAgent: "pi",
    peer: "reasonix",
    stage: "review",
    ts: 1_300,
  },
  {
    type: "pair:consult",
    cycleId: WALKED_CYCLE,
    peer: "reasonix",
    durationMs: 12000,
    outcome: "reviewed",
    ts: 1_400,
  },
  {
    type: "pair:verdict",
    cycleId: WALKED_CYCLE,
    peer: "reasonix",
    verdict: "agree",
    findings: 0,
    cost: 0.01,
    stage: "review",
    ts: 1_500,
  },
  {
    type: "peer:gate",
    cycleId: WALKED_CYCLE,
    verdict: "consulted",
    reasons: ["peer review completed"],
    ts: 1_600,
  },
  {
    type: "pair:selected",
    cycleId: WALKED_CYCLE,
    workingAgent: "pi",
    peer: "claude",
    stage: "score",
    ts: 1_700,
  },
  {
    type: "pair:score",
    cycleId: WALKED_CYCLE,
    peer: "claude",
    score: 8,
    verdict: "good",
    cost: 0.02,
    stage: "score",
    ts: 1_800,
  },
  {
    type: "attest:gate",
    cycleId: WALKED_CYCLE,
    verdict: "produced",
    reasons: ["review-score good 8/10 present"],
    ts: 1_900,
  },
  {
    type: "cycle:terminal",
    schema: 1,
    cycleId: WALKED_CYCLE,
    storyId: "FIX-1034",
    agent: "pi",
    model: "deepseek-v4-pro",
    startedAt: 1_000,
    endedAt: 2_000,
    outcome: "published_pending_merge",
    pr: { present: false, reason: "no_publish_attempted" },
    branch: { present: true, value: "loop/FIX-1034" },
    commit: { present: true, value: "def" },
    tcr: { present: true, value: 1 },
    attest: { present: true, value: { reportPath: ".roll/...", acMap: true } },
    usage: { present: false, reason: "no_parseable_usage" },
    cost: { present: false, reason: "no_parseable_usage" },
    ts: 2_000,
  },
];

// ── Fixture 2: escalated cycle (FIX-1032a stall → supervisor-fix shape) ───────

const ESCALATED_CYCLE = "20260629-144000-4086";

const escalatedEvents: RollEvent[] = [
  {
    type: "cycle:start",
    cycleId: ESCALATED_CYCLE,
    storyId: "FIX-1032a",
    agent: "pi",
    model: "deepseek-v4-pro",
    ts: 3_000,
  },
  { type: "cycle:first_edit", cycleId: ESCALATED_CYCLE, commitHash: "aaa", ts: 3_100 },
  {
    type: "agent:stall",
    cycleId: ESCALATED_CYCLE,
    agent: "pi",
    idleSec: 601,
    thresholdSec: 600,
    ts: 3_700,
  },
  {
    type: "cycle:end",
    cycleId: ESCALATED_CYCLE,
    outcome: "gave_up",
    cost: {
      cycleId: ESCALATED_CYCLE,
      agent: "pi",
      model: "deepseek-v4-pro",
      tokensIn: 0,
      tokensOut: 0,
      estimatedCost: 0,
      revertCount: 0,
      effectiveCost: 0,
    },
    ts: 3_800,
  },
];

// ── Fixture 3: supervisor_fix cycle (codex builds directly) ───────────────────

const SUPERVISOR_FIX_CYCLE = "20260629-145000-1036";

const supervisorFixEvents: RollEvent[] = [
  {
    type: "cycle:start",
    cycleId: SUPERVISOR_FIX_CYCLE,
    storyId: "FIX-1036",
    agent: SUPERVISOR,
    model: "gpt-5.5",
    ts: 5_000,
  },
  { type: "cycle:first_edit", cycleId: SUPERVISOR_FIX_CYCLE, commitHash: "fix1", ts: 5_100 },
  { type: "cycle:tcr", cycleId: SUPERVISOR_FIX_CYCLE, commitHash: "fix2", message: "tcr: repair harness", ts: 5_200 },
  {
    type: "attest:gate",
    cycleId: SUPERVISOR_FIX_CYCLE,
    verdict: "produced",
    reasons: ["harness fix verified"],
    ts: 5_300,
  },
  {
    type: "cycle:terminal",
    schema: 1,
    cycleId: SUPERVISOR_FIX_CYCLE,
    storyId: "FIX-1036",
    agent: SUPERVISOR,
    model: "gpt-5.5",
    startedAt: 5_000,
    endedAt: 5_400,
    outcome: "delivered",
    pr: { present: true, value: { url: "https://github.com/.../1", state: "merged", number: 1 } },
    branch: { present: true, value: "loop/FIX-1036" },
    commit: { present: true, value: "fix2" },
    tcr: { present: true, value: 1 },
    attest: { present: true, value: { reportPath: ".roll/...", acMap: true } },
    usage: { present: false, reason: "no_parseable_usage" },
    cost: { present: false, reason: "no_parseable_usage" },
    ts: 5_400,
  },
];

// ── Fixture 4: split (planner intervention) ───────────────────────────────────

const SPLIT_CYCLE = "20260629-142800-00001";

const splitEvents: RollEvent[] = [
  {
    type: "cycle:start",
    cycleId: SPLIT_CYCLE,
    storyId: "FIX-1032",
    agent: SUPERVISOR,
    model: "gpt-5.5",
    ts: 800,
  },
  {
    type: "story:split",
    parentStoryId: "FIX-1032",
    childStoryIds: ["FIX-1032a", "FIX-1032b", "FIX-1032c"],
    reason: "est_min 55 exceeds fix upper bound",
    chainDepth: 0,
    capped: false,
    ts: 900,
  },
];

// ── Fixture 5: legacy v3 cycle (no role events, only build+gate) ──────────────

const LEGACY_CYCLE = "v3-legacy-001";

const legacyEvents: RollEvent[] = [
  {
    type: "cycle:start",
    cycleId: LEGACY_CYCLE,
    storyId: "US-OLD-001",
    agent: "claude",
    model: "",
    ts: 100,
  },
  { type: "cycle:tcr", cycleId: LEGACY_CYCLE, commitHash: "old1", message: "fix", ts: 200 },
  {
    type: "cycle:end",
    cycleId: LEGACY_CYCLE,
    outcome: "delivered",
    cost: {
      cycleId: LEGACY_CYCLE,
      agent: "claude",
      model: "",
      tokensIn: 1000,
      tokensOut: 200,
      estimatedCost: 0.5,
      revertCount: 0,
      effectiveCost: 0.5,
    },
    ts: 300,
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("projectCollabCycle", () => {
  it("maps a walked_full cycle per design §7.3", () => {
    const summary = makeSummary(WALKED_CYCLE, walkedEvents);
    const view = projectCollabCycle(summary, walkedEvents, SUPERVISOR);

    expect(view.schema).toBe("collab-view.v1");
    expect(view.cycleId).toBe(WALKED_CYCLE);
    expect(view.storyId).toBe("FIX-1034");
    expect(view.startedAtMs).toBe(1_000);
    expect(view.terminus).toBe("walked_full");
    expect(view.stance).toEqual({ level: "supervise" });

    expect(view.cast).toEqual({
      supervise: SUPERVISOR,
      build: "pi",
      peers: ["reasonix"],
      scorer: "claude",
    });

    expect(view.handoffs.map((h) => h.kind)).toEqual([
      "assign",
      "build",
      "review",
      "score",
      "gate",
    ]);

    const assign = view.handoffs.find((h) => h.kind === "assign")!;
    expect(assign.fromRole).toBe("supervise");
    expect(assign.toRole).toBe("build");
    expect(assign.agent).toBe("pi");

    const build = view.handoffs.find((h) => h.kind === "build")!;
    expect(build.folded).toBe(1);

    const review = view.handoffs.find((h) => h.kind === "review")!;
    expect(review.verdict).toBe("agree");

    const score = view.handoffs.find((h) => h.kind === "score")!;
    expect(score.verdict).toBe("good/8");

    const gate = view.handoffs.find((h) => h.kind === "gate")!;
    expect(gate.verdict).toBe("produced");

    expect(view.escalation).toBeUndefined();
  });

  it("derives an inferred escalation from agent:stall + gave_up", () => {
    const summary = makeSummary(ESCALATED_CYCLE, escalatedEvents);
    const view = projectCollabCycle(summary, escalatedEvents, SUPERVISOR);

    expect(view.terminus).toBe("escalated");
    expect(view.escalation).toBeDefined();
    expect(view.escalation!.trigger).toBe("stall");
    expect(view.escalation!.inferred).toBe(true);
    expect(view.escalation!.supervisorAction).toBe("reroute");
    expect(view.escalation!.fromRole).toBe("build");
  });

  it("marks supervisor takeover as supervisor_fix with build stance", () => {
    const summary = makeSummary(SUPERVISOR_FIX_CYCLE, supervisorFixEvents);
    const view = projectCollabCycle(summary, supervisorFixEvents, SUPERVISOR);

    expect(view.terminus).toBe("supervisor_fix");
    expect(view.stance).toEqual({
      level: "build",
      note: "supervisor took over as builder",
    });
    expect(view.cast.build).toBe(SUPERVISOR);
  });

  it("detects story:split as plan stance and split terminus", () => {
    const summary = makeSummary(SPLIT_CYCLE, splitEvents);
    const view = projectCollabCycle(summary, splitEvents, SUPERVISOR);

    expect(view.terminus).toBe("split");
    expect(view.stance).toEqual({
      level: "plan",
      note: "est_min 55 exceeds fix upper bound",
    });
  });

  it("degrades legacy v3 cycles with empty terminus and build+gate only", () => {
    const summary = makeSummary(LEGACY_CYCLE, legacyEvents);
    const view = projectCollabCycle(summary, legacyEvents, SUPERVISOR);

    expect(view.terminus).toBe("");
    expect(view.handoffs.map((h) => h.kind)).toEqual(["assign", "build"]);
    expect(view.escalation).toBeUndefined();
  });

  it("never fabricates a supervisor kill when escalation is inferred", () => {
    const summary = makeSummary(ESCALATED_CYCLE, escalatedEvents);
    const view = projectCollabCycle(summary, escalatedEvents, SUPERVISOR);

    expect(view.escalation!.inferred).toBe(true);
    expect(view.escalation!.detail).not.toContain("supervisor actively killed");
  });
});

describe("projectCollabStream", () => {
  it("assembles a stream view and degrades missing summaries", () => {
    const summaries: Record<string, CycleRoleSummary> = {
      [WALKED_CYCLE]: makeSummary(WALKED_CYCLE, walkedEvents),
      [ESCALATED_CYCLE]: makeSummary(ESCALATED_CYCLE, escalatedEvents),
    };
    const src = fixtureSource([...walkedEvents, ...escalatedEvents], summaries);

    const stream = projectCollabStream(
      [WALKED_CYCLE, ESCALATED_CYCLE, "missing-cycle"],
      src,
    );

    expect(stream.schema).toBe("collab-stream.v1");
    expect(stream.supervisor).toBe(SUPERVISOR);
    expect(stream.goalScope).toBe("roll v4 collab observability");
    expect(stream.cycles).toHaveLength(3);

    expect(stream.cycles[0]!.terminus).toBe("walked_full");
    expect(stream.cycles[1]!.terminus).toBe("escalated");
    expect(stream.cycles[2]!.terminus).toBe("");
    expect(stream.cycles[2]!.stance).toEqual({
      level: "supervise",
      note: "协同摘要不可用",
    });
  });
});

describe("collab-view serialization", () => {
  it("produces stable JSON for the two design fixtures", () => {
    const walkedSummary = makeSummary(WALKED_CYCLE, walkedEvents);
    const escalatedSummary = makeSummary(ESCALATED_CYCLE, escalatedEvents);

    const walked = projectCollabCycle(walkedSummary, walkedEvents, SUPERVISOR);
    const escalated = projectCollabCycle(escalatedSummary, escalatedEvents, SUPERVISOR);

    const sample = {
      walked_full: walked,
      escalated,
    };

    const json = JSON.stringify(sample, null, 2);
    expect(json).toContain('"schema": "collab-view.v1"');
    expect(json).toContain('"terminus": "walked_full"');
    expect(json).toContain('"terminus": "escalated"');
    expect(json).toContain('"inferred": true');
  });
});
