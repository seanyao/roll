/**
 * US-AGENT-049 — open-pool role casting ranks candidates by capability and health.
 */
import { describe, expect, it } from "vitest";
import { rankRoleCandidates, selectRankedCandidate } from "../src/agent/role-cast-ranker.js";
import type { AgentCapabilityProfile, AgentHealthSignal, RoleCastRankingInput } from "@roll/spec";

const profile = (over: Partial<AgentCapabilityProfile> = {}): AgentCapabilityProfile => ({
  agent: "kimi",
  canExecute: true,
  canReview: true,
  canScore: true,
  strengths: [],
  knownShortcomings: [],
  ...over,
});

const health = (over: Partial<AgentHealthSignal> = {}): AgentHealthSignal => ({
  agent: over.agent ?? "kimi",
  source: "cycle",
  status: "healthy",
  observedAt: "2026-07-01T00:00:00Z",
  ...over,
});

const input = (over: Partial<RoleCastRankingInput> = {}): RoleCastRankingInput => ({
  role: "builder",
  pool: ["kimi", "pi", "codex", "reasonix", "claude", "agy"],
  profiles: {
    kimi: profile({ agent: "kimi", strengths: ["strong builder"], costBand: "medium" }),
    pi: profile({ agent: "pi", strengths: ["good evaluator/build candidate"], knownShortcomings: ["usage capture partial"], costBand: "low" }),
    codex: profile({ agent: "codex", strengths: ["fresh-session capable"], costBand: "medium" }),
    reasonix: profile({ agent: "reasonix", strengths: ["cheap"], knownShortcomings: ["weaker Builder reliability on broad UI/workflow cards"], costBand: "low" }),
    claude: profile({ agent: "claude", strengths: ["capable generalist"], knownShortcomings: ["high cost"], costBand: "high" }),
    agy: profile({ agent: "agy", strengths: ["can build"], knownShortcomings: ["auth prompts"], costBand: "medium" }),
  },
  health: {
    kimi: [health({ agent: "kimi" })],
    pi: [health({ agent: "pi" })],
    codex: [health({ agent: "codex" })],
    reasonix: [health({ agent: "reasonix" })],
    claude: [health({ agent: "claude" })],
    agy: [health({ agent: "agy" })],
  },
  recentOutcomes: {},
  ...over,
});

describe("rankRoleCandidates — US-AGENT-049", () => {
  it("ranks healthy agents above auth-degraded agents", () => {
    const ranked = rankRoleCandidates(
      input({
        health: {
          agy: [health({ agent: "agy", status: "degraded", reason: "auth" })],
        },
      }),
    );
    const agy = ranked.find((c) => c.agent === "agy");
    expect(agy?.warnings).toContain("auth degraded");
    expect(agy?.eligible).toBe(false);
    expect(ranked[0]?.agent).not.toBe("agy");
  });

  it("keeps degraded agents visible instead of erasing them", () => {
    const ranked = rankRoleCandidates(
      input({
        health: {
          agy: [health({ agent: "agy", status: "degraded", reason: "auth" })],
        },
      }),
    );
    expect(ranked.some((c) => c.agent === "agy")).toBe(true);
  });

  it("ranks low-cost but weaker agents below healthy builders for builder role", () => {
    const ranked = rankRoleCandidates(input());
    const reasonix = ranked.find((c) => c.agent === "reasonix");
    expect(reasonix?.warnings).toContain("weaker Builder reliability on broad UI/workflow cards");
    const kimi = ranked.find((c) => c.agent === "kimi");
    expect(kimi!.score).toBeGreaterThan(reasonix!.score);
  });

  it("penalizes high-cost agents", () => {
    const ranked = rankRoleCandidates(input());
    const claude = ranked.find((c) => c.agent === "claude");
    expect(claude?.warnings).toContain("high cost");
  });

  it("rewards recent successes and penalizes recent failures", () => {
    const ranked = rankRoleCandidates(
      input({
        recentOutcomes: {
          pi: ["success", "success"],
          codex: ["failure", "gave_up"],
        },
      }),
    );
    const pi = ranked.find((c) => c.agent === "pi");
    const codex = ranked.find((c) => c.agent === "codex");
    expect(pi?.reasons).toContain("2 recent success(es)");
    expect(codex?.warnings).toContain("2 recent failure(s)");
    expect(pi!.score).toBeGreaterThan(codex!.score);
  });

  it("marks agents without the required role capability ineligible", () => {
    const ranked = rankRoleCandidates(
      input({
        role: "evaluator",
        profiles: {
          kimi: profile({ agent: "kimi", canScore: false }),
        },
      }),
    );
    const kimi = ranked.find((c) => c.agent === "kimi");
    expect(kimi?.eligible).toBe(false);
    expect(kimi?.warnings).toContain("not tagged for evaluator");
  });

  it("selects the highest-scoring eligible candidate", () => {
    const selected = selectRankedCandidate(rankRoleCandidates(input()));
    expect(selected).not.toBeNull();
    expect(selected!.eligible).toBe(true);
  });

  it("returns null when every candidate is blocked", () => {
    const ranked = rankRoleCandidates(
      input({
        health: Object.fromEntries(input().pool.map((a) => [a, [health({ agent: a, status: "blocked", reason: "auth" })]])) as Record<string, AgentHealthSignal[]>,
      }),
    );
    expect(selectRankedCandidate(ranked)).toBeNull();
  });
});
