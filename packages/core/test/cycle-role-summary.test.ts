/**
 * US-OBS-032 — Cycle Role Summary: unit tests for the event-to-role projection
 * and markdown rendering, using the plan's worked sample as fixture data.
 */
import { describe, expect, it } from "vitest";
import {
  buildCycleRoleSummary,
  renderCycleRoleSummaryMarkdown,
  type BuildCycleRoleSummaryInput,
} from "../src/loop/cycle-role-summary.js";
import type { RollEvent } from "@roll/spec";

// ── Fixture from the plan's worked sample ───────────────────────────────────

const CYCLE_ID = "20260629-112437-39253";

const fixtureEvents: RollEvent[] = [
  {
    type: "cycle:start",
    cycleId: CYCLE_ID,
    storyId: "US-TASK-001",
    agent: "pi",
    model: "deepseek-v4-pro",
    ts: 1000,
  },
  {
    type: "pair:selected",
    cycleId: CYCLE_ID,
    workingAgent: "pi",
    peer: "reasonix",
    stage: "review",
    ts: 1100,
  },
  {
    type: "pair:selected",
    cycleId: CYCLE_ID,
    workingAgent: "pi",
    peer: "kimi",
    stage: "review",
    ts: 1105,
  },
  {
    type: "pair:selected",
    cycleId: CYCLE_ID,
    workingAgent: "pi",
    peer: "codex",
    stage: "review",
    ts: 1110,
  },
  {
    type: "pair:verdict",
    cycleId: CYCLE_ID,
    peer: "reasonix",
    verdict: "refine",
    findings: 0,
    ts: 1200,
  },
  {
    type: "pair:consult",
    cycleId: CYCLE_ID,
    peer: "kimi",
    durationMs: 45000,
    outcome: "reviewed",
    ts: 1210,
  },
  {
    type: "pair:consult",
    cycleId: CYCLE_ID,
    peer: "codex",
    durationMs: 52000,
    outcome: "reviewed",
    ts: 1220,
  },
  {
    type: "pair:selected",
    cycleId: CYCLE_ID,
    workingAgent: "pi",
    peer: "reasonix",
    stage: "score",
    ts: 1300,
  },
  {
    type: "pair:score",
    cycleId: CYCLE_ID,
    peer: "reasonix",
    score: 10,
    verdict: "good",
    cost: 0.05,
    stage: "score",
    ts: 1400,
  },
  {
    type: "pair:score-failure",
    cycleId: CYCLE_ID,
    peer: "agy",
    cause: "unparseable",
    detail: "control characters before SCORE",
    stage: "score",
    ts: 1410,
  },
  {
    type: "attest:gate",
    cycleId: CYCLE_ID,
    verdict: "produced",
    reasons: ["review-score good 10/10 present"],
    ts: 1500,
  },
  {
    type: "peer:gate",
    cycleId: CYCLE_ID,
    verdict: "consulted",
    reasons: ["peer review completed"],
    ts: 1510,
  },
  {
    type: "cycle:end",
    cycleId: CYCLE_ID,
    outcome: "delivered",
    cost: {
      cycleId: CYCLE_ID,
      agent: "pi",
      model: "deepseek-v4-pro",
      tokensIn: 10000,
      tokensOut: 2000,
      estimatedCost: 1.5,
      revertCount: 0,
      effectiveCost: 1.5,
    },
    ts: 1600,
  },
];

const fixtureInput: BuildCycleRoleSummaryInput = {
  cycleId: CYCLE_ID,
  events: fixtureEvents,
  eventsPath: ".roll/loop/events.ndjson",
  peerDir: ".roll/loop/peer",
  cycleLogDir: ".roll/loop/cycle-logs",
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("cycle-role-summary", () => {
  describe("buildCycleRoleSummary", () => {
    it("builds a summary from fixture events", () => {
      const summary = buildCycleRoleSummary(fixtureInput);

      expect(summary.schema).toBe("cycle-role-summary.v1");
      expect(summary.cycleId).toBe(CYCLE_ID);
      expect(summary.storyId).toBe("US-TASK-001");
      expect(summary.executionProfile).toBe("standard");

      // Roles present
      const builder = summary.roles.find((r) => r.role === "builder");
      expect(builder).toBeDefined();
      expect(builder!.agent).toBe("pi");
      expect(builder!.model).toBe("deepseek-v4-pro");
      expect(builder!.state).toBe("accepted");

      const reviewers = summary.roles.filter((r) => r.role === "peer_reviewer");
      expect(reviewers.length).toBeGreaterThanOrEqual(3);

      // reasonix was accepted (has verdict)
      const reasonixReviewer = reviewers.find((r) => r.agent === "reasonix");
      expect(reasonixReviewer).toBeDefined();
      expect(reasonixReviewer!.state).toBe("accepted");
      expect(reasonixReviewer!.verdict).toBe("refine");
      expect(reasonixReviewer!.findings).toBe(0);
      expect(reasonixReviewer!.acceptedByGate).toBe(true);

      // kimi returned but no structured verdict accepted
      const kimiReviewer = reviewers.find((r) => r.agent === "kimi");
      expect(kimiReviewer).toBeDefined();
      expect(kimiReviewer!.state).toBe("returned");
      expect(kimiReviewer!.detail).toContain("no structured verdict");

      const evaluators = summary.roles.filter((r) => r.role === "evaluator");
      expect(evaluators.length).toBeGreaterThanOrEqual(2);

      // reasonix evaluator accepted with score 10
      const reasonixEval = evaluators.find((r) => r.agent === "reasonix");
      expect(reasonixEval).toBeDefined();
      expect(reasonixEval!.state).toBe("accepted");
      expect(reasonixEval!.score).toBe(10);
      expect(reasonixEval!.verdict).toBe("good");

      // agy failed unparseable — shows even without pair:selected
      const agyEval = evaluators.find((r) => r.agent === "agy");
      expect(agyEval).toBeDefined();
      expect(agyEval!.state).toBe("failed");
      expect(agyEval!.cause).toBe("unparseable");

      // Attest gate
      const gate = summary.roles.find((r) => r.role === "attest_gate");
      expect(gate).toBeDefined();
      expect(gate!.state).toBe("accepted");

      // Gates block
      expect(summary.gates.peerGate).toBe("consulted");
      expect(summary.gates.attestGate).toBe("produced");
      expect(summary.gates.delivery).toBe("delivered");
    });

    it("uses event facts for byte-stable generatedAt and sources", () => {
      const first = buildCycleRoleSummary(fixtureInput);
      const second = buildCycleRoleSummary(fixtureInput);

      expect(first.generatedAt).toBe("1970-01-01T00:00:01.600Z");
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(first.sources).toEqual([
        ".roll/loop/events.ndjson",
        ".roll/loop/cycle-logs",
        ".roll/loop/cycle-logs/20260629-112437-39253.agent.log",
        ".roll/loop/peer/cycle-20260629-112437-39253.pair.json",
        ".roll/loop/peer/cycle-20260629-112437-39253.score.pair.json",
      ]);
    });

    it("maps current code-stage peer review events to Peer Reviewer", () => {
      const codeStageEvents: RollEvent[] = [
        {
          type: "cycle:start",
          cycleId: "CODE-STAGE",
          storyId: "US-CODE-STAGE",
          agent: "reasonix",
          model: "deepseek-flash",
          ts: 100,
        },
        {
          type: "pair:selected",
          cycleId: "CODE-STAGE",
          workingAgent: "reasonix",
          peer: "codex",
          stage: "code",
          ts: 200,
        },
        {
          type: "pair:verdict",
          cycleId: "CODE-STAGE",
          peer: "codex",
          verdict: "refine",
          findings: 1,
          cost: 0,
          stage: "code",
          ts: 300,
        },
        {
          type: "peer:gate",
          cycleId: "CODE-STAGE",
          verdict: "consulted",
          reasons: ["code peer returned"],
          ts: 400,
        },
      ];

      const summary = buildCycleRoleSummary({
        cycleId: "CODE-STAGE",
        events: codeStageEvents,
        eventsPath: ".roll/loop/events.ndjson",
        peerDir: ".roll/loop/peer",
        cycleLogDir: ".roll/loop/cycle-logs",
      });

      const reviewer = summary.roles.find((r) => r.role === "peer_reviewer" && r.agent === "codex");
      expect(reviewer).toBeDefined();
      expect(reviewer!.state).toBe("accepted");
      expect(reviewer!.stage).toBe("review");
      expect(reviewer!.artifactPath).toBe(".roll/loop/peer/cycle-CODE-STAGE.pair.json");
      expect(summary.sources).toContain(".roll/loop/peer/cycle-CODE-STAGE.pair.json");
    });

    it("selects only events for the targeted cycle", () => {
      const noisy: RollEvent[] = [
        ...fixtureEvents,
        {
          type: "cycle:start",
          cycleId: "OTHER-CYCLE",
          storyId: "US-OTHER",
          agent: "claude",
          model: "",
          ts: 2000,
        },
      ];
      const summary = buildCycleRoleSummary({ ...fixtureInput, events: noisy });
      expect(summary.cycleId).toBe(CYCLE_ID);
      expect(summary.storyId).toBe("US-TASK-001");
    });

    it("reports not_required when no events exist", () => {
      const emptySummary = buildCycleRoleSummary({
        cycleId: "EMPTY-CYCLE",
        events: [],
        peerDir: "",
        cycleLogDir: "",
      });
      expect(emptySummary.cycleId).toBe("EMPTY-CYCLE");
      expect(emptySummary.roles.length).toBe(0);
      expect(emptySummary.gates.peerGate).toBeUndefined();
      expect(emptySummary.gates.attestGate).toBeUndefined();
      expect(emptySummary.storyId).toBe("unknown");
    });

    it("keeps both a failed score attempt and the later accepted retry", () => {
      const retryEvents: RollEvent[] = [
        {
          type: "cycle:start",
          cycleId: "SCORE-RETRY",
          storyId: "US-SCORE-RETRY",
          agent: "claude",
          model: "opus-4",
          ts: 100,
        },
        {
          type: "pair:selected",
          cycleId: "SCORE-RETRY",
          workingAgent: "claude",
          peer: "pi",
          stage: "score",
          ts: 200,
        },
        {
          type: "pair:score-failure",
          cycleId: "SCORE-RETRY",
          peer: "pi",
          cause: "unparseable",
          detail: "missing SCORE line",
          stage: "score",
          ts: 300,
        },
        {
          type: "pair:selected",
          cycleId: "SCORE-RETRY",
          workingAgent: "claude",
          peer: "pi",
          stage: "score",
          ts: 400,
        },
        {
          type: "pair:score",
          cycleId: "SCORE-RETRY",
          peer: "pi",
          score: 8,
          verdict: "good",
          cost: 0.03,
          stage: "score",
          ts: 500,
        },
        {
          type: "attest:gate",
          cycleId: "SCORE-RETRY",
          verdict: "produced",
          reasons: ["review-score good 8/10 present"],
          ts: 600,
        },
      ];

      const summary = buildCycleRoleSummary({
        cycleId: "SCORE-RETRY",
        events: retryEvents,
        peerDir: ".roll/loop/peer",
        cycleLogDir: ".roll/loop/cycle-logs",
      });

      const piAttempts = summary.roles.filter((r) => r.role === "evaluator" && r.agent === "pi");
      expect(piAttempts).toHaveLength(2);
      expect(piAttempts[0]).toMatchObject({
        state: "failed",
        cause: "unparseable",
      });
      expect(piAttempts[1]).toMatchObject({
        state: "accepted",
        score: 8,
        verdict: "good",
        acceptedByGate: true,
      });
    });
  });

  describe("renderCycleRoleSummaryMarkdown", () => {
    it("renders the fixture summary as markdown", () => {
      const summary = buildCycleRoleSummary(fixtureInput);
      const md = renderCycleRoleSummaryMarkdown(summary);

      expect(md).toContain(`# Cycle Role Summary — ${CYCLE_ID}`);
      expect(md).toContain("Story: US-TASK-001");
      expect(md).toContain("## Builder");
      expect(md).toContain("- pi / deepseek-v4-pro");
      expect(md).toContain("## Peer Review");
      expect(md).toContain("reasonix: accepted verdict=refine findings=0");
      expect(md).toContain("## Evaluator / Score");
      expect(md).toContain("reasonix: accepted score=10 verdict=good");
      expect(md).toContain("agy: failed unparseable");
      expect(md).toContain("kimi: returned");
      expect(md).toContain("## Gates");
    });

    it("renders minimal summary gracefully", () => {
      const minimal = buildCycleRoleSummary({
        cycleId: "MINIMAL",
        events: [
          {
            type: "cycle:start",
            cycleId: "MINIMAL",
            storyId: "",
            agent: "",
            model: "",
            ts: 100,
          },
        ],
        peerDir: "",
        cycleLogDir: "",
      });
      const md = renderCycleRoleSummaryMarkdown(minimal);
      expect(md).toContain("Cycle Role Summary");
    });
  });

  describe("edge cases", () => {
    it("handles no pair events", () => {
      const summary = buildCycleRoleSummary({
        cycleId: "NO-PAIR",
        events: [
          {
            type: "cycle:start",
            cycleId: "NO-PAIR",
            storyId: "US-NO-PAIR",
            agent: "claude",
            model: "opus-4",
            ts: 100,
          },
        ],
        peerDir: "",
        cycleLogDir: "",
      });
      expect(summary.storyId).toBe("US-NO-PAIR");
      expect(summary.roles).toContainEqual(expect.objectContaining({
        role: "peer_reviewer",
        agent: null,
        state: "not_required",
      }));
      expect(summary.roles).toContainEqual(expect.objectContaining({
        role: "evaluator",
        agent: null,
        state: "not_required",
      }));
    });

    it("handles agent blocked events", () => {
      const blockedEvents: RollEvent[] = [
        {
          type: "cycle:start",
          cycleId: "BLOCKED",
          storyId: "US-BLOCKED",
          agent: "claude",
          model: "",
          ts: 100,
        },
        {
          type: "pair:selected",
          cycleId: "BLOCKED",
          workingAgent: "claude",
          peer: "reasonix",
          stage: "review",
          ts: 200,
        },
        {
          type: "agent:blocked",
          cycleId: "BLOCKED",
          agent: "reasonix",
          cause: "auth",
          stage: "review",
          detail: "not logged in",
          ts: 300,
        },
      ];
      const summary = buildCycleRoleSummary({
        cycleId: "BLOCKED",
        events: blockedEvents,
        peerDir: "",
        cycleLogDir: "",
      });
      const reviewer = summary.roles.find((r) => r.role === "peer_reviewer" && r.agent === "reasonix");
      expect(reviewer).toBeDefined();
      expect(reviewer!.state).toBe("failed");
      expect(reviewer!.cause).toBe("auth");
    });

    it("sets execution profile from event", () => {
      const profileEvents: RollEvent[] = [
        {
          type: "cycle:start",
          cycleId: "PROFILE-TEST",
          storyId: "US-PROFILE",
          agent: "pi",
          model: "",
          ts: 100,
        },
        {
          type: "execution:profile",
          cycleId: "PROFILE-TEST",
          storyId: "US-PROFILE",
          profile: "verified",
          reason: "high-risk story",
          ts: 150,
        },
      ];
      const summary = buildCycleRoleSummary({
        cycleId: "PROFILE-TEST",
        events: profileEvents,
        peerDir: "",
        cycleLogDir: "",
      });
      expect(summary.executionProfile).toBe("verified");
    });
  });
});
