import { describe, expect, it } from "vitest";
import { rankRoleCandidates } from "../src/agent/role-cast-ranker.js";
import type { AgentCapabilityProfile, AgentHealthSignal } from "@roll/spec";

const profiles: AgentCapabilityProfile[] = [
  { agent: "kimi", canExecute: true, canReview: true, canScore: true, strengths: ["strong builder"], knownShortcomings: ["needs focused scope"], costBand: "medium" },
  { agent: "agy", canExecute: true, canReview: true, canScore: false, strengths: ["ui context"], knownShortcomings: ["auth prompts"], costBand: "unknown" },
  { agent: "reasonix", canExecute: true, canReview: true, canScore: true, strengths: ["cheap focused fixes"], knownShortcomings: ["weaker broad builder"], costBand: "low" },
  { agent: "claude", canExecute: true, canReview: true, canScore: true, strengths: ["deep review"], knownShortcomings: ["expensive"], costBand: "high" },
  { agent: "codex", canExecute: true, canReview: true, canScore: true, strengths: ["fresh sessions"], knownShortcomings: [], costBand: "medium" },
];

const health: AgentHealthSignal[] = [
  { agent: "kimi", source: "cycle", status: "healthy", observedAt: "2026-07-01T00:00:00Z" },
  { agent: "agy", source: "cycle", status: "degraded", reason: "auth", observedAt: "2026-07-01T00:01:00Z" },
  { agent: "reasonix", source: "cycle", status: "degraded", reason: "no_tcr", observedAt: "2026-07-01T00:02:00Z" },
  { agent: "claude", source: "manual", status: "healthy", reason: "cost", observedAt: "2026-07-01T00:03:00Z" },
  { agent: "codex", source: "probe", status: "healthy", observedAt: "2026-07-01T00:04:00Z" },
];

describe("US-AGENT-049 role-cast ranker", () => {
  it("keeps every candidate visible while ranking healthy builders over auth-degraded least-recent agents", () => {
    const ranked = rankRoleCandidates({ role: "builder", profiles, healthSignals: health, recentUse: { kimi: 20, codex: 10 } });
    expect(ranked.map((r) => r.agent)).toContain("agy");
    expect(ranked[0]?.agent).not.toBe("agy");
    expect(ranked.find((r) => r.agent === "agy")?.warnings).toContain("health degraded:auth");
    expect(ranked.find((r) => r.agent === "kimi")?.reasons).toContain("health:healthy");
  });

  it("keeps low-cost degraded focused agents eligible but below healthy candidates for broad builder work", () => {
    const ranked = rankRoleCandidates({ role: "builder", profiles, healthSignals: health, storyRisk: "high" });
    const reasonix = ranked.find((r) => r.agent === "reasonix");
    expect(reasonix?.eligible).toBe(true);
    expect(reasonix?.reasons).toContain("cost:low");
    expect((reasonix?.score ?? 0)).toBeLessThan(ranked.find((r) => r.agent === "kimi")?.score ?? 0);
  });

  it("surfaces successful deliveries as ranking evidence", () => {
    const ranked = rankRoleCandidates({
      role: "builder",
      profiles,
      healthSignals: health,
      successfulDeliveries: { codex: 2 },
    });
    const codex = ranked.find((r) => r.agent === "codex");
    expect(codex?.reasons).toContain("successful-deliveries:2");
    expect(codex?.score).toBeGreaterThan(ranked.find((r) => r.agent === "kimi")?.score ?? 0);
  });

  it("blocks same candidate selection only for blocked health or missing capability", () => {
    const ranked = rankRoleCandidates({
      role: "evaluator",
      profiles: [{ agent: "pi", canExecute: false, canReview: true, canScore: true, strengths: [], knownShortcomings: [], costBand: "medium" }],
      healthSignals: [{ agent: "pi", source: "score", status: "blocked", reason: "parser", observedAt: "2026-07-01T00:00:00Z" }],
    });
    expect(ranked).toEqual([
      {
        agent: "pi",
        eligible: false,
        score: 0,
        reasons: ["capable:evaluator", "health:blocked", "cost:medium"],
        warnings: ["health blocked:parser"],
      },
    ]);
  });
});
