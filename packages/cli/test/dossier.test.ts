/**
 * US-DOSSIER-001 — Delivery Dossier three-layer generation.
 * 001a: design tokens + Features Index front page (collectDossier + renderFeaturesIndex).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { collectDossier, type DossierEpic } from "../src/lib/archive.js";
import { DOSSIER_CSS, DOSSIER_FILTER_SCRIPT } from "../src/lib/dossier-css.js";
import { renderFeaturesIndex, renderTruthBoard, spineMotif } from "../src/lib/dossier-index.js";
import { miniSpine, renderEpicPage } from "../src/lib/epic-page.js";
import { collectStoryDossierInput, renderStoryDossier, storySpine } from "../src/lib/story-dossier.js";
import { markPhaseDone } from "../src/lib/story-page.js";

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
  // epic "beta": wish only, hand-written spec without frontmatter. The 🚫 marker
  // exercises title-emoji stripping without counting as a ✅ done marker.
  mkdirSync(join(f, "beta", "REFACTOR-3"), { recursive: true });
  writeFileSync(join(f, "beta", "REFACTOR-3", "spec.md"), "# REFACTOR-3 — tidy things 🚫\n");
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

  it("IDEA-003: a ✅ heading marks a card delivered even without a latest/ report (v2-migrated history)", () => {
    const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-dossier-v2-")));
    dirs.push(p);
    const f = join(p, ".roll", "features", "autonomous-evolution");
    // v2-migrated card shapes: status emoji lives in the H2 story heading.
    mkdirSync(join(f, "US-AUTO-9"), { recursive: true });
    writeFileSync(join(f, "US-AUTO-9", "spec.md"), "## US-AUTO-9 一个 v2 做完的故事 ✅\n\n**Created**: 2026-05-29\n");
    mkdirSync(join(f, "US-AUTO-10"), { recursive: true });
    writeFileSync(join(f, "US-AUTO-10", "spec.md"), "## US-AUTO-10 一个 v2 没做的故事 📋\n");
    mkdirSync(join(f, "US-AUTO-11"), { recursive: true });
    writeFileSync(join(f, "US-AUTO-11", "spec.md"), "## US-AUTO-11 v2 在做的故事 🔨\n");
    const epic = collectDossier(p)[0]!;
    const done = epic.stories.find((s) => s.id === "US-AUTO-9")!;
    const todo = epic.stories.find((s) => s.id === "US-AUTO-10")!;
    const wip = epic.stories.find((s) => s.id === "US-AUTO-11")!;
    expect(done.delivered).toBe(true); // ✅ heading = evidence of v2 completion
    expect(todo.delivered).toBe(false); // 📋 = genuinely not done
    expect(wip.delivered).toBe(false); // 🔨 = in progress, not done
    expect(epic.delivered).toBe(1); // only the ✅ card counts
  });

  it("US-DOSSIER-008: pre-v3 done card (no latest/, no ac-map) is legacy; latest/ or ac-map cancels it", () => {
    const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-dossier-legacy-")));
    dirs.push(p);
    const f = join(p, ".roll", "features", "hist");
    // pre-v3 done: ✅ heading, no latest/, no ac-map.json → legacy
    mkdirSync(join(f, "US-OLD-1"), { recursive: true });
    writeFileSync(join(f, "US-OLD-1", "spec.md"), "## US-OLD-1 历史做完的故事 ✅\n");
    // done but carries v3 ac-map evidence (no latest/ yet) → NOT legacy
    mkdirSync(join(f, "US-OLD-2"), { recursive: true });
    writeFileSync(join(f, "US-OLD-2", "spec.md"), "## US-OLD-2 有证据的故事 ✅\n");
    writeFileSync(join(f, "US-OLD-2", "ac-map.json"), "[]\n");
    // not done → not legacy
    mkdirSync(join(f, "US-OLD-3"), { recursive: true });
    writeFileSync(join(f, "US-OLD-3", "spec.md"), "## US-OLD-3 没做 📋\n");
    const epic = collectDossier(p)[0]!;
    expect(epic.stories.find((s) => s.id === "US-OLD-1")!.legacy).toBe(true);
    expect(epic.stories.find((s) => s.id === "US-OLD-2")!.legacy).toBe(false);
    expect(epic.stories.find((s) => s.id === "US-OLD-3")!.legacy).toBe(false);
    // a v3 card delivered via latest/ is never legacy.
    expect(collectDossier(project())[0]!.stories.find((s) => s.id === "US-A-1")!.legacy).toBe(false);
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

  it("status overview: tally cards by state + delivery spectrum + % merged", () => {
    // fixture: 3 stories — US-A-1 done, FIX-2 todo, beta todo → done 1 / todo 2 → 33%
    expect(html).toContain('class="statusboard"');
    expect(html).toContain('class="tally done"');
    expect(html).toContain("已交付"); // Done tally label
    expect(html).toContain('class="spectrum"');
    expect(html).toContain("已合主干");
    expect(html).toContain("33%");
  });

  it("lifecycle spine: five stations, delivery carries the truth badge", () => {
    const spine = spineMotif();
    expect(spine.match(/class="node/g)).toHaveLength(5);
    expect(spine).toContain('node truth');
    expect(spine).toContain("Retrospective");
    expect(spine).toContain("复盘");
  });

  it("toolbar: search input + per-status filter chips wired to the filter script", () => {
    expect(html).toContain("data-dossier-search");
    expect(html).toContain('class="statusfilter"');
    expect(html).toContain('data-sf="done"');
    expect(html).toContain('data-sf="hold"');
    expect(html).toContain(DOSSIER_FILTER_SCRIPT);
  });

  it("US-EVID-016: links the fixed morning report when present", () => {
    const withReport = renderFeaturesIndex(collectDossier(project()), { morningReportHref: "../reports/morning/latest.html" });
    expect(withReport).toContain("Morning report");
    expect(withReport).toContain("夜间运行晨报");
    expect(withReport).toContain('href="../reports/morning/latest.html"');
  });

  it("US-TRUTH-011: truth strip and aggregate tiles freeze a drift fixture", () => {
    const epics: DossierEpic[] = [{
      name: "truth",
      delivered: 1,
      stories: [
        { id: "US-OK", epic: "truth", type: "US", delivered: true, stages: ["definition", "design", "execution", "delivery"] },
        { id: "US-DRIFT", epic: "truth", type: "US", delivered: false, status: "done", truthState: "fail", truthReason: "premature_done" },
      ],
    }];
    const board = renderTruthBoard(epics, {
      generatedAt: "2026-06-11T04:00:00Z",
      collectedAt: "2026-06-11T03:59:00Z",
      audit: { fail: 2, warn: 1, unknown: 3 },
      cycle: { cycles3d: 14, failed3d: 2, costUsd3d: 1.23 },
      release: { latestTag: "v3.611.2", verdict: "fail", waiver: "REL-1" },
    });

    expect(board).toContain('data-truth-board="fail"');
    expect(board).toMatchSnapshot();
    expect(board).toContain("audit");
    expect(board).toContain("f:2 w:1 ?:3");
    expect(board).toContain("Story");
    expect(board).toContain("50%");
    expect(board).toContain("Cycle");
    expect(board).toContain("14");
    expect(board).toContain("$1.23");
    expect(board).toContain("Release");
    expect(board).toContain("v3.611.2");
    expect(board).toContain("REL-1");
  });

  it("US-TRUTH-011: truth strip and aggregate tiles freeze an all-green fixture", () => {
    const epics: DossierEpic[] = [{
      name: "green",
      delivered: 1,
      stories: [{ id: "US-GREEN", epic: "green", type: "US", delivered: true, stages: ["definition", "design", "execution", "delivery"] }],
    }];
    const truth = {
      generatedAt: "2026-06-11T05:00:00Z",
      collectedAt: "2026-06-11T04:59:00Z",
      audit: { fail: 0, warn: 0, unknown: 0 },
      cycle: { cycles3d: 3, failed3d: 0, costUsd3d: 0.42 },
      release: { latestTag: "v3.611.3", verdict: "pass" },
    };
    const board = renderTruthBoard(epics, truth);
    const index = renderFeaturesIndex(epics, { truth });

    expect(board).toMatchSnapshot();
    expect(index).toContain('data-truth-board="pass"');
    expect(index).toContain("all clear");
    expect(index).toContain("100%");
    expect(index).toContain("v3.611.3");
    expect(index).toContain("$0.42");
  });

  it("US-TRUTH-011: absent audit/run/release facts stay unknown, not zero", async () => {
    const p = project();
    const { collectTruthBoardInput } = await import("../src/commands/index-gen.js");
    const truth = collectTruthBoardInput(p, Date.parse("2026-06-11T06:00:00Z") / 1000);
    const index = renderFeaturesIndex(collectDossier(p), { truth });

    expect(truth).toEqual({ generatedAt: "2026-06-11T06:00:00Z" });
    expect(index).toContain('data-truth-board="unknown"');
    expect(index).toContain("f:? w:? ?:?");
    expect(index).toContain("<b>?</b>");
    expect(index).toContain("<dd>?</dd>");
  });

  it("epic groups: shipping before backlog; story rows carry type + status (US-DOSSIER)", () => {
    expect(html.indexOf("Shipping to main")).toBeLessThan(html.indexOf("In backlog"));
    expect(html).toContain('href="alpha/index.html"');
    expect(html).toContain('href="alpha/US-A-1/index.html"');
    expect(html).toContain('class="story"');
    expect(html).toContain('class="stype US"');
    expect(html).toContain('class="sstat st-done"'); // US-A-1 delivered → done row
    expect(html).toContain('data-truth="1"');
  });

  it("US-DOSSIER: epics render as foldable <details> with a lifecycle spine, not a table", () => {
    expect(html).toContain('<details class="epic"');
    expect(html).toContain('summary class="epic-sum"');
    expect(html).toContain('class="lifespine'); // per-story five-station spine
    // the old table / card-grid layouts are gone
    expect(html).not.toContain('<table class="epic-table">');
    expect(html).not.toContain('class="epic-grid"');
    expect(html).not.toContain('class="epic-card"');
    // filter still keys off data-search + data-status on the details
    expect(html).toContain("data-search=");
    expect(html).toContain("data-status=");
  });

  it("US-DOSSIER-008: a legacy row carries a 历史/legacy chip + a muted legacy spine; evidenced cards don't", () => {
    const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-dossier-legrender-")));
    dirs.push(p);
    const f = join(p, ".roll", "features", "hist");
    mkdirSync(join(f, "US-OLD-1"), { recursive: true });
    writeFileSync(join(f, "US-OLD-1", "spec.md"), "## US-OLD-1 历史做完的故事 ✅\n");
    const leg = renderFeaturesIndex(collectDossier(p));
    expect(leg).toContain('class="slegacy"'); // the 历史/legacy chip
    expect(leg).toContain('class="lifespine legacy"'); // spine rendered muted, not evidence-dark
    expect(leg).toContain("历史");
    // a v3-evidenced delivered card (US-A-1 via latest/) gets neither.
    expect(html).not.toContain('class="slegacy"');
    expect(html).not.toContain("lifespine legacy");
  });

  it("US-DOSSIER-008: the Done tally annotates how many deliveries are legacy (pre-v3)", () => {
    const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-dossier-legcount-")));
    dirs.push(p);
    const f = join(p, ".roll", "features", "hist");
    mkdirSync(join(f, "US-OLD-1"), { recursive: true });
    writeFileSync(join(f, "US-OLD-1", "spec.md"), "## US-OLD-1 历史做完 ✅\n");
    mkdirSync(join(f, "US-OLD-2"), { recursive: true });
    writeFileSync(join(f, "US-OLD-2", "spec.md"), "## US-OLD-2 也历史做完 ✅\n");
    const leg = renderFeaturesIndex(collectDossier(p));
    expect(leg).toContain('class="tsub"');
    expect(leg).toContain("含 2 历史");
    // no legacy in the v3 fixture (US-A-1 delivered via latest/) → no annotation.
    expect(html).not.toContain('class="tsub"');
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

  it("US-DOSSIER-008b: a legacy story's per-page spine is muted + carries a legacy banner; evidenced cards don't", () => {
    const legacyFull = renderStoryDossier({ story: { ...story, legacy: true, delivered: true }, wish: "历史卡" });
    expect(legacyFull).toContain('class="spine legacy"');
    expect(legacyFull).toContain('class="legacy-banner"');
    expect(legacyFull).toContain("历史交付");
    // the evidenced fixture is not legacy → normal spine, no banner div
    // (the CSS rule string is inlined on every page, so assert on the markup).
    expect(full).not.toContain('class="spine legacy"');
    expect(full).not.toContain('class="legacy-banner"');
  });

  it("US-DOSSIER-007: a fully-rendered dossier page carries data-phase anchors that markPhaseDone can mount onto (no longer a silent no-op)", () => {
    // The renderer now shares the anchor contract — every lifecycle station is keyed.
    for (const key of ["definition", "design", "execution", "delivery", "retrospective"]) {
      expect(full).toContain(`data-phase="${key}"`);
    }
    // markPhaseDone finds the delivery section on the full page (previously the
    // dossier emitted no data-phase, so this mount was a silent no-op).
    const mounted = markPhaseDone(full, "delivery", "<p>mounted PR #999</p>");
    expect(mounted).toContain("<p>mounted PR #999</p>");
    expect(mounted).toContain('class="phase phase-done" data-phase="delivery"');
    expect(mounted.match(/data-phase="delivery"/g)!.length).toBe(1);
  });

  it("US-EVID-013: retrospective renders structured self-score summary, note link, dimensions, and trend", () => {
    const html = renderStoryDossier({
      story,
      selfScore: {
        skill: "roll-build",
        score: 9,
        verdict: "good",
        ts: "2026-06-08T12:00:00Z",
        note: "证据链完整，门禁干净。",
        href: "notes/2026-06-08-roll-build-US-A-1.md",
        dimensions: { "test-quality": 8 },
      },
      selfScoreTrend: "self-score: mean 8.0 / min 7 / redo 0 (last 14)",
    });
    expect(html).toContain('class="selfscore-card selfscore-good"');
    expect(html).toContain("<b>9</b>/10");
    expect(html).toContain("good");
    expect(html).toContain("证据链完整，门禁干净。");
    expect(html).toContain('href="notes/2026-06-08-roll-build-US-A-1.md"');
    expect(html).toContain("<code>test-quality</code>: <b>8</b>");
    expect(html).toContain("self-score: mean 8.0 / min 7 / redo 0 (last 14)");
    expect(storySpine({ story, selfScore: { skill: "roll-build", score: 9, verdict: "good", ts: "", note: "" } })).toContain(
      "Retrospective",
    );
  });

  it("US-EVID-007: execution station can be filled by merged PR evidence when squash removed tcr commits", () => {
    const html = renderStoryDossier({
      story,
      executionRefs: [{ kind: "merged-pr", label: "PR #481 merged", commitCount: 5 }],
      reportHref: "latest/US-A-1-report.html",
    });
    expect(html).toContain("1 merged PR");
    expect(html).toContain("PR #481 merged");
    expect(html).toContain("5 commits");
    expect(html).not.toContain("No cycles yet");

    const spine = storySpine({
      story,
      executionRefs: [{ kind: "merged-pr", label: "PR #481 merged", commitCount: 5 }],
    });
    expect(spine).toContain("node truth");
    expect(spine.match(/node done/g)).toHaveLength(2); // definition + execution
  });

  it("US-EVID-007: collectStoryDossierInput derives execution refs from merged PR notes", () => {
    const p = project();
    const dir = join(p, ".roll", "features", "alpha", "US-PR-9");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "spec.md"),
      "# US-PR-9\n\n**Fixed**: 2026-06-06（PR#481，squash 5be97d3，5 commits）\n\n**AC:**\n- [x] shipped\n",
    );
    const got = collectStoryDossierInput(p, { id: "US-PR-9", epic: "alpha", type: "US", delivered: true });
    expect(got.executionRefs).toEqual([{ kind: "merged-pr", label: "PR #481 merged", commitCount: 5 }]);
    expect(storySpine(got)).toContain("node done");
  });

  it("US-EVID-008: delivery station renders PR, CI, diff/files, agent, cost, tokens, and timeline", () => {
    const html = renderStoryDossier({
      story,
      reportHref: "latest/US-A-1-report.html",
      deliveryEvidence: {
        prs: [
          {
            number: 481,
            href: "https://github.com/acme/roll/pull/481",
            ci: "green",
          },
        ],
        diffHref: "https://github.com/acme/roll/pull/481/files",
        filesChanged: ["packages/cli/src/lib/story-dossier.ts", "packages/cli/test/dossier.test.ts"],
        agent: "claude",
        cost: { usd: 1.23, tokensIn: 1200, tokensOut: 345 },
        timeline: [
          { label: "definition", at: "2026-06-08" },
          { label: "execution", at: "2026-06-08T10:00:00Z" },
          { label: "delivery", at: "2026-06-08T10:15:00Z" },
        ],
      },
    });

    expect(html).toContain("Delivery evidence");
    expect(html).toContain('href="https://github.com/acme/roll/pull/481"');
    expect(html).toContain("PR #481");
    expect(html).toContain("CI green");
    expect(html).toContain('href="https://github.com/acme/roll/pull/481/files"');
    expect(html).toContain("packages/cli/src/lib/story-dossier.ts");
    expect(html).toContain("claude");
    expect(html).toContain("$1.23");
    expect(html).toContain("1.2k in");
    expect(html).toContain("345 out");
    expect(html).toContain("definition");
    expect(html).toContain("delivery");
  });

  it("US-EVID-008: collectStoryDossierInput reconstructs delivery facts from card text, runs, and events", () => {
    const p = project();
    const dir = join(p, ".roll", "features", "alpha", "US-DEL-8");
    mkdirSync(join(p, ".roll", "loop"), { recursive: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "spec.md"),
      [
        "# US-DEL-8",
        "",
        "**Delivery:**",
        "- PR https://github.com/acme/roll/pull/481 merged; CI green",
        "- Files changed: packages/a.ts, packages/b.ts",
        "- Diff: https://github.com/acme/roll/pull/481/files",
        "",
        "**AC:**",
        "- [x] shipped",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(p, ".roll", "loop", "runs.jsonl"),
      JSON.stringify({
        run_id: "cycle-1",
        cycle_id: "cycle-1",
        story_id: "US-DEL-8",
        built: ["US-DEL-8"],
        status: "done",
        outcome: "delivered",
        agent: "pi",
        ts: "2026-06-08T10:15:00Z",
        duration_sec: 900,
        cost_usd: 2.5,
        tokens_in: 2000,
        tokens_out: 300,
      }) + "\n",
    );
    writeFileSync(
      join(p, ".roll", "loop", "events.ndjson"),
      [
        { type: "cycle:start", cycleId: "cycle-1", storyId: "US-DEL-8", agent: "pi", model: "m", ts: 1780912800 },
        { type: "pr:merge", prNumber: 481, storyId: "US-DEL-8", ts: 1780904000 },
        { type: "ci:pass", prNumber: 481, ts: 1780904100 },
      ].map((row) => JSON.stringify(row)).join("\n") + "\n",
    );

    const got = collectStoryDossierInput(p, { id: "US-DEL-8", epic: "alpha", type: "US", delivered: true, created: "2026-06-08" });
    expect(got.deliveryEvidence).toEqual({
      prs: [{ number: 481, href: "https://github.com/acme/roll/pull/481", ci: "green" }],
      diffHref: "https://github.com/acme/roll/pull/481/files",
      filesChanged: ["packages/a.ts", "packages/b.ts"],
      agent: "pi",
      cost: { usd: 2.5, tokensIn: 2000, tokensOut: 300 },
      timeline: [
        { label: "definition", at: "2026-06-08" },
        { label: "execution", at: "2026-06-08T10:00:00.000Z" },
        { label: "delivery", at: "2026-06-08T10:15:00Z" },
      ],
    });
  });

  it("US-EVID-009: story graph renders traversable links, release trace, and dead-link fallbacks", () => {
    const html = renderStoryDossier({
      story,
      storyGraph: {
        dependsOn: [
          { id: "US-UP-1", href: "../US-UP-1/index.html" },
          { id: "US-MISSING-1" },
        ],
        dependedBy: [{ id: "US-DOWN-1", href: "../US-DOWN-1/index.html" }],
        fixes: [{ id: "US-BASE-1", href: "../US-BASE-1/index.html" }],
        release: { label: "v3.700.0 — 2026-06-09", href: "../../../../CHANGELOG.md#v37000-2026-06-09" },
      },
    });

    expect(html).toContain("Story graph");
    expect(html).toContain("故事图谱");
    expect(html).toContain("Depends on");
    expect(html).toContain('href="../US-UP-1/index.html"');
    expect(html).toContain("<code>US-MISSING-1</code>");
    expect(html).not.toContain('href="undefined"');
    expect(html).toContain("Depended by");
    expect(html).toContain("Fixes");
    expect(html).toContain('href="../../../../CHANGELOG.md#v37000-2026-06-09"');
    expect(renderStoryDossier({ story })).not.toContain("Story graph");
  });

  it("US-EVID-009: collectStoryDossierInput reconstructs dependencies, reverse edges, FIX source, and changelog release", () => {
    const p = project();
    const f = join(p, ".roll", "features", "alpha");
    const up = join(f, "US-UP-1");
    const current = join(f, "US-GRAPH-9");
    const down = join(f, "US-DOWN-1");
    const fix = join(f, "FIX-GRAPH-9");
    mkdirSync(up, { recursive: true });
    mkdirSync(current, { recursive: true });
    mkdirSync(down, { recursive: true });
    mkdirSync(fix, { recursive: true });
    writeFileSync(join(up, "spec.md"), "# US-UP-1\n");
    writeFileSync(join(up, "index.html"), "<!doctype html>");
    writeFileSync(join(current, "spec.md"), "# US-GRAPH-9\n\n**Dependencies:**\n- depends-on: US-UP-1, US-MISSING-1\n");
    writeFileSync(join(down, "spec.md"), "# US-DOWN-1\n\n- depends-on: US-GRAPH-9\n");
    writeFileSync(join(down, "index.html"), "<!doctype html>");
    writeFileSync(join(fix, "spec.md"), "# FIX-GRAPH-9\n\nfixes: US-UP-1\n");
    writeFileSync(join(p, "CHANGELOG.md"), "## v3.700.0 — 2026-06-09\n\n- Delivered US-GRAPH-9 with graph evidence.\n");

    const got = collectStoryDossierInput(p, { id: "US-GRAPH-9", epic: "alpha", type: "US", delivered: true });
    expect(got.storyGraph?.dependsOn).toEqual([{ id: "US-UP-1", href: "../US-UP-1/index.html" }, { id: "US-MISSING-1" }]);
    expect(got.storyGraph?.dependedBy).toEqual([{ id: "US-DOWN-1", href: "../US-DOWN-1/index.html" }]);
    expect(got.storyGraph?.release?.label).toBe("v3.700.0 — 2026-06-09");
    expect(got.storyGraph?.release?.href).toContain("../../../../CHANGELOG.md#");

    const fixGraph = collectStoryDossierInput(p, { id: "FIX-GRAPH-9", epic: "alpha", type: "FIX", delivered: false }).storyGraph;
    expect(fixGraph?.fixes).toEqual([{ id: "US-UP-1", href: "../US-UP-1/index.html" }]);
  });

  it("US-EVID-012: delivery station renders dynamic replay evidence", () => {
    const html = renderStoryDossier({
      story,
      dynamicEvidence: [
        { kind: "cast", label: "terminal replay", href: "latest/evidence/demo.cast" },
        { kind: "video", label: "web flow", href: "latest/screenshots/flow.mp4" },
      ],
    });
    expect(html).toContain("Dynamic replay");
    expect(html).toContain("动态复现");
    expect(html).toContain('href="latest/evidence/demo.cast"');
    expect(html).toContain("<video controls");
    expect(html).toContain('src="latest/screenshots/flow.mp4"');
  });

  it("US-EVID-012: collectStoryDossierInput discovers casts and videos from the latest run", () => {
    const p = project();
    const dir = join(p, ".roll", "features", "alpha", "US-DYN-12");
    const run = join(dir, "2026-06-08T12-00-00");
    mkdirSync(join(run, "evidence"), { recursive: true });
    mkdirSync(join(run, "screenshots"), { recursive: true });
    writeFileSync(join(dir, "spec.md"), "# US-DYN-12\n");
    writeFileSync(join(run, "evidence", "demo.cast"), '{"version":2}\n');
    writeFileSync(join(run, "screenshots", "flow.mp4"), "MP4");
    symlinkSync("2026-06-08T12-00-00", join(dir, "latest"));

    const got = collectStoryDossierInput(p, { id: "US-DYN-12", epic: "alpha", type: "US", delivered: true });
    expect(got.dynamicEvidence).toEqual([
      { kind: "cast", label: "demo.cast", href: "latest/evidence/demo.cast" },
      { kind: "video", label: "flow.mp4", href: "latest/screenshots/flow.mp4" },
    ]);
  });

  it("US-EVID-014: collectStoryDossierInput renders correction action trace from events", () => {
    const p = project();
    const dir = join(p, ".roll", "features", "alpha", "US-CORR-14");
    mkdirSync(join(p, ".roll", "loop"), { recursive: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spec.md"), "# US-CORR-14\n");
    writeFileSync(
      join(p, ".roll", "loop", "events.ndjson"),
      JSON.stringify({
        type: "correction:action",
        cycleId: "cycle-1",
        storyId: "US-CORR-14",
        action: "open_fix",
        plannedAction: "open_fix",
        signal: "missing_acceptance_report",
        reason: "no fresh acceptance report",
        targetId: "FIX-001",
        mode: "auto",
        source: "attest:gate",
        ts: 1780912800,
      }) + "\n",
    );

    const got = collectStoryDossierInput(p, { id: "US-CORR-14", epic: "alpha", type: "US", delivered: false });
    expect(got.correctionActions).toEqual([
      {
        action: "open_fix",
        at: "2026-06-08T10:00:00.000Z",
        mode: "auto",
        reason: "no fresh acceptance report",
        signal: "missing_acceptance_report",
        source: "attest:gate",
        targetId: "FIX-001",
      },
    ]);
    const html = renderStoryDossier(got);
    expect(html).toContain("Correction trace");
    expect(html).toContain("FIX-001");
    expect(html).toContain("missing_acceptance_report");
  });

  it("US-EVID-011: design station renders peer-review verdicts, rounds, findings, and full-record links", () => {
    const html = renderStoryDossier({
      story,
      peerReview: {
        finalVerdict: "AGREE",
        rounds: [
          {
            round: 1,
            verdict: "REFINE",
            peer: "kimi",
            stage: "design",
            findings: ["tighten the AC evidence wording"],
            href: "../../../loop/peer/cycle-c1.design.pair.json",
          },
          {
            round: 2,
            verdict: "AGREE",
            peer: "pi",
            stage: "code",
            findings: ["no blocking concerns"],
            href: "../../../loop/peer/cycle-c1.pair.json",
          },
        ],
      },
    });

    expect(html).toContain("Peer review");
    expect(html).toContain("同行评审");
    expect(html).toContain("AGREE");
    expect(html).toContain("2 rounds");
    expect(html).toContain("kimi");
    expect(html).toContain("tighten the AC evidence wording");
    expect(html).toContain('href="../../../loop/peer/cycle-c1.design.pair.json"');
  });

  it("US-EVID-011: collectStoryDossierInput reconstructs peer review from cycle runtime records", () => {
    const p = project();
    const dir = join(p, ".roll", "features", "alpha", "US-PEER-11");
    mkdirSync(join(p, ".roll", "loop", "peer"), { recursive: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spec.md"), "# US-PEER-11\n");
    writeFileSync(
      join(p, ".roll", "loop", "runs.jsonl"),
      JSON.stringify({
        run_id: "c1",
        cycle_id: "c1",
        story_id: "US-PEER-11",
        built: ["US-PEER-11"],
        status: "done",
        outcome: "delivered",
      }) + "\n",
    );
    writeFileSync(
      join(p, ".roll", "loop", "peer", "cycle-c1.design.pair.json"),
      JSON.stringify({
        cycleId: "c1",
        workingAgent: "codex",
        peer: "kimi",
        stage: "design",
        verdict: "refine",
        findings: ["clarify the fallback behavior"],
        cost: 0.12,
      }),
    );
    writeFileSync(
      join(p, ".roll", "loop", "peer", "cycle-c1.pair.json"),
      JSON.stringify({
        cycleId: "c1",
        workingAgent: "codex",
        peer: "pi",
        stage: "code",
        verdict: "agree",
        findings: ["no blocker"],
        cost: 0,
      }),
    );

    const got = collectStoryDossierInput(p, { id: "US-PEER-11", epic: "alpha", type: "US", delivered: true });
    expect(got.peerReview).toEqual({
      finalVerdict: "AGREE",
      rounds: [
        {
          round: 1,
          verdict: "REFINE",
          peer: "kimi",
          stage: "design",
          findings: ["clarify the fallback behavior"],
          href: "../../../loop/peer/cycle-c1.design.pair.json",
        },
        {
          round: 2,
          verdict: "AGREE",
          peer: "pi",
          stage: "code",
          findings: ["no blocker"],
          href: "../../../loop/peer/cycle-c1.pair.json",
        },
      ],
    });
  });

  it("wish-only story: empty states render honestly, delivery pending", () => {
    const bare = renderStoryDossier({ story: { ...story, delivered: false } });
    expect(bare).toContain("尚未设计");
    expect(bare).toContain("暂无周期");
    expect(bare).toContain("尚未交付");
    expect(bare).not.toContain('class="attest-banner"');
    expect(bare).not.toContain("Delivery evidence");
    expect(bare).not.toContain("Peer review");
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

  it("survives a malformed ac-map (codex review): null row / non-string note / whitespace verify", () => {
    const p = project();
    const dir = join(p, ".roll", "features", "alpha", "US-V-3");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "ac-map.json"),
      JSON.stringify([null, { ac: "US-V-3:AC1", status: "pass", note: 42, verify: "   " }]),
    );
    const got = collectStoryDossierInput(p, { id: "US-V-3", epic: "alpha", type: "US", delivered: true });
    // the null row is skipped, not fatal; the valid row survives
    expect(got.acRows).toHaveLength(1);
    expect(got.acRows?.[0]?.ac).toBe("US-V-3:AC1");
    // non-string note dropped, whitespace-only verify dropped (no fake command)
    expect(got.acRows?.[0]?.note).toBeUndefined();
    expect(got.acRows?.[0]?.verify).toBeUndefined();
  });

  it("escapes an unknown status (codex review): no HTML injection from ac-map", () => {
    const html = renderStoryDossier({
      story: { id: "US-V-4", epic: "alpha", type: "US", delivered: true },
      acRows: [{ ac: "US-V-4:AC1", status: "<img src=x onerror=alert(1)>" }],
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
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
    mkdirSync(join(p, ".roll", "reports", "consistency"), { recursive: true });
    writeFileSync(
      join(p, ".roll", "reports", "consistency", "2026-06-11.json"),
      JSON.stringify({ generatedAt: "2026-06-11T03:59:00Z", summary: { fail: 1, warn: 2, unknown: 3, grandfathered: 0 } }),
    );
    mkdirSync(join(p, ".roll", "loop"), { recursive: true });
    writeFileSync(
      join(p, ".roll", "loop", "runs.jsonl"),
      [
        JSON.stringify({ run_id: "old", cycle_id: "old", status: "failed", ts: "2026-06-07T00:00:00Z", cost_usd: 9 }),
        JSON.stringify({ run_id: "r1", cycle_id: "r1", status: "merged", outcome: "delivered", ts: "2026-06-11T02:00:00Z", cost_effective_usd: 1 }),
        JSON.stringify({ run_id: "r2", cycle_id: "r2", status: "failed", outcome: "failed", ts: "2026-06-11T03:00:00Z", cost_usd: 0.5 }),
      ].join("\n") + "\n",
    );
    writeFileSync(
      join(p, ".roll", "loop", "events.ndjson"),
      [
        JSON.stringify({ type: "release:gate", tag: "v3.611.3", verdict: "blocked", failCount: 1, waivedRules: [], ts: 1781149000 }),
        JSON.stringify({ type: "release:waiver", reason: "owner accepted fixture", scope: "truth-board", expiresSec: 1781235400, operator: "test", ts: 1781149100 }),
      ].join("\n") + "\n",
    );

    const { indexCommand } = await import("../src/commands/index-gen.js");
    const save = process.cwd();
    const oldNow = process.env["ROLL_RENDER_NOW"];
    process.env["ROLL_RENDER_NOW"] = "2026-06-11T04:00:00Z";
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
      if (oldNow === undefined) delete process.env["ROLL_RENDER_NOW"];
      else process.env["ROLL_RENDER_NOW"] = oldNow;
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
    // Story dossier carries the available delivery artifacts, but the delivered
    // banner waits for merge truth instead of treating attest presence as enough.
    expect(story).not.toContain('class="attest-banner"');
    expect(story).toContain("US-A-1:AC1");
    expect(story).toContain("✓ pass");
    // US-TRUTH-011: the generated front page consumes live audit/run/release
    // facts instead of rendering an un-fed fixture board full of unknowns.
    expect(idx).toContain('data-truth-board="fail"');
    expect(idx).toContain("f:1 w:2 ?:3");
    expect(idx).toContain("2026-06-11T04:00:00Z");
    expect(idx).toContain("v3.611.3");
    expect(idx).toContain("truth-board");
    expect(idx).toContain("<b>2</b>");
    expect(idx).toContain("$1.50");
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
    expect(input.selfScore?.score).toBe(9);
    expect(input.selfScore?.href).toContain("notes/2026-06-08-roll-build-US-A-1-1.md");
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
    expect(input.selfScore?.score).toBe(8);
  });

  it("US-EVID-013: collected self-score carries dimensions and trend context", () => {
    const p = project();
    const card = join(p, ".roll", "features", "alpha", "US-A-1");
    mkdirSync(join(card, "notes"), { recursive: true });
    writeFileSync(
      join(card, "notes", "2026-06-08-roll-build-US-A-1-1.md"),
      "---\nskill: roll-build\nstory: US-A-1\nscore: 7\nverdict: ok\nts: 2026-06-08T12:00:00Z\ntest-quality: 6\n---\n\n证据足够，但测试质量还要补强。\n",
    );
    mkdirSync(join(p, ".roll", "notes"), { recursive: true });
    writeFileSync(
      join(p, ".roll", "notes", "2026-06-01-roll-build-US-OLD-1.md"),
      "---\nskill: roll-build\nstory: US-OLD\nscore: 9\nverdict: good\nts: 2026-06-01T12:00:00Z\n---\n\n旧好卡。\n",
    );
    writeFileSync(
      join(p, ".roll", "notes", "2026-06-02-roll-build-US-OLD-2.md"),
      "---\nskill: roll-build\nstory: US-OLD\nscore: 5\nverdict: ok\nts: 2026-06-02T12:00:00Z\n---\n\n旧低分。\n",
    );
    const input = collectStoryDossierInput(p, {
      id: "US-A-1", epic: "alpha", type: "US", delivered: true,
    });
    expect(input.selfScore?.dimensions).toEqual({ "test-quality": 6 });
    expect(input.selfScoreTrend).toBe("self-score: mean 7.0 / min 5 / redo 1 (last 14)");
  });
});

describe("dossier aligns status/type with the backlog (US-DOSSIER)", () => {
  /** A project whose backlog drives status; features cards carry NO latest/. */
  function backlogProject(): string {
    const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-dossier-bk-")));
    dirs.push(p);
    const f = join(p, ".roll", "features");
    for (const [epic, id] of [
      ["done-epic", "US-DONE-1"],
      ["mix-epic", "US-MIX-1"],
      ["mix-epic", "FIX-MIX-2"],
      ["mix-epic", "US-MIX-3"],
      ["mix-epic", "US-MIX-4"],
    ] as const) {
      mkdirSync(join(f, epic, id), { recursive: true });
      writeFileSync(join(f, epic, id, "spec.md"), `# ${id} — ${id}\n`);
    }
    writeFileSync(
      join(p, ".roll", "backlog.md"),
      "| ID | Description | Status |\n|----|----|----|\n" +
        "| [US-DONE-1](x) | done epic story | ✅ Done |\n" +
        "| [US-MIX-1](x) | merged one | ✅ Done |\n" +
        "| FIX-MIX-2 | in flight | 🔨 In Progress |\n" +
        "| US-MIX-3 | waiting | 📋 Todo |\n" +
        "| US-MIX-4 | parked | 🚫 Hold |\n",
    );
    return p;
  }

  it("status carries backlog claim, but delivered is adjudicated by story truth", () => {
    const epics = collectDossier(backlogProject());
    const mix = epics.find((e) => e.name === "mix-epic")!;
    const byId = Object.fromEntries(mix.stories.map((s) => [s.id, s]));
    expect(byId["US-MIX-1"]).toMatchObject({ delivered: false, status: "done", truthState: "grandfathered" });
    expect(byId["FIX-MIX-2"]).toMatchObject({ delivered: false, status: "in_progress" });
    expect(byId["US-MIX-3"]).toMatchObject({ delivered: false, status: "todo" });
    expect(byId["US-MIX-4"]).toMatchObject({ delivered: false, status: "hold" });
    expect(mix.delivered).toBe(0); // backlog Done is a claim until truth confirms merge
  });

  it("US-TRUTH-009: premature Done shows claim and truth failure on index and epic pages", () => {
    const p = backlogProject();
    const epics = collectDossier(p, {
      prEvidence: { "US-MIX-1": { state: "OPEN" } },
    });
    const mix = epics.find((e) => e.name === "mix-epic")!;
    const story = mix.stories.find((s) => s.id === "US-MIX-1")!;
    expect(story).toMatchObject({ status: "done", delivered: false, truthState: "fail", truthReason: "premature_done" });
    expect(mix.delivered).toBe(0);

    const index = renderFeaturesIndex(epics);
    expect(index).toContain('data-status="fail"');
    expect(index).toContain("claim done");
    expect(index).toContain("truth fail");
    expect(index).not.toContain('data-status="done"><span class="stype US">US</span><span class="sid">US-MIX-1</span>');

    const epic = renderEpicPage(mix);
    expect(epic).toContain('class="pill fail"');
    expect(epic).toContain("premature_done");
  });

  it("merged PR evidence turns a Done claim into delivered truth", () => {
    const epics = collectDossier(backlogProject(), {
      prEvidence: { "US-MIX-1": { state: "MERGED", mergedAtSec: 1_781_000_000 } },
    });
    const mix = epics.find((e) => e.name === "mix-epic")!;
    expect(mix.stories.find((s) => s.id === "US-MIX-1")).toMatchObject({ delivered: true, status: "done", truthState: "truth" });
    expect(mix.delivered).toBe(1);
  });

  it("a truth-delivered epic lands in 'Delivered to main', partial in 'Shipping' (shipping first)", () => {
    const html = renderFeaturesIndex(collectDossier(backlogProject(), {
      prEvidence: {
        "US-MIX-1": { state: "MERGED", mergedAtSec: 1_781_000_000 },
        "US-DONE-1": { state: "MERGED", mergedAtSec: 1_781_000_000 },
      },
    }));
    expect(html).toContain("Delivered to main");
    expect(html).toContain("Shipping to main");
    // board order: in-flight (Shipping) on top, then Delivered.
    expect(html.indexOf("Shipping to main")).toBeLessThan(html.indexOf("Delivered to main"));
  });

  it("story rows carry the backlog status (done/wip/hold/todo) + a lifecycle spine", () => {
    const html = renderFeaturesIndex(collectDossier(backlogProject()));
    expect(html).toContain('data-status="unknown"><span class="stype US">US</span><span class="sid">US-MIX-1</span>');
    expect(html).toContain('data-status="wip"><span class="stype FIX">FIX</span><span class="sid">FIX-MIX-2</span>');
    expect(html).toContain('data-status="hold"><span class="stype US">US</span><span class="sid">US-MIX-4</span>');
    expect(html).toContain('data-status="todo"><span class="stype US">US</span><span class="sid">US-MIX-3</span>');
    expect(html).toContain('class="lifespine');
  });
});
