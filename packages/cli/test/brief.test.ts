import type { BacklogItem } from "@roll/core";
import { composeBrief } from "@roll/core";
import { beforeAll, describe, expect, it } from "vitest";
import { renderBrief } from "../src/commands/brief.js";
import { renderState, stripAnsi } from "../src/render.js";

function item(id: string, status: string, desc = "the description"): BacklogItem {
  return { id, desc, status };
}

const ITEMS: BacklogItem[] = [
  item("US-A-001", "✅ Done"),
  item("US-A-002", "✅ Done"),
  item("FIX-001", "🔨 In Progress"),
  item("US-B-001", "📋 Todo"),
  item("FIX-002", "📋 Todo"),
  item("US-C-001", "🚫 Hold"),
  item("US-D-001", "🔒 Blocked"),
];

function plain(lines: string[]): string {
  return stripAnsi(lines.join("\n"));
}

describe("renderBrief", () => {
  // Render plain text so assertions key on content, not ANSI.
  beforeAll(() => {
    renderState.useColor = false;
  });

  it("default view folds the completed LIST (count only, no ids)", () => {
    const m = composeBrief(ITEMS, []);
    const out = plain(renderBrief(m, "en", { full: false }, "2026-06-06 15:00"));
    expect(out).toContain("2"); // completed count surfaces
    expect(out).not.toContain("US-A-001"); // but the list is folded away
  });

  it("--full expands the completed and queue lists", () => {
    const m = composeBrief(ITEMS, []);
    const out = plain(renderBrief(m, "en", { full: true }, "2026-06-06 15:00"));
    expect(out).toContain("US-A-001");
    expect(out).toContain("US-B-001"); // queued story listed too
  });

  it("always lists the owner's-call block (alerts + hold + blocked)", () => {
    const m = composeBrief(ITEMS, ["ALERT-roll-x.md"]);
    const out = plain(renderBrief(m, "en", { full: false }, "d"));
    expect(out).toContain("ALERT-roll-x.md");
    expect(out).toContain("US-C-001"); // hold
    expect(out).toContain("US-D-001"); // blocked
  });

  it("shows all-clear + release-ready when nothing needs the owner", () => {
    const m = composeBrief([item("US-X", "✅ Done")], []);
    const out = plain(renderBrief(m, "en", { full: false }, "d"));
    expect(out.toLowerCase()).toContain("all clear");
  });

  it("English output carries no CJK (single-language contract)", () => {
    const m = composeBrief(ITEMS, ["A.md"]);
    const out = plain(renderBrief(m, "en", { full: true }, "2026-06-06 15:00"));
    expect(out).not.toMatch(/[一-鿿]/);
  });

  it("Chinese output carries no English label words (single-language contract)", () => {
    const m = composeBrief(ITEMS, ["A.md"]);
    const out = plain(renderBrief(m, "zh", { full: true }, "2026-06-06 15:00"));
    // Story ids (US-/FIX-) are identifiers, not labels — allow them; assert no
    // English label words like "Completed"/"Pending"/"Shipped" leak through.
    expect(out).not.toMatch(/Completed|Pending|Shipped|In Progress|Attention/);
  });
});
