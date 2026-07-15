/**
 * US-ATTEST-015 — Outward verification parser/validation/report-state tests.
 *
 * Covers:
 *   - AC1: Extend evaluation-contract parsing with explicit external-smoke and owner-attested
 *   - AC2: Outward AC without declaration fails validation with repairable message
 *   - AC3: Represent verified/verified-in-simulation/unverified-external/failed-external
 *   - AC4: Legacy stories preserved without retroactive failure
 *   - AC5: Missing declarations, malformed smoke metadata, simulation-only,
 *          unavailable external environment, owner attestation scope
 */
import { describe, expect, it } from "vitest";
import { parseEvaluationContract, type EvaluationContract } from "../src/lib/evaluation-contract.js";
import {
  validateOutwardDeclarations,
  resolveOutwardVerificationStatus,
  outwardAcStatusFromVerification,
  classifyOutwardStatusForReport,
  type OutwardEvidenceMap,
} from "@roll/core";

// ════════════════════════════════════════════════════════════════════════════
// AC1: Parser extension — external-smoke and owner-attested evidence kinds
// ════════════════════════════════════════════════════════════════════════════

describe("US-ATTEST-015 AC1 — evaluation contract parser extended", () => {
  it("parses external-smoke evidence with full metadata", () => {
    const spec = `---
id: US-EXT-001
---

**Evaluation contract:**
- expected_evidence:
  - kind: external-smoke
    target: npm i -g github:owner/repo#<commit> && example --version
    proves: Git install channel works on a clean machine
    environment: release
    timeout_sec: 180
`;
    const contract = parseEvaluationContract(spec);
    expect(contract).not.toBeNull();
    expect(contract!.expected_evidence).toHaveLength(1);
    const item = contract!.expected_evidence[0];
    expect(item).toBeDefined();
    if (item === undefined) return;
    expect(item.kind).toBe("external-smoke");
    expect(item.target).toContain("npm i -g");
    expect(item.proves).toContain("Git install");
    // Outward metadata should be attached
    expect(item.outward).toBeDefined();
    if (item.outward === undefined) return;
    expect(item.outward.mode).toBe("external-smoke");
    expect(item.outward.command).toContain("npm i -g");
    expect(item.outward.environment).toBe("release");
    expect(item.outward.timeoutSec).toBe(180);
  });

  it("parses owner-attested evidence with required fields", () => {
    const spec = `---
id: US-OA-001
---

**Evaluation contract:**
- expected_evidence:
  - kind: owner-attested
    target: Manual OAuth callback verification
    proves: OAuth login works in production
    reason: OAuth requires real redirect URIs not available in CI
    approval_ref: https://github.com/owner/repo/issues/999#issuecomment-1
`;
    const contract = parseEvaluationContract(spec);
    expect(contract).not.toBeNull();
    const item = contract!.expected_evidence[0];
    expect(item).toBeDefined();
    if (item === undefined) return;
    expect(item.kind).toBe("owner-attested");
    expect(item.outward).toBeDefined();
    if (item.outward === undefined) return;
    expect(item.outward.mode).toBe("owner-attested");
    expect(item.outward.reason).toContain("OAuth");
    expect(item.outward.approvalRef).toContain("github.com");
  });

  it("parses owner-attested with optional scope and expiresAt", () => {
    const spec = `---
id: US-OA-SCOPED-001
---

**Evaluation contract:**
- expected_evidence:
  - kind: owner-attested
    target: macOS arm64 native build verification
    proves: Native binary works on Apple Silicon
    reason: CI matrix does not cover arm64
    approval_ref: https://github.com/owner/repo/discussions/42
    scope: macOS arm64 only
    expires_at: 2026-12-31
`;
    const contract = parseEvaluationContract(spec);
    const item = contract!.expected_evidence[0];
    expect(item).toBeDefined();
    if (item === undefined) return;
    expect(item.outward).toBeDefined();
    if (item.outward === undefined) return;
    expect(item.outward.scope).toBe("macOS arm64 only");
    expect(item.outward.expiresAt).toBe("2026-12-31");
  });

  it("excludes outward block for non-outward evidence kinds", () => {
    const spec = `---
id: US-NORMAL-001
---

**Evaluation contract:**
- expected_evidence:
  - kind: test
    target: packages/cli/test/foo.test.ts
    proves: AC1
`;
    const contract = parseEvaluationContract(spec);
    expect(contract).not.toBeNull();
    const item = contract!.expected_evidence[0];
    expect(item).toBeDefined();
    if (item === undefined) return;
    expect(item.outward).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AC2: Validation — outward AC without declaration fails
// ════════════════════════════════════════════════════════════════════════════

describe("US-ATTEST-015 AC2 — outward declarations validated", () => {
  it("passes validation for a complete external-smoke declaration", () => {
    const contract: EvaluationContract = {
      expected_evidence: [
        {
          kind: "external-smoke",
          target: "npm i -g && test",
          proves: "AC1",
          outward: { mode: "external-smoke", command: "npm i -g && test", environment: "release", timeoutSec: 120 },
        },
      ],
      scorer_focus: [],
      builder_notes: [],
    };
    const result = validateOutwardDeclarations(contract);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("flags missing command in external-smoke", () => {
    const contract: EvaluationContract = {
      expected_evidence: [
        {
          kind: "external-smoke",
          target: "npm i -g",
          proves: "AC1",
          outward: { mode: "external-smoke", command: "", environment: "ci", timeoutSec: 60 },
        },
      ],
      scorer_focus: [],
      builder_notes: [],
    };
    const result = validateOutwardDeclarations(contract);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe("missing_command");
    expect(result.errors[0]?.ac).toBe("AC1");
    expect(result.errors[0]?.message).toContain("command");
  });

  it("flags invalid environment value", () => {
    const contract: EvaluationContract = {
      expected_evidence: [
        {
          kind: "external-smoke",
          target: "cmd",
          proves: "AC2",
          outward: { mode: "external-smoke", command: "cmd", environment: "local" as any, timeoutSec: 30 },
        },
      ],
      scorer_focus: [],
      builder_notes: [],
    };
    const result = validateOutwardDeclarations(contract);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "invalid_environment")).toBe(true);
  });

  it("flags missing timeout_sec", () => {
    const contract: EvaluationContract = {
      expected_evidence: [
        {
          kind: "external-smoke",
          target: "cmd",
          proves: "AC3",
          outward: { mode: "external-smoke", command: "cmd", environment: "ci", timeoutSec: 0 },
        },
      ],
      scorer_focus: [],
      builder_notes: [],
    };
    const result = validateOutwardDeclarations(contract);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "invalid_timeout")).toBe(true);
  });

  it("flags missing reason in owner-attested", () => {
    const contract: EvaluationContract = {
      expected_evidence: [
        {
          kind: "owner-attested",
          target: "Manual check",
          proves: "AC4",
          outward: { mode: "owner-attested", reason: "", approvalRef: "https://x" },
        },
      ],
      scorer_focus: [],
      builder_notes: [],
    };
    const result = validateOutwardDeclarations(contract);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "missing_reason")).toBe(true);
  });

  it("flags missing approval_ref in owner-attested", () => {
    const contract: EvaluationContract = {
      expected_evidence: [
        {
          kind: "owner-attested",
          target: "Manual check",
          proves: "AC5",
          outward: { mode: "owner-attested", reason: "needs manual", approvalRef: "" },
        },
      ],
      scorer_focus: [],
      builder_notes: [],
    };
    const result = validateOutwardDeclarations(contract);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "missing_approval_ref")).toBe(true);
  });

  it("produces a repairable message for each error", () => {
    const contract: EvaluationContract = {
      expected_evidence: [
        {
          kind: "external-smoke",
          target: "cmd",
          proves: "AC1",
          outward: { mode: "external-smoke", command: "", environment: "ci", timeoutSec: 0 },
        },
      ],
      scorer_focus: [],
      builder_notes: [],
    };
    const result = validateOutwardDeclarations(contract);
    for (const err of result.errors) {
      expect(err.message.length).toBeGreaterThan(10);
      expect(err.message).toMatch(/add|provide|set|specify|declare|require/i);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AC3: Verification status representation
// ════════════════════════════════════════════════════════════════════════════

describe("US-ATTEST-015 AC3 — outward verification statuses", () => {
  it("resolves verified when external-smoke passed", () => {
    const map: OutwardEvidenceMap = {
      "AC1": { mode: "external-smoke", command: "cmd", environment: "release", timeoutSec: 60 },
    };
    const smokeResults = [{ ac: "AC1", exitCode: 0, summary: "OK", command: "cmd", environment: "release" }];
    const results = resolveOutwardVerificationStatus(map, smokeResults, []);
    const ac1 = results.find((r) => r.ac === "AC1");
    expect(ac1).toBeDefined();
    if (ac1 === undefined) return;
    expect(ac1.status).toBe("verified");
  });

  it("resolves failed-external when smoke failed", () => {
    const map: OutwardEvidenceMap = {
      "AC1": { mode: "external-smoke", command: "cmd", environment: "ci", timeoutSec: 30 },
    };
    const smokeResults = [{ ac: "AC1", exitCode: 1, summary: "command not found", command: "cmd", environment: "ci" }];
    const results = resolveOutwardVerificationStatus(map, smokeResults, []);
    const ac1 = results.find((r) => r.ac === "AC1");
    expect(ac1).toBeDefined();
    if (ac1 === undefined) return;
    expect(ac1.status).toBe("failed-external");
    expect(ac1.failureDetail).toBeDefined();
  });

  it("resolves unverified-external when smoke hasn't run yet", () => {
    const map: OutwardEvidenceMap = {
      "AC1": { mode: "external-smoke", command: "cmd", environment: "release", timeoutSec: 60 },
    };
    // No smoke results
    const results = resolveOutwardVerificationStatus(map, [], []);
    const ac1 = results.find((r) => r.ac === "AC1");
    expect(ac1).toBeDefined();
    if (ac1 === undefined) return;
    expect(ac1.status).toBe("unverified-external");
  });

  it("resolves verified-in-simulation when only simulation evidence exists", () => {
    const map: OutwardEvidenceMap = {
      "AC1": { mode: "external-smoke", command: "cmd", environment: "release", timeoutSec: 60 },
    };
    // Simulation evidence present (npm pack test) but no real smoke
    const simEvidence = [{ ac: "AC1", kind: "test", label: "npm pack test passed" }];
    const results = resolveOutwardVerificationStatus(map, [], simEvidence);
    const ac1 = results.find((r) => r.ac === "AC1");
    expect(ac1).toBeDefined();
    if (ac1 === undefined) return;
    // When simulation ran but real smoke didn't → verified-in-simulation
    // This must NOT be "verified"
    expect(ac1.status).not.toBe("verified");
    expect(ac1.status).not.toBe("pass" as any);
  });

  it("verified-in-simulation + failed smoke => failed-external", () => {
    const map: OutwardEvidenceMap = {
      "AC1": { mode: "external-smoke", command: "cmd", environment: "ci", timeoutSec: 30 },
    };
    const smokeResults = [{ ac: "AC1", exitCode: 1, summary: "timeout", command: "cmd", environment: "ci" }];
    const simEvidence = [{ ac: "AC1", kind: "test", label: "local test passed" }];
    const results = resolveOutwardVerificationStatus(map, smokeResults, simEvidence);
    const ac1 = results.find((r) => r.ac === "AC1");
    expect(ac1).toBeDefined();
    if (ac1 === undefined) return;
    expect(ac1.status).toBe("failed-external");
  });

  it("owner-attested with valid attestation resolves verified", () => {
    const map: OutwardEvidenceMap = {
      "AC1": { mode: "owner-attested", reason: "OAuth testing", approvalRef: "https://x" },
    };
    const ownerRecords = [{ ac: "AC1", reason: "OAuth testing", approvalRef: "https://x" }];
    const results = resolveOutwardVerificationStatus(map, [], [], ownerRecords);
    const ac1 = results.find((r) => r.ac === "AC1");
    expect(ac1).toBeDefined();
    if (ac1 === undefined) return;
    expect(ac1.status).toBe("verified");
  });

  it("owner-attested without matching record => unverified-external", () => {
    const map: OutwardEvidenceMap = {
      "AC1": { mode: "owner-attested", reason: "OAuth", approvalRef: "https://x" },
    };
    const results = resolveOutwardVerificationStatus(map, [], [], []);
    const ac1 = results.find((r) => r.ac === "AC1");
    expect(ac1).toBeDefined();
    if (ac1 === undefined) return;
    expect(ac1.status).toBe("unverified-external");
  });

  it("outwardAcStatusFromVerification maps verified → pass", () => {
    expect(outwardAcStatusFromVerification("verified")).toBe("pass");
  });

  it("outwardAcStatusFromVerification maps verified-in-simulation → claimed (not pass)", () => {
    const status = outwardAcStatusFromVerification("verified-in-simulation");
    // Must NOT be pass/pass-with-evidence — simulation alone cannot produce green
    expect(status).not.toBe("pass");
    expect(status).not.toBe("pass-with-evidence");
    expect(["claimed", "partial"]).toContain(status);
  });

  it("outwardAcStatusFromVerification maps unverified-external → claimed", () => {
    expect(outwardAcStatusFromVerification("unverified-external")).toBe("claimed");
  });

  it("outwardAcStatusFromVerification maps failed-external → fail", () => {
    expect(outwardAcStatusFromVerification("failed-external")).toBe("fail");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AC4: Legacy stories preserved without retroactive failure
// ════════════════════════════════════════════════════════════════════════════

describe("US-ATTEST-015 AC4 — legacy story preservation", () => {
  it("returns null for legacy spec (no evaluation contract block)", () => {
    const legacy = `---
id: US-OLD-001
title: old story
---

**AC:**
- [ ] Do something
`;
    const contract = parseEvaluationContract(legacy);
    expect(contract).toBeNull();
  });

  it("validates without error for contract with no outward evidence", () => {
    const contract: EvaluationContract = {
      expected_evidence: [
        { kind: "test", target: "test.ts", proves: "AC1" },
        { kind: "screenshot", target: "page", proves: "AC2" },
      ],
      scorer_focus: [],
      builder_notes: [],
    };
    const result = validateOutwardDeclarations(contract);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("classifyOutwardStatusForReport returns null when no outward items", () => {
    const contract: EvaluationContract = {
      expected_evidence: [
        { kind: "test", target: "test.ts", proves: "AC1" },
      ],
      scorer_focus: [],
      builder_notes: [],
    };
    const result = classifyOutwardStatusForReport(contract, [], [], []);
    expect(result).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AC5: Edge cases — malformed metadata, simulation-only, unavailable env, scope
// ════════════════════════════════════════════════════════════════════════════

describe("US-ATTEST-015 AC5 — edge cases", () => {
  it("flags malformed smoke command metadata (empty string)", () => {
    const contract: EvaluationContract = {
      expected_evidence: [
        {
          kind: "external-smoke",
          target: "",
          proves: "AC1",
          outward: { mode: "external-smoke", command: "   ", environment: "ci", timeoutSec: 60 },
        },
      ],
      scorer_focus: [],
      builder_notes: [],
    };
    const result = validateOutwardDeclarations(contract);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "missing_command")).toBe(true);
  });

  it("simulation-only AC (npm pack) maps to claimed, never pass", () => {
    const map: OutwardEvidenceMap = {
      "AC1": { mode: "external-smoke", command: "npm i -g && test", environment: "release", timeoutSec: 120 },
    };
    // Only simulation evidence (no smoke results)
    const simEvidence = [{ ac: "AC1", kind: "command", label: "npm pack && npm test passed locally" }];
    const results = resolveOutwardVerificationStatus(map, [], simEvidence);
    const ac1 = results.find((r) => r.ac === "AC1");
    expect(ac1).toBeDefined();
    if (ac1 === undefined) return;
    expect(ac1.status).not.toBe("verified");
    const reportStatus = outwardAcStatusFromVerification(ac1.status);
    // Simulation-only must not produce a positive AC status
    expect(reportStatus).not.toBe("pass");
    expect(reportStatus).not.toBe("pass-with-evidence");
    expect(reportStatus).not.toBe("readonly");
  });

  it("unavailable external environment produces unverified-external", () => {
    const map: OutwardEvidenceMap = {
      "AC1": { mode: "external-smoke", command: "cmd", environment: "nightly", timeoutSec: 60 },
    };
    // Environment unavailable → no smoke results
    const results = resolveOutwardVerificationStatus(map, [], []);
    expect(results[0]?.status).toBe("unverified-external");
    expect(results[0]?.note).toContain("no smoke results");
  });

  it("owner attestation with expired scope produces unverified", () => {
    const map: OutwardEvidenceMap = {
      "AC1": {
        mode: "owner-attested",
        reason: "Manual test",
        approvalRef: "https://x",
        expiresAt: "2020-01-01",  // Expired
      },
    };
    const ownerRecords = [{ ac: "AC1", reason: "Manual test", approvalRef: "https://x", expiresAt: "2020-01-01" }];
    const results = resolveOutwardVerificationStatus(map, [], [], ownerRecords);
    const ac1 = results.find((r) => r.ac === "AC1");
    expect(ac1).toBeDefined();
    if (ac1 === undefined) return;
    // Expired attestation should not produce verified
    expect(ac1.status).not.toBe("verified");
  });

  it("classifyOutwardStatusForReport aggregates mixed outcomes", () => {
    const contract: EvaluationContract = {
      expected_evidence: [
        {
          kind: "external-smoke",
          target: "cmd1",
          proves: "AC1",
          outward: { mode: "external-smoke", command: "cmd1", environment: "ci", timeoutSec: 30 },
        },
        {
          kind: "owner-attested",
          target: "manual",
          proves: "AC2",
          outward: { mode: "owner-attested", reason: "test", approvalRef: "https://x" },
        },
      ],
      scorer_focus: [],
      builder_notes: [],
    };
    const smokeResults = [{ ac: "AC1", exitCode: 0, summary: "OK", command: "cmd1", environment: "ci" }];
    const ownerRecords = [{ ac: "AC2", reason: "test", approvalRef: "https://x" }];
    const report = classifyOutwardStatusForReport(contract, smokeResults, [], ownerRecords);
    expect(report).not.toBeNull();
    if (report === null) return;
    expect(report.acStatuses.size).toBe(2);
    const ac1Status = outwardAcStatusFromVerification(report.acStatuses.get("AC1") ?? "unverified-external");
    const ac2Status = outwardAcStatusFromVerification(report.acStatuses.get("AC2") ?? "unverified-external");
    expect(ac1Status).toBe("pass");
    expect(ac2Status).toBe("pass");
  });
});
