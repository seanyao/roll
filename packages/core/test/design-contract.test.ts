/**
 * US-V4-006 — Designer contract: render/parse round-trip, fail-closed validation
 * (missing/malformed/empty-acceptance), and design-contract-vs-delivered mapping.
 */
import { describe, expect, it } from "vitest";
import {
  designContractVsDelivered,
  parseDesignContract,
  renderDesignContract,
  summarizeDesignContractVsDelivered,
  validateDesignArtifact,
} from "../src/loop/design-contract.js";
import type { DesignerContract } from "@roll/spec";

const FULL: DesignerContract = {
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
    role: "designer",
    rig: { agent: "kimi" },
    sessionId: "C-1:design:kimi:1700",
    worktreeCwd: "/wt",
    scoreRepoCwd: "/repo",
    inputs: [],
    outputs: [],
    createdAt: "2026-06-28T00:00:00Z",
    ...over,
  };
}

describe("designer contract render/parse round-trip", () => {
  it("round-trips a full contract", () => {
    expect(parseDesignContract(renderDesignContract(FULL), "US-9")).toEqual(FULL);
  });
  it("round-trips with no resize guidance", () => {
    const { resizeGuidance, ...rest } = FULL;
    void resizeGuidance;
    const c = { ...rest } as DesignerContract;
    expect(parseDesignContract(renderDesignContract(c), "US-9")).toEqual(c);
  });
});

describe("parseDesignContract — fail-closed", () => {
  it("returns null on empty / non-string", () => {
    expect(parseDesignContract("", "US-9")).toBeNull();
  });
  it("returns null when required sections are missing", () => {
    expect(parseDesignContract("# Designer\n\nsome prose", "US-9")).toBeNull();
    // scope + acceptance but no out-of-scope
    expect(parseDesignContract("## Scope boundary\n- x\n## Acceptance contract\n- y\n", "US-9")).toBeNull();
  });
});

describe("validateDesignArtifact — fail-closed before the Builder", () => {
  const contractMd = renderDesignContract(FULL);
  it("accepts a well-formed designer artifact", () => {
    expect(validateDesignArtifact({ manifest: manifest(), contractMd, storyId: "US-9" })).toEqual({ ok: true, reasons: [] });
  });
  it("fails closed when the contract is missing", () => {
    const v = validateDesignArtifact({ manifest: manifest(), contractMd: null, storyId: "US-9" });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toContain("design-contract.md missing or malformed");
  });
  it("fails closed when the contract is malformed", () => {
    expect(validateDesignArtifact({ manifest: manifest(), contractMd: "garbage", storyId: "US-9" }).ok).toBe(false);
  });
  it("rejects a manifest whose role is not designer", () => {
    const v = validateDesignArtifact({ manifest: manifest({ role: "builder" }), contractMd, storyId: "US-9" });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toContain('role !== "designer"');
  });
  it("rejects an empty acceptance contract (not a real contract)", () => {
    const empty = renderDesignContract({ ...FULL, acceptanceContract: [] });
    const v = validateDesignArtifact({ manifest: manifest(), contractMd: empty, storyId: "US-9" });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toContain("no acceptance items");
  });
});

describe("design-contract-vs-delivered mapping", () => {
  it("marks satisfied / changed / missing", () => {
    const rows = designContractVsDelivered(FULL, ["picker prefers est_min", "falls back to backlog tag eventually"]);
    expect(rows.find((r) => r.item === "picker prefers est_min")?.status).toBe("satisfied");
    // fuzzy (substring) match → changed
    expect(rows.find((r) => r.item === "falls back to backlog tag")?.status).toBe("changed");
  });
  it("marks a wholly-undelivered acceptance item missing", () => {
    const rows = designContractVsDelivered(FULL, ["something unrelated"]);
    expect(rows.every((r) => r.status === "missing")).toBe(true);
  });
  it("summarizes the mapping", () => {
    const rows = designContractVsDelivered(FULL, ["picker prefers est_min"]);
    expect(summarizeDesignContractVsDelivered(rows)).toContain("satisfied");
    expect(summarizeDesignContractVsDelivered(rows)).toContain("missing");
  });
});
