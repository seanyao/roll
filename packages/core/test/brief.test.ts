import { describe, expect, it } from "vitest";
import { type BacklogItem } from "../src/backlog/store.js";
import { composeBrief, decideCount, queueTotal, releaseReady } from "../src/brief/compose.js";

function item(id: string, status: string, desc = "desc"): BacklogItem {
  return { id, desc, status };
}

describe("composeBrief", () => {
  const items: BacklogItem[] = [
    item("US-A-001", "✅ Done (PR#1)"),
    item("US-A-002", "✅ Done"),
    item("FIX-001", "🔨 In Progress"),
    item("US-B-001", "📋 Todo"),
    item("FIX-002", "📋 Todo"),
    item("REFACTOR-001", "📋 Todo"),
    item("US-C-001", "🚫 Hold (waiting on owner)"),
    item("US-D-001", "🔒 Blocked [needs key]"),
  ];

  it("buckets rows by status, ignoring trailing notes", () => {
    const m = composeBrief(items, []);
    expect(m.shipped.map((i) => i.id)).toEqual(["US-A-001", "US-A-002"]);
    expect(m.inProgress.map((i) => i.id)).toEqual(["FIX-001"]);
    expect(m.queueFix.map((i) => i.id)).toEqual(["FIX-002"]);
    expect(m.queueUs.map((i) => i.id)).toEqual(["US-B-001"]);
    expect(m.queueOther.map((i) => i.id)).toEqual(["REFACTOR-001"]);
    expect(m.hold.map((i) => i.id)).toEqual(["US-C-001"]);
    expect(m.blocked.map((i) => i.id)).toEqual(["US-D-001"]);
  });

  it("threads alert identifiers through verbatim", () => {
    const m = composeBrief(items, ["ALERT-roll-0d54a5.md"]);
    expect(m.alerts).toEqual(["ALERT-roll-0d54a5.md"]);
  });

  it("queueTotal sums every pending bucket", () => {
    expect(queueTotal(composeBrief(items, []))).toBe(3);
  });

  it("decideCount sums alerts + hold + blocked (the owner's call)", () => {
    expect(decideCount(composeBrief(items, ["A.md"]))).toBe(3); // 1 alert + 1 hold + 1 blocked
  });

  it("releaseReady is true only when nothing needs the owner", () => {
    expect(releaseReady(composeBrief(items, ["A.md"]))).toBe(false);
    expect(releaseReady(composeBrief([item("US-X", "✅ Done")], []))).toBe(true);
  });

  it("Done status is not mistaken for Todo via substring", () => {
    const m = composeBrief([item("US-X", "✅ Done — superseded Todo note")], []);
    expect(m.shipped.map((i) => i.id)).toEqual(["US-X"]);
    expect(m.queueUs).toEqual([]);
  });
});
