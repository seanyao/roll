/**
 * US-V4-006 — Planner contract: render/parse round-trip, fail-closed validation
 * (missing/malformed/empty-acceptance), and planned-vs-delivered mapping.
 */
import { describe, expect, it } from "vitest";
import {
  parsePlannerContract,
  plannedVsDelivered,
  renderPlannerContract,
  summarizePlannedVsDelivered,
  validatePlannerArtifact,
} from "../src/loop/planner-contract.js";
import type { PlannerContract } from "@roll/spec";

const FULL: PlannerContract = {
  storyId: "US-9",
  scopeBoundary: ["change the picker only", "no schema migration"],
  acceptanceContract: ["picker prefers est_min", "falls back to backlog tag"],
  expectedEvidence: ["unit test for est_min routing"],
  risks: ["est_min absent on legacy cards"],
  outOfScope: ["agent spawn changes"],
  resizeGuidance: "split into picker + escalation if both grow",
};

function manifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    storyId: "US-9",
    cycleId: "C-1",
    role: "planner",
    rig: { agent: "kimi" },
    sessionId: "C-1:plan:kimi:1700",
    worktreeCwd: "/wt",
    scoreRepoCwd: "/repo",
    inputs: [],
    outputs: [],
    createdAt: "2026-06-28T00:00:00Z",
    ...over,
  };
}

describe("planner-contract render/parse round-trip", () => {
  it("round-trips a full contract", () => {
    expect(parsePlannerContract(renderPlannerContract(FULL), "US-9")).toEqual(FULL);
  });
  it("round-trips with no resize guidance", () => {
    const { resizeGuidance, ...rest } = FULL;
    void resizeGuidance;
    const c = { ...rest } as PlannerContract;
    expect(parsePlannerContract(renderPlannerContract(c), "US-9")).toEqual(c);
  });
});

describe("parsePlannerContract — fail-closed", () => {
  it("returns null on empty / non-string", () => {
    expect(parsePlannerContract("", "US-9")).toBeNull();
  });
  it("returns null when required sections are missing", () => {
    expect(parsePlannerContract("# Planner\n\nsome prose", "US-9")).toBeNull();
    // scope + acceptance but no out-of-scope
    expect(parsePlannerContract("## Scope boundary\n- x\n## Acceptance contract\n- y\n", "US-9")).toBeNull();
  });
});

describe("validatePlannerArtifact — fail-closed before the Builder", () => {
  const contractMd = renderPlannerContract(FULL);
  it("accepts a well-formed planner artifact", () => {
    expect(validatePlannerArtifact({ manifest: manifest(), contractMd, storyId: "US-9" })).toEqual({ ok: true, reasons: [] });
  });
  it("fails closed when the contract is missing", () => {
    const v = validatePlannerArtifact({ manifest: manifest(), contractMd: null, storyId: "US-9" });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toContain("planner-contract.md missing or malformed");
  });
  it("fails closed when the contract is malformed", () => {
    expect(validatePlannerArtifact({ manifest: manifest(), contractMd: "garbage", storyId: "US-9" }).ok).toBe(false);
  });
  it("rejects a manifest whose role is not planner", () => {
    const v = validatePlannerArtifact({ manifest: manifest({ role: "builder" }), contractMd, storyId: "US-9" });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toContain('role !== "planner"');
  });
  it("rejects an empty acceptance contract (not a real contract)", () => {
    const empty = renderPlannerContract({ ...FULL, acceptanceContract: [] });
    const v = validatePlannerArtifact({ manifest: manifest(), contractMd: empty, storyId: "US-9" });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toContain("no acceptance items");
  });
});

describe("plannedVsDelivered mapping", () => {
  it("marks satisfied / changed / missing", () => {
    const rows = plannedVsDelivered(FULL, ["picker prefers est_min", "falls back to backlog tag eventually"]);
    expect(rows.find((r) => r.item === "picker prefers est_min")?.status).toBe("satisfied");
    // fuzzy (substring) match → changed
    expect(rows.find((r) => r.item === "falls back to backlog tag")?.status).toBe("changed");
  });
  it("marks a wholly-undelivered acceptance item missing", () => {
    const rows = plannedVsDelivered(FULL, ["something unrelated"]);
    expect(rows.every((r) => r.status === "missing")).toBe(true);
  });
  it("summarizes the mapping", () => {
    const rows = plannedVsDelivered(FULL, ["picker prefers est_min"]);
    expect(summarizePlannedVsDelivered(rows)).toContain("satisfied");
    expect(summarizePlannedVsDelivered(rows)).toContain("missing");
  });
});
