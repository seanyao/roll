/**
 * Unit tests for StoryPicker: status skip rules, depends-on chains
 * (multi-dep / missing dep / done dep), open-PR skip, type priority, and
 * first-in-file-order selection.
 */
import { describe, expect, it } from "vitest";
import { AWAITING_REVIEW_STATUS_MARKER } from "@roll/spec";
import { assessBacklog, buildHasOpenPr, parseDependsOn, pickStory, prTitleReferences, shouldSuppressDormancy, type BacklogItem } from "../src/index.js";

/** Terse fixture row builder. */
function item(id: string, status: string, desc = ""): BacklogItem {
  return { id, status, desc };
}

const TODO = "📋 Todo";
const DONE = "✅ Done";

describe("parseDependsOn", () => {
  it("returns [] when no tag is present", () => {
    expect(parseDependsOn("a plain description")).toEqual([]);
  });
  it("splits a multi-id tag, trimming each", () => {
    expect(parseDependsOn("x `depends-on:US-A,US-B,FIX-3`")).toEqual(["US-A", "US-B", "FIX-3"]);
  });
  it("captures lettered sub-story ids (FIX-167)", () => {
    expect(parseDependsOn("depends-on:US-LOOP-062c")).toEqual(["US-LOOP-062c"]);
  });
});

describe("pickStory — status skip rules", () => {
  it("skips 🚫 Hold / 🔒 Blocked / ⏸ Deferred / In Progress / Done, takes first Todo", () => {
    const items = [
      item("US-1", "🚫 Hold"),
      item("US-2", "🔒 Blocked"),
      item("US-3", "⏸ Deferred"),
      item("US-4", "🔨 In Progress"),
      item("US-5", DONE),
      item("US-6", TODO),
    ];
    expect(pickStory(items)?.id).toBe("US-6");
  });

  it("returns undefined when nothing is Todo", () => {
    expect(pickStory([item("US-1", DONE), item("FIX-1", "🚫 Hold")])).toBeUndefined();
  });

  it("FIX-909: picks ⏳ 待复评 rows for conservative resume", () => {
    const items = [item("FIX-909", AWAITING_REVIEW_STATUS_MARKER), item("FIX-910", TODO)];
    expect(pickStory(items)?.id).toBe("FIX-909");
  });

  it("FIX-363: skips a poison-pill card on the runtime skip-list, takes the next Todo", () => {
    const items = [item("FIX-1", TODO), item("FIX-2", TODO)];
    // FIX-1 failed K times → skip-listed; the loop must keep delivering FIX-2
    // rather than re-picking the poison pill (which previously halted the loop).
    const skip = new Set(["FIX-1"]);
    expect(pickStory(items, { shouldSkip: (id) => skip.has(id) })?.id).toBe("FIX-2");
    // the skipped card stays a valid Todo — only the runtime overlay hides it,
    // so clearing the skip-list re-arms it (backlog truth never changed).
    expect(pickStory(items)?.id).toBe("FIX-1");
  });

  it("FIX-363: when the ONLY Todo is skip-listed, the loop idles (no_story) rather than re-burning it", () => {
    const items = [item("FIX-1", TODO), item("US-1", DONE)];
    expect(pickStory(items, { shouldSkip: (id) => id === "FIX-1" })).toBeUndefined();
  });

  it("FIX-1018: skips a story with pending unpublished local work, takes the next Todo", () => {
    const items = [item("US-1", TODO), item("US-2", TODO)];
    const pending = new Set(["US-1"]);
    expect(pickStory(items, { hasPendingPublish: (id) => pending.has(id) })?.id).toBe("US-2");
    // clearing the runtime marker re-arms the story (backlog truth unchanged).
    expect(pickStory(items)?.id).toBe("US-1");
  });

  it("FIX-1018: when every Todo is pending-publish, the loop idles", () => {
    const items = [item("US-1", TODO), item("US-2", TODO)];
    const pending = new Set(["US-1", "US-2"]);
    expect(pickStory(items, { hasPendingPublish: (id) => pending.has(id) })).toBeUndefined();
    expect(assessBacklog(items, { hasPendingPublish: (id) => pending.has(id) })).toEqual({
      hasWork: false,
      reason: "all_pending_publish",
    });
  });
});

describe("pickStory — type priority and file order", () => {
  it("prefers FIX over US over REFACTOR regardless of file order", () => {
    const items = [
      item("REFACTOR-1", TODO),
      item("US-1", TODO),
      item("FIX-1", TODO),
    ];
    expect(pickStory(items)?.id).toBe("FIX-1");
  });

  it("within a prefix takes the first eligible in file order", () => {
    const items = [item("US-1", DONE), item("US-2", TODO), item("US-3", TODO)];
    expect(pickStory(items)?.id).toBe("US-2");
  });

  it("falls through to US then REFACTOR when no FIX is eligible", () => {
    const items = [item("FIX-1", "🚫 Hold"), item("REFACTOR-1", TODO), item("US-1", TODO)];
    expect(pickStory(items)?.id).toBe("US-1");
  });

  it("uses advisory semantic ranking before deterministic prefix/file order when provided", () => {
    const items = [item("FIX-1", TODO), item("US-1", TODO), item("US-2", TODO)];
    expect(
      pickStory(items, {
        ranking: [
          { id: "US-2", score: 95, reason: "unblocks more follow-up work" },
          { id: "FIX-1", score: 20, reason: "less urgent" },
        ],
      })?.id,
    ).toBe("US-2");
  });

  it("still applies eligibility gates after advisory ranking", () => {
    const items = [item("US-HOLD", "🚫 Hold"), item("US-BLOCKED", TODO, "depends-on:US-MISSING"), item("FIX-1", TODO)];
    expect(
      pickStory(items, {
        ranking: [
          { id: "US-HOLD", score: 100, reason: "owner hold must still win" },
          { id: "US-BLOCKED", score: 99, reason: "blocked must still wait" },
        ],
      })?.id,
    ).toBe("FIX-1");
  });
});

describe("pickStory — depends-on chains", () => {
  it("skips a story whose single dep is not Done", () => {
    const items = [item("US-X", TODO, "x `depends-on:US-A`"), item("US-A", TODO)];
    expect(pickStory(items)?.id).toBe("US-A"); // US-X skipped, US-A itself eligible
  });

  it("picks a story whose single dep IS Done", () => {
    const items = [item("US-A", DONE), item("US-X", TODO, "x `depends-on:US-A`")];
    expect(pickStory(items)?.id).toBe("US-X");
  });

  it("multi-dep: all Done → eligible (US-X is the only Todo)", () => {
    const items = [
      item("US-A", DONE),
      item("US-B", DONE),
      item("US-X", TODO, "x `depends-on:US-A,US-B`"),
    ];
    expect(pickStory(items)?.id).toBe("US-X");
  });

  it("multi-dep: one missing → skipped", () => {
    const items = [
      item("US-A", DONE),
      item("US-X", TODO, "x `depends-on:US-A,US-MISSING`"),
    ];
    expect(pickStory(items)).toBeUndefined();
  });

  it("a depends-on mention in a sibling's description never gets re-picked as the dep owner", () => {
    // US-TODO merely mentions US-DONE; US-DONE is the real (Done) row (FIX-161).
    const items = [item("US-DONE", DONE), item("US-TODO", TODO, "mentions US-DONE here")];
    expect(pickStory(items)?.id).toBe("US-TODO");
  });
});

describe("pickStory — open-PR skip (injected predicate, FIX-141)", () => {
  it("skips a story that already has an open PR and takes the next", () => {
    const items = [item("US-1", TODO), item("US-2", TODO)];
    const pick = pickStory(items, { hasOpenPr: (id) => id === "US-1" });
    expect(pick?.id).toBe("US-2");
  });

  it("defaults to no open PRs when the predicate is omitted", () => {
    expect(pickStory([item("US-1", TODO)])?.id).toBe("US-1");
  });
});

describe("pickStory — merged-delivery skip (injected predicate, FIX-323)", () => {
  it("skips a 📋 Todo card whose deliverable already MERGED (zombie re-pick guard)", () => {
    // FIX-284 case: a prior gave_up reset the merged card to Todo; without the
    // guard the picker re-picks it forever. With the guard it takes the next.
    const items = [item("FIX-284", TODO), item("FIX-285", TODO)];
    const pick = pickStory(items, { hasMergedDelivery: (id) => id === "FIX-284" });
    expect(pick?.id).toBe("FIX-285");
  });

  it("returns undefined when the only Todo card has a merged delivery", () => {
    const pick = pickStory([item("FIX-284", TODO)], { hasMergedDelivery: (id) => id === "FIX-284" });
    expect(pick).toBeUndefined();
  });

  it("defaults to no merged deliveries when the predicate is omitted", () => {
    expect(pickStory([item("FIX-284", TODO)])?.id).toBe("FIX-284");
  });
});

describe("pickStory — annotated Todo gate is tolerant (FIX-301)", () => {
  it("picks an annotated Todo (marker + parenthetical text), not just a bare marker", () => {
    // FIX-284/285 carried `📋 Todo (...)`; an exact `=== "📋 Todo"` check dropped
    // them and idled the loop. The classifier recognizes the Todo marker regardless.
    expect(pickStory([item("FIX-1", "📋 Todo (rebased onto main)")])?.id).toBe("FIX-1");
  });

  it("still picks a bare Todo marker", () => {
    expect(pickStory([item("FIX-1", TODO)])?.id).toBe("FIX-1");
  });

  it("does not pick a non-Todo even when annotated", () => {
    expect(pickStory([item("FIX-1", "🚫 Hold (waiting on owner)")])).toBeUndefined();
  });

  it("when every Todo carries an annotation, still yields the first workable card", () => {
    // Priority (FIX > US > REFACTOR) and file order survive: every row is an
    // annotated Todo, so the first FIX in file order wins (the picker takes the
    // first eligible row top-to-bottom, not the lowest-numbered id).
    const items = [
      item("REFACTOR-1", "📋 Todo (low priority)"),
      item("US-1", "📋 Todo (needs design)"),
      item("FIX-2", "📋 Todo (cleanup)"),
      item("FIX-1", "📋 Todo (urgent)"),
    ];
    expect(pickStory(items)?.id).toBe("FIX-2");
  });

  it("an annotated Todo whose dep is Done is still gated by depends-on", () => {
    const items = [
      item("US-A", "✅ Done"),
      item("US-X", "📋 Todo (blocked earlier)", "x `depends-on:US-A`"),
    ];
    expect(pickStory(items)?.id).toBe("US-X");
  });
});

// ── prTitleReferences (US-LOOP-079c) ────────────────────────────────────────

describe("prTitleReferences — token-bounded id matching", () => {
  it("matches an exact id in the title", () => {
    expect(prTitleReferences("US-1", "US-1: wire hasOpenPr")).toBe(true);
  });

  it("matches at the end of the title", () => {
    expect(prTitleReferences("FIX-42", "fix: parse FIX-42")).toBe(true);
  });

  it("does not match a substring (FIX-1 in FIX-10)", () => {
    expect(prTitleReferences("FIX-1", "FIX-10: big fix")).toBe(false);
  });

  it("does not match an id followed by a letter", () => {
    expect(prTitleReferences("US-A", "US-AB: adjacent")).toBe(false);
  });

  it("does not match when id is absent", () => {
    expect(prTitleReferences("US-1", "some other title")).toBe(false);
  });

  it("matches hyphen-separated ids", () => {
    expect(prTitleReferences("US-LOOP-079c", "cycle US-LOOP-079c published")).toBe(true);
  });

  it("is case-sensitive", () => {
    expect(prTitleReferences("us-1", "US-1: lower vs upper")).toBe(false);
  });

  it("matches across multi-word titles", () => {
    expect(prTitleReferences("FIX-300", "[FIX-300] classifyStatus tolerance for legacy markers")).toBe(true);
  });
});

// ── buildHasOpenPr (US-LOOP-079c) ───────────────────────────────────────────

describe("buildHasOpenPr — predicate from open PR titles", () => {
  it("returns true when id matches a PR title", () => {
    const hasOpenPr = buildHasOpenPr(["US-1: wire hasOpenPr", "FIX-42: cleanup"]);
    expect(hasOpenPr("US-1")).toBe(true);
  });

  it("returns false when id matches no PR title", () => {
    const hasOpenPr = buildHasOpenPr(["US-1: wire hasOpenPr"]);
    expect(hasOpenPr("US-2")).toBe(false);
  });

  it("returns false for empty title list", () => {
    const hasOpenPr = buildHasOpenPr([]);
    expect(hasOpenPr("US-1")).toBe(false);
  });

  it("returns false when id is a substring of another id in the title", () => {
    // FIX-1 should NOT match a PR titled "FIX-10: ..."
    const hasOpenPr = buildHasOpenPr(["FIX-10: big fix"]);
    expect(hasOpenPr("FIX-1")).toBe(false);
  });

  it("matching is token-bounded — id followed by non-alphanumeric", () => {
    const hasOpenPr = buildHasOpenPr(["[US-1] some work"]);
    expect(hasOpenPr("US-1")).toBe(true);
  });

  // AC3 fixture: all todos have open PRs → assessBacklog reason=all_awaiting_merge
  it("AC3: all todos blocked by open PR → all_awaiting_merge in assessBacklog", () => {
    const items = [
      item("US-1", "📋 Todo"),
      item("US-2", "📋 Todo"),
    ];
    const hasOpenPr = buildHasOpenPr([
      "US-1: fix parser",
      "US-2: add feature",
    ]);
    const result = assessBacklog(items, { hasOpenPr });
    expect(result).toEqual({ hasWork: false, reason: "all_awaiting_merge" });
  });

  // AC4: cards without open PR → pickStory unchanged
  it("AC4: no open PR titles → pickStory unchanged (regression)", () => {
    const items = [item("US-1", "📋 Todo"), item("FIX-42", "📋 Todo")];
    const hasOpenPr = buildHasOpenPr([]);
    // No open PRs → FIX has priority, FIX-42 picked
    expect(pickStory(items, { hasOpenPr })?.id).toBe("FIX-42");
  });
});

// ─── US-LOOP-079k AC1: dormancy suppression ────────────────────────────────

describe("shouldSuppressDormancy", () => {
  it("returns true for all_awaiting_merge (temporary PR-blocked idle)", () => {
    expect(shouldSuppressDormancy("all_awaiting_merge")).toBe(true);
  });

  it("returns false for permanent / structural idle reasons", () => {
    for (const reason of [
      "all_blocked_by_deps",
      "all_merged_pending",
      "all_skip_listed",
      "all_in_progress",
      "all_done",
      "backlog_empty",
      "has_work",
    ] as const) {
      expect(shouldSuppressDormancy(reason), reason).toBe(false);
    }
  });

  it("all_awaiting_merge is the only suppressed reason (tripwire against unintended set growth)", () => {
    // AC1: DORMANCY_SUPPRESSED_REASONS is a closed set — all_awaiting_merge is
    // the only temporary idle reason that should keep the loop ACTIVE.
    // Adding a reason to this set changes dormancy policy and needs a story.
    expect(shouldSuppressDormancy("all_awaiting_merge")).toBe(true);
    // Every OTHER known reason should NOT suppress dormancy.
    expect(shouldSuppressDormancy("all_blocked_by_deps")).toBe(false);
    expect(shouldSuppressDormancy("all_merged_pending")).toBe(false);
    expect(shouldSuppressDormancy("all_skip_listed")).toBe(false);
    expect(shouldSuppressDormancy("all_in_progress")).toBe(false);
    expect(shouldSuppressDormancy("all_done")).toBe(false);
    expect(shouldSuppressDormancy("backlog_empty")).toBe(false);
    expect(shouldSuppressDormancy("has_work")).toBe(false);
  });
});
