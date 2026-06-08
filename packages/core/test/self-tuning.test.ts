import { describe, expect, it } from "vitest";
import { buildSelfTuningPlan } from "../src/index.js";

const SCORES = [
  { score: 4, verdict: "ok", at: "2026-06-01T00:00:00Z" },
  { score: 5, verdict: "ok", at: "2026-06-02T00:00:00Z" },
  { score: 6, verdict: "good", at: "2026-06-03T00:00:00Z" },
  { score: 7, verdict: "good", at: "2026-06-04T00:00:00Z" },
  { score: 8, verdict: "good", at: "2026-06-05T00:00:00Z" },
  { score: 9, verdict: "good", at: "2026-06-06T00:00:00Z" },
];

describe("buildSelfTuningPlan — US-EVID-015 second-order control loop", () => {
  it("emits suggest-mode threshold, routing, and rubric proposals with evidence and rollback", () => {
    const plan = buildSelfTuningPlan({
      now: "2026-06-09T00:00:00Z",
      minSamples: 3,
      current: {
        lowScoreThreshold: 5,
        routePreferences: { "hard/US": "pi" },
        rubricWeights: { quality: 1, efficiency: 1 },
      },
      selfScores: SCORES,
      misjudgments: [
        { kind: "false_block", count: 1 },
        { kind: "leak", count: 5 },
      ],
      agentSlots: [
        { tier: "hard", storyType: "US", agent: "pi", total: 10, passed: 3 },
        { tier: "hard", storyType: "US", agent: "claude", total: 12, passed: 10 },
      ],
      rubricSignals: [
        { dimension: "quality", samples: 8, reworkCorrelation: 0.78, noise: 0.1 },
        { dimension: "efficiency", samples: 8, reworkCorrelation: 0.12, noise: 0.72 },
      ],
    });

    expect(plan.mode).toBe("suggest");
    expect(plan.applied).toBe(false);
    expect(plan.proposals.map((p) => p.kind)).toEqual(["threshold", "route_preference", "rubric_weight", "rubric_weight"]);
    expect(plan.proposals[0]).toMatchObject({
      target: "self_score.low_threshold",
      action: "tighten",
      from: 5,
      to: 6,
    });
    expect(plan.proposals[0]?.evidence.join("\n")).toContain("leak=5");
    expect(plan.proposals[1]).toMatchObject({
      target: "route.hard/US",
      action: "prefer_agent",
      from: "pi",
      to: "claude",
    });
    expect(plan.proposals[1]?.evidence.join("\n")).toContain("claude pass_rate=0.83");
    expect(plan.proposals[2]).toMatchObject({ target: "rubric.quality.weight", action: "raise_weight", from: 1, to: 1.2 });
    expect(plan.proposals[3]).toMatchObject({ target: "rubric.efficiency.weight", action: "lower_weight", from: 1, to: 0.8 });
    for (const proposal of plan.proposals) {
      expect(proposal.rollback.command).toContain("roll tune reset");
      expect(proposal.rationale).not.toBe("");
      expect(proposal.evidence.length).toBeGreaterThan(0);
    }
  });

  it("relaxes the low-score threshold when false blocks dominate", () => {
    const plan = buildSelfTuningPlan({
      now: "2026-06-09T00:00:00Z",
      minSamples: 3,
      current: { lowScoreThreshold: 5 },
      selfScores: SCORES,
      misjudgments: [
        { kind: "false_block", count: 6 },
        { kind: "leak", count: 1 },
      ],
      agentSlots: [],
      rubricSignals: [],
    });

    expect(plan.proposals).toHaveLength(1);
    expect(plan.proposals[0]).toMatchObject({ kind: "threshold", action: "relax", from: 5, to: 4 });
  });

  it("suppresses proposals when sample count is low or cooldown is still active", () => {
    const tooSmall = buildSelfTuningPlan({
      now: "2026-06-09T00:00:00Z",
      minSamples: 4,
      current: { lowScoreThreshold: 5 },
      selfScores: SCORES.slice(0, 2),
      misjudgments: [{ kind: "leak", count: 9 }],
      agentSlots: [{ tier: "hard", storyType: "US", agent: "pi", total: 2, passed: 0 }],
      rubricSignals: [{ dimension: "quality", samples: 2, reworkCorrelation: 1, noise: 0 }],
    });
    expect(tooSmall.proposals).toEqual([]);
    expect(tooSmall.stability.sampleGate).toBe("insufficient");

    const cooling = buildSelfTuningPlan({
      now: "2026-06-09T00:00:00Z",
      minSamples: 3,
      cooldownHours: 48,
      lastTunedAt: "2026-06-08T12:00:00Z",
      current: { lowScoreThreshold: 5 },
      selfScores: SCORES,
      misjudgments: [{ kind: "leak", count: 9 }],
      agentSlots: [],
      rubricSignals: [],
    });
    expect(cooling.proposals).toEqual([]);
    expect(cooling.stability.cooldownActive).toBe(true);
  });
});
