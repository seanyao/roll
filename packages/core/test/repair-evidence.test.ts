import { describe, it, expect } from "vitest";
import {
  classifyEvidenceRepair,
  generateAcMap,
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

describe("generateAcMap", () => {
  const acItems = [
    { id: "FIX-1058:AC1", text: "When a loop PR is CI green and has an accepted evaluator result but lacks a fresh acceptance report, Roll exposes a scoped recovery command" },
    { id: "FIX-1058:AC2", text: "The recovery path must invoke or reuse the real attest/report generation path and produce a non-empty acceptance report plus ac-map" },
    { id: "FIX-1058:AC3", text: "The recovery path must not modify product code unless the evidence repair proves the delivered code no longer matches the spec" },
  ];

  it("returns one entry per AC item", () => {
    const map = generateAcMap("FIX-1058", acItems);
    expect(map).toHaveLength(3);
  });

  it("sets status to claimed for every entry (never pass) by default", () => {
    const map = generateAcMap("FIX-1058", acItems);
    for (const entry of map) {
      expect(entry.status).toBe("claimed");
    }
  });

  it("uses the AC id as the ac field", () => {
    const map = generateAcMap("FIX-1058", acItems);
    expect(map[0]!.ac).toBe("FIX-1058:AC1");
    expect(map[1]!.ac).toBe("FIX-1058:AC2");
  });

  it("attaches caller-supplied evidence refs that textually match AC text", () => {
    const refs = [
      { kind: "text", label: "cli-repair-evidence: recovery command validates PR eligibility", textFile: "evidence/cli.txt" },
      { kind: "text", label: "test-output: vitest passes for all classification variants", textFile: "evidence/test.txt" },
    ];
    const map = generateAcMap("FIX-1058", [acItems[0]!], { evidenceRefs: refs });
    expect(map[0]!.evidence.length).toBeGreaterThanOrEqual(1);
  });

  it("provides a fallback evidence entry when no refs match", () => {
    const map = generateAcMap("FIX-1058", [acItems[0]!]);
    expect(map[0]!.evidence.length).toBeGreaterThanOrEqual(1);
    expect(map[0]!.evidence[0]!.label).toContain("repair");
  });

  it("returns empty array for empty acItems", () => {
    const map = generateAcMap("FIX-1058", []);
    expect(map).toHaveLength(0);
  });

  it("produces stable JSON-serializable output", () => {
    const map = generateAcMap("FIX-1058", acItems);
    const json = JSON.stringify(map);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
  });

  it("respects status: readonly with fallbackTextFile produces textFile in evidence", () => {
    const map = generateAcMap("FIX-1058", [acItems[0]!], {
      status: "readonly",
      fallbackTextFile: "evidence/repair.txt",
    });
    expect(map[0]!.status).toBe("readonly");
    expect(map[0]!.evidence[0]!.textFile).toBe("evidence/repair.txt");
    expect(map[0]!.evidence[0]!.kind).toBe("text");
  });

  it("readonly without fallbackTextFile produces bare label (content predicate will reject)", () => {
    const map = generateAcMap("FIX-1058", [acItems[0]!], { status: "readonly" });
    expect(map[0]!.status).toBe("readonly");
    expect(map[0]!.evidence[0]!.textFile).toBeUndefined();
  });

  it("status readonly with matching evidenceRefs that carry textFile passes content predicate", () => {
    const refs = [
      { kind: "text", label: "recovery command validates PR", textFile: "evidence/cli.txt" },
    ];
    const map = generateAcMap("FIX-1058", [acItems[0]!], { status: "readonly", evidenceRefs: refs });
    expect(map[0]!.status).toBe("readonly");
    // The matching ref has a textFile — acMapEvidenceIsReal would accept it.
    const hasRealTextEvidence = map[0]!.evidence.some(
      (ev) => ev.kind === "text" && typeof ev.textFile === "string" && ev.textFile !== "",
    );
    expect(hasRealTextEvidence).toBe(true);
  });
});

describe("generateAcMap content predicate compliance", () => {
  // The attest gate's acMapEvidenceIsReal() requires:
  //   - kind="text" → textFile must be a non-empty string
  //   - kind="ci"/"commit"/"deploy"/"test-pass" → always real (structural)
  //   - kind="cast"/"video" → href must be a non-empty string
  //   - kind="screenshot" → always real
  // A positive AC (pass/readonly/partial) with no real evidence entry
  // fails the content floor and the report is an empty shell.

  it("readonly AC with text+textFile evidence passes content predicate", () => {
    const map = generateAcMap("FIX-1058", [{ id: "AC1", text: "recovery command validates PR with repair log" }], {
      status: "readonly",
      evidenceRefs: [{ kind: "text", label: "repair log", textFile: "evidence/log.txt" }],
    });
    expect(map[0]!.status).toBe("readonly");
    expect(map[0]!.evidence[0]!.kind).toBe("text");
    expect(map[0]!.evidence[0]!.textFile).toBe("evidence/log.txt");
  });

  it("readonly AC with ci evidence always passes (structural kind)", () => {
    const map = generateAcMap("FIX-1058", [{ id: "AC1", text: "PR is CI green and passed" }], {
      status: "readonly",
      evidenceRefs: [{ kind: "ci", label: "CI passed", textFile: "evidence/summary.txt" }],
    });
    expect(map[0]!.status).toBe("readonly");
    expect(map[0]!.evidence[0]!.kind).toBe("ci");
  });

  it("readonly AC with fallbackTextFile carries real textFile for content predicate", () => {
    const map = generateAcMap("FIX-1058", [{ id: "AC1", text: "unmatched" }], {
      status: "readonly",
      fallbackTextFile: "evidence/repair-summary.txt",
    });
    expect(map[0]!.evidence[0]!.kind).toBe("text");
    expect(map[0]!.evidence[0]!.textFile).toBe("evidence/repair-summary.txt");
  });

  it("claimed AC with bare label is correct (not positive, so gate skips it)", () => {
    const map = generateAcMap("FIX-1058", [{ id: "AC1", text: "unmatched" }]);
    expect(map[0]!.status).toBe("claimed");
    expect(map[0]!.evidence[0]!.textFile).toBeUndefined();
  });
});
