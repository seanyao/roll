/**
 * US-DOSSIER-001 — Delivery Dossier three-layer generation.
 * 001a: design tokens + Features Index front page (collectDossier + renderFeaturesIndex).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { STATUS_MARKER } from "@roll/spec";
import { generateDossierPages } from "../src/commands/index-gen.js";
import { collectDossier, type DossierEpic, type DossierStory } from "../src/lib/archive.js";
import { DOSSIER_CSS, DOSSIER_FILTER_SCRIPT } from "../src/lib/dossier-css.js";
import { LADDER_CSS, deriveDeliveryLadder, renderFeaturesIndex, renderTruthBoard, spineMotif, storyLadderState } from "../src/lib/dossier-index.js";
import { miniSpine, renderEpicPage, storyState } from "../src/lib/epic-page.js";
import {
  acDisplayState,
  acHasVisualEvidence,
  classifyAc,
  collectGitDossierFacts,
  collectStoryDossierInput,
  parseAcEvidence,
  rebaseEvidenceHrefToStoryRoot,
  renderStoryDossier,
  storyEvidenceFlags,
  storyHasMergeEvidence,
  storySpine,
} from "../src/lib/story-dossier.js";
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

function projectWithEpicDocs(): string {
  const p = project();
  const f = join(p, ".roll", "features");
  writeFileSync(join(f, "alpha", "alpha.md"), "# Alpha overview\n");
  writeFileSync(join(f, "alpha", "alpha-plan.md"), "# Alpha plan\n");
  writeFileSync(join(f, "alpha", "deep dive.md"), "# Deep dive\n");
  writeFileSync(join(f, "alpha", "notes.md"), "# Alpha notes\n");
  return p;
}

function projectWithPlanOnlyDoc(): string {
  const p = project();
  const f = join(p, ".roll", "features");
  writeFileSync(join(f, "beta", "beta-plan.md"), "# Beta plan\n");
  return p;
}

function epicDocsSection(page: string): string {
  return /<section class="epic-docs[\s\S]*?<\/section>\n/.exec(page)?.[0] ?? "";
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

  it("FIX-278: offline merge evidence keeps a backlog-Done card delivered when the rebuild path has no live PR snapshot", () => {
    // The exact `roll index --rebuild` regression: a merged card is ✅ Done in
    // the backlog, but rebuild passes NO prEvidence snapshot, so the truth
    // selector returns unknown for this (post-epoch) card → delivered=false,
    // stripping the delivered banner off a page that git proves merged. The
    // durable merge truth (a `… (#476)` merge commit) must keep it delivered.
    const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-dossier-fix278-")));
    dirs.push(p);
    const f = join(p, ".roll", "features", "loop-engine");
    mkdirSync(join(f, "FIX-208", "2026-06-06T05-04-48"), { recursive: true });
    writeFileSync(join(f, "FIX-208", "spec.md"), "---\nid: FIX-208\ntitle: runs 行证据保真\ntype: fix\ncreated: 2026-06-06\n---\n\n# FIX-208\n");
    writeFileSync(join(f, "FIX-208", "2026-06-06T05-04-48", "FIX-208-report.html"), "<html>attested</html>\n");
    symlinkSync(join(f, "FIX-208", "2026-06-06T05-04-48"), join(f, "FIX-208", "latest"));
    writeFileSync(
      join(p, ".roll", "backlog.md"),
      "| Story | Desc | Status |\n|---|---|---|\n| [FIX-208](x) | runs 行证据保真 | ✅ Done |\n",
    );
    // A Todo card alongside it — must NEVER be promoted by merge evidence.
    mkdirSync(join(f, "FIX-209"), { recursive: true });
    writeFileSync(join(f, "FIX-209", "spec.md"), "---\nid: FIX-209\ntitle: not done\ntype: fix\ncreated: 2026-06-06\n---\n\n# FIX-209\n");
    writeFileSync(
      join(p, ".roll", "backlog.md"),
      "| Story | Desc | Status |\n|---|---|---|\n| [FIX-208](x) | runs 行证据保真 | ✅ Done |\n| [FIX-209](x) | not done | 📋 Todo |\n",
    );
    // No merge-evidence probe (default): the selector erases delivered — the bug.
    expect(collectDossier(p)[0]!.stories.find((s) => s.id === "FIX-208")!.delivered).toBe(false);
    // With offline merge truth: the Done card stays delivered; the Todo card —
    // even though the probe matches it — is NOT promoted (Done-gate).
    const withMerge = collectDossier(p, { mergeEvidence: () => true })[0]!.stories;
    expect(withMerge.find((s) => s.id === "FIX-208")!.delivered).toBe(true);
    expect(withMerge.find((s) => s.id === "FIX-209")!.delivered).toBe(false);
  });

  it("FIX-278: storyHasMergeEvidence reads a `(#N)` merge commit that references the story id", () => {
    const facts = {
      slug: "seanyao/roll",
      commits: [
        { subject: "loop cycle cycle-20260606 (#476)", message: "Story body mentions FIX-208 root cause", files: [] },
        { subject: "tcr: US-EVID-001 open runner evidence frame", message: "no PR number here", files: [] },
        { subject: "chore: unrelated (#999)", message: "nothing relevant", files: [] },
      ],
    };
    expect(storyHasMergeEvidence(facts, "FIX-208")).toBe(true); // (#476) merge commit body cites FIX-208
    expect(storyHasMergeEvidence(facts, "US-EVID-001")).toBe(true); // tcr subject names it → own work landed
    expect(storyHasMergeEvidence(facts, "FIX-999")).toBe(false); // no commit references it
    expect(storyHasMergeEvidence(null, "FIX-208")).toBe(false); // not a git repo
  });

  it("FIX-308: git dossier facts read origin/main when local HEAD is stale", () => {
    const remote = realpathSync(mkdtempSync(join(tmpdir(), "roll-dossier-remote-")));
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "roll-dossier-origin-main-")));
    dirs.push(remote, repo);

    execFileSync("git", ["init", "--bare", "--initial-branch=main"], { cwd: remote });
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Roll Test"], { cwd: repo });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: repo });
    writeFileSync(join(repo, "README.md"), "base\n");
    execFileSync("git", ["add", "README.md"], { cwd: repo });
    execFileSync("git", ["commit", "-m", "base"], { cwd: repo });
    execFileSync("git", ["push", "-u", "origin", "main"], { cwd: repo });
    execFileSync("git", ["checkout", "-b", "stale-local-main"], { cwd: repo });
    execFileSync("git", ["checkout", "main"], { cwd: repo });
    writeFileSync(join(repo, "README.md"), "base\nFIX-308 landed\n");
    execFileSync("git", ["commit", "-am", "loop cycle cycle-20260614 (#700)\n\nStory FIX-308 delivered"], { cwd: repo });
    execFileSync("git", ["push", "origin", "main"], { cwd: repo });
    execFileSync("git", ["checkout", "stale-local-main"], { cwd: repo });

    const facts = collectGitDossierFacts(repo);
    expect(storyHasMergeEvidence(facts, "FIX-308")).toBe(true);
  });

  it("FIX-349: collectGitDossierFacts returns fully-populated facts when git log output exceeds the 1MB execFileSync default", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "roll-dossier-bigfacts-")));
    dirs.push(repo);

    execFileSync("git", ["init", "--initial-branch=main"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Roll Test"], { cwd: repo });
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: repo });

    // Build a history whose `git log ... %B` output blows past the 1MB default
    // maxBuffer: 40 commits, each with a ~40KB body → ~1.6MB > 1MB. Against the
    // OLD code this makes execFileSync throw ENOBUFS → collectGitDossierFacts
    // returns null; the fix raises maxBuffer so all commits come back.
    const NUM_COMMITS = 40;
    const bigBody = "x".repeat(40 * 1024);
    for (let i = 0; i < NUM_COMMITS; i++) {
      writeFileSync(join(repo, `file-${i}.txt`), `content ${i}\n`);
      execFileSync("git", ["add", "."], { cwd: repo });
      execFileSync("git", ["commit", "-m", `BIG-${i} large commit\n\n${bigBody}`], { cwd: repo });
    }

    const facts = collectGitDossierFacts(repo);
    expect(facts).not.toBeNull();
    // Every fixture commit must be present — proves the full output was read,
    // not silently truncated. (collectGitDossierFacts catches ENOBUFS → null;
    // with default maxBuffer this whole assertion block fails on `not.toBeNull`.)
    expect(facts!.commits.length).toBe(NUM_COMMITS);
    for (let i = 0; i < NUM_COMMITS; i++) {
      expect(storyHasMergeEvidence(facts, `BIG-${i}`)).toBe(true);
    }
  });

  it("FIX-308: dossier generation fetches origin/main before classifying merged stories", () => {
    const remote = realpathSync(mkdtempSync(join(tmpdir(), "roll-dossier-fetch-remote-")));
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "roll-dossier-fetch-repo-")));
    const pusher = realpathSync(mkdtempSync(join(tmpdir(), "roll-dossier-fetch-pusher-")));
    dirs.push(remote, repo, pusher);

    execFileSync("git", ["init", "--bare", "--initial-branch=main"], { cwd: remote });
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Roll Test"], { cwd: repo });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: repo });
    writeFileSync(join(repo, "README.md"), "base\n");
    execFileSync("git", ["add", "README.md"], { cwd: repo });
    execFileSync("git", ["commit", "-m", "base"], { cwd: repo });
    execFileSync("git", ["push", "-u", "origin", "main"], { cwd: repo });
    execFileSync("git", ["checkout", "-b", "stale-local-main"], { cwd: repo });

    execFileSync("git", ["clone", remote, pusher]);
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: pusher });
    execFileSync("git", ["config", "user.name", "Roll Test"], { cwd: pusher });
    writeFileSync(join(pusher, "README.md"), "base\nFIX-308 landed remotely\n");
    execFileSync("git", ["commit", "-am", "loop cycle cycle-20260614 (#701)\n\nStory FIX-308 delivered"], { cwd: pusher });
    execFileSync("git", ["push", "origin", "main"], { cwd: pusher });

    const storyDir = join(repo, ".roll", "features", "acceptance-evidence", "FIX-308");
    mkdirSync(storyDir, { recursive: true });
    writeFileSync(storyDir + "/spec.md", "---\nid: FIX-308\ntitle: stale merge baseline\ntype: fix\n---\n\n# FIX-308\n");
    writeFileSync(join(repo, ".roll", "backlog.md"), "| Story | Desc | Status |\n|---|---|---|\n| [FIX-308](x) | stale merge baseline | ✅ Done |\n");

    generateDossierPages(repo, false);

    const truth = JSON.parse(readFileSync(join(repo, ".roll", "features", "truth.json"), "utf8")) as { stories: Array<{ id: string; ladder: string }> };
    expect(truth.stories.find((s) => s.id === "FIX-308")).toMatchObject({ ladder: "merged" });
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

  it("US-DOSSIER-009: collects epic-root markdown docs with overview first, plan second, then other docs", () => {
    const alpha = collectDossier(projectWithEpicDocs()).find((e) => e.name === "alpha")!;
    expect(alpha.docs).toEqual([
      { file: "alpha.md", href: "alpha.md", kind: "overview", title: "Alpha overview" },
      { file: "alpha-plan.md", href: "alpha-plan.md", kind: "plan", title: "Alpha plan" },
      { file: "deep dive.md", href: "deep%20dive.md", kind: "doc", title: "Deep dive" },
      { file: "notes.md", href: "notes.md", kind: "doc", title: "Alpha notes" },
    ]);
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

  it("US-DOSSIER-025: status overview tally cards are the ladder (attested/merged/claimed) + delivery spectrum + % merged", () => {
    // fixture: 3 stories — US-A-1 delivered via latest/ but NO ac-map/screenshot
    // → `merged` rung (not attested); FIX-2 todo; beta todo → merged 1 / todo 2 → 33%.
    expect(html).toContain('class="statusboard ladder"');
    expect(html).toContain('class="tally attested"'); // the top rung card is present
    expect(html).toContain('class="tally merged"'); // US-A-1 sits at merged (no attest evidence)
    expect(html).toContain('class="tally claimed"');
    expect(html).toContain("已验收"); // Attested tally label
    expect(html).toContain("已合主干"); // Merged tally label
    expect(html).toContain('class="spectrum"');
    expect(html).toContain('class="s-merged"'); // the spectrum's `done`-equivalent split: merged segment
    expect(html).toContain("33%");
  });

  it("lifecycle spine: five stations, delivery carries the truth badge", () => {
    const spine = spineMotif();
    expect(spine.match(/class="node/g)).toHaveLength(5);
    expect(spine).toContain('node truth');
    expect(spine).toContain("Retrospective");
    expect(spine).toContain("复盘");
  });

  it("US-DOSSIER-025: toolbar search input + per-rung filter chips (ladder vocabulary) wired to the filter script", () => {
    expect(html).toContain("data-dossier-search");
    expect(html).toContain('class="statusfilter"');
    // the chips are the ladder rungs now, so a chip's data-sf matches the
    // data-status rungs the epic folds carry (attested/merged/claimed/…).
    expect(html).toContain('data-sf="attested"');
    expect(html).toContain('data-sf="merged"');
    expect(html).toContain('data-sf="claimed"');
    expect(html).toContain('data-sf="hold"');
    expect(html).not.toContain('data-sf="done"'); // the old lumped bucket is gone
    expect(html).toContain(DOSSIER_FILTER_SCRIPT);
  });

  it("FIX-300: the Hold tally + filter chip use the canonical @roll/spec glyph (🚫), never the legacy lock (🔒)", () => {
    // The dossier sources its status display glyphs from the ONE STATUS_MARKER set,
    // so the Hold rung shows the canonical 🚫 (STATUS_MARKER.hold) — the same glyph
    // the showcase reset/picker/renderer key on — not the divergent legacy lock 🔒.
    expect(STATUS_MARKER.hold).toContain("🚫"); // guard: canonical glyph is 🚫
    expect(html).toContain("🚫"); // Hold tally card + chip render the canonical glyph
    expect(html).not.toContain("🔒"); // the legacy lock never leaks into the dossier
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

  it("epic groups: shipping before backlog; story rows carry type + ladder rung (US-DOSSIER-025)", () => {
    expect(html.indexOf("Shipping to main")).toBeLessThan(html.indexOf("In backlog"));
    expect(html).toContain('href="alpha/index.html"');
    expect(html).toContain('href="alpha/US-A-1/index.html"');
    expect(html).toContain('class="story"');
    expect(html).toContain('class="stype US"');
    // US-DOSSIER-025: US-A-1 delivered via latest/ but no attest evidence → `merged`
    // rung (the honest middle), not the old binary `done`.
    expect(html).toContain('class="sstat st-merged"');
    expect(html).toContain('data-status="merged"');
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

  it("US-DOSSIER-009: epic folds mark whether an overview doc exists", () => {
    const withDocs = renderFeaturesIndex(collectDossier(projectWithEpicDocs()));
    expect(withDocs).toContain('class="epic-docmark has-overview"');
    expect(withDocs).toContain("overview");
    expect(withDocs).toContain("总览");
    expect(withDocs).toContain('class="epic-docmark no-overview"');
    expect(withDocs).toContain("no overview");
    expect(withDocs).toContain("无总览");
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
    expect(html).toContain('href="../index.html#backlog"');
    expect(html).toContain("Epic Dossier");
    expect(html).toContain("史诗档案");
    expect(html).toContain("Merged to main");
    expect(html).toContain('style="width:50%"'); // 1 of 2 delivered
  });

  it("US-DOSSIER-025: rungs grouped on the ladder (attested → merged → claimed) plus preserved drift/unknown; rows link to story dossiers", () => {
    // The alpha fixture's US-A-1 is delivered via latest/ but unattested → it
    // lands in the `merged` group; FIX-2 is wish-only (not even claimed) → it
    // sits in NO rung group (only attested/merged/claimed/drift/unknown render).
    expect(html).toContain('href="US-A-1/index.html"');
    expect(html).toContain('class="type type-FIX"');
    // the group headings are the ladder rungs, bilingual on separate lines.
    expect(html).toContain("Merged to main"); // the merged rung heading
    expect(html).toContain('class="pill merged"'); // US-A-1's merged rung pill
    expect(html).toContain("已合主干"); // 中 of the merged pill / heading
    // the old `cycle`/`backlog` pills are gone — replaced by the ladder vocabulary.
    expect(html).not.toContain('class="pill cycle"');
    expect(html).not.toContain('class="pill backlog"');
  });

  it("US-DOSSIER-025: mini-spine fills to the rung — attested all five (delivery truth-green), merged through delivery (no attest mark), claimed definition + hatched delivery", () => {
    // attested — merge + full attest evidence → all five, delivery node attested (truth-green).
    const attested = miniSpine({
      id: "X-1", epic: "e", type: "US", delivered: true, legacy: false,
      evidence: { report: true, acMap: true, visualEvidence: true },
    });
    expect(attested.match(/<i[ >]/g)).toHaveLength(5);
    expect(attested).toContain('class="attested"'); // delivery node carries the attested rung
    expect(attested).not.toContain('class="merged"');
    // merged — delivered but no attest evidence → filled through delivery (teal), never attested.
    const merged = miniSpine({ id: "X-2", epic: "e", type: "US", delivered: true, legacy: false });
    expect(merged).toContain('class="merged"');
    expect(merged).not.toContain('class="attested"');
    // claimed — backlog ✅ Done, no merge evidence → definition only + a hatched amber delivery node.
    const claimed = miniSpine({ id: "X-3", epic: "e", type: "US", delivered: false, status: "done", legacy: false });
    expect(claimed).toContain('class="claimed"');
    expect(claimed.match(/class="done"/g)).toHaveLength(1); // definition station only
    // wish-only — definition only, no rung class on the delivery node.
    const wish = miniSpine({ id: "X-4", epic: "e", type: "US", delivered: false, legacy: false });
    expect(wish.match(/class="done"/g)).toHaveLength(1);
    expect(wish).not.toContain('class="attested"');
    expect(wish).not.toContain('class="merged"');
    expect(wish).not.toContain('class="claimed"');
  });

  it("self-containment holds", () => {
    expect(html).not.toContain("<script src=");
    expect(html).not.toContain("<link");
    expect(html).toContain("localStorage");
  });

  it("US-DOSSIER-009: masthead surfaces overview, plan, and other epic-root docs as file://-safe relative links", () => {
    const alphaWithDocs = collectDossier(projectWithEpicDocs()).find((e) => e.name === "alpha")!;
    const page = renderEpicPage(alphaWithDocs);
    expect(page).toContain("Design docs");
    expect(page).toContain("设计文档");
    expect(page).toContain('href="alpha.md"');
    expect(page).toContain('href="alpha-plan.md"');
    expect(page).toContain('href="deep%20dive.md"');
    expect(page).toContain('href="notes.md"');
    expect(page).toContain("Overview");
    expect(page).toContain("Plan");
    expect(page).toContain("Alpha notes");
    expect(epicDocsSection(page)).toMatchSnapshot();
  });

  it("US-DOSSIER-009: epics without root markdown show a quiet convention hint", () => {
    const beta = collectDossier(project()).find((e) => e.name === "beta")!;
    const page = renderEpicPage(beta);
    expect(page).toContain("No epic-root design docs yet");
    expect(page).toContain("暂无 epic 根设计文档");
    expect(page).toContain(".roll/features/beta/beta.md");
    expect(page).toContain(".roll/features/beta/beta-plan.md");
    expect(epicDocsSection(page)).toMatchSnapshot();
  });

  it("US-DOSSIER-009: epics with plan docs but no overview still show the overview convention", () => {
    const beta = collectDossier(projectWithPlanOnlyDoc()).find((e) => e.name === "beta")!;
    const page = renderEpicPage(beta);
    expect(page).toContain('href="beta-plan.md"');
    expect(page).toContain("No overview doc yet");
    expect(page).toContain("暂无总览文档");
    expect(page).toContain(".roll/features/beta/beta.md");
    expect(epicDocsSection(page)).toMatchSnapshot();
  });
});

describe("US-DOSSIER-025 — epic list page + mini-spine + index spectrum on the ladder", () => {
  // A four-rung fixture, each story already enriched with the evidence flags the
  // index command attaches, so storyState / storyLadderState resolve to a distinct
  // rung — exactly what the per-story dossier + truth.json registry would report.
  const ATTESTED: DossierStory = {
    id: "US-AT-1", epic: "ladder", type: "US", title: "Attested story", delivered: true, legacy: false,
    status: "done", evidence: { report: true, acMap: true, visualEvidence: true },
  };
  const MERGED: DossierStory = {
    id: "US-MG-2", epic: "ladder", type: "US", title: "Merged story", delivered: true, legacy: false,
    status: "done", evidence: { report: false, acMap: true, visualEvidence: false },
  };
  const CLAIMED: DossierStory = {
    id: "US-CL-3", epic: "ladder", type: "US", title: "Claimed story", delivered: false, legacy: false,
    status: "done",
  };
  const DRIFT: DossierStory = {
    id: "US-DR-4", epic: "ladder", type: "US", title: "Drift story", delivered: false, legacy: false,
    status: "done", truthState: "fail", truthReason: "premature_done",
  };
  const ladderEpic: DossierEpic = {
    name: "ladder", stories: [ATTESTED, MERGED, CLAIMED, DRIFT], delivered: 2,
  };

  it("AC1: storyState returns the ternary ladder for non-error rows; fail/unknown preserved", () => {
    expect(storyState(ATTESTED)).toBe("attested");
    expect(storyState(MERGED)).toBe("merged");
    expect(storyState(CLAIMED)).toBe("claimed");
    expect(storyState(DRIFT)).toBe("fail");
    expect(storyState({ id: "U", epic: "e", type: "US", delivered: false, legacy: false, truthState: "unknown" })).toBe("unknown");
    // a delivered story with no enriched evidence flags is the honest `merged`
    // rung, never a silent `attested`.
    expect(storyState({ id: "U", epic: "e", type: "US", delivered: true, legacy: false })).toBe("merged");
  });

  it("AC2: epic story rows render the rung pill (attested/merged/claimed), bilingual EN/中 on separate lines", () => {
    const page = renderEpicPage(ladderEpic);
    expect(page).toContain('class="pill attested"');
    expect(page).toContain('class="pill merged"');
    expect(page).toContain('class="pill claimed"');
    expect(page).toContain('class="pill fail"');
    // bilingual, EN line then 中 line (the bi() two-span shape), never inline.
    expect(page).toContain('<span class="lang-en">attested</span><span class="lang-zh">已验收</span>');
    expect(page).toContain('<span class="lang-en">merged</span><span class="lang-zh">已合主干</span>');
    expect(page).toContain('<span class="lang-en">claimed</span><span class="lang-zh">仅声称</span>');
    // the old vocabulary is gone.
    expect(page).not.toContain('class="pill cycle"');
    expect(page).not.toContain('class="pill backlog"');
  });

  it("AC3: miniSpine fills to the rung — attested all five, merged through delivery (no attest mark), claimed definition + hatched delivery", () => {
    const at = miniSpine(ATTESTED);
    expect(at.match(/<i[ >]/g)).toHaveLength(5);
    expect(at).toContain('class="attested"');
    expect(at).not.toContain('class="merged"');
    const mg = miniSpine(MERGED);
    expect(mg).toContain('class="merged"');
    expect(mg).not.toContain('class="attested"'); // merged never reads as full green
    const cl = miniSpine(CLAIMED);
    expect(cl).toContain('class="claimed"');
    expect(cl.match(/class="done"/g)).toHaveLength(1); // definition station only
    // no row reads fully done unless it is at least `merged`: claimed has no
    // filled upstream stations beyond definition.
    expect(cl).not.toContain('class="merged"');
    expect(cl).not.toContain('class="attested"');
  });

  it("AC4: epic group headings are the ladder rungs + preserved drift/unknown; bilingual on separate lines; empty groups omitted", () => {
    const page = renderEpicPage(ladderEpic);
    // headings present and in rung order: attested → merged → claimed → drift.
    const iAt = page.indexOf("Merged & attested");
    const iMg = page.indexOf("Merged to main");
    const iCl = page.indexOf("Claimed only");
    const iDr = page.indexOf("Truth drift");
    expect(iAt).toBeGreaterThan(-1);
    expect(iAt).toBeLessThan(iMg);
    expect(iMg).toBeLessThan(iCl);
    expect(iCl).toBeLessThan(iDr);
    // bilingual headings on separate lines.
    expect(page).toContain('<span class="lang-en">Claimed only</span><span class="lang-zh">仅声称 — 尚无合并证据</span>');
    // empty groups are omitted: an all-attested epic shows no merged/claimed/drift heading.
    const allAttested = renderEpicPage({ name: "a", stories: [ATTESTED], delivered: 1 });
    expect(allAttested).toContain("Merged & attested");
    expect(allAttested).not.toContain("Claimed only");
    expect(allAttested).not.toContain("Truth drift");
  });

  it("AC5: the front-page spectrum + storySpectrumState classify by the same ladder; done split into attested vs merged; tally + legend one-to-one", () => {
    const html = renderFeaturesIndex([ladderEpic]);
    // the spectrum bar carries distinct attested + merged + claimed segments.
    expect(html).toContain('class="s-attested"');
    expect(html).toContain('class="s-merged"');
    expect(html).toContain('class="s-claimed"');
    // tally cards split done → attested + merged, with a claimed card.
    expect(html).toContain('class="tally attested"');
    expect(html).toContain('class="tally merged"');
    expect(html).toContain('class="tally claimed"');
    // legend swatches one-to-one with the rungs.
    expect(html).toContain('class="i-attested"');
    expect(html).toContain('class="i-merged"');
    expect(html).toContain('class="i-claimed"');
    // % merged to main = (attested + merged) / total = 2/4 = 50%.
    expect(html).toContain("<b>50%</b>");
    // the row status pill on the index uses the same rung as the epic page.
    expect(html).toContain('data-status="attested"');
    expect(html).toContain('data-status="merged"');
    expect(html).toContain('data-status="claimed"');
  });

  it("AC6: the rung is identical on every surface for the same story (epic page row, index spectrum, registry classifier)", () => {
    // storyState (epic page) and storyLadderState (index) agree per story.
    for (const s of ladderEpic.stories) {
      expect(storyState(s)).toBe(storyLadderState(s));
    }
    // and they equal the registry's deriveDeliveryLadder rung for the delivered/
    // claimed cases (the truth.json `ladder` field) — one ladder, every surface.
    expect(deriveDeliveryLadder(ATTESTED, ATTESTED.evidence!)).toBe("attested");
    expect(deriveDeliveryLadder(MERGED, MERGED.evidence!)).toBe("merged");
    expect(deriveDeliveryLadder(CLAIMED, { report: false, acMap: false, visualEvidence: false })).toBe("claimed");
  });

  it("US-DOSSIER-025 fidelity: the EPIC list surface keeps every reference component (masthead crumb + ledger + wish→truth bar + doc links + grouped rows w/ type chip + id + mini 5-node spine + claim↔truth pill)", () => {
    const page = renderEpicPage(ladderEpic);
    // masthead + breadcrumb home + epic kicker.
    expect(page).toContain('class="crumb"');
    expect(page).toContain('href="../index.html#backlog"');
    expect(page).toContain("Epic Dossier");
    // epic-level ledger (figures) + wish→truth bar + legend.
    expect(page).toContain('class="ledger"');
    expect(page).toContain('class="figures"');
    expect(page).toContain('class="wt-bar"');
    expect(page).toContain('class="wt-legend"');
    expect(page).toContain('style="width:50%"'); // 2 of 4 delivered
    // a story row carries: type chip · id · title · mini 5-node spine · rung pill.
    expect(page).toContain('class="type type-US"');
    expect(page).toContain('class="id"');
    expect(page).toContain('class="mini-spine"');
    const rowSpine = miniSpine(ATTESTED);
    expect(rowSpine.match(/<i[ >]/g)).toHaveLength(5); // exactly 5 nodes
    expect(page).toContain('class="pill attested"');
    // the ladder palette is injected (attest-green / teal / amber), self-contained.
    expect(page).toContain(LADDER_CSS);
    expect(page).not.toContain("<script src=");
    expect(page).not.toContain("<link");
  });

  it("US-DOSSIER-025 fidelity: the front-page spectrum keeps the reference status overview (8-rung statusboard + segmented bar + corpus %line + legend)", () => {
    const html = renderFeaturesIndex([ladderEpic]);
    expect(html).toContain('class="statusboard ladder"'); // the tally board
    expect(html).toContain('class="spectrum"'); // the segmented bar
    expect(html).toContain('class="pctline"'); // corpus + % merged line
    expect(html).toContain('class="spectrum-legend"'); // the legend
    expect(html).toContain('class="lifespine'); // per-row lifecycle spine
    // the ladder colors are injected once.
    expect(html).toContain(LADDER_CSS);
  });

  it("US-DOSSIER-025: determinism — the same epic renders byte-identical across reruns (no clock/locale)", () => {
    expect(renderEpicPage(ladderEpic)).toBe(renderEpicPage(ladderEpic));
    expect(renderFeaturesIndex([ladderEpic])).toBe(renderFeaturesIndex([ladderEpic]));
  });
});

describe("renderStoryDossier — US-DOSSIER-001c", () => {
  const story = { id: "US-A-1", epic: "alpha", type: "US", title: "Alpha story", created: "2026-06-01", delivered: true };
  const full = renderStoryDossier({
    story,
    // US-DOSSIER-023: the attested rung — merged AND full attest evidence on
    // disk (report + ac-map + a real-pixel screenshot). The strongest rung.
    ladder: "attested",
    evidence: { report: true, acMap: true, visualEvidence: true },
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
    expect(full).toContain('href="../../index.html#backlog"'); // root = Backlog tab (US-DOSSIER-012)
    expect(full).toContain('href="../index.html"');
    expect(full).toContain("<code>US-A-1</code>");
    expect(full).toContain('class="type type-US"');
  });

  it("US-DOSSIER-023: spine delivery node is the ladder rung — attested → truth-green node, four upstream stations done", () => {
    const spine = storySpine({
      story,
      ladder: "attested",
      evidence: { report: true, acMap: true, visualEvidence: true },
      wish: "w",
      design: ["d"],
      commits: ["c"],
      retro: "r",
    });
    // four upstream stations (definition/design/execution/retrospective) keep
    // the .node.done accent; the delivery node is .node.attested (not .done).
    expect(spine.match(/node done/g)).toHaveLength(4);
    expect(spine).toContain("node attested");
    expect(spine).not.toContain("node truth"); // the old binary class is gone
  });

  it("US-DOSSIER-023: the three delivery rungs render distinct, never-faking node states", () => {
    // claimed — backlog Done, NO merge evidence yet (delivered:false) → hatched/hollow.
    const claimed = storySpine({ story: { ...story, delivered: false, status: "done" } });
    expect(claimed).toContain("node claimed");
    expect(claimed).not.toContain("node merged");
    expect(claimed).not.toContain("node attested");
    // merged — merge truth on main but attest chain incomplete → solid teal middle rung.
    const merged = storySpine({ story, ladder: "merged", evidence: { report: false, acMap: true, visualEvidence: false } });
    expect(merged).toContain("node merged");
    expect(merged).not.toContain("node attested");
    expect(merged).not.toContain("node claimed");
    // attested — merged AND full evidence → truth-green.
    const attested = storySpine({ story, ladder: "attested", evidence: { report: true, acMap: true, visualEvidence: true } });
    expect(attested).toContain("node attested");
    expect(attested).not.toContain("node merged");
  });

  it("five sections with real content: wish-quote, design bullets, commits, attest banner + per-AC blocks, retro", () => {
    expect(full).toContain('class="wish-quote"');
    expect(full).toContain("一键看到全部交付真相");
    expect(full).toContain("<li>生成器读真实数据</li>");
    expect(full).toContain("2 TCR commits");
    expect(full).toContain('class="attest-banner"'); // attested rung keeps the truth-green banner
    expect(full).toContain('href="latest/US-A-1-report.html"');
    // US-DOSSIER-024: AC1 (pass, doc/contract heuristic) keeps its ✓ pass badge;
    // AC2 ("截屏待补" — an observable AC with NO screenshot) is honestly demoted
    // to the evidence-gap state, never shown as attested.
    expect(full).toContain('data-ac="US-A-1:AC1"');
    expect(full).toContain("✓ pass");
    expect(full).toContain('data-ac="US-A-1:AC2"');
    expect(full).toContain("截屏待补"); // the note still renders inline beneath the AC
    expect(full).toContain("evidence gap"); // the gap chip on the observable, screenshot-less AC2
    expect(full).toContain("score 9 good");
  });

  it("US-DOSSIER-023: the delivery banner is state-aware, bilingual EN/中 on separate lines, never hardcoded", () => {
    // attested — truth-green attest banner, "Merged & attested".
    expect(full).toContain('class="attest-banner"');
    expect(full).toContain("Merged & attested");
    expect(full).toContain("已合主干 · 已验收");
    // merged — teal merge-banner, "Merged (not yet attested)".
    const merged = renderStoryDossier({ story, ladder: "merged", evidence: { report: false, acMap: true, visualEvidence: false } });
    expect(merged).toContain('class="attest-banner merge-banner"');
    expect(merged).toContain("Merged (not yet attested)");
    expect(merged).toContain("已合主干 — 尚未验收");
    expect(merged).not.toContain('class="attest-banner"'); // not the bare truth-green attested class
    // claimed — amber claim-banner, the honest "no merge evidence yet" copy.
    const claimed = renderStoryDossier({ story: { ...story, delivered: false, status: "done" } });
    expect(claimed).toContain('class="attest-banner claim-banner"');
    expect(claimed).toContain("Claimed — backlog says Done, no merge evidence yet");
    expect(claimed).toContain("仅声明 — 待办标记 Done，尚无合并证据");
    // The old hardcoded banner copy is gone everywhere.
    expect(full).not.toContain("Merged to main — attested");
  });

  it("US-DOSSIER-023: the claim ↔ truth reconciliation panel renders two columns (声明/claim vs 真相/truth) with a per-rung recColor", () => {
    // attested — both sides green, fully reconciled.
    expect(full).toContain('class="reconcile" data-rung="attested"');
    expect(full).toContain('border-left-color:#178a52');
    expect(full).toContain('class="reconcile-col reconcile-claim"');
    expect(full).toContain('class="reconcile-col reconcile-truth"');
    expect(full).toContain("声明"); // claim side label
    expect(full).toContain("真相"); // truth side label
    // claimed — amber recColor, truth side honest "no merge on main yet".
    const claimed = renderStoryDossier({ story: { ...story, delivered: false, status: "done" } });
    expect(claimed).toContain('data-rung="claimed"');
    expect(claimed).toContain('border-left-color:#c77d12');
    expect(claimed).toContain("主干尚无合并");
    // merged — teal recColor.
    const merged = renderStoryDossier({ story, ladder: "merged", evidence: { report: false, acMap: true, visualEvidence: false } });
    expect(merged).toContain('data-rung="merged"');
    expect(merged).toContain('border-left-color:#0d9488');
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

  it("US-DOSSIER-023 AC4: a legacy card keeps the uniform muted spine — the three-state ladder never fakes progress on it", () => {
    const legacyFull = renderStoryDossier({ story: { ...story, legacy: true, delivered: true }, wish: "历史卡" });
    // no three-state delivery node — legacy nodes are all `.node.legacy`.
    expect(legacyFull).not.toContain("node claimed");
    expect(legacyFull).not.toContain("node merged");
    expect(legacyFull).not.toContain("node attested");
    expect(legacyFull).toContain("node legacy");
    // no claim↔truth reconciliation panel (nothing to reconcile pre-v3).
    expect(legacyFull).not.toContain('class="reconcile"');
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

  it("US-EVID-013: retrospective renders the structured Review Score summary, note link, dimensions, and trend", () => {
    const html = renderStoryDossier({
      story,
      reviewScore: {
        skill: "roll-build",
        score: 9,
        verdict: "good",
        ts: "2026-06-08T12:00:00Z",
        note: "证据链完整，门禁干净。",
        href: "notes/2026-06-08-roll-build-US-A-1.md",
        dimensions: { "test-quality": 8 },
        scoring: "pair",
        scoredBy: "kimi",
        sessionId: "c-a1:score:kimi:a1:1700000000",
      },
      reviewScoreTrend: "review-score: mean 8.0 / min 7 / redo 0 (last 14)",
    });
    expect(html).toContain("reviewscore-good");
    expect(html).toContain("<b>9</b>/10");
    expect(html).toContain("good");
    expect(html).toContain("证据链完整，门禁干净。");
    expect(html).toContain('href="notes/2026-06-08-roll-build-US-A-1.md"');
    expect(html).toContain("<code>test-quality</code>: <b>8</b>");
    expect(html).toContain("review-score: mean 8.0 / min 7 / redo 0 (last 14)");
    expect(storySpine({ story, reviewScore: { skill: "roll-build", score: 9, verdict: "good", ts: "", note: "" } })).toContain(
      "Retrospective",
    );
  });

  it("FIX-343 (AC6): the SINGLE peer Review Score block shows score/verdict/rationale, the Reviewer, AND the session id (independence visible); no SELF badge", () => {
    const html = renderStoryDossier({
      story,
      reviewScore: {
        skill: "roll-build",
        score: 8,
        verdict: "good",
        ts: "2026-06-13T12:00:00Z",
        note: "结对评委确认证据链完整。",
        href: "notes/2026-06-13-roll-build-US-A-1-pair.md",
        dimensions: { "test-quality": 8 },
        scoring: "pair",
        scoredBy: "kimi",
        sessionId: "c-a1:score:kimi:a1:1700000099",
      },
    });
    // ONE peer-review badge — never the old self/pair binary.
    expect(html).toContain('data-scoring="peer"');
    expect(html).toContain("score-kind-peerscore");
    expect(html).toContain("kimi"); // who graded it
    expect(html).toContain("Review Score — by peer Reviewer kimi");
    expect(html).toContain("评审分 —— 由评审 kimi 评判");
    // AC9: the Reviewer's fresh session id is rendered (independence is visible).
    expect(html).toContain("Reviewer session: c-a1:score:kimi:a1:1700000099");
    expect(html).toContain("<b>8</b>/10");
    expect(html).toContain("结对评委确认证据链完整。"); // rationale
    expect(html).toContain('href="notes/2026-06-13-roll-build-US-A-1-pair.md"'); // note link
    // No SELF / 自评 badge, no data-scoring="self", no selfscore-* class.
    expect(html).not.toContain('data-scoring="self"');
    expect(html).not.toContain("score-kind-selfscore");
    expect(html).not.toMatch(/class="[^"]*\bselfscore-/);
    expect(html).not.toContain(">SELF<");
    expect(html).not.toContain(">自评<");
  });

  it("FIX-343 (AC6): a LEGACY self note renders in a muted not-gating style, never the live peer block", () => {
    const html = renderStoryDossier({
      story,
      reviewScore: {
        skill: "roll-build",
        score: 7,
        verdict: "ok",
        ts: "2026-06-13T12:00:00Z",
        note: "历史自评留痕。",
        scoring: "self",
        fallbackReason: "pairing off (legacy note)",
      },
    });
    expect(html).toContain('data-scoring="self"');
    expect(html).toContain("score-kind-legacy");
    expect(html).toContain("Legacy self-grade (not gating)");
    expect(html).toContain("历史自评（不计入门禁）");
    expect(html).toContain("Recorded reason: pairing off (legacy note)");
    // A legacy self note is NOT the live peer block.
    expect(html).not.toContain('data-scoring="peer"');
    expect(html).not.toContain("Review Score — by peer Reviewer");
  });

  it("FIX-343 (AC6): no score at all renders an honest empty retrospective, never throwing", () => {
    const html = renderStoryDossier({ story });
    expect(html).toContain('data-phase="retrospective"');
    expect(html).toContain("Not yet written");
    // No score card is rendered (the `score-kind-*` strings still appear in the
    // always-emitted CSS rules, so assert on the rendered card markup instead).
    expect(html).not.toContain('data-scoring="peer"');
    expect(html).not.toContain('data-scoring="self"');
    expect(html).not.toContain('<span class="score-kind-badge');
  });

  it("FIX-343 (AC6): collected input lifts peer provenance (scoredBy + sessionId) from the score note's frontmatter", () => {
    const p = project();
    const card = join(p, ".roll", "features", "alpha", "US-A-1");
    mkdirSync(join(card, "notes"), { recursive: true });
    writeFileSync(
      join(card, "notes", "2026-06-13-roll-build-US-A-1-1.md"),
      "---\nskill: roll-build\nstory: US-A-1\nscore: 8\nverdict: good\nts: 2026-06-13T12:00:00Z\nscoring: pair\nscored-by: kimi\nsession-id: c1:score:kimi:a1:42\n---\n\n结对评委确认。\n",
    );
    const input = collectStoryDossierInput(p, { id: "US-A-1", epic: "alpha", type: "US", delivered: true });
    expect(input.reviewScore?.scoring).toBe("pair");
    expect(input.reviewScore?.scoredBy).toBe("kimi");
    expect(input.reviewScore?.sessionId).toBe("c1:score:kimi:a1:42");
  });

  it("FIX-343 (AC6): a legacy self note's provenance flows through to collected input (tolerated on read)", () => {
    const p = project();
    const card = join(p, ".roll", "features", "alpha", "US-A-1");
    mkdirSync(join(card, "notes"), { recursive: true });
    writeFileSync(
      join(card, "notes", "2026-06-13-roll-build-US-A-1-1.md"),
      "---\nskill: roll-build\nstory: US-A-1\nscore: 7\nverdict: ok\nts: 2026-06-13T12:00:00Z\nscoring: self\nfallback-reason: pairing off\n---\n\n自评留痕。\n",
    );
    const input = collectStoryDossierInput(p, { id: "US-A-1", epic: "alpha", type: "US", delivered: true });
    expect(input.reviewScore?.scoring).toBe("self");
    expect(input.reviewScore?.fallbackReason).toBe("pairing off");
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
    // US-DOSSIER-023: delivered:true with no on-disk attest evidence flags
    // falls back to the honest `merged` rung (never silently `attested`).
    expect(spine).toContain("node merged");
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

  it("renders the verify command inline within its AC block (US-DOSSIER-024: no separate Verify column)", () => {
    expect(html).toContain('class="ac-verify"');
    expect(html).toContain('data-ac="US-V-1:AC1"');
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
    // exactly one copy affordance (AC1), AC2 (readonly, no verify) carries none —
    // US-DOSSIER-024: the per-AC block simply omits the verify row, never invents one.
    expect(html.match(/data-copy=/g)).toHaveLength(1);
    expect(html.match(/class="ac-verify"/g)).toHaveLength(1); // only AC1 has a verify row
    expect(html).toContain('data-ac="US-V-1:AC2"'); // AC2 still renders as its own block
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
    // FIX-281: pin ROLL_HOME to a tmp dir so the US-DOSSIER-028 self-register
    // writes a sandbox registry, never the real ~/.roll/projects.json.
    const oldRollHome = process.env["ROLL_HOME"];
    const homeSandbox = realpathSync(mkdtempSync(join(tmpdir(), "roll-dossier-home-")));
    dirs.push(homeSandbox);
    process.env["ROLL_HOME"] = homeSandbox;
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
      if (oldRollHome === undefined) delete process.env["ROLL_HOME"];
      else process.env["ROLL_HOME"] = oldRollHome;
    }
    expect(out.join("")).toContain("Delivery Dossier regenerated");

    const idx = readFileSync(join(f, "index.html"), "utf8");
    const epic = readFileSync(join(f, "alpha", "index.html"), "utf8");
    const story = readFileSync(join(f, "alpha", "US-A-1", "index.html"), "utf8");
    // index → epic → story → back.
    expect(idx).toContain('href="alpha/index.html"');
    expect(epic).toContain('href="US-A-1/index.html"');
    expect(epic).toContain('href="../index.html#backlog"'); // breadcrumb root is the Backlog tab (US-DOSSIER-012)
    expect(story).toContain('href="../../index.html#backlog"');
    expect(story).toContain('href="../index.html"');
    // Story dossier carries the available delivery artifacts, but the delivered
    // banner waits for merge truth instead of treating attest presence as enough.
    expect(story).not.toContain('class="attest-banner"');
    expect(story).toContain("US-A-1:AC1");
    expect(story).toContain("✓ pass");
    // US-TRUTH-011 (re-frozen for the US-DOSSIER-011 console): the generated
    // front page consumes live audit/run/release facts via the ONE snapshot.
    expect(idx).toMatch(/data-truth="verdict"[^>]*>FAIL</); // audit fail:1 → FAIL
    expect(idx).toContain("v3.611.3");
    expect(idx).toContain("truth-board"); // waiver visible on the release tile
    expect(idx).toContain("$1.50");
    const m = /<script id="roll-truth" type="application\/json">\n([\s\S]*?)<\/script>/.exec(idx);
    const snap = JSON.parse((m?.[1] ?? "").replace(/<\\\//g, "</"));
    expect(snap.audit).toMatchObject({ fail: 1, warn: 2, unknown: 3 });
    expect(snap.cycle).toMatchObject({ cycles3d: 2, failed3d: 1, costUsd3d: 1.5 });
    expect(snap.generatedAt).toBe("2026-06-11T04:00:00Z");
  });
});

describe("US-META-008 — Review Score notes live in the card folder", () => {
  it("retro reads the card's notes/ first (card-local beats .roll/notes)", () => {
    const p = project();
    const card = join(p, ".roll", "features", "alpha", "US-A-1");
    mkdirSync(join(card, "notes"), { recursive: true });
    writeFileSync(
      join(card, "notes", "2026-06-08-roll-build-US-A-1-1.md"),
      "---\nscore: 9\nverdict: good\n---\n\nscore: 9\nverdict: good\n\n卡内评审正文。\n",
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
    expect(input.retro).toContain("卡内评审正文");
    expect(input.reviewScore?.score).toBe(9);
    expect(input.reviewScore?.href).toContain("notes/2026-06-08-roll-build-US-A-1-1.md");
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
    expect(input.reviewScore?.score).toBe(8);
  });

  it("US-EVID-013: collected Review Score carries dimensions and trend context", () => {
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
    expect(input.reviewScore?.dimensions).toEqual({ "test-quality": 6 });
    expect(input.reviewScoreTrend).toBe("review-score: mean 7.0 / min 5 / redo 1 (last 14)");
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

  it("US-DOSSIER-025: story rows carry the ladder rung (claimed/wip/hold/todo) + a lifecycle spine", () => {
    const html = renderFeaturesIndex(collectDossier(backlogProject()));
    // US-MIX-1 is backlog ✅ Done with NO merge evidence → `claimed` (a wish, not
    // truth) — the new honest rung, where the old vocabulary lumped it as unknown.
    expect(html).toContain('data-status="claimed"><span class="stype US">US</span><span class="sid">US-MIX-1</span>');
    expect(html).toContain('data-status="wip"><span class="stype FIX">FIX</span><span class="sid">FIX-MIX-2</span>');
    expect(html).toContain('data-status="hold"><span class="stype US">US</span><span class="sid">US-MIX-4</span>');
    expect(html).toContain('data-status="todo"><span class="stype US">US</span><span class="sid">US-MIX-3</span>');
    expect(html).toContain('class="lifespine');
  });
});

describe("US-DOSSIER-021 — per-story delivery ladder", () => {
  const full = { report: true, acMap: true, visualEvidence: true };
  const bare = { report: false, acMap: false, visualEvidence: false };

  it("attested = delivered AND full evidence (report + ac-map + screenshot)", () => {
    expect(deriveDeliveryLadder({ delivered: true, status: "done" }, full)).toBe("attested");
  });

  it("merged = delivered but missing some attest evidence (the honest middle rung)", () => {
    expect(deriveDeliveryLadder({ delivered: true, status: "done" }, { report: true, acMap: true, visualEvidence: false })).toBe("merged");
    expect(deriveDeliveryLadder({ delivered: true, status: "done" }, bare)).toBe("merged");
    // delivered even though the backlog claim is absent — merge truth promotes it.
    expect(deriveDeliveryLadder({ delivered: true }, full).startsWith("attest")).toBe(true);
  });

  it("claimed = backlog Done but NO merge evidence (a premature Done)", () => {
    expect(deriveDeliveryLadder({ delivered: false, status: "done" }, bare)).toBe("claimed");
    // evidence presence cannot lift a not-delivered card past claimed.
    expect(deriveDeliveryLadder({ delivered: false, status: "done" }, full)).toBe("claimed");
  });

  it("none = not even claimed done (todo / wip / hold / absent)", () => {
    expect(deriveDeliveryLadder({ delivered: false, status: "todo" }, bare)).toBe("none");
    expect(deriveDeliveryLadder({ delivered: false, status: "in_progress" }, bare)).toBe("none");
    expect(deriveDeliveryLadder({ delivered: false, status: "hold" }, full)).toBe("none");
    expect(deriveDeliveryLadder({ delivered: false }, bare)).toBe("none");
  });
});

describe("US-DOSSIER-021 — storyEvidenceFlags probes the card folder", () => {
  function evidenceProject(): string {
    const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-dossier-evid-")));
    dirs.push(p);
    const f = join(p, ".roll", "features");
    // US-E-1: full evidence — report + ac-map + a screenshot under latest/.
    const run = join(f, "evid", "US-E-1", "2026-06-01T00-00-00");
    mkdirSync(join(run, "screenshots"), { recursive: true });
    writeFileSync(join(run, "US-E-1-report.html"), "<html></html>");
    writeFileSync(join(run, "screenshots", "shot.png"), "png");
    symlinkSync(run, join(f, "evid", "US-E-1", "latest"));
    writeFileSync(join(f, "evid", "US-E-1", "ac-map.json"), JSON.stringify([{ ac: "AC1", status: "pass" }]));
    // US-E-2: report + ac-map but NO screenshot file (visualEvidence false).
    const run2 = join(f, "evid", "US-E-2", "2026-06-02T00-00-00");
    mkdirSync(run2, { recursive: true });
    writeFileSync(join(run2, "US-E-2-report.html"), "<html></html>");
    symlinkSync(run2, join(f, "evid", "US-E-2", "latest"));
    writeFileSync(join(f, "evid", "US-E-2", "ac-map.json"), JSON.stringify([{ ac: "AC1", status: "pass", kind: "screenshot" }]));
    // US-E-3: nothing on disk.
    mkdirSync(join(f, "evid", "US-E-3"), { recursive: true });
    return p;
  }

  it("sets each flag from a real artifact; a screenshot-kind ac-map row counts as visual", () => {
    const p = evidenceProject();
    const e1 = storyEvidenceFlags(p, { id: "US-E-1", epic: "evid", type: "US", delivered: true, legacy: false });
    expect(e1).toEqual({ report: true, acMap: true, visualEvidence: true });
    const e2 = storyEvidenceFlags(p, { id: "US-E-2", epic: "evid", type: "US", delivered: true, legacy: false });
    // no screenshot file, but ac-map carries a kind:"screenshot" row → visual true.
    expect(e2).toEqual({ report: true, acMap: true, visualEvidence: true });
    const e3 = storyEvidenceFlags(p, { id: "US-E-3", epic: "evid", type: "US", delivered: false, legacy: false });
    expect(e3).toEqual({ report: false, acMap: false, visualEvidence: false });
  });
});

// ── US-DOSSIER-024 — per-AC evidence blocks + observable-gap detection ────────
describe("US-DOSSIER-024 — per-AC evidence blocks", () => {
  const story = { id: "US-AC-1", epic: "alpha", type: "US", title: "AC story", created: "2026-06-13", delivered: true };

  it("parseAcEvidence: normalizes ac-map evidence (screenshot href, text textFile→href); drops malformed", () => {
    const ev = parseAcEvidence([
      { kind: "screenshot", label: "terminal capture", href: "screenshots/terminal.png" },
      { kind: "text", label: "source map", textFile: "evidence/source-map.txt" },
      { kind: "bogus", href: "x" }, // unknown kind dropped
      null, // null dropped
      "string", // non-object dropped
    ]);
    expect(ev).toEqual([
      { kind: "screenshot", label: "terminal capture", href: "screenshots/terminal.png" },
      { kind: "text", label: "source map", href: "evidence/source-map.txt" },
    ]);
    expect(parseAcEvidence(undefined)).toEqual([]);
    expect(parseAcEvidence("not-array")).toEqual([]);
  });

  it("classifyAc: a screenshot/cast evidence entry ⇒ observable; readonly status / doc copy ⇒ readonly", () => {
    expect(classifyAc({ ac: "X:AC1", status: "pass", evidence: [{ kind: "screenshot", href: "a.png" }] })).toBe("observable");
    expect(classifyAc({ ac: "X:AC2", status: "readonly" })).toBe("readonly");
    expect(classifyAc({ ac: "X:AC3", status: "pass", note: "renders the dashboard panel" })).toBe("observable");
    expect(classifyAc({ ac: "X:AC4", status: "pass", note: "writes a doc contract / 只读口径" })).toBe("readonly");
    // text-only evidence + ambiguous copy ⇒ readonly (doc/contract).
    expect(classifyAc({ ac: "X:AC5", status: "pass", evidence: [{ kind: "text", href: "d.txt" }] })).toBe("readonly");
  });

  it("acDisplayState (AC3 honesty): an OBSERVABLE AC with no screenshot/cast is DEMOTED to gap — never attested", () => {
    const observableNoShot = { ac: "X:AC1", status: "pass", note: "renders the spine" };
    expect(classifyAc(observableNoShot)).toBe("observable");
    expect(acHasVisualEvidence(observableNoShot, [])).toBe(false);
    expect(acDisplayState(observableNoShot, "observable", [])).toBe("gap");
    // a real screenshot file on disk backs it → attested-green, not gap.
    expect(acDisplayState(observableNoShot, "observable", ["latest/screenshots/spine.png"])).toBe("attested");
    // a screenshot evidence entry in ac-map also backs it.
    const withShot = { ac: "X:AC2", status: "pass", evidence: [{ kind: "screenshot" as const, href: "latest/screenshots/s.png" }] };
    expect(acDisplayState(withShot, "observable", [])).toBe("attested");
    // a READONLY AC may attest on doc/text evidence — never forced to gap.
    expect(acDisplayState({ ac: "X:AC3", status: "readonly" }, "readonly", [])).toBe("attested");
  });

  it("AC1: each AC is its OWN block — AC id + status badge + inline evidence beneath it (no flat table)", () => {
    const html = renderStoryDossier({
      story,
      acRows: [
        { ac: "US-AC-1:AC1", status: "pass", note: "renders the page", evidence: [{ kind: "screenshot", label: "live render", href: "latest/screenshots/page.png" }] },
        { ac: "US-AC-1:AC2", status: "readonly", note: "doc contract", evidence: [{ kind: "text", label: "source map", href: "latest/evidence/map.txt" }] },
      ],
      screenshotFiles: ["latest/screenshots/page.png"],
    });
    // each AC is its own block, addressable by data-ac
    expect(html).toContain('class="ac-blocks"');
    expect(html).toContain('data-ac="US-AC-1:AC1"');
    expect(html).toContain('data-ac="US-AC-1:AC2"');
    // the old flat table markup is gone
    expect(html).not.toContain('class="ac-table"');
    // AC1's inline screenshot thumbnail renders BENEATH it (real-pixel proof)
    expect(html).toContain('class="ac-shot"');
    expect(html).toContain('<img src="latest/screenshots/page.png"');
    // FIX-285: text evidence no longer renders as a click-through doc link.
    // Ad-hoc render inputs with no hydrated body show an honest empty state.
    expect(html).not.toContain('class="ac-evlink ac-ev-doc"');
    expect(html).not.toContain('href="latest/evidence/map.txt"');
    expect(html).toContain("Text evidence unavailable");
  });

  it("AC2: observable vs readonly class chip is labelled on each block", () => {
    const html = renderStoryDossier({
      story,
      acRows: [
        { ac: "US-AC-1:AC1", status: "pass", evidence: [{ kind: "screenshot", href: "latest/screenshots/a.png" }] },
        { ac: "US-AC-1:AC2", status: "readonly", note: "doc only" },
      ],
      screenshotFiles: ["latest/screenshots/a.png"],
    });
    expect(html).toContain('class="ac-kind ac-kind-obs"');
    expect(html).toContain("observable");
    expect(html).toContain("可观测");
    expect(html).toContain('class="ac-kind ac-kind-ro"');
    expect(html).toContain("readonly");
    expect(html).toContain("只读");
  });

  it("AC3: an observable AC WITHOUT a screenshot shows an evidence-gap chip and is NOT attested", () => {
    const html = renderStoryDossier({
      story,
      acRows: [{ ac: "US-AC-1:AC1", status: "pass", note: "renders the truth banner" }], // observable copy, no screenshot
      // no screenshotFiles
    });
    expect(html).toContain('class="ac-gap-chip"');
    expect(html).toContain("evidence gap");
    expect(html).toContain("证据缺口");
    expect(html).toContain("ac-state-gap");
    // the demoted block must NOT wear the attested truth-green badge / ✓ pass
    expect(html).not.toContain("✓ pass");
    expect(html).toContain("◇ unproven");
    expect(html).toContain("◇ 未证实");
    // readonly ACs are never forced to gap — they may attest on doc/text evidence.
    const ro = renderStoryDossier({ story, acRows: [{ ac: "US-AC-1:AC9", status: "readonly", note: "doc contract" }] });
    expect(ro).not.toContain("evidence gap");
    expect(ro).toContain("◆ readonly");
  });

  it("AC4: AC block accent + gap colors align with the three-state spine ladder (claimed/merged/attested)", () => {
    const html = renderStoryDossier({
      story,
      acRows: [
        { ac: "US-AC-1:AC1", status: "pass", evidence: [{ kind: "screenshot", href: "latest/screenshots/a.png" }] }, // attested → truth-green
        { ac: "US-AC-1:AC2", status: "partial", note: "doc partial" }, // merged → attest-pending teal
        { ac: "US-AC-1:AC3", status: "claimed", note: "doc claim" }, // claimed → amber
      ],
      screenshotFiles: ["latest/screenshots/a.png"],
    });
    expect(html).toContain("border-left-color:#178a52"); // attested truth-green (US-DOSSIER-023 ladder)
    expect(html).toContain("border-left-color:#0d9488"); // merged attest-pending teal
    expect(html).toContain("border-left-color:#c77d12"); // claimed claim-amber
    // EN/中 on separate lines via bi() — the gap chip carries both, not inline.
    const gap = renderStoryDossier({ story, acRows: [{ ac: "US-AC-1:AC4", status: "pass", note: "renders a panel" }] });
    expect(gap).toContain("evidence gap");
    expect(gap).toContain("证据缺口");
  });

  it("collectStoryDossierInput: threads ac-map evidence[] + on-disk screenshots into the dossier input", () => {
    const p = project();
    const storyDir = join(p, ".roll", "features", "alpha", "US-AC-7");
    const dir = join(storyDir, "2026-06-13T00-00-00");
    mkdirSync(join(dir, "screenshots"), { recursive: true });
    writeFileSync(join(dir, "screenshots", "render.png"), "PNGDATA");
    symlinkSync(dir, join(storyDir, "latest"));
    // FIX-282: a `../screenshots/x` ac-map href is STORY-LEVEL — the file lives at
    // the story root, NOT the run dir. Mirror that on disk.
    mkdirSync(join(storyDir, "screenshots"), { recursive: true });
    writeFileSync(join(storyDir, "screenshots", "render.png"), "PNGDATA");
    writeFileSync(
      join(storyDir, "ac-map.json"),
      JSON.stringify([
        { ac: "US-AC-7:AC1", status: "pass", evidence: [{ kind: "screenshot", label: "render", href: "../screenshots/render.png" }] },
      ]),
    );
    const got = collectStoryDossierInput(p, { id: "US-AC-7", epic: "alpha", type: "US", delivered: true });
    // FIX-282: the run-dir-relative `../screenshots/x` is re-based to the STORY
    // ROOT (`screenshots/x`) so the `<img>` on the story page resolves.
    expect(got.acRows?.[0]?.evidence).toEqual([{ kind: "screenshot", label: "render", href: "screenshots/render.png" }]);
    expect(got.screenshotFiles).toEqual(["latest/screenshots/render.png"]);
  });

  it("FIX-285: text evidence renders inline from the evidence file while screenshots stay thumbnails", () => {
    const p = project();
    const storyDir = join(p, ".roll", "features", "alpha", "US-AC-TEXT");
    const runDir = join(storyDir, "2026-06-15T00-00-00");
    mkdirSync(join(runDir, "evidence"), { recursive: true });
    mkdirSync(join(runDir, "screenshots"), { recursive: true });
    writeFileSync(join(runDir, "evidence", "vitest.txt"), "Vitest says <green> & stable\n");
    writeFileSync(join(runDir, "screenshots", "page.png"), "PNGDATA");
    symlinkSync(runDir, join(storyDir, "latest"));
    writeFileSync(
      join(storyDir, "ac-map.json"),
      JSON.stringify([
        {
          ac: "US-AC-TEXT:AC1",
          status: "readonly",
          evidence: [
            { kind: "text", label: "vitest output", textFile: "evidence/vitest.txt" },
            { kind: "screenshot", label: "page", href: "screenshots/page.png" },
          ],
        },
        {
          ac: "US-AC-TEXT:AC2",
          status: "readonly",
          evidence: [{ kind: "text", label: "missing log", textFile: "evidence/missing.txt" }],
        },
      ]),
    );

    const input = collectStoryDossierInput(p, { id: "US-AC-TEXT", epic: "alpha", type: "US", delivered: true });
    const html = renderStoryDossier(input);

    expect(html).toContain('<details class="ac-text-evidence">');
    expect(html).toContain("<summary>vitest output</summary>");
    expect(html).toContain("Vitest says &lt;green&gt; &amp; stable");
    expect(html).not.toContain('href="latest/evidence/vitest.txt"');
    expect(html).toContain('class="ac-shot"');
    expect(html).toContain('<img src="latest/screenshots/page.png"');
    expect(html).toContain('class="ac-evidence-empty"');
    expect(html).toContain("Text evidence unavailable");
  });
});

// ── FIX-282 — story-dossier evidence hrefs re-based to the story root ─────────
describe("FIX-282 — story-page evidence hrefs resolve from the story root", () => {
  it("rebaseEvidenceHrefToStoryRoot: story-level `../` is stripped; run-dir-local is via latest/; off-tree untouched", () => {
    // STORY-LEVEL (`../acceptance|screenshots|evidence/x`) lives at the story
    // root → strip the run-dir `../` so the story page reaches it directly.
    expect(rebaseEvidenceHrefToStoryRoot("../acceptance/print.png")).toBe("acceptance/print.png");
    expect(rebaseEvidenceHrefToStoryRoot("../screenshots/mobile.png")).toBe("screenshots/mobile.png");
    expect(rebaseEvidenceHrefToStoryRoot("../evidence/vitest-report.txt")).toBe("evidence/vitest-report.txt");
    // RUN-DIR-LOCAL (no `../`) lives under `<ts>/` → reach the live run dir via
    // the `latest/` symlink from the story root.
    expect(rebaseEvidenceHrefToStoryRoot("screenshots/terminal.png")).toBe("latest/screenshots/terminal.png");
    expect(rebaseEvidenceHrefToStoryRoot("evidence/source-map.txt")).toBe("latest/evidence/source-map.txt");
    // Already story-root-correct / off-tree refs are left untouched.
    expect(rebaseEvidenceHrefToStoryRoot("latest/screenshots/x.png")).toBe("latest/screenshots/x.png");
    expect(rebaseEvidenceHrefToStoryRoot("https://github.com/seanyao/roll/pull/6")).toBe("https://github.com/seanyao/roll/pull/6");
    expect(rebaseEvidenceHrefToStoryRoot("/abs/path.png")).toBe("/abs/path.png");
    // No re-based href ever keeps an out-of-root `../` segment.
    for (const h of ["../acceptance/a.png", "../screenshots/b.png", "screenshots/c.png", "latest/d.png"]) {
      expect(rebaseEvidenceHrefToStoryRoot(h).startsWith("../")).toBe(false);
    }
  });

  it("AC1+AC2+AC4: a story-level screenshot href resolves to an EXISTING file from the story root (no out-of-root `../`)", () => {
    const p = project();
    const storyDir = join(p, ".roll", "features", "alpha", "US-FIX-282");
    // A real run dir + `latest/` symlink, plus story-level acceptance/ pixels —
    // the exact shape that broke 125 of 164 `<img>` refs.
    const runDir = join(storyDir, "2026-06-13T10-00-00");
    mkdirSync(runDir, { recursive: true });
    symlinkSync(runDir, join(storyDir, "latest"));
    mkdirSync(join(storyDir, "acceptance"), { recursive: true });
    writeFileSync(join(storyDir, "acceptance", "print.png"), "PNGDATA");
    writeFileSync(join(storyDir, "acceptance", "mobile-390.png"), "PNGDATA");
    writeFileSync(
      join(storyDir, "ac-map.json"),
      JSON.stringify([
        {
          ac: "US-FIX-282:AC1",
          status: "pass",
          evidence: [
            { kind: "screenshot", label: "print form", href: "../acceptance/print.png" },
            { kind: "screenshot", label: "mobile form", href: "../acceptance/mobile-390.png" },
          ],
        },
      ]),
    );
    const story = { id: "US-FIX-282", epic: "alpha", type: "US" as const, delivered: true };
    const input = collectStoryDossierInput(p, story);
    const ev = input.acRows?.[0]?.evidence ?? [];
    expect(ev.length).toBe(2);
    for (const e of ev) {
      const href = e.href ?? "";
      // AC1: re-based href never escapes the story root with `../`.
      expect(href.startsWith("../")).toBe(false);
      // AC4: the re-based href points at a file that actually exists, resolved
      // from the STORY ROOT (where index.html lives).
      expect(existsSync(join(storyDir, href))).toBe(true);
    }
    // AC2: every `<img>` src the renderer emits resolves to an existing file
    // when read relative to the story root — zero broken images.
    const html = renderStoryDossier(input);
    const imgSrcs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(imgSrcs.length).toBeGreaterThan(0);
    for (const src of imgSrcs) {
      if (/^[a-z]+:/i.test(src) || src.startsWith("/")) continue; // off-tree
      expect(src.startsWith("../")).toBe(false);
      expect(existsSync(join(storyDir, src))).toBe(true);
    }
  });
});
