/**
 * US-SKILL-030 — Evaluation contract parser tests (AC5).
 *
 * Covers:
 *   - Parsing a full evaluation contract block from spec.md
 *   - Legacy spec fallback (no block → null, no crash, no behavior change)
 *   - Minimal block (one-item expected_evidence)
 *   - Formatting for scorer prompt
 *   - Evidence delta summary (planned-vs-delivered)
 */
import { describe, expect, it } from "vitest";
import {
  evidenceDeltaSummary,
  formatEvaluationContractForScorer,
  parseEvaluationContract,
  type EvaluationContract,
} from "../src/lib/evaluation-contract.js";

const FULL_SPEC = `---
id: US-EXAMPLE-001
title: example story
---

**Evaluation contract:**
- expected_evidence:
  - kind: test
    target: packages/cli/test/example.test.ts
    proves: AC1
  - kind: screenshot
    target: the console Casting tab
    proves: AC2
- scorer_focus:
  - judge whether the CLI output is consistent across locales
  - check that the backlog index row format matches the spec
- builder_notes:
  - use the shared markdown renderer, don't inline regex
  - the screenshot is the real product page, not the dossier
`;

const MINIMAL_SPEC = `---
id: US-TRIVIAL-001
---

**Evaluation contract:**
- expected_evidence:
  - kind: diff
    target: CHANGELOG.md
    proves: AC1
- scorer_focus:
  - nothing beyond generic code quality
`;

const LEGACY_SPEC = `---
id: US-OLD-001
title: old story without contract
---

**AC:**
- [ ] Do something
- [ ] Verify it works
`;

const SPEC_WITH_EMPTY_CONTRACT = `---
id: US-EMPTY-001
---

**Evaluation contract:**
- expected_evidence:
- scorer_focus:
- builder_notes:
`;

const SPEC_CONTRACT_AFTER_HEADING = `---
id: US-AFTER-001
---

## Design

**Evaluation contract:**
- expected_evidence:
  - kind: command
    target: roll status
    proves: CLI output matches
- scorer_focus:
  - output format correctness
`;

describe("parseEvaluationContract", () => {
  it("parses a full evaluation contract with all sections", () => {
    const contract = parseEvaluationContract(FULL_SPEC);
    expect(contract).not.toBeNull();
    expect(contract!.expected_evidence).toHaveLength(2);

    expect(contract!.expected_evidence[0]).toEqual({
      kind: "test",
      target: "packages/cli/test/example.test.ts",
      proves: "AC1",
    });
    expect(contract!.expected_evidence[1]).toEqual({
      kind: "screenshot",
      target: "the console Casting tab",
      proves: "AC2",
    });

    expect(contract!.scorer_focus).toHaveLength(2);
    expect(contract!.scorer_focus[0]).toContain("consistent across locales");
    expect(contract!.scorer_focus[1]).toContain("backlog index row format");

    expect(contract!.builder_notes).toHaveLength(2);
    expect(contract!.builder_notes[0]).toContain("shared markdown renderer");
  });

  it("parses a minimal one-item block", () => {
    const contract = parseEvaluationContract(MINIMAL_SPEC);
    expect(contract).not.toBeNull();
    expect(contract!.expected_evidence).toHaveLength(1);
    expect(contract!.expected_evidence[0]).toEqual({
      kind: "diff",
      target: "CHANGELOG.md",
      proves: "AC1",
    });
    expect(contract!.scorer_focus).toHaveLength(1);
    expect(contract!.builder_notes).toHaveLength(0);
  });

  it("returns null for legacy spec without the block", () => {
    const contract = parseEvaluationContract(LEGACY_SPEC);
    expect(contract).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseEvaluationContract("")).toBeNull();
    expect(parseEvaluationContract("\n\n")).toBeNull();
  });

  it("returns empty-lists contract for empty expected_evidence (trivial story)", () => {
    const contract = parseEvaluationContract(SPEC_WITH_EMPTY_CONTRACT);
    expect(contract).not.toBeNull();
    expect(contract!.expected_evidence).toHaveLength(0);
    expect(contract!.scorer_focus).toHaveLength(0);
    expect(contract!.builder_notes).toHaveLength(0);
  });

  it("stops at the next ** heading", () => {
    const spec = `---
id: US-STOP-001
---

**Evaluation contract:**
- expected_evidence:
  - kind: test
    target: a.test.ts
    proves: AC1

**Domain Model:**
- Context: Foo
`;
    const contract = parseEvaluationContract(spec);
    expect(contract).not.toBeNull();
    expect(contract!.expected_evidence).toHaveLength(1);
    // "Domain Model:" should NOT end up in scorer_focus
    expect(contract!.scorer_focus).toHaveLength(0);
  });

  it("stops at a ## heading", () => {
    const spec = `---
id: US-STOP2-001
---

**Evaluation contract:**
- expected_evidence:
  - kind: manual
    target: manual check
    proves: AC1

## Acceptance Criteria
- [ ] AC1 works
`;
    const contract = parseEvaluationContract(spec);
    expect(contract).not.toBeNull();
    expect(contract!.expected_evidence).toHaveLength(1);
  });

  it("handles contract after another heading in the spec body", () => {
    const contract = parseEvaluationContract(SPEC_CONTRACT_AFTER_HEADING);
    expect(contract).not.toBeNull();
    expect(contract!.expected_evidence).toHaveLength(1);
    expect(contract!.expected_evidence[0]!.kind).toBe("command");
  });
});

describe("formatEvaluationContractForScorer", () => {
  it("formats the contract for the scorer prompt", () => {
    const contract: EvaluationContract = {
      expected_evidence: [
        { kind: "test", target: "foo.test.ts", proves: "AC1" },
        { kind: "screenshot", target: "console page", proves: "AC2" },
      ],
      scorer_focus: ["locale consistency", "format correctness"],
      builder_notes: [],
    };
    const result = formatEvaluationContractForScorer(contract);
    expect(result).toContain("Planned evidence:");
    expect(result).toContain("test: foo.test.ts (proves AC1)");
    expect(result).toContain("screenshot: console page (proves AC2)");
    expect(result).toContain("Scorer focus:");
    expect(result).toContain("locale consistency");
  });

  it("returns empty string for null contract", () => {
    expect(formatEvaluationContractForScorer(null)).toBe("");
  });
});

describe("evidenceDeltaSummary", () => {
  it("builds planned-vs-delivered mapping", () => {
    const contract: EvaluationContract = {
      expected_evidence: [
        { kind: "test", target: "x.test.ts", proves: "AC1" },
        { kind: "screenshot", target: "page", proves: "AC2" },
      ],
      scorer_focus: [],
      builder_notes: [],
    };
    const acMap = [
      { ac: "AC1", status: "pass", evidence: [] },
      { ac: "AC2", status: "partial", evidence: [] },
    ];
    const summary = evidenceDeltaSummary(contract, acMap);
    expect(summary).toContain("✅ test: x.test.ts → AC1 (pass)");
    expect(summary).toContain("⚠️ screenshot: page → AC2 (partial)");
  });

  it("marks unlisted ACs as missing", () => {
    const contract: EvaluationContract = {
      expected_evidence: [{ kind: "test", target: "t", proves: "AC99" }],
      scorer_focus: [],
      builder_notes: [],
    };
    const summary = evidenceDeltaSummary(contract, []);
    expect(summary).toContain("❓ test: t → AC99 (missing)");
  });

  it("returns empty string for null contract", () => {
    expect(evidenceDeltaSummary(null, [])).toBe("");
  });
});
