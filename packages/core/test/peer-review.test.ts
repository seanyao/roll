import { describe, expect, it } from "vitest";
import { parsePeerReviewTranscript, selectPeerReviewer, selectPeerReviewers, reviewerKind } from "../src/index.js";

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

  it("selects only external-provider reviewers and excludes subagents", () => {
    expect(reviewerKind("pi")).toBe("external");
    expect(reviewerKind("subagent:Volta")).toBe("auxiliary");

    expect(
      selectPeerReviewer({
        mode: "hetero",
        candidates: ["subagent:Volta"],
        workerAgents: ["kimi"],
      }),
    ).toEqual({ status: "unavailable", reason: "no_external_reviewer" });

    expect(
      selectPeerReviewer({
        mode: "hetero",
        candidates: ["subagent:Volta", "pi"],
        workerAgents: ["kimi"],
      }),
    ).toMatchObject({ status: "selected", reviewer: "pi", provider: "pi", effectiveMode: "hetero" });
  });
});

describe("FIX-336 — ranked heterogeneous peer reviewer selection", () => {
  it("hetero mode returns only heterogeneous candidates in ranked order", () => {
    const selected = selectPeerReviewers({
      mode: "hetero",
      candidates: ["kimi", "pi", "reasonix"],
      workerAgents: ["kimi"],
    });
    expect(selected.status).toBe("selected");
    if (selected.status !== "selected") return;
    expect(selected.reviewers.map((r) => r.reviewer)).toEqual(["pi", "reasonix"]);
    expect(selected.reviewers.every((r) => r.effectiveMode === "hetero" && !r.degraded)).toBe(true);
  });

  it("hetero mode is unavailable when every candidate shares the worker vendor", () => {
    expect(selectPeerReviewers({ mode: "hetero", candidates: ["kimi"], workerAgents: ["kimi"] })).toEqual({
      status: "unavailable",
      reason: "no_heterogeneous_reviewer",
    });
  });

  it("auto mode ranks hetero first and marks same-vendor fallback as degraded", () => {
    const selected = selectPeerReviewers({
      mode: "auto",
      candidates: ["kimi", "pi", "reasonix"],
      workerAgents: ["kimi"],
    });
    expect(selected.status).toBe("selected");
    if (selected.status !== "selected") return;
    expect(selected.reviewers.map((r) => ({ reviewer: r.reviewer, mode: r.effectiveMode, degraded: r.degraded }))).toEqual([
      { reviewer: "pi", mode: "hetero", degraded: false },
      { reviewer: "reasonix", mode: "hetero", degraded: false },
      { reviewer: "kimi", mode: "self", degraded: true },
    ]);
    expect(selected.reviewers[2]?.reason).toBe("all_heterogeneous_peers_failed");
  });

  it("auto single-provider pool degrades to self with single_provider_available", () => {
    const selected = selectPeerReviewers({ mode: "auto", candidates: ["kimi"], workerAgents: ["kimi"] });
    expect(selected.status).toBe("selected");
    if (selected.status !== "selected") return;
    expect(selected.reviewers).toHaveLength(1);
    expect(selected.reviewers[0]).toMatchObject({
      reviewer: "kimi",
      effectiveMode: "self",
      degraded: true,
      reason: "single_provider_available",
    });
  });

  it("self mode prefers the current worker then other installed reviewers", () => {
    const selected = selectPeerReviewers({ mode: "self", candidates: ["pi", "kimi", "reasonix"], workerAgents: ["kimi"] });
    expect(selected.status).toBe("selected");
    if (selected.status !== "selected") return;
    expect(selected.reviewers.map((r) => r.reviewer)).toEqual(["kimi", "pi", "reasonix"]);
    expect(selected.reviewers.every((r) => r.effectiveMode === "self" && !r.degraded)).toBe(true);
  });

  it("requested reviewer bypasses ranking and resolves effective mode from workers", () => {
    expect(
      selectPeerReviewers({ mode: "auto", candidates: ["kimi", "pi"], workerAgents: ["kimi"], requestedReviewer: "pi" }),
    ).toEqual({
      status: "selected",
      reviewers: [{ effectiveMode: "hetero", reviewer: "pi", provider: "pi", degraded: false }],
    });

    expect(
      selectPeerReviewers({ mode: "auto", candidates: ["kimi", "pi"], workerAgents: ["kimi"], requestedReviewer: "kimi" }),
    ).toEqual({
      status: "selected",
      reviewers: [{ effectiveMode: "self", reviewer: "kimi", provider: "moonshot", degraded: false }],
    });
  });

  it("selectPeerReviewer stays backward-compatible as the head of the ranked list", () => {
    expect(
      selectPeerReviewer({ mode: "auto", candidates: ["kimi", "pi", "reasonix"], workerAgents: ["kimi"] }),
    ).toMatchObject({ status: "selected", reviewer: "pi", effectiveMode: "hetero", degraded: false });
  });
});
