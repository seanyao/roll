import { describe, expect, it } from "vitest";
import { renderDesignReviewPageFromMarkdown } from "../src/lib/review-page.js";

const ideaFixture = [
  "# IDEA-066 — Roll Capture.app",
  "",
  "## Detailed design",
  "",
  "### Domain Slice",
  "",
  "- Context: Evidence",
  "- Aggregate: Attest run evidence frame",
  "- Entities touched: Screenshot request, capture result, external requirement readiness",
  "- Cross-context: Tools owns physical.screenshot; Distribution exposes setup/doctor readiness; Presentation renders tool and evidence status.",
  "",
  "### Decision",
  "",
  "Create a dedicated macOS `Roll Capture.app` as the stable physical screenshot host.",
  "",
  "### Contract Schema",
  "",
  "```ts",
  "interface RollCaptureRequestV1 {",
  "  kind: \"web\" | \"terminal\" | \"physical_terminal\";",
  "  out: string;",
  "}",
  "```",
  "",
  "### Complete Worked Sample",
  "",
  "`roll attest US-INIT-003d` creates a request JSON.",
  "Roll invokes:",
  "",
  "```text",
  "open -g -a \"Roll Capture\" --args --request /repo/.roll/tmp/capture/request.json",
  "```",
  "",
  "`Roll Capture.app` opens a Terminal window, runs `roll doctor --tools`, waits for the command sentinel, captures the live rectangle, and writes a response.",
  "The attest evidence frame then records a screenshot evidence item.",
  "",
  "## Sign-off",
  "approve design -> roll design IDEA-066 --split",
  "revise design -> roll design IDEA-066 \"revise ...\"",
  "",
].join("\n");

describe("Design Review Page renderer", () => {
  it("renders deterministic visual blocks for an IDEA-066-shaped design", () => {
    const html = renderDesignReviewPageFromMarkdown({
      id: "IDEA-066",
      title: "Roll Capture.app",
      sourceSpecPath: ".roll/features/acceptance-evidence/IDEA-066/spec.md",
      status: "awaiting-signoff",
      generatedAt: "2026-07-02T00:00:00.000Z",
      cardsCreated: 0,
      nextAction: "open the Design Review Page, then split into implementation cards",
      markdown: ideaFixture,
      lang: "en",
    });

    expect(html).toContain("Design Review Page · IDEA-066");
    expect(html).toContain("Architecture Map");
    expect(html).toContain("Flow Diagram");
    expect(html).toContain("Decision Matrix");
    expect(html).toContain("Prototype Frames");
    expect(html).toContain("Sign-off");
    expect(html).toContain("Roll Capture.app");
    expect(html).toContain("roll doctor --tools");
    expect(html).not.toContain("not enough structure");
    expect(html).not.toContain("Dossier");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\bfetch\(/);
    expect(html).not.toMatch(/<script/i);
  });

  it("renders honest gaps when the design has too little structure", () => {
    const html = renderDesignReviewPageFromMarkdown({
      id: "IDEA-GAP",
      title: "Thin design",
      sourceSpecPath: ".roll/features/demo/IDEA-GAP/spec.md",
      status: "awaiting-signoff",
      generatedAt: "2026-07-02T00:00:00.000Z",
      cardsCreated: 0,
      nextAction: "review the raw design",
      markdown: "# IDEA-GAP\n\n## Detailed design\n\nSome prose only.",
      lang: "en",
    });

    expect(html).toContain("not enough structure");
    expect(html).toContain(".roll/features/demo/IDEA-GAP/spec.md#detailed-design");
    expect(html).not.toContain("invented");
  });

  it("is byte-stable for the same scrubbed input", () => {
    const input = {
      id: "IDEA-066",
      title: "Roll Capture.app",
      sourceSpecPath: ".roll/features/acceptance-evidence/IDEA-066/spec.md",
      status: "awaiting-signoff" as const,
      generatedAt: "<TS>",
      cardsCreated: 0,
      nextAction: "open the Design Review Page",
      markdown: ideaFixture,
      lang: "en" as const,
    };

    expect(renderDesignReviewPageFromMarkdown(input)).toBe(renderDesignReviewPageFromMarkdown(input));
  });
});
