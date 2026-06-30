import { describe, it, expect } from "vitest";
import {
  classifyEvidenceRepair,
  isEvidenceRepaired,
  repairedPrNumbers,
  type EvidenceRepairInput,
} from "../src/supervisor/repair-evidence.js";

function input(overrides: Partial<EvidenceRepairInput> = {}): EvidenceRepairInput {
  return {
    ciState: "success",
    reviewState: "APPROVED",
    mergeable: "CLEAN",
    isDraft: false,
    hasFreshReport: false,
    alreadyRepaired: false,
    ...overrides,
  };
}

describe("classifyEvidenceRepair", () => {
  it("classifies a green PR without fresh report as reparable", () => {
    const result = classifyEvidenceRepair(input());
    expect(result.verdict).toBe("reparable");
  });

  it("classifies a draft green PR without fresh report as reparable", () => {
    const result = classifyEvidenceRepair(input({ isDraft: true }));
    expect(result.verdict).toBe("reparable");
    expect(result.reason).toContain("draft PR");
  });

  it("returns not_reparable when CI is red", () => {
    const result = classifyEvidenceRepair(input({ ciState: "failure" }));
    expect(result.verdict).toBe("not_reparable");
    expect(result.reason).toContain("CI");
  });

  it("returns not_reparable when CI is pending", () => {
    const result = classifyEvidenceRepair(input({ ciState: "pending" }));
    expect(result.verdict).toBe("not_reparable");
  });

  it("returns not_reparable when evaluator has not approved", () => {
    const result = classifyEvidenceRepair(input({ reviewState: "CHANGES_REQUESTED" }));
    expect(result.verdict).toBe("not_reparable");
    expect(result.reason).toContain("evaluator");
  });

  it("returns not_reparable when merge is dirty", () => {
    const result = classifyEvidenceRepair(input({ mergeable: "CONFLICTING" }));
    expect(result.verdict).toBe("not_reparable");
    expect(result.reason).toContain("merge");
  });

  it("returns not_reparable when merge is BEHIND", () => {
    const result = classifyEvidenceRepair(input({ mergeable: "BEHIND" }));
    expect(result.verdict).toBe("not_reparable");
  });

  it("returns already_repaired when already repaired", () => {
    const result = classifyEvidenceRepair(input({ alreadyRepaired: true }));
    expect(result.verdict).toBe("already_repaired");
  });

  it("returns no_gap when fresh report exists", () => {
    const result = classifyEvidenceRepair(input({ hasFreshReport: true }));
    expect(result.verdict).toBe("no_gap");
  });

  it("prioritizes not_reparable over already_repaired when CI is red", () => {
    // If CI is red, repair cannot help regardless of prior repair status.
    const result = classifyEvidenceRepair(input({ ciState: "failure", alreadyRepaired: true }));
    expect(result.verdict).toBe("not_reparable");
  });

  it("returns not_reparable when evaluator is absent (none)", () => {
    const result = classifyEvidenceRepair(input({ reviewState: "none" }));
    expect(result.verdict).toBe("not_reparable");
  });

  it("returns not_reparable when mergeable is DIRTY", () => {
    const result = classifyEvidenceRepair(input({ mergeable: "DIRTY" }));
    expect(result.verdict).toBe("not_reparable");
  });
});

describe("repairedPrNumbers", () => {
  it("extracts repaired PR numbers from events", () => {
    const events = [
      { type: "evidence:repaired", prNumber: 1116, storyId: "FIX-1057", outcome: "evidence-generated", details: "ok", ts: 1 },
      { type: "evidence:repaired", prNumber: 1200, storyId: "FIX-999", outcome: "evidence-generated", details: "ok", ts: 2 },
      { type: "pr:open", prNumber: 1116, storyId: "FIX-1057", ts: 3 },
    ];
    const set = repairedPrNumbers(events);
    expect(set.has(1116)).toBe(true);
    expect(set.has(1200)).toBe(true);
    expect(set.has(9999)).toBe(false);
  });

  it("returns empty set for events without evidence:repaired", () => {
    const events = [
      { type: "pr:open", prNumber: 1116, storyId: "FIX-1057", ts: 1 },
      { type: "pr:merge", prNumber: 1116, storyId: "FIX-1057", ts: 2 },
    ];
    const set = repairedPrNumbers(events);
    expect(set.size).toBe(0);
  });

  it("returns empty set for empty array", () => {
    const set = repairedPrNumbers([]);
    expect(set.size).toBe(0);
  });

  it("skips evidence:repaired events without prNumber", () => {
    const events = [
      { type: "evidence:repaired", storyId: "FIX-1057", outcome: "evidence-generated", details: "ok", ts: 1 },
    ];
    const set = repairedPrNumbers(events);
    expect(set.size).toBe(0);
  });
});

describe("isEvidenceRepaired", () => {
  it("returns true when PR is in repaired set", () => {
    const set = new Set([1116, 1200]);
    expect(isEvidenceRepaired(1116, set)).toBe(true);
    expect(isEvidenceRepaired(1200, set)).toBe(true);
  });

  it("returns false when PR is not in repaired set", () => {
    const set = new Set([1116]);
    expect(isEvidenceRepaired(9999, set)).toBe(false);
  });

  it("returns false for empty set", () => {
    const set = new Set<number>();
    expect(isEvidenceRepaired(1116, set)).toBe(false);
  });
});
