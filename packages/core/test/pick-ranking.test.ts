import { describe, expect, it } from "vitest";
import {
  advisoryRankItems,
  buildPickRankingCacheKey,
  parsePickRankingJson,
  type BacklogItem,
} from "../src/index.js";

const TODO = "📋 Todo";
const DONE = "✅ Done";

function item(id: string, status = TODO, desc = ""): BacklogItem {
  return { id, status, desc };
}

describe("pick semantic ranking — parser", () => {
  it("accepts JSON arrays with bounded score and one-line reason", () => {
    const parsed = parsePickRankingJson(
      JSON.stringify([
        { id: "US-2", score: 99, reason: "unblocks the release lane" },
        { id: "FIX-1", score: 45, reason: "small cleanup" },
      ]),
    );
    expect(parsed).toEqual({
      ok: true,
      entries: [
        { id: "US-2", score: 99, reason: "unblocks the release lane" },
        { id: "FIX-1", score: 45, reason: "small cleanup" },
      ],
    });
  });

  it("rejects malformed JSON, unknown ids, bad scores, and empty reasons", () => {
    const candidates = [item("US-1"), item("US-2")];
    expect(parsePickRankingJson("{not json", candidates).ok).toBe(false);
    expect(parsePickRankingJson('[{"id":"US-X","score":50,"reason":"x"}]', candidates).ok).toBe(false);
    expect(parsePickRankingJson('[{"id":"US-1","score":101,"reason":"x"}]', candidates).ok).toBe(false);
    expect(parsePickRankingJson('[{"id":"US-1","score":50,"reason":""}]', candidates).ok).toBe(false);
  });

  it("accepts text noise around the first valid JSON array", () => {
    const parsed = parsePickRankingJson(
      'ignore range [0-100]\n[{"id":"US-1","score":80,"reason":"ready now"}]\ntrailing text',
      [item("US-1")],
    );
    expect(parsed).toEqual({
      ok: true,
      entries: [{ id: "US-1", score: 80, reason: "ready now" }],
    });
  });
});

describe("pick semantic ranking — cache key", () => {
  it("changes when backlog content or candidate set changes", () => {
    const a = buildPickRankingCacheKey("backlog-a", [item("US-1"), item("US-2")]);
    const same = buildPickRankingCacheKey("backlog-a", [item("US-1"), item("US-2")]);
    const changedBacklog = buildPickRankingCacheKey("backlog-b", [item("US-1"), item("US-2")]);
    const changedCandidates = buildPickRankingCacheKey("backlog-a", [item("US-1"), item("US-3")]);
    expect(same).toEqual(a);
    expect(changedBacklog).not.toEqual(a);
    expect(changedCandidates).not.toEqual(a);
  });
});

describe("pick semantic ranking — advisory merge", () => {
  it("puts ranked items first by score while preserving deterministic fallback order", () => {
    const items = [item("FIX-1"), item("US-1"), item("US-2"), item("REFACTOR-1")];
    expect(advisoryRankItems(items, [
      { id: "US-2", score: 90, reason: "higher value" },
      { id: "FIX-1", score: 10, reason: "less urgent" },
    ]).map((row) => row.id)).toEqual(["US-2", "FIX-1", "US-1", "REFACTOR-1"]);
  });

  it("does not make ineligible high-score cards pickable", () => {
    const items = [
      item("US-BLOCKED", TODO, "depends-on:US-MISSING"),
      item("US-READY", TODO),
      item("US-DONE", DONE),
    ];
    const ranked = advisoryRankItems(items, [
      { id: "US-BLOCKED", score: 100, reason: "looks important" },
      { id: "US-DONE", score: 95, reason: "already shipped" },
      { id: "US-READY", score: 1, reason: "still eligible" },
    ]);
    expect(ranked.map((row) => row.id)).toEqual(["US-BLOCKED", "US-DONE", "US-READY"]);
  });
});
