/**
 * US-V4-004 — pure execution-profile selection + risk classification.
 * Covers the arch §12 decision boundaries and the spec-text heuristics, plus the
 * backwards-compatible "no v4 signals → standard" path.
 */
import { describe, expect, it } from "vitest";
import { applyExecutionPolicy, classifyStoryRisk, explainExecutionProfile, selectExecutionProfile } from "../src/loop/execution-profile.js";
import type { StoryRiskInput } from "@roll/spec";

function base(over: Partial<StoryRiskInput> = {}): StoryRiskInput {
  return {
    storyId: "US-1",
    storyType: "US",
    filesHint: [],
    userVisible: false,
    visualEvidenceRequired: false,
    crossModule: false,
    touchesTruthOrRelease: false,
    touchesAgentRuntime: false,
    acceptanceAmbiguous: false,
    historicalEvidenceRisk: false,
    ...over,
  };
}

describe("selectExecutionProfile (arch §12)", () => {
  it("low-risk local work → standard", () => {
    expect(selectExecutionProfile(base())).toBe("standard");
  });

  it("user-visible OR visual-evidence OR weak history → verified", () => {
    expect(selectExecutionProfile(base({ userVisible: true }))).toBe("verified");
    expect(selectExecutionProfile(base({ visualEvidenceRequired: true }))).toBe("verified");
    expect(selectExecutionProfile(base({ historicalEvidenceRisk: true }))).toBe("verified");
  });

  it("ambiguous / cross-module / truth-release / agent-runtime → planned", () => {
    expect(selectExecutionProfile(base({ acceptanceAmbiguous: true }))).toBe("planned");
    expect(selectExecutionProfile(base({ crossModule: true }))).toBe("planned");
    expect(selectExecutionProfile(base({ touchesTruthOrRelease: true }))).toBe("planned");
    expect(selectExecutionProfile(base({ touchesAgentRuntime: true }))).toBe("planned");
  });

  it("planning risk dominates evidence risk (planned wins over verified)", () => {
    expect(selectExecutionProfile(base({ userVisible: true, crossModule: true }))).toBe("planned");
  });

  it("explain gives a deterministic rationale per tier", () => {
    expect(explainExecutionProfile(base())).toMatch(/^standard/);
    expect(explainExecutionProfile(base({ userVisible: true }))).toMatch(/^verified/);
    expect(explainExecutionProfile(base({ touchesTruthOrRelease: true }))).toMatch(/^planned/);
  });
});

describe("applyExecutionPolicy (execution_policy.mode gates execution)", () => {
  it("standard mode forces standard regardless of classification (no-regression default)", () => {
    expect(applyExecutionPolicy("planned", "standard")).toBe("standard");
    expect(applyExecutionPolicy("verified", "standard")).toBe("standard");
    expect(applyExecutionPolicy("standard", "standard")).toBe("standard");
  });
  it("auto mode uses the classified profile", () => {
    expect(applyExecutionPolicy("planned", "auto")).toBe("planned");
    expect(applyExecutionPolicy("verified", "auto")).toBe("verified");
    expect(applyExecutionPolicy("standard", "auto")).toBe("standard");
  });
  it("verified mode floors at verified; planned still escalates", () => {
    expect(applyExecutionPolicy("standard", "verified")).toBe("verified");
    expect(applyExecutionPolicy("verified", "verified")).toBe("verified");
    expect(applyExecutionPolicy("planned", "verified")).toBe("planned");
  });
  it("planned mode forces the full pipeline", () => {
    expect(applyExecutionPolicy("standard", "planned")).toBe("planned");
  });
});

describe("classifyStoryRisk (spec-text heuristics)", () => {
  it("a clear local FIX with ACs and no visible surface → standard", () => {
    const spec = "---\nid: FIX-1\nscreenshot_exempt: pure parser fix\n---\n## Acceptance Criteria\n- [ ] parser handles edge case\n";
    const input = classifyStoryRisk("FIX-1", spec);
    expect(input.storyType).toBe("FIX");
    expect(selectExecutionProfile(input)).toBe("standard");
  });

  it("a [visual-evidence] / physical_terminal story → verified", () => {
    const spec = "---\nid: US-2\nphysical_terminal: required\n---\n## Acceptance Criteria\n- [ ] [visual-evidence] terminal shows output\n";
    const input = classifyStoryRisk("US-2", spec);
    expect(input.visualEvidenceRequired).toBe(true);
    expect(input.userVisible).toBe(true);
    expect(selectExecutionProfile(input)).toBe("verified");
  });

  it("a truth/release story → planned", () => {
    const spec = "## Context\nChange the release consistency gate and DeliveryRecord truth.\n\n## Acceptance Criteria\n- [ ] gate reads structured truth\n";
    const input = classifyStoryRisk("US-3", spec);
    expect(input.touchesTruthOrRelease).toBe(true);
    expect(selectExecutionProfile(input)).toBe("planned");
  });

  it("an agent-runtime story → planned", () => {
    const spec = "## Context\nNormalize the agent routing / rig + execution profile config.\n\n## Acceptance Criteria\n- [ ] router resolves rigs\n";
    expect(selectExecutionProfile(classifyStoryRisk("US-4", spec))).toBe("planned");
  });

  it("a story with NO acceptance criteria is ambiguous → planned", () => {
    const input = classifyStoryRisk("US-5", "## Context\nDo something useful.\n");
    expect(input.acceptanceAmbiguous).toBe(true);
    expect(selectExecutionProfile(input)).toBe("planned");
  });

  it("a multi-package filesHint → cross-module → planned", () => {
    const spec = "## Acceptance Criteria\n- [ ] works\n";
    const input = classifyStoryRisk("US-6", spec, { filesHint: ["packages/cli/src/a.ts", "packages/core/src/b.ts"] });
    expect(input.crossModule).toBe(true);
    expect(selectExecutionProfile(input)).toBe("planned");
  });

  it("backwards compat: a plain local story with no v4 risk signals stays standard", () => {
    const spec = "---\nid: FIX-7\nscreenshot_exempt: internal rename\n---\n## Acceptance Criteria\n- [ ] rename applied\n";
    expect(selectExecutionProfile(classifyStoryRisk("FIX-7", spec))).toBe("standard");
  });
});
