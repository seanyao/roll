/**
 * US-DOSSIER-001 — Delivery Dossier three-layer generation.
 * 001a: design tokens + Features Index front page (collectDossier + renderFeaturesIndex).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { collectDossier } from "../src/lib/archive.js";
import { DOSSIER_CSS, DOSSIER_FILTER_SCRIPT } from "../src/lib/dossier-css.js";
import { renderFeaturesIndex, spineMotif } from "../src/lib/dossier-index.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

/** A features tree: two epics, one fully wish, one with a truth card. */
function project(): string {
  const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-dossier-")));
  dirs.push(p);
  const f = join(p, ".roll", "features");
  // epic "alpha": US-A-1 delivered (latest → run dir), FIX-2 wish-only.
  mkdirSync(join(f, "alpha", "US-A-1", "2026-06-01T00-00-00"), { recursive: true });
  writeFileSync(
    join(f, "alpha", "US-A-1", "spec.md"),
    "---\nid: US-A-1\ntitle: Alpha story\ntype: us\ncreated: 2026-06-01\n---\n\n# US-A-1 — Alpha story\n",
  );
  symlinkSync(join(f, "alpha", "US-A-1", "2026-06-01T00-00-00"), join(f, "alpha", "US-A-1", "latest"));
  mkdirSync(join(f, "alpha", "FIX-2"), { recursive: true });
  writeFileSync(join(f, "alpha", "FIX-2", "spec.md"), "# FIX-2 · 修一个洞\n");
  // epic "beta": wish only, hand-written spec without frontmatter.
  mkdirSync(join(f, "beta", "REFACTOR-3"), { recursive: true });
  writeFileSync(join(f, "beta", "REFACTOR-3", "spec.md"), "# REFACTOR-3 — tidy things ✅\n");
  return p;
}

describe("collectDossier — US-DOSSIER-001a data model", () => {
  it("walks epics/stories, reads spec meta, detects truth via latest pointer", () => {
    const epics = collectDossier(project());
    expect(epics.map((e) => e.name)).toEqual(["alpha", "beta"]);
    const alpha = epics[0]!;
    expect(alpha.delivered).toBe(1);
    const a1 = alpha.stories.find((s) => s.id === "US-A-1")!;
    expect(a1).toMatchObject({ type: "US", title: "Alpha story", created: "2026-06-01", delivered: true });
    // H1-fallback title for hand-written specs (status emoji stripped).
    const f2 = alpha.stories.find((s) => s.id === "FIX-2")!;
    expect(f2).toMatchObject({ type: "FIX", title: "修一个洞", delivered: false });
    expect(epics[1]!.stories[0]!.title).toBe("tidy things");
  });

  it("missing features dir → empty model", () => {
    const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-dossier-empty-")));
    dirs.push(p);
    expect(collectDossier(p)).toEqual([]);
  });
});

describe("renderFeaturesIndex — US-DOSSIER-001a front page", () => {
  const html = renderFeaturesIndex(collectDossier(project()));

  it("masthead: kicker + serif H1 + lede with oxblood em on wish/truth", () => {
    expect(html).toContain("Delivery Dossier");
    expect(html).toContain("<em>wish</em>");
    expect(html).toContain("<em>truth</em>");
    expect(html).toContain("<em>愿望</em>");
    expect(html).toContain("<em>事实</em>");
  });

  it("ledger: four figures with real tallies + wish→truth bar", () => {
    // 2 epics, 3 stories, 1 merged, 1 epic shipping → 33%
    expect(html).toContain('class="figures"');
    expect(html).toContain("Stories tracked");
    expect(html).toContain("Merged to main");
    expect(html).toContain("已合主干");
    expect(html).toContain('style="width:33%"');
  });

  it("lifecycle spine: five stations, delivery carries the truth badge", () => {
    const spine = spineMotif();
    expect(spine.match(/class="node/g)).toHaveLength(5);
    expect(spine).toContain('node truth');
    expect(spine).toContain("Retrospective");
    expect(spine).toContain("复盘");
  });

  it("toolbar: search input + only-shipping toggle wired to the filter script", () => {
    expect(html).toContain("data-dossier-search");
    expect(html).toContain("data-dossier-only");
    expect(html).toContain("Only shipping");
    expect(html).toContain(DOSSIER_FILTER_SCRIPT);
  });

  it("epic groups: shipping first, backlog after; cards carry bar + chips", () => {
    expect(html.indexOf("Shipping to main")).toBeLessThan(html.indexOf("In backlog"));
    expect(html).toContain('href="alpha/index.html"');
    expect(html).toContain('href="alpha/US-A-1/index.html"');
    expect(html).toContain('class="chip truth"');
    expect(html).toContain('data-truth="1"');
    expect(html).toContain('class="epic-bar"');
  });

  it("self-containment: no external scripts/links/images; chrome + tokens inline", () => {
    expect(html).not.toContain("<script src=");
    expect(html).not.toContain("<link");
    expect(html).not.toMatch(/<img src="https?:/);
    expect(html).toContain("localStorage");
    expect(html).toContain(DOSSIER_CSS);
    expect(html).toContain('data-set-lang="zh"');
    expect(html).toContain('data-set-theme="dark"');
  });

  it("design tokens reuse the chrome palette — no new hex colors in DOSSIER_CSS", () => {
    expect(DOSSIER_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(DOSSIER_CSS).toContain("var(--pass)");
    expect(DOSSIER_CSS).toContain("var(--accent)");
    expect(DOSSIER_CSS).toContain("@media (max-width:680px)");
  });
});
