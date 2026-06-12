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
});
