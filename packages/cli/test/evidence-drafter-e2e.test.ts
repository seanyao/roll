/**
 * AC4: end-to-end test — draft ac-map from realistic fixture cycle data.
 *
 * Simulates a real cycle: agent spawn → TCR commits → CI gate → changed files.
 * Verifies that the draft ac-map is non-empty, has evidence entries, and
 * correctly maps activity signals to ACs.
 */
import { describe, it, expect } from "vitest";
import { generateAcMapDraft, ACMAP_DRAFT_STATUS, ACMAP_PASS_WITH_EVIDENCE } from "../src/runner/attest-remediation.js";
import type { DraftEvidence } from "../src/runner/attest-remediation.js";
import type { CycleActivityEvent } from "@roll/spec";

// ════════════════════════════════════════════════════════════════════════════
// E2E test: realistic cycle → draft ac-map
// ════════════════════════════════════════════════════════════════════════════

describe("US-OBS-031 AC4: e2e draft from realistic cycle data", () => {
  const specText = `---
id: US-OBS-031
title: evidence drafter
---

# US-OBS-031

**AC:**
- [x] AC1 Build the core evidence drafter module with signal matching
- [x] AC2 Wire activity signals into the draft pipeline
- [x] AC3 Tests pass with >= 80% coverage
- [x] AC4 End-to-end test against fixture cycle data
`;

  const gitEvidence: DraftEvidence = {
    commitLines: [
      "abc1234 tcr: add evidence-drafter core module",
      "def5678 tcr: wire activity signals into draft gen",
      "ghi9012 tcr: add e2e tests for cycle fixture data",
      "jkl3456 docs: update CHANGELOG",
    ],
    diffStatLines: [
      " packages/core/src/attest/evidence-drafter.ts    | 245 +++++++++",
      " packages/core/test/evidence-drafter.test.ts     | 120 ++++",
      " packages/cli/src/runner/attest-remediation.ts    |  45 ++",
      " packages/cli/test/evidence-drafter-e2e.test.ts   |  80 +++",
      " CHANGELOG.md                                     |   5 +",
    ],
    changedFilenames: [
      "packages/core/src/attest/evidence-drafter.ts",
      "packages/core/test/evidence-drafter.test.ts",
      "packages/cli/src/runner/attest-remediation.ts",
      "packages/cli/test/evidence-drafter-e2e.test.ts",
      "CHANGELOG.md",
    ],
  };

  // Realistic activity signals from a cycle
  const signals: CycleActivityEvent[] = [
    {
      kind: "lifecycle",
      cycle_id: "cycle-001",
      ts: 1000,
      agent: "claude",
      payload: { event: "cycle:start", detail: "US-OBS-031" },
    },
    {
      kind: "tcr",
      cycle_id: "cycle-001",
      ts: 5000,
      agent: "claude",
      payload: { commitHash: "abc1234", message: "add evidence-drafter core module" },
    },
    {
      kind: "tcr",
      cycle_id: "cycle-001",
      ts: 10000,
      agent: "claude",
      payload: { commitHash: "def5678", message: "wire activity signals into draft gen" },
    },
    {
      kind: "tcr",
      cycle_id: "cycle-001",
      ts: 15000,
      agent: "claude",
      payload: { commitHash: "ghi9012", message: "add e2e tests for cycle fixture data" },
    },
    {
      kind: "tool_call",
      cycle_id: "cycle-001",
      ts: 18000,
      agent: "claude",
      payload: { tool: "Bash", input: "npx vitest run" },
    },
    {
      kind: "tool_result",
      cycle_id: "cycle-001",
      ts: 20000,
      agent: "claude",
      payload: { tool: "Bash", summary: "14 tests passed" },
    },
    {
      kind: "gate",
      cycle_id: "cycle-001",
      ts: 22000,
      agent: "claude",
      payload: { gate: "ci", verdict: "pass", detail: "14 tests · 3.2s" },
    },
    {
      kind: "lifecycle",
      cycle_id: "cycle-001",
      ts: 25000,
      agent: "claude",
      payload: { event: "cycle:end", detail: "built" },
    },
  ];

  it("produces a non-empty ac-map draft with evidence entries", () => {
    const draftJson = generateAcMapDraft(specText, "US-OBS-031", gitEvidence, signals);
    expect(draftJson).not.toBeNull();

    const entries = JSON.parse(draftJson!) as Array<Record<string, unknown>>;
    expect(entries.length).toBeGreaterThanOrEqual(1);
    // Verify every row has an ac field and a status
    for (const e of entries) {
      expect(typeof e["ac"]).toBe("string");
      expect(typeof e["status"]).toBe("string");
    }
  });

  it("maps TCR commit evidence from activity signals to ACs", () => {
    const draftJson = generateAcMapDraft(specText, "US-OBS-031", gitEvidence, signals);
    const entries = JSON.parse(draftJson!) as Array<Record<string, unknown>>;

    // AC1 should have evidence from the "evidence-drafter" TCR commit
    const ac1 = entries.find((e) => (e["ac"] as string).includes("AC1"));
    expect(ac1).toBeDefined();
    const ac1Evidence = (ac1!["evidence"] as Array<Record<string, string>>) ?? [];
    // The signal evidence should include TCR commit info
    const signalEvidence = ac1Evidence.filter((e) => (e["label"] ?? "").includes("[high]"));
    expect(signalEvidence.length).toBeGreaterThanOrEqual(1);
  });

  it("finds high-confidence pass-with-evidence when strong signals exist", () => {
    const draftJson = generateAcMapDraft(specText, "US-OBS-031", gitEvidence, signals);
    const entries = JSON.parse(draftJson!) as Array<Record<string, unknown>>;

    // At least one AC should get pass-with-evidence from test file + signal matching
    const highConfidence = entries.filter((e) => e["status"] === ACMAP_PASS_WITH_EVIDENCE);
    expect(highConfidence.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to needs-confirmation for ACs without strong signals", () => {
    const draftJson = generateAcMapDraft(specText, "US-OBS-031", gitEvidence, []);
    const entries = JSON.parse(draftJson!) as Array<Record<string, unknown>>;

    // Without signals, some ACs should be needs-confirmation
    const needsConfirm = entries.filter((e) => e["status"] === ACMAP_DRAFT_STATUS);
    expect(needsConfirm.length).toBeGreaterThanOrEqual(1);
  });

  it("handles empty signals array gracefully", () => {
    const draftJson = generateAcMapDraft(specText, "US-OBS-031", gitEvidence, []);
    expect(draftJson).not.toBeNull();

    const entries = JSON.parse(draftJson!) as Array<Record<string, unknown>>;
    expect(entries.length).toBeGreaterThanOrEqual(1);
    // All entries should have a valid status
    for (const e of entries) {
      const status = e["status"] as string;
      expect([ACMAP_DRAFT_STATUS, ACMAP_PASS_WITH_EVIDENCE]).toContain(status);
    }
  });

  it("handles undefined signals (backward compat)", () => {
    // No signals parameter — should work exactly as before
    const draftJson = generateAcMapDraft(specText, "US-OBS-031", gitEvidence);
    expect(draftJson).not.toBeNull();

    const entries = JSON.parse(draftJson!) as Array<Record<string, unknown>>;
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });
});
