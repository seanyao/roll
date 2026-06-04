/**
 * Unit tests for StoryPicker: status skip rules, depends-on chains
 * (multi-dep / missing dep / done dep), open-PR skip, type priority, and
 * first-in-file-order selection.
 */
import { describe, expect, it } from "vitest";
import { type BacklogItem, parseDependsOn, pickStory } from "../src/index.js";

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
