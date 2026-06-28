/**
 * US-V4-005 — Evaluator artifact contract: render/parse round-trip, assembly from
 * the three SEPARATE contracts (blocking review / score / attest), and fail-closed
 * validation (missing/malformed artifact, builder self-grade).
 */
import { describe, expect, it } from "vitest";
import {
  assembleEvalReport,
  parseEvalReport,
  renderEvalReport,
  validateArtifactManifest,
  validateEvaluatorArtifact,
} from "../src/loop/evaluator-artifact.js";
import type { EvalReport } from "@roll/spec";

function manifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    storyId: "US-1",
    cycleId: "C-1",
    role: "evaluator",
    rig: { agent: "reasonix" },
    sessionId: "C-1:eval:reasonix:1700",
    worktreeCwd: "/wt",
    scoreRepoCwd: "/repo",
    inputs: [],
    outputs: [],
    createdAt: "2026-06-28T00:00:00Z",
    ...over,
  };
}

describe("eval-report render/parse round-trip", () => {
  it("round-trips a full report", () => {
    const report: EvalReport = {
      storyId: "US-1",
      blockingFindings: ["AC2 has no test", "regression in parser"],
      advisoryFindings: ["consider renaming foo"],
      score: { value: 8, verdict: "good" },
      attestStatus: "produced",
      recommendation: "repair",
    };
    const parsed = parseEvalReport(renderEvalReport(report), "US-1");
    expect(parsed).toEqual(report);
  });

  it("round-trips an empty-findings merge report", () => {
    const report: EvalReport = {
      storyId: "US-2",
      blockingFindings: [],
      advisoryFindings: [],
      attestStatus: "produced",
      recommendation: "merge",
    };
    expect(parseEvalReport(renderEvalReport(report), "US-2")).toEqual(report);
  });

  it("carries a planned-vs-delivered section through", () => {
    const report: EvalReport = {
      storyId: "US-3",
      blockingFindings: [],
      advisoryFindings: [],
      attestStatus: "produced",
      plannedVsDelivered: "AC1 satisfied; AC2 changed (deferred screenshot)",
      recommendation: "merge",
    };
    expect(parseEvalReport(renderEvalReport(report), "US-3")?.plannedVsDelivered).toContain("AC1 satisfied");
  });
});

describe("parseEvalReport — fail-closed", () => {
  it("returns null on empty / non-string", () => {
    expect(parseEvalReport("", "US-1")).toBeNull();
    expect(parseEvalReport("   ", "US-1")).toBeNull();
  });
  it("returns null when required sections are missing", () => {
    expect(parseEvalReport("# Evaluator report\n\nsome prose, no sections", "US-1")).toBeNull();
    // has blocking + attest but no recommendation
    expect(parseEvalReport("## Blocking findings\n- x\n## Attest / evidence status\n- produced\n", "US-1")).toBeNull();
  });
  it("returns null on an unknown recommendation value", () => {
    const md = "## Blocking findings\n- (none)\n## Attest / evidence status\n- produced\n## Recommendation\n- ship-it\n";
    expect(parseEvalReport(md, "US-1")).toBeNull();
  });
});

describe("assembleEvalReport — three separate contracts → recommendation", () => {
  it("a blocking finding → repair (regardless of score)", () => {
    const r = assembleEvalReport({ storyId: "US-1", blockingFindings: ["AC2 fails"], score: { value: 9, verdict: "good" }, attestStatus: "produced" });
    expect(r.recommendation).toBe("repair");
    expect(r.blockingFindings).toEqual(["AC2 fails"]);
  });
  it("a regression score → repair even with no blocking findings", () => {
    const r = assembleEvalReport({ storyId: "US-1", blockingFindings: [], score: { value: 3, verdict: "regression" }, attestStatus: "produced" });
    expect(r.recommendation).toBe("repair");
  });
  it("a skipped attest with clean review → hold", () => {
    const r = assembleEvalReport({ storyId: "US-1", blockingFindings: [], score: { value: 8, verdict: "good" }, attestStatus: "skipped" });
    expect(r.recommendation).toBe("hold");
  });
  it("clean review + produced attest → merge", () => {
    const r = assembleEvalReport({ storyId: "US-1", blockingFindings: [], score: { value: 8, verdict: "good" }, attestStatus: "produced" });
    expect(r.recommendation).toBe("merge");
  });
  it("keeps score, blocking, and attest as distinct dimensions (not one pass/fail)", () => {
    const r = assembleEvalReport({ storyId: "US-1", blockingFindings: ["x"], score: { value: 7, verdict: "ok" }, attestStatus: "produced", advisoryFindings: ["y"] });
    expect(r.score).toEqual({ value: 7, verdict: "ok" });
    expect(r.attestStatus).toBe("produced");
    expect(r.advisoryFindings).toEqual(["y"]);
  });
});

describe("validateEvaluatorArtifact — fail-closed + independence", () => {
  const reportMd = renderEvalReport({ storyId: "US-1", blockingFindings: [], advisoryFindings: [], attestStatus: "produced", recommendation: "merge" });

  it("accepts a well-formed evaluator artifact from a distinct fresh session", () => {
    const v = validateEvaluatorArtifact({ manifest: manifest(), reportMd, storyId: "US-1", builderSessionId: "C-1:build:codex:1600" });
    expect(v.ok).toBe(true);
    expect(v.reasons).toEqual([]);
  });

  it("fails closed when the eval-report is missing", () => {
    const v = validateEvaluatorArtifact({ manifest: manifest(), reportMd: null, storyId: "US-1", builderSessionId: "B" });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toContain("eval-report.md missing or malformed");
  });

  it("fails closed when the eval-report is malformed", () => {
    const v = validateEvaluatorArtifact({ manifest: manifest(), reportMd: "garbage", storyId: "US-1", builderSessionId: "B" });
    expect(v.ok).toBe(false);
  });

  it("rejects a manifest whose role is not evaluator", () => {
    const v = validateEvaluatorArtifact({ manifest: manifest({ role: "builder" }), reportMd, storyId: "US-1", builderSessionId: "B" });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toContain('role !== "evaluator"');
  });

  it("BUILDER SELF-GRADE: rejects when evaluator sessionId === builder sessionId", () => {
    const builder = "C-1:build:codex:1600";
    const v = validateEvaluatorArtifact({ manifest: manifest({ sessionId: builder }), reportMd, storyId: "US-1", builderSessionId: builder });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toContain("self-grade");
  });

  it("rejects a manifest with no sessionId (independence unverifiable)", () => {
    const v = validateEvaluatorArtifact({ manifest: manifest({ sessionId: "" }), reportMd, storyId: "US-1", builderSessionId: "B" });
    expect(v.ok).toBe(false);
  });

  it("rejects a wholly missing manifest", () => {
    expect(validateArtifactManifest(null, "evaluator").ok).toBe(false);
    expect(validateArtifactManifest(undefined, "planner").ok).toBe(false);
  });
});
