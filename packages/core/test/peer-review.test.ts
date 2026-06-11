import { describe, expect, it } from "vitest";
import { parsePeerReviewTranscript, selectPeerReviewer, reviewerKind } from "../src/index.js";

describe("FIX-255 peer review adapter core", () => {
  it("parses a single anchored APPROVE verdict with reason and findings", () => {
    const parsed = parsePeerReviewTranscript("VERDICT: APPROVE\nREASON: ACs line up\nFINDING: tests cover the edge\n");

    expect(parsed.verdict).toBe("APPROVE");
    expect(parsed.reason).toBe("ACs line up");
    expect(parsed.findings).toEqual(["tests cover the edge"]);
  });

  it("fails closed on malformed or multiple verdict lines", () => {
    const parsed = parsePeerReviewTranscript("VERDICT: APPROVE\nVERDICT: REQUEST_CHANGES\nREASON: ambiguous\n");

    expect(parsed.verdict).toBe("REQUEST_CHANGES");
    expect(parsed.reason).toBe("malformed_or_multiple_verdict_lines");
    expect(parsed.findings[0]).toContain("ambiguous");
  });

  it("selects only external-provider reviewers and excludes Codex subagents", () => {
    expect(reviewerKind("codex")).toBe("external");
    expect(reviewerKind("codex-subagent:Volta")).toBe("auxiliary");

    expect(
      selectPeerReviewer({
        mode: "hetero",
        candidates: ["codex-subagent:Volta"],
        workerAgents: ["claude"],
      }),
    ).toEqual({ status: "unavailable", reason: "no_external_reviewer" });

    expect(
      selectPeerReviewer({
        mode: "hetero",
        candidates: ["codex-subagent:Volta", "codex"],
        workerAgents: ["claude"],
      }),
    ).toMatchObject({ status: "selected", reviewer: "codex", provider: "openai", effectiveMode: "hetero" });
  });
});
