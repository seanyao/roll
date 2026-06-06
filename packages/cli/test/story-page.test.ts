/**
 * Story-card page contract (US-META-005/006/007): one generator emits the
 * skeleton, markPhaseDone flips its sections — the round-trip locks the markup
 * contract that previously drifted between two hand-rolled skeletons.
 */
import { describe, expect, it } from "vitest";
import {
  STORY_ID_RE,
  STORY_PHASES,
  markPhaseDone,
  renderSpecMd,
  renderStoryPage,
  storyFamilyOf,
} from "../src/lib/story-page.js";

describe("storyFamilyOf", () => {
  it("extracts the family for every recognized prefix", () => {
    expect(storyFamilyOf("FIX-216")).toBe("FIX");
    expect(storyFamilyOf("US-META-005")).toBe("US");
    expect(storyFamilyOf("IDEA-003")).toBe("IDEA");
    expect(storyFamilyOf("REFACTOR-001")).toBe("REFACTOR");
    expect(storyFamilyOf("EPIC-1")).toBeNull();
  });

  it("STORY_ID_RE matches story dirs, not epic dirs", () => {
    expect(STORY_ID_RE.test("FIX-204")).toBe(true);
    expect(STORY_ID_RE.test("uncategorized")).toBe(false);
  });
});

describe("renderSpecMd", () => {
  it("emits frontmatter with title for live cards", () => {
    const md = renderSpecMd({ id: "IDEA-7", title: "a thing", type: "idea", created: "2026-06-07" });
    expect(md).toContain("id: IDEA-7\n");
    expect(md).toContain("title: a thing\n");
    expect(md).toContain("type: idea\n");
    expect(md).toContain("# IDEA-7 — a thing\n");
  });

  it("derives type from the id family and records epic + note for backfill", () => {
    const md = renderSpecMd({ id: "FIX-9", epic: "loop", created: "2026-06-07", note: "backfilled" });
    expect(md).toContain("type: fix\n");
    expect(md).toContain("epic: loop\n");
    expect(md).toContain("# FIX-9\n\n> backfilled\n");
  });
});

describe("renderStoryPage + markPhaseDone round-trip", () => {
  const page = renderStoryPage({ id: "FIX-9", title: 'fix "it"', created: "2026-06-07" });

  it("emits every phase as pending with a family badge", () => {
    for (const [phase] of STORY_PHASES) {
      expect(page).toContain(`<section class="phase-pending"><h2>${phase}</h2>`);
    }
    expect(page).toContain("<code>FIX</code>");
    expect(page).toContain("fix &quot;it&quot;");
  });

  it("markPhaseDone flips exactly the named phase", () => {
    const done = markPhaseDone(page, "Delivery", "<p>shipped</p>");
    expect(done).toContain('<section class="phase-done"><h2>Delivery</h2><p>shipped</p></section>');
    expect(done).not.toContain('<section class="phase-pending"><h2>Delivery</h2>');
    expect(done).toContain('<section class="phase-pending"><h2>Design</h2>');
  });

  it("returns the html unchanged when the section is absent", () => {
    expect(markPhaseDone("<html></html>", "Delivery", "x")).toBe("<html></html>");
  });
});
