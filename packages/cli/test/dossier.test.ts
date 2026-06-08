/**
 * US-DOSSIER-001 — Delivery Dossier three-layer generation.
 * 001a: design tokens + Features Index front page (collectDossier + renderFeaturesIndex).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { collectDossier } from "../src/lib/archive.js";
import { DOSSIER_CSS, DOSSIER_FILTER_SCRIPT } from "../src/lib/dossier-css.js";
import { renderFeaturesIndex, spineMotif } from "../src/lib/dossier-index.js";
import { miniSpine, renderEpicPage } from "../src/lib/epic-page.js";
import { collectStoryDossierInput, renderStoryDossier, storySpine } from "../src/lib/story-dossier.js";

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

describe("renderEpicPage — US-DOSSIER-001b", () => {
  const epics = collectDossier(project());
  const alpha = epics.find((e) => e.name === "alpha")!;
  const html = renderEpicPage(alpha);

  it("masthead carries breadcrumb home + epic ledger with truth figure", () => {
    expect(html).toContain('href="../index.html"');
    expect(html).toContain("Epic Dossier");
    expect(html).toContain("史诗档案");
    expect(html).toContain("Merged to main");
    expect(html).toContain('style="width:50%"'); // 1 of 2 delivered
  });

  it("three groups: merged first, backlog after; rows link to story dossiers", () => {
    expect(html.indexOf("已合主干")).toBeLessThan(html.indexOf("仍在待办"));
    expect(html).toContain('href="US-A-1/index.html"');
    expect(html).toContain('class="type type-FIX"');
    expect(html).toContain('class="pill merged"');
    expect(html).toContain('class="pill backlog"');
  });

  it("mini-spine: truth story fills all five dots with delivery in truth-green", () => {
    const truthSpine = miniSpine({ id: "X-1", epic: "e", type: "US", delivered: true });
    expect(truthSpine.match(/<i[ >]/g)).toHaveLength(5);
    expect(truthSpine).toContain('class="truth"');
    const wishSpine = miniSpine({ id: "X-2", epic: "e", type: "US", delivered: false });
    expect(wishSpine.match(/class="done"/g)).toHaveLength(1); // definition only
  });

  it("self-containment holds", () => {
    expect(html).not.toContain("<script src=");
    expect(html).not.toContain("<link");
    expect(html).toContain("localStorage");
  });
});

describe("renderStoryDossier — US-DOSSIER-001c", () => {
  const story = { id: "US-A-1", epic: "alpha", type: "US", title: "Alpha story", created: "2026-06-01", delivered: true };
  const full = renderStoryDossier({
    story,
    wish: "用户希望一键看到全部交付真相",
    design: ["生成器读真实数据", "复用 chrome"],
    commits: ["tcr: step one", "tcr: step two"],
    acRows: [
      { ac: "US-A-1:AC1", status: "pass" },
      { ac: "US-A-1:AC2", status: "partial", note: "截屏待补" },
    ],
    reportHref: "latest/US-A-1-report.html",
    retro: "score 9 good",
  });

  it("masthead: breadcrumb chain + mono id + kv metadata", () => {
    expect(full).toContain('href="../../index.html"');
    expect(full).toContain('href="../index.html"');
    expect(full).toContain("<code>US-A-1</code>");
    expect(full).toContain('class="type type-US"');
  });

  it("spine: all five stations done, delivery in truth-green", () => {
    const spine = storySpine({ story, wish: "w", design: ["d"], commits: ["c"], retro: "r" });
    expect(spine.match(/node (done|truth)/g)).toHaveLength(5);
    expect(spine).toContain("node truth");
  });

  it("five sections with real content: wish-quote, design bullets, commits, attest banner + AC table, retro", () => {
    expect(full).toContain('class="wish-quote"');
    expect(full).toContain("一键看到全部交付真相");
    expect(full).toContain("<li>生成器读真实数据</li>");
    expect(full).toContain("2 TCR commits");
    expect(full).toContain('class="attest-banner"');
    expect(full).toContain('href="latest/US-A-1-report.html"');
    expect(full).toContain("◑ partial");
    expect(full).toContain("截屏待补");
    expect(full).toContain("score 9 good");
  });

  it("wish-only story: empty states render honestly, delivery pending", () => {
    const bare = renderStoryDossier({ story: { ...story, delivered: false } });
    expect(bare).toContain("尚未设计");
    expect(bare).toContain("暂无周期");
    expect(bare).toContain("尚未交付");
    expect(bare).not.toContain('class="attest-banner"');
  });

  it("self-containment holds", () => {
    expect(full).not.toContain("<script src=");
    expect(full).not.toContain("<link");
    expect(full).toContain("localStorage");
  });
});

describe("renderStoryDossier — EVID-010 re-runnable verify commands", () => {
  const story = { id: "US-V-1", epic: "alpha", type: "US", title: "Verify story", created: "2026-06-08", delivered: true };
  const html = renderStoryDossier({
    story,
    acRows: [
      { ac: "US-V-1:AC1", status: "pass", verify: "roll test", tests: ["test/foo.test.ts", "test/bar.test.ts"] },
      { ac: "US-V-1:AC2", status: "readonly" },
    ],
  });

  it("renders a Verify column header", () => {
    expect(html).toContain("Verify");
  });

  it("renders the verify command as copyable text (re-runnable, agent-agnostic)", () => {
    expect(html).toContain("roll test");
    expect(html).toContain('data-copy="roll test"');
  });

  it("lists the covering tests inline", () => {
    expect(html).toContain("test/foo.test.ts");
    expect(html).toContain("test/bar.test.ts");
  });

  it("an AC without a verify command degrades gracefully — no invented command", () => {
    // exactly one copy affordance (AC1), AC2 carries none
    expect(html.match(/data-copy=/g)).toHaveLength(1);
    expect(html).toContain("verify-empty");
  });

  it("the copy handler is inline — page stays self-contained", () => {
    expect(html).not.toContain("<script src=");
    expect(html).toContain("data-copy");
  });
});

describe("collectStoryDossierInput — EVID-010 parses verify/tests from ac-map.json", () => {
  it("threads verify command and tests through to acRows", () => {
    const p = project();
    const dir = join(p, ".roll", "features", "alpha", "US-V-2");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "ac-map.json"),
      JSON.stringify([{ ac: "US-V-2:AC1", status: "pass", verify: "node bin/roll.js ci --wait", tests: ["test/ci.test.ts"] }]),
    );
    const got = collectStoryDossierInput(p, { id: "US-V-2", epic: "alpha", type: "US", delivered: true });
    expect(got.acRows?.[0]?.verify).toBe("node bin/roll.js ci --wait");
    expect(got.acRows?.[0]?.tests).toEqual(["test/ci.test.ts"]);
  });
});

describe("roll index — US-DOSSIER-001d three-layer integration", () => {
  it("generates front page + epic pages + story dossiers with cross-links", async () => {
    const p = project();
    // Give US-A-1 an ac-map + a report so the dossier shows delivery truth.
    const f = join(p, ".roll", "features");
    writeFileSync(
      join(f, "alpha", "US-A-1", "ac-map.json"),
      JSON.stringify([{ ac: "US-A-1:AC1", status: "pass", evidence: [] }]),
    );
    writeFileSync(join(f, "alpha", "US-A-1", "2026-06-01T00-00-00", "US-A-1-report.html"), "<html></html>");
    writeFileSync(join(p, ".roll", "backlog.md"), "| US-A-1 | Alpha story | ✅ Done |\n");

    const { indexCommand } = await import("../src/commands/index-gen.js");
    const save = process.cwd();
    process.chdir(p);
    const out: string[] = [];
    const w = process.stdout.write.bind(process.stdout);
    // @ts-expect-error capture-only
    process.stdout.write = (s: string): boolean => (out.push(String(s)), true);
    try {
      expect(indexCommand([])).toBe(0);
    } finally {
      process.stdout.write = w;
      process.chdir(save);
    }
    expect(out.join("")).toContain("Delivery Dossier regenerated");

    const idx = readFileSync(join(f, "index.html"), "utf8");
    const epic = readFileSync(join(f, "alpha", "index.html"), "utf8");
    const story = readFileSync(join(f, "alpha", "US-A-1", "index.html"), "utf8");
    // index → epic → story → back.
    expect(idx).toContain('href="alpha/index.html"');
    expect(epic).toContain('href="US-A-1/index.html"');
    expect(epic).toContain('href="../index.html"');
    expect(story).toContain('href="../../index.html"');
    expect(story).toContain('href="../index.html"');
    // Story dossier carries the real delivery data.
    expect(story).toContain('class="attest-banner"');
    expect(story).toContain('href="latest/US-A-1-report.html"');
    expect(story).toContain("US-A-1:AC1");
    expect(story).toContain("✓ pass");
  });
});

describe("US-META-008 — self-score notes live in the card folder", () => {
  it("retro reads the card's notes/ first (card-local beats .roll/notes)", () => {
    const p = project();
    const card = join(p, ".roll", "features", "alpha", "US-A-1");
    mkdirSync(join(card, "notes"), { recursive: true });
    writeFileSync(
      join(card, "notes", "2026-06-08-roll-build-US-A-1-1.md"),
      "---\nscore: 9\nverdict: good\n---\n\nscore: 9\nverdict: good\n\n卡内自评正文。\n",
    );
    // A stale copy in the legacy flat dir must NOT win.
    mkdirSync(join(p, ".roll", "notes"), { recursive: true });
    writeFileSync(
      join(p, ".roll", "notes", "2026-06-01-roll-build-US-A-1-0.md"),
      "---\nscore: 3\nverdict: regression\n---\n\nscore: 3\n\n旧位置残留。\n",
    );
    const input = collectStoryDossierInput(p, {
      id: "US-A-1", epic: "alpha", type: "US", delivered: true,
    });
    expect(input.retro).toContain("9");
    expect(input.retro).toContain("卡内自评正文");
  });

  it("legacy .roll/notes still serves cards that have no local notes/", () => {
    const p = project();
    mkdirSync(join(p, ".roll", "notes"), { recursive: true });
    writeFileSync(
      join(p, ".roll", "notes", "2026-06-01-roll-fix-FIX-2-7.md"),
      "---\nscore: 8\nverdict: ok\n---\n\nscore: 8\n\n旧档兼容。\n",
    );
    const input = collectStoryDossierInput(p, { id: "FIX-2", epic: "alpha", type: "FIX", delivered: false });
    expect(input.retro).toContain("旧档兼容");
  });
});
