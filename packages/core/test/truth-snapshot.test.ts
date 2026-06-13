/** US-DOSSIER-010 — the one truth aggregation (pure selector). */
import { describe, expect, it } from "vitest";
import { buildTruthSnapshot } from "../src/truth/selectors.js";
import { serializeTruthSnapshot } from "@roll/spec";

describe("buildTruthSnapshot", () => {
  it("tallies the spectrum and totals from pre-classified story states", () => {
    const s = buildTruthSnapshot({
      generatedAt: "2026-06-13T00:00:00Z",
      storyStates: ["done", "done", "todo", "wip", "fail", "unknown", "hold", "done"],
      legacyCount: 2,
      audit: { fail: 1, warn: 3, unknown: 0 },
      cycle: { cycles3d: 5, failed3d: 2, costUsd3d: 1.23 },
      release: { latestTag: "v3.612.2", verdict: "pass" },
    });
    expect(s.story.total).toBe(8);
    expect(s.story.spectrum).toEqual({ done: 3, wip: 1, hold: 1, todo: 1, fail: 1, unknown: 1 });
    expect(Object.values(s.story.spectrum).reduce((a, b) => a + b, 0)).toBe(s.story.total);
    expect(s.story.legacy).toBe(2);
    expect(s.cycle?.failed3d).toBe(2);
    expect(s.release?.verdict).toBe("pass");
  });

  it("omits absent facets instead of inventing zeros (honest unknowns)", () => {
    const s = buildTruthSnapshot({ generatedAt: "t", storyStates: [], legacyCount: 0 });
    expect(s.audit).toBeUndefined();
    expect(s.cycle).toBeUndefined();
    expect(s.release).toBeUndefined();
    expect(s.story.total).toBe(0);
  });

  it("serialization is deterministic and newline-terminated", () => {
    const s = buildTruthSnapshot({ generatedAt: "t", storyStates: ["done"], legacyCount: 0 });
    const a = serializeTruthSnapshot(s);
    expect(a).toBe(serializeTruthSnapshot(s));
    expect(a.endsWith("\n")).toBe(true);
    expect(JSON.parse(a).story.total).toBe(1);
  });

  // US-DOSSIER-021 — the per-story ladder + evidence registry rides the snapshot.
  it("carries the stories[] registry verbatim and stays additive when omitted", () => {
    const stories = [
      { id: "US-A-1", epic: "alpha", ladder: "attested" as const, evidence: { report: true, acMap: true, visualEvidence: true }, truthState: "done" as const, truthReason: "merge_evidence_confirms", legacy: false },
      { id: "US-A-2", epic: "alpha", ladder: "claimed" as const, evidence: { report: false, acMap: false, visualEvidence: false }, truthState: "unknown" as const, legacy: false },
    ];
    const withStories = buildTruthSnapshot({ generatedAt: "t", storyStates: ["done", "unknown"], legacyCount: 0, stories });
    expect(withStories.stories).toEqual(stories);
    // additive: omitting stories leaves the key off entirely (byte-identical to before).
    const without = buildTruthSnapshot({ generatedAt: "t", storyStates: ["done", "unknown"], legacyCount: 0 });
    expect(without.stories).toBeUndefined();
    expect("stories" in without).toBe(false);
  });

  it("the aggregate spectrum still folds from storyStates while stories[] rides alongside", () => {
    const states = ["done", "done", "todo", "unknown"] as const;
    const s = buildTruthSnapshot({
      generatedAt: "t",
      storyStates: states,
      legacyCount: 1,
      stories: states.map((st, i) => ({
        id: `US-${i}`,
        epic: "e",
        ladder: st === "done" ? ("merged" as const) : ("none" as const),
        evidence: { report: false, acMap: false, visualEvidence: false },
        truthState: st,
        legacy: i === 0,
      })),
    });
    // aggregate = sum of storyStates, independent of how many stories[] rows exist.
    expect(s.story.total).toBe(4);
    expect(Object.values(s.story.spectrum).reduce((a, b) => a + b, 0)).toBe(s.story.total);
    expect(s.story.spectrum).toEqual({ done: 2, wip: 0, hold: 0, todo: 1, fail: 0, unknown: 1 });
    expect(s.stories).toHaveLength(4);
  });
});
