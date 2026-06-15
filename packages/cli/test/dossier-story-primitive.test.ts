/**
 * US-DOSSIER-003 — story dossier page surfaces the full story context entry:
 * one-liner + As/I want/So that + CONTEXT + AC (inline) + spec link.
 */
import { describe, expect, it } from "vitest";
import { renderStoryDossier, type StoryDossierInput } from "../src/lib/story-dossier.js";

const base: StoryDossierInput = {
  story: { id: "US-X-1", epic: "demo", type: "US", title: "一句话描述在此", created: "2026-06-08", delivered: false },
  narrative: { asA: "某角色", iWant: "做某事", soThat: "得到某价值" },
  context: "Acceptance Evidence",
  acItems: [
    { text: "第一条验收", checked: true },
    { text: "第二条验收", checked: false },
  ],
};

describe("renderStoryDossier — US-DOSSIER-003 full context entry", () => {
  const html = renderStoryDossier(base);
  it("masthead shows the one-liner title (一句话描述)", () => {
    expect(html).toContain("一句话描述在此");
  });
  it("definition station renders the As/I want/So that primitive", () => {
    expect(html).toContain("某角色");
    expect(html).toContain("做某事");
    expect(html).toContain("得到某价值");
    expect(html).toContain("story-primitive");
    expect(html).not.toContain('<div class="wish-quote">'); // primitive replaces the wish-quote element
  });
  it("CONTEXT is shown inline", () => {
    expect(html).toContain("Acceptance Evidence");
  });
  it("AC checklist is inline with checkbox state", () => {
    expect(html).toContain("ac-checklist");
    expect(html).toContain("☑ 第一条验收");
    expect(html).toContain("☐ 第二条验收");
  });
  it("prominent spec.md design-doc link in the masthead (not just footer)", () => {
    // the masthead kv carries a spec.md link
    expect(html.split("</div>\n</div>")[0]).toContain('href="spec.html"');
  });
  it("FIX-286: footer keeps a SINGLE spec link (rendered spec.html), no redundant spec.md (raw)", () => {
    const footer = html.match(/<footer>[\s\S]*?<\/footer>/)?.[0] ?? "";
    expect(footer).not.toBe("");
    expect(footer).toContain('<a href="spec.html">spec</a>');
    expect(footer).not.toContain("spec.md (raw)"); // the redundant raw link is gone
    expect(footer).not.toContain('href="spec.md"');
    expect((footer.match(/<a /g) ?? []).length).toBe(1); // exactly one link in the footer
  });
  it("falls back to wish, then empty, when no narrative", () => {
    const noNarr = renderStoryDossier({ ...base, narrative: undefined, wish: "退回的愿望" });
    expect(noNarr).toContain("退回的愿望");
    const bare = renderStoryDossier({ ...base, narrative: undefined, wish: undefined });
    expect(bare).toContain("未记录故事原语");
  });
  it("self-containment holds", () => {
    expect(html).not.toContain("<script src=");
    expect(html).toContain("localStorage");
  });
});
