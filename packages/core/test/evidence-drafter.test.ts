/**
 * US-OBS-031 — Evidence Drafter tests.
 *
 * Tests the auto-draft ac-map pipeline: activity signals + git diff → draft ac-map.
 * Core invariants: every output entry starts conservative (claimed/missing, never pass);
 * high-confidence direct matches get "high"; heuristic matches get "medium"; no match → missing.
 */
import { describe, it, expect } from "vitest";
import { draftAcMap, type DraftAcMapInput } from "../src/attest/evidence-drafter.js";
import type { CycleActivityEvent } from "@roll/spec";

// ════════════════════════════════════════════════════════════════════════════
// Test helpers
// ════════════════════════════════════════════════════════════════════════════

function tcrSignal(overrides: Partial<CycleActivityEvent> = {}): CycleActivityEvent {
  return {
    kind: "tcr",
    cycle_id: "cycle-001",
    ts: 1000,
    agent: "claude",
    payload: { commitHash: "abc1234", message: "add evidence drafter" },
    ...overrides,
  } as CycleActivityEvent;
}

function gateSignal(gate: string, verdict: string, detail?: string): CycleActivityEvent {
  return {
    kind: "gate",
    cycle_id: "cycle-001",
    ts: 2000,
    agent: "claude",
    payload: { gate, verdict, ...(detail !== undefined ? { detail } : {}) },
  } as CycleActivityEvent;
}

function toolCallSignal(tool: string, summary: string): CycleActivityEvent {
  return {
    kind: "tool_call",
    cycle_id: "cycle-001",
    ts: 1500,
    agent: "claude",
    payload: { tool, input: summary },
    ...({} as Record<string, unknown>),
  } as unknown as CycleActivityEvent;
}

function lifecycleSignal(event: string, detail?: string): CycleActivityEvent {
  return {
    kind: "lifecycle",
    cycle_id: "cycle-001",
    ts: 500,
    agent: "claude",
    payload: { event, ...(detail !== undefined ? { detail } : {}) },
  } as CycleActivityEvent;
}

// ════════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════════

describe("draftAcMap", () => {
  it("returns entries in the same order as input acItems", () => {
    const input: DraftAcMapInput = {
      acItems: [
        { id: "US-001:AC1", text: "Build the evidence drafter module" },
        { id: "US-001:AC2", text: "Add screenshot references" },
      ],
      signals: [],
      changedFiles: [],
    };

    const result = draftAcMap(input);
    expect(result).toHaveLength(2);
    expect(result[0]!.ac).toBe("US-001:AC1");
    expect(result[1]!.ac).toBe("US-001:AC2");
  });

  it("defaults every AC to claimed or missing — never pass", () => {
    const input: DraftAcMapInput = {
      acItems: [
        { id: "US-001:AC1", text: "Some feature" },
        { id: "US-001:AC2", text: "Another feature" },
      ],
      signals: [tcrSignal()],
      changedFiles: ["packages/core/src/attest/evidence-drafter.ts"],
    };

    const result = draftAcMap(input);
    for (const entry of result) {
      expect(entry.status).not.toBe("pass");
      expect(["claimed", "missing"]).toContain(entry.status);
    }
  });

  it("marks AC as missing when no signals or files correlate", () => {
    const input: DraftAcMapInput = {
      acItems: [{ id: "US-001:AC1", text: "An obscure unreferenced requirement" }],
      signals: [
        tcrSignal({ payload: { commitHash: "abc1234", message: "something unrelated" } }),
      ],
      changedFiles: ["README.md"],
    };

    const result = draftAcMap(input);
    expect(result[0]!.status).toBe("missing");
    expect(result[0]!.evidence).toHaveLength(0);
    expect(result[0]!.note).toBeDefined();
  });

  it("matches TCR commits to AC by keyword correlation", () => {
    const input: DraftAcMapInput = {
      acItems: [{ id: "US-001:AC1", text: "Build the evidence drafter module" }],
      signals: [
        tcrSignal({ payload: { commitHash: "abc1234", message: "add evidence drafter core logic" } }),
        tcrSignal({ payload: { commitHash: "def5678", message: "fix typo in unrelated module" } }),
      ],
      changedFiles: [],
    };

    const result = draftAcMap(input);
    expect(result[0]!.status).toBe("claimed");
    expect(result[0]!.evidence.length).toBeGreaterThanOrEqual(1);
    const matched = result[0]!.evidence.filter((e) => e.source.includes("abc1234"));
    expect(matched).toHaveLength(1);
    expect(matched[0]!.confidence).toBe("high");
  });

  it("matches gate signals to AC by keyword", () => {
    const input: DraftAcMapInput = {
      acItems: [{ id: "US-001:AC1", text: "CI test pass and gate check succeed" }],
      signals: [
        gateSignal("ci", "pass", "12 tests · 3.2s"),
        gateSignal("peer", "pass"),
      ],
      changedFiles: [],
    };

    const result = draftAcMap(input);
    expect(result[0]!.status).toBe("claimed");
    const ciEvidence = result[0]!.evidence.filter((e) => e.kind === "ci");
    expect(ciEvidence.length).toBeGreaterThanOrEqual(1);
  });

  it("matches changed files to AC by keyword correlation", () => {
    const input: DraftAcMapInput = {
      acItems: [{ id: "US-001:AC1", text: "Build the evidence drafter module" }],
      signals: [],
      changedFiles: [
        "packages/core/src/attest/evidence-drafter.ts",
        "packages/core/test/evidence-drafter.test.ts",
        "README.md",
      ],
    };

    const result = draftAcMap(input);
    expect(result[0]!.status).toBe("claimed");
    const fileEvidence = result[0]!.evidence.filter((e) => e.source.startsWith("git diff"));
    expect(fileEvidence).toHaveLength(1);
    expect(fileEvidence[0]!.confidence).toBe("medium");
  });

  it("attaches screenshot references when screenshots are provided", () => {
    const input: DraftAcMapInput = {
      acItems: [{ id: "US-001:AC1", text: "Screenshot of terminal output" }],
      signals: [],
      changedFiles: [],
      screenshots: ["terminal.png", "web.png"],
    };

    const result = draftAcMap(input);
    const ssEvidence = result[0]!.evidence.filter((e) => e.kind === "screenshot");
    // "screenshot" keyword appears in the source "captured artifact: terminal.png"
    // but "terminal" is a keyword token so it should match
    expect(ssEvidence.length).toBeGreaterThanOrEqual(1);
  });

  it("marks confidence as high for direct signal matches with multiple keyword hits", () => {
    const input: DraftAcMapInput = {
      acItems: [{ id: "US-001:AC1", text: "evidence drafter automatically produces ac-map from activity stream" }],
      signals: [
        tcrSignal({ payload: { commitHash: "abc1234", message: "add evidence drafter to auto-produce ac-map from activity stream" } }),
      ],
      changedFiles: [
        "packages/core/src/attest/evidence-drafter.ts",
      ],
    };

    const result = draftAcMap(input);
    expect(result[0]!.confidence).toBe("high");
  });

  it("marks confidence as medium for file-only matches without signal correlation", () => {
    const input: DraftAcMapInput = {
      acItems: [{ id: "US-001:AC1", text: "Build the evidence drafter module" }],
      signals: [],
      changedFiles: ["packages/core/src/attest/evidence-drafter.ts"],
    };

    const result = draftAcMap(input);
    expect(result[0]!.confidence).toBe("medium");
  });

  it("marks confidence as low when no evidence at all matches", () => {
    const input: DraftAcMapInput = {
      acItems: [{ id: "US-001:AC1", text: "An obscure unreferenced requirement" }],
      signals: [
        tcrSignal({ payload: { commitHash: "abc1234", message: "something completely unrelated" } }),
      ],
      changedFiles: ["README.md"],
    };

    const result = draftAcMap(input);
    expect(result[0]!.confidence).toBe("low");
    expect(result[0]!.status).toBe("missing");
  });

  it("deduplicates TCR commits with the same hash", () => {
    const input: DraftAcMapInput = {
      acItems: [{ id: "US-001:AC1", text: "Add evidence module" }],
      signals: [
        tcrSignal({ payload: { commitHash: "abc1234", message: "add evidence module" } }),
        tcrSignal({ payload: { commitHash: "abc1234", message: "add evidence module" } }), // duplicate
      ],
      changedFiles: [],
    };

    const result = draftAcMap(input);
    const tcrEvidence = result[0]!.evidence.filter((e) => e.kind === "commit");
    expect(tcrEvidence).toHaveLength(1);
  });

  it("includes a note explaining what the builder should do for claimed entries", () => {
    const input: DraftAcMapInput = {
      acItems: [{ id: "US-001:AC1", text: "Add evidence module" }],
      signals: [tcrSignal({ payload: { commitHash: "abc1234", message: "add evidence module" } })],
      changedFiles: [],
    };

    const result = draftAcMap(input);
    expect(result[0]!.note).toBeDefined();
    expect(result[0]!.note).toContain("confirm");
  });

  it("handles empty input gracefully", () => {
    const result = draftAcMap({
      acItems: [],
      signals: [],
      changedFiles: [],
    });
    expect(result).toEqual([]);
  });

  it("does not match lifecycle signals (they are not evidence)", () => {
    const input: DraftAcMapInput = {
      acItems: [{ id: "US-001:AC1", text: "Cycle starts correctly" }],
      signals: [lifecycleSignal("cycle:start", "cycle-001")],
      changedFiles: [],
    };

    const result = draftAcMap(input);
    // Lifecycle events are not extracted as evidence — they should result in missing
    expect(result[0]!.status).toBe("missing");
    expect(result[0]!.evidence).toHaveLength(0);
  });
});
