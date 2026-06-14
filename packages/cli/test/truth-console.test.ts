/**
 * US-DOSSIER-011 — the Truth Console shell + Overview. Numbers come from the
 * ONE TruthSnapshot; tabs are hash-routed; brand is injected; copy is fully
 * bilingual (single-language presentation via roll-lang).
 */
import { describe, expect, it } from "vitest";
import { serializeTruthSnapshot, type TruthSnapshot } from "@roll/spec";
import { renderTruthConsole, renderMachineStubPage, rollScope, type ProjectRegistryEntry } from "../src/lib/truth-console.js";
import { renderAgentsMachinePage } from "../src/lib/page-agents.js";
import { renderSkillsPage } from "../src/lib/page-skills.js";
import { collectLoopHeartbeat } from "../src/lib/loop-heartbeat.js";
import { collectCasting } from "../src/lib/casting.js";
import { collectGitHooks, type GitHooksVM } from "../src/lib/git-hooks.js";
import { parseProjectsRegistry, reachableProjects } from "../src/lib/projects-registry.js";

const SNAP: TruthSnapshot = {
  generatedAt: "2026-06-13T00:00:00Z",
  collectedAt: "2026-06-12T23:00:00Z",
  story: { total: 10, spectrum: { done: 5, wip: 1, hold: 1, todo: 2, fail: 0, unknown: 1 }, legacy: 3 },
  audit: { fail: 0, warn: 2, unknown: 1 },
  cycle: { cycles3d: 7, failed3d: 2, costUsd3d: 1.5 },
  release: { latestTag: "v3.612.2", verdict: "pass" },
  loop: { lanes: [{ name: "loop", running: true, mode: "cron", everyMin: 60, lastAt: "2026-06-12T23:30:00Z", nextAt: "2026-06-13T00:30:00Z" }] },
};

const SPINE = ["definition", "design", "execution", "delivery", "retrospective"];
const BACKLOG = {
  shipping: [
    {
      name: "alpha",
      done: 1,
      total: 3,
      stories: [
        { id: "US-A-1", epic: "alpha", type: "US", title: "first", state: "done" as const, legacy: false, stages: SPINE },
        { id: "FIX-9", epic: "alpha", type: "FIX", title: "fix it", state: "todo" as const, legacy: false, stages: ["definition"] },
        { id: "US-A-2", epic: "alpha", type: "US", title: "old one", state: "done" as const, legacy: true, stages: [] },
      ],
    },
  ],
  settled: [
    { name: "omega", done: 1, total: 1, stories: [{ id: "US-O-1", epic: "omega", type: "US", title: "settled", state: "done" as const, legacy: false, stages: SPINE }] },
  ],
};

const AGENTS = [
  {
    name: "claude", display: "claude", runner: "Claude Code", version: "2.1.0", installed: true,
    cycles72h: 4, costUsd72h: 1.25,
    files: [{ path: "/home/u/.claude/CLAUDE.md", kind: "CLAUDE.md", state: "sync" as const }],
    syncStale: false,
  },
  {
    name: "kimi", display: "kimi", runner: "Kimi CLI", version: "—", installed: true,
    cycles72h: 1, costUsd72h: 0.1,
    files: [{ path: "/home/u/.kimi/AGENTS.md", kind: "AGENTS.md", state: "stale" as const }],
    syncStale: true, setupCmd: "roll setup -f kimi",
  },
  {
    name: "trae", display: "trae", runner: "trae CLI", version: "—", installed: false,
    cycles72h: 0, costUsd72h: 0, files: [], syncStale: false,
  },
];

const SKILLS = {
  summary: { skills: 2, violations: 0 as number | "unknown", hubLines: 110, auditRan: true },
  groups: [
    { key: "delivery" as const, rows: [{
      name: "roll-build", group: "delivery" as const, hubLines: 60, description: "Load when shipping a story",
      violations: [], auditKnown: true, hasGotchas: true, hasLoadTrigger: true, routeCases: { positive: 2, negative: 2 },
      usage: 7, files: [{ path: "SKILL.md", lines: 60, dir: false }, { path: "references/", lines: 0, dir: true }, { path: "references/full-contract.md", lines: 900, dir: false }],
      dirPath: "/repo/skills/roll-build", hubText: "# Roll Build\nhub text here",
    }] },
    { key: "quality" as const, rows: [{
      name: "roll-.review", group: "quality" as const, hubLines: 50, description: "Load when reviewing",
      violations: [], auditKnown: true, hasGotchas: true, hasLoadTrigger: true, routeCases: { positive: 2, negative: 2 },
      usage: 0, files: [{ path: "SKILL.md", lines: 50, dir: false }], dirPath: "/repo/skills/roll-.review", hubText: "# Review",
    }] },
    { key: "observe" as const, rows: [] },
    { key: "lifecycle" as const, rows: [] },
  ],
};

// US-DOSSIER-030 — Casting view-model: the four complexity slots fully resolved
// (with one route-resolve audit rationale on `hard`) + the four scenario rows.
const CASTING = collectCasting({
  readSlot: (slot) => ({ easy: "kimi", default: "codex", hard: "claude", fallback: "claude" })[slot],
  sparPair: () => ["claude", "kimi"],
  onboardClient: () => undefined,
  routeAudit: (slot) => (slot === "hard" ? "claude best for US in-tier (hit_rate 0.91, n=12); slot kept" : undefined),
});

const GIT_HOOKS: GitHooksVM = {
  hooksPath: "hooks",
  configured: true,
  rows: [
    { name: "pre-commit", descEn: "TCR proof gate before commit", descZh: "提交前 TCR 测试证明闸", path: "hooks/pre-commit" },
    { name: "prepare-commit-msg", descEn: "append AI co-author trailer", descZh: "追加 AI 协作者 trailer", path: "hooks/prepare-commit-msg" },
  ],
};

// US-DOSSIER-033 — Charter browser view-model: a charter group (docs), a guide
// group with one bilingual guide/en↔zh pair, and an epic-plans group.
const CHARTER = {
  defaultId: "docs/manifesto.md",
  groups: [
    {
      key: "charter" as const,
      docs: [
        { id: "docs/manifesto.md", path: "docs/manifesto.md", title: "Manifesto", bodyEn: "<h1>Manifesto</h1><p>main is truth</p>", bodyZh: "<h1>Manifesto</h1><p>main is truth</p>", bilingual: false },
        { id: "docs/architecture.md", path: "docs/architecture.md", title: "Architecture", bodyEn: "<h1>Architecture</h1>", bodyZh: "<h1>Architecture</h1>", bilingual: false },
      ],
    },
    {
      key: "guide" as const,
      docs: [
        { id: "guide/INDEX.md", path: "guide/INDEX.md", title: "Documentation Index", bodyEn: "<h1>Documentation Index</h1>", bodyZh: "<h1>Documentation Index</h1>", bilingual: false },
        { id: "guide/en/loop.md", path: "guide/en/loop.md", title: "roll loop", bodyEn: "<h1>roll loop EN body</h1>", bodyZh: "<h1>roll loop ZH 正文</h1>", bilingual: true },
      ],
    },
    {
      key: "plans" as const,
      docs: [{ id: ".roll/features/delivery-dossier/truth-console.md", path: ".roll/features/delivery-dossier/truth-console.md", title: "Truth Console plan", bodyEn: "<h1>Plan</h1>", bodyZh: "<h1>Plan</h1>", bilingual: false }],
    },
  ],
};

const RELEASE_SCOPE = {
  pending: [
    { epic: "alpha", items: [{ id: "FIX-9", epic: "alpha", title: "fix it", state: "todo" }] },
  ],
  shipped: [
    { epic: "alpha", items: [{ id: "US-A-1", epic: "alpha", title: "first", state: "done", prNumber: 638 }] },
  ],
  pendingCount: 5,
  shippedCount: 5,
  history: [
    { tag: "v3.612.2", date: "2026-06-12", waived: false, items: ["item one"] },
    { tag: "v3.611.2", date: "2026-06-11", waived: true, items: ["older"] },
  ],
};

const RELEASE_PANEL = {
  dims: [
    { key: "code-backlog" as const, tally: { fail: 1, warn: 2, unknown: 3, subjects: ["US-X-1"] } },
    { key: "cards" as const, tally: { fail: 0, warn: 1, unknown: 0, subjects: ["US-X-2"] } },
    { key: "docs" as const, tally: { fail: 0, warn: 0, unknown: 1, subjects: ["FIX-9"] } },
    { key: "tests" as const, tally: { fail: 0, warn: 0, unknown: 0, subjects: [] } },
    { key: "bilingual" as const, tally: { fail: 0, warn: 0, unknown: 0, subjects: [] } },
    { key: "site" as const, tally: { fail: 0, warn: 0, unknown: 0, subjects: [] } },
  ],
  total: { fail: 1, warn: 3, unknown: 4 },
  blocking: true,
  generatedAt: "2026-06-12T00:00:00Z",
  prevTag: "v3.612.1",
};

const CYCLES = [
  {
    cycleId: "20260612-x-1234", tsSec: 1781230000, verdict: "delivered" as const, storyId: "US-A-1", agent: "claude",
    model: "claude", tokens: "1k/400", cost: "$0.42", duration: "1m35s",
    tape: [
      { key: "cycle" as const, detail: "2026-06-12 01:00Z", state: "pass" as const },
      { key: "story" as const, detail: "US-A-1", state: "pass" as const },
      { key: "build" as const, detail: "5 commits", state: "pass" as const },
      { key: "peer" as const, detail: "refine", state: "pass" as const },
      { key: "ci" as const, detail: "attest ✓", state: "pass" as const },
      { key: "pr" as const, detail: "#123 merged", state: "pass" as const },
      { key: "end" as const, detail: "delivered", state: "pass" as const },
    ],
    evidence: [{ label: "US-A-1", href: "#backlog" }],
  },
  {
    cycleId: "20260612-x-9999", tsSec: 1781230100, verdict: "reverted" as const, storyId: "", agent: "pi",
    model: "pi", tokens: "—", cost: "—", duration: "—",
    tape: [], evidence: [],
  },
];

function render(
  snapshot: TruthSnapshot = SNAP,
  extra: { projects?: ProjectRegistryEntry[]; currentSlug?: string } = {},
): string {
  return renderTruthConsole({
    snapshot,
    snapshotJson: serializeTruthSnapshot(snapshot),
    brand: { name: "roll", slogan: "It just works." },
    backlog: BACKLOG,
    spineKeys: SPINE,
    cycles: CYCLES,
    agents: AGENTS,
    releasePanel: RELEASE_PANEL,
    releaseScope: RELEASE_SCOPE,
    githubSlug: "seanyao/roll",
    skills: SKILLS,
    casting: CASTING,
    gitHooks: GIT_HOOKS,
    charter: CHARTER,
    ...extra,
  });
}

describe("renderTruthConsole — US-DOSSIER-011", () => {
  const html = render();

  // US-DOSSIER-040: the canonical PROJECT tab order is fixed by the CORRECT
  // design reference's nav markup (Delivery Dossier.dc.html `<!-- tabs -->`,
  // tabIndex/tabContext/tabEpics/tabLoop/tabRelease/tabCasting): Overview →
  // Charter → Backlog → Loop → Release → Casting. Skills/Agents/Conventions/
  // About are MACHINE-GLOBAL (the MACHINE breadcrumb), never project tabs. The
  // rendered bar, the panes, and the CONSOLE_SCRIPT router all read ONE shared
  // TABS constant, anchoring all three.
  const DC_TAB_ORDER = ["overview", "charter", "backlog", "loop", "release", "casting"] as const;

  it("AC1: hash-routed tabs in the design-reference order, overview first, Skills not a project tab", () => {
    for (const k of DC_TAB_ORDER) {
      expect(html).toContain(`data-tab="${k}"`);
      expect(html).toContain(`id="tab-${k}"`);
    }
    // Render bar order == pane order == router key order, all from one source.
    const barOrder = [...html.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]);
    expect(barOrder).toEqual([...DC_TAB_ORDER]);
    const paneOrder = [...html.matchAll(/id="tab-([a-z]+)"/g)].map((m) => m[1]);
    expect(paneOrder).toEqual([...DC_TAB_ORDER]);
    // AC5: the router derives its key list from the same constant — no hand-copied
    // literal — so the serialized array equals the canonical order exactly.
    const scriptTabs = /var TABS = (\[[^\]]*\]);/.exec(html);
    expect(JSON.parse(scriptTabs?.[1] ?? "[]")).toEqual([...DC_TAB_ORDER]);
    expect(html).toContain("hashchange"); // tab state survives drill-down via hash
    // US-DOSSIER-040: Casting is its OWN project tab; Skills is NOT a project tab
    // (it stays machine-global, reached via the MACHINE breadcrumb → skills.html).
    expect(barOrder).toContain("casting");
    expect(barOrder).not.toContain("skills"); // no Skills PROJECT tab
    expect(html).not.toContain('data-tab="skills"');
    expect(html).not.toContain('id="tab-skills"');
    expect(JSON.parse(scriptTabs?.[1] ?? "[]")).not.toContain("skills"); // router has no skills key
    // the machine Skills breadcrumb still routes to the machine-global page
    expect(html).toContain('data-machine="skills"');
    expect(html).toContain('href="skills.html"');
  });

  it("AC2: brand name + slogan are injected, not hardcoded", () => {
    const custom = renderTruthConsole({
      snapshot: SNAP,
      snapshotJson: serializeTruthSnapshot(SNAP),
      brand: { name: "acme", slogan: "Ship truth." },
      backlog: { shipping: [], settled: [] },
      spineKeys: SPINE,
      cycles: [],
      agents: [],
      releasePanel: { dims: [], total: { fail: 0, warn: 0, unknown: 0 }, blocking: false },
      releaseScope: { pending: [], shipped: [], pendingCount: 0, shippedCount: 0, history: [] },
      skills: { summary: { skills: 0, violations: 0, hubLines: 0, auditRan: true }, groups: [] },
      casting: collectCasting({ readSlot: () => undefined }),
      gitHooks: { hooksPath: "hooks", configured: false, rows: [] },
      charter: { groups: [] },
    });
    expect(custom).toContain("acme");
    expect(custom).toContain("Ship truth.");
    expect(custom).not.toContain("It just works.");
  });

  it("AC3: overview carries verdict, heartbeat, three tiles and the spectrum", () => {
    expect(html).toContain('data-truth="verdict"');
    expect(html).toMatch(/data-truth="verdict"[^>]*>WARN</); // warn=2 → WARN
    expect(html).toContain("循环心跳");
    expect(html).toContain("1/1"); // running lanes
    expect(html).toContain('data-tab-link="backlog"');
    expect(html).toContain('data-tab-link="loop"');
    expect(html).toContain('data-tab-link="release"');
    for (const k of ["done", "fail", "unknown", "wip", "todo", "hold"]) expect(html).toContain(`data-truth="spectrum-${k}"`);
    expect(html).toContain('data-prefilter="done"'); // spectrum click pre-sets the backlog filter
  });

  it("AC4: bilingual spans everywhere new copy appears; telemetry is monospace", () => {
    expect(html).toContain('class="lang-en"');
    expect(html).toContain('class="lang-zh"');
    expect(html).toContain("真相判定");
    expect(html).toContain("Truth verdict");
    expect(html).toContain("IBM Plex Mono");
    expect(html).toContain('data-set-lang="en"');
    expect(html).toContain('data-set-lang="zh"');
  });

  it("AC5: every rendered number equals the snapshot (and the embed is the same serialization)", () => {
    const m = /<script id="roll-truth" type="application\/json">\n([\s\S]*?)<\/script>/.exec(html);
    const embedded = JSON.parse((m?.[1] ?? "").replace(/<\\\//g, "</")) as TruthSnapshot;
    expect(embedded).toEqual(SNAP);
    for (const k of ["done", "fail", "unknown", "wip", "todo", "hold"] as const) {
      const dm = new RegExp(`data-truth="spectrum-${k}"[^>]*>(\\d+)<`).exec(html);
      expect(Number(dm?.[1]), k).toBe(SNAP.story.spectrum[k]);
    }
    expect(new RegExp('data-truth="total"[^>]*>10 ').test(html)).toBe(true);
    const pct = /data-truth="merged-pct"[^>]*>(\d+)%/.exec(html);
    expect(Number(pct?.[1])).toBe(50);
  });
});

describe("collectLoopHeartbeat — US-DOSSIER-011", () => {
  it("reads plist presence, period, last run; derives next; off lanes stay visible", () => {
    const hb = collectLoopHeartbeat({
      plistText: (svc) =>
        svc === "loop" ? "<key>StartInterval</key>\n<integer>3600</integer>" : null,
      lastRunAt: () => "2026-06-12T23:30:00Z",
    });
    expect(hb.lanes).toHaveLength(2);
    const loop = hb.lanes[0];
    expect(loop?.running).toBe(true);
    expect(loop?.everyMin).toBe(60);
    expect(loop?.lastAt).toBe("2026-06-12T23:30:00Z");
    expect(loop?.nextAt).toBe("2026-06-13T00:30:00Z");
    expect(hb.lanes[1]?.running).toBe(false);
  });

  it("never throws on a machine with nothing scheduled", () => {
    const hb = collectLoopHeartbeat({ plistText: () => null, lastRunAt: () => null });
    expect(hb.lanes.every((l) => !l.running)).toBe(true);
  });
});

describe("backlog tab — US-DOSSIER-012", () => {
  const html = render();

  it("AC1: wish header with bilingual kicker + lede", () => {
    expect(html).toContain("Wishes, not yet truth");
    expect(html).toContain("愿望，尚未成真");
    expect(html).toContain("直到主干证明它合并才算完成");
  });

  it("AC2: search box + six state chips + prefilter hash route", () => {
    expect(html).toContain('id="bl-search"');
    for (const k of ["done", "fail", "unknown", "wip", "todo", "hold"]) expect(html).toContain(`data-filter="${k}"`);
    expect(html).toContain('href="#backlog/done"'); // spectrum tally pre-sets the filter
    expect(html).toContain("applyPrefilter"); // hash → chip activation script
  });

  it("AC3: epic accordions grouped shipping/settled; story rows carry type·id·title·spine·claim↔truth", () => {
    expect(html).toContain("Shipping to main");
    expect(html).toContain("Settled on main");
    expect(html).toContain('data-epic="alpha"');
    expect(html).toContain('data-epic="omega"');
    expect(html).toContain('href="alpha/US-A-1/index.html"'); // row click → story dossier
    expect(html).toContain('href="alpha/index.html"'); // epic name → epic page
    expect(html).toContain(">US<"); // type badge
    expect(html).toContain(">FIX<");
    expect(html).toContain("truth ✓");
    expect(html).toContain(">legacy<"); // legacy chip instead of a fake truth
    expect(html).toMatch(/data-state="todo"/);
  });

  it("AC5: backlog rows tally to the snapshot story total by construction", () => {
    const rows = html.match(/class="bl-row"/g) ?? [];
    const total = BACKLOG.shipping.concat(BACKLOG.settled).reduce((a, e) => a + e.stories.length, 0);
    expect(rows.length).toBe(total);
  });
});

describe("loop tab cycle ledger — US-DOSSIER-013", () => {
  const html = render();

  it("AC1: range buttons Today/3d/7d/All with live count recompute script", () => {
    for (const r of ["1", "3", "7", "all"]) expect(html).toContain(`data-range="${r}"`);
    expect(html).toContain('id="cy-count"');
    expect(html).toContain('id="cy-failed"');
    expect(html).toContain("applyRange");
  });

  it("AC2/AC4: rows carry verdict dot + CLI vocabulary + telemetry columns", () => {
    expect(html).toContain('data-verdict="delivered"');
    expect(html).toContain('data-verdict="reverted"');
    expect(html).toContain("已回滚"); // bilingual verdict
    expect(html).toContain("1k/400");
    expect(html).toContain("$0.42");
    expect(html).toContain("1m35s");
  });

  it("AC3: expanded row shows the seven-segment tape with facts + evidence chips", () => {
    for (const k of ["cycle", "story", "build", "peer", "ci", "pr", "end"]) expect(html).toContain(`>${k}<`);
    expect(html).toContain("5 commits");
    expect(html).toContain("#123 merged");
    expect(html).toContain("attest ✓");
    expect(html).toContain('href="#backlog"');
  });

  it("failed counter script counts failed+reverted+blocked (never swallowed)", () => {
    expect(html).toContain('v === "failed" || v === "reverted" || v === "blocked"');
  });
});

describe("loop tab cycle ledger — FIX-297", () => {
  // A real cycleId is YYYYMMDD-HHMMSS-PID; `.slice(-6)` used to grab the `-`
  // separator and render a fake negative "-32144".
  const REAL_ID = "20260614-020436-32144";
  const html = render();
  const withReal = renderTruthConsole({
    snapshot: SNAP,
    snapshotJson: serializeTruthSnapshot(SNAP),
    brand: { name: "roll", slogan: "It just works." },
    backlog: BACKLOG,
    spineKeys: SPINE,
    cycles: [
      {
        cycleId: REAL_ID, tsSec: 1781230000, verdict: "delivered" as const, storyId: "US-A-1", agent: "claude",
        model: "claude", tokens: "1k/400", cost: "$0.42", duration: "1m35s",
        tape: [], evidence: [],
      },
    ],
    agents: AGENTS,
    releasePanel: RELEASE_PANEL,
    releaseScope: RELEASE_SCOPE,
    githubSlug: "seanyao/roll",
    skills: SKILLS,
    casting: CASTING,
    charter: CHARTER,
  });

  it("AC1: the displayed handle is the trailing digit run — never a fake negative", () => {
    // The handle span shows 32144 with NO leading separator…
    expect(withReal).toContain(">32144<");
    // …and the copy-chip (roll cycle <handle>) resolves the SAME handle.
    expect(withReal).toContain("roll cycle 32144");
    // The fake "-NNNNN" the old `.slice(-6)` produced must never be DISPLAYED.
    // (The full cycleId legitimately contains "-32144" in its data attributes;
    //  what must be gone is the rendered handle "-32144" and "roll cycle -32144".)
    expect(withReal).not.toContain(">-32144<");
    expect(withReal).not.toContain("roll cycle -32144");
  });

  it("AC2: the ledger opens on a count-capped 'recent' window (not all history)", () => {
    // A new default range exists and is the one toggled on at render time…
    expect(html).toContain('data-range="recent"');
    expect(html).toContain('class="cy-range on" data-range="recent"');
    // …and the page boots into it, not the old 3-day default.
    expect(html).toContain('applyRange("recent")');
    expect(html).not.toContain('applyRange("3")');
    // The count cap is real (newest N), expandable to the full history via "all".
    expect(html).toContain("RECENT_CAP");
    expect(html).toContain('data-range="all"');
  });

  it("AC2: failures stay first-class — always shown, counted over the full ledger", () => {
    // Failed/reverted/blocked rows are forced visible regardless of the window…
    expect(html).toContain("var show = isFail || inWindow");
    // …and the failed tally is the full-ledger total, not the in-window subset.
    expect(html).toContain("failedAll++"); // counted before any window test
    expect(html).toContain("f.textContent = String(failedAll)");
    // The badge says so in plain language (failures never hidden).
    expect(html).toContain("failed (all)");
  });
});

// US-DOSSIER-040: the agents inventory is MACHINE-GLOBAL — it left the Loop tab
// and now lives only on the machine Agents page (agents.html, rendered by
// renderAgentsMachinePage). Its rendering is covered by page-agents.test.ts; the
// console no longer carries an inline agents panel (asserted in "loop tab IA"
// below), so there is no agents-panel describe against the console here.

describe("collectCasting — US-DOSSIER-030 (pure)", () => {
  const deps = {
    readSlot: (slot: "easy" | "default" | "hard" | "fallback") =>
      ({ easy: "kimi", default: "codex", hard: "claude", fallback: "claude" })[slot],
    sparPair: () => ["claude", "kimi"] as [string, string],
    onboardClient: () => undefined,
    routeAudit: (slot: "easy" | "default" | "hard" | "fallback") =>
      slot === "hard" ? "claude best for US in-tier (hit_rate 0.91, n=12); slot kept" : undefined,
  };

  it("AC1: four complexity-slot rows resolve from readSlot in design order", () => {
    const vm = collectCasting(deps);
    const slots = vm.rows.filter((r) => ["easy", "default", "hard", "fallback"].includes(r.key));
    expect(slots.map((r) => r.key)).toEqual(["easy", "default", "hard", "fallback"]);
    expect(slots.map((r) => r.agentEn)).toEqual(["kimi", "codex", "claude", "claude"]);
    expect(slots.every((r) => r.mono && !r.empty)).toBe(true);
    expect(vm.configured).toBe(true);
  });

  it("AC1: an empty/unconfigured slot renders an em-dash, never a guessed agent", () => {
    const vm = collectCasting({ readSlot: () => undefined });
    const easy = vm.rows.find((r) => r.key === "easy");
    expect(easy?.agentEn).toBe("—");
    expect(easy?.empty).toBe(true);
    expect(easy?.mono).toBe(false);
    // review-pr also reuses the (empty) default slot → em-dash, not invented.
    expect(vm.rows.find((r) => r.key === "review-pr")?.agentEn).toBe("—");
    expect(vm.configured).toBe(false);
  });

  it("AC2: scenario rows — peer differ-from-builder, spar pair, onboard follows client", () => {
    const vm = collectCasting(deps);
    const peer = vm.rows.find((r) => r.key === "peer");
    expect(peer?.agentEn).toContain("must differ from builder");
    expect(peer?.agentZh).toContain("强制异构");
    expect(peer?.mono).toBe(false); // a rule, not a fixed agent
    const spar = vm.rows.find((r) => r.key === "spar");
    expect(spar?.agentEn).toBe("claude ⚔ kimi");
    const onboard = vm.rows.find((r) => r.key === "onboard");
    expect(onboard?.agentEn).toBe("follows the active client");
    // full design row order
    expect(vm.rows.map((r) => r.key)).toEqual(["easy", "default", "hard", "fallback", "peer", "review-pr", "spar", "onboard"]);
  });

  it("AC4: a route-resolve rationale is surfaced where present; absent ⇒ plain config", () => {
    const vm = collectCasting(deps);
    expect(vm.rows.find((r) => r.key === "hard")?.audit).toContain("hit_rate 0.91");
    expect(vm.rows.find((r) => r.key === "easy")?.audit).toBe(""); // nothing inferred
  });

  it("AC6: deterministic — same inputs produce byte-identical view-models", () => {
    expect(JSON.stringify(collectCasting(deps))).toBe(JSON.stringify(collectCasting(deps)));
  });
});

describe("collectGitHooks — FIX-284", () => {
  it("collects real hook files from the configured hooks path and ignores samples", () => {
    const vm = collectGitHooks({
      hooksPath: "hooks",
      listHookFiles: () => ["pre-commit", "prepare-commit-msg", "pre-push.sample"],
      hookPath: (name) => `hooks/${name}`,
    });
    expect(vm.configured).toBe(true);
    expect(vm.hooksPath).toBe("hooks");
    expect(vm.rows.map((r) => r.name)).toEqual(["pre-commit", "prepare-commit-msg"]);
    expect(vm.rows[0]?.descEn).toContain("TCR");
    expect(vm.rows[1]?.descEn).toContain("co-author");
  });

  it("empty/default git hook dirs render honestly without inventing launchd lanes", () => {
    const vm = collectGitHooks({
      hooksPath: ".git/hooks",
      listHookFiles: () => ["pre-commit.sample", "commit-msg.sample"],
      hookPath: (name) => `.git/hooks/${name}`,
    });
    expect(vm.configured).toBe(false);
    expect(vm.rows).toEqual([]);
  });
});

// US-DOSSIER-040: Casting is its OWN top-level project tab (executor complexity
// ladder + scenario roles), promoted OUT of the Loop tab. The Hooks-this-repo
// panel stays in the Loop tab. The grid view-model is unchanged (collectCasting).
describe("Casting tab + Loop tab IA — US-DOSSIER-030 / US-DOSSIER-040", () => {
  const html = render();

  // The Casting tab pane wraps the grid; locate that pane to assert the ladder +
  // roles live inside the Casting tab, not the Loop tab.
  const paneOf = (id: string): string => {
    const m = new RegExp(`<div id="${id}"[^>]*>([\\s\\S]*?)(?=<div id="tab-|</main>)`).exec(html);
    return m?.[1] ?? "";
  };
  const castingPane = paneOf("tab-casting");
  const loopPane = paneOf("tab-loop");

  it("AC1/US-040: Casting is its OWN tab pane (kicker + 3+1 executor ladder + role grid)", () => {
    expect(html).toContain('id="tab-casting"');
    expect(html).toContain('data-tab="casting"');
    expect(castingPane).toContain('data-exec-ladder="true"');
    expect(castingPane).toContain("grid-template-columns:repeat(3,1fr) 1.1fr");
    for (const key of ["easy", "default", "hard", "fallback"]) {
      expect(castingPane).toContain(`data-exec-slot="${key}"`);
    }
    expect(castingPane).toContain('data-ramp="1"');
    expect(castingPane).toContain('data-ramp="2"');
    expect(castingPane).toContain('data-ramp="3"');
    expect(castingPane).toContain("↩");
    expect(castingPane).toContain("Casting");
    expect(castingPane).toContain("选角"); // the Casting tab label (CORRECT稿)
    expect(castingPane).toContain("角色分工"); // the grid section label
  });

  it("AC2: Casting scenario roles render as 140px | 1fr | auto rows", () => {
    expect(html).toContain("Casting");
    expect(html).toContain("角色分工");
    expect(castingPane).toContain('data-scenario-roles="true"');
    for (const key of ["peer", "review-pr", "spar", "onboard"]) {
      expect(castingPane).toContain(`data-scenario-role="${key}"`);
    }
    expect(castingPane).toContain("grid-template-columns:140px 1fr auto");
    expect(html).toContain("Executor · easy");
    expect(html).toContain("执行 · easy");
    // resolved slot agents from the router config (no hardcoded arrays)
    expect(html).toContain(">kimi<");
    expect(html).toContain(">codex<");
    expect(html).toContain("roll agent list"); // reconcile command chip
  });

  it("AC2: peer differ-from-builder rule, spar pair, onboard follows the client", () => {
    expect(html).toContain("must differ from builder");
    expect(html).toContain("强制异构于执行者");
    expect(html).toContain("claude ⚔ kimi");
    expect(html).toContain("follows the active client");
    expect(html).toContain("跟随当前交互客户端");
  });

  it("AC4: the route-resolve rationale rides the resolved slot row", () => {
    expect(html).toContain("claude best for US in-tier (hit_rate 0.91, n=12); slot kept");
  });

  it("AC3: Hooks-this-repo enumerates configured git hooks, not scheduled lanes", () => {
    expect(html).toContain('data-hooks="this-repo"');
    expect(html).toContain("Hooks · this repo");
    expect(html).toContain("钩子 · 本仓");
    expect(html).toContain("git hooks wired into this checkout");
    expect(html).toContain("本检出已配置的 git 钩子");
    expect(html).toContain('data-hook="pre-commit"');
    expect(html).toContain('data-hook="prepare-commit-msg"');
    expect(html).toContain("TCR proof gate before commit");
    expect(html).not.toContain("scheduled launchd lanes wired into this checkout");
  });

  it("US-040: the Loop tab is cleaned — no inline agents panel, no inline casting ladder", () => {
    expect(loopPane).not.toBe("");
    // the casting grid + scenario roles are NOT inside the Loop pane (moved out)
    expect(loopPane).not.toContain('data-exec-slot="easy"');
    expect(loopPane).not.toContain('data-scenario-role="peer"');
    expect(loopPane).not.toContain("Executor · easy");
    expect(loopPane).not.toContain("roll agent list");
    // the inline agents inventory left the Loop tab (it is the machine Agents page)
    expect(loopPane).not.toContain("Agents on this machine");
    expect(loopPane).not.toContain("本机 agents");
    expect(loopPane).not.toContain('class="ag-row"');
    // the Loop tab still keeps the Hooks panel + the Cycle ledger
    expect(loopPane).toContain('data-hooks="this-repo"');
    expect(loopPane).toContain('id="cy-ledger"');
    expect(loopPane).toContain('class="cy-row"');
  });

  it("AC5: every new Casting + Hooks label is bilingual (EN and 中 both present)", () => {
    for (const [en, zh] of [
      ["Casting", "角色分工"],
      ["Hooks · this repo", "钩子 · 本仓"],
      ["git hooks", "git 钩子"],
      ["pairing rule", "结对规则"],
      ["interactive", "交互式"],
    ] as const) {
      expect(html).toContain(en);
      expect(html).toContain(zh);
    }
  });
});

describe("release tab — US-DOSSIER-015", () => {
  const html = render();

  it("AC1: gate head carries tag, verdict, f/w/? totals, cut, previous, merged/pending bar", () => {
    expect(html).toContain("v3.612.2");
    expect(html).toContain("v3.612.1"); // previous tag
    expect(html).toContain("f:1 w:3 ?:4");
    expect(html).toContain("merged");
    expect(html).toContain("pending");
  });

  it("AC2: six dimension rows + the strict-equality total row", () => {
    for (const k of ["code-backlog", "cards", "docs", "tests", "bilingual", "site"]) expect(html).toContain(`data-dim="${k}"`);
    expect(html).toContain('data-truth="gate-total"');
    expect(html).toContain("① ");
    expect(html).toContain("⑥ ");
  });

  it("AC3: a failing dimension shows the blocking banner", () => {
    expect(html).toContain("blocks the release");
    expect(html).toContain("挡发版");
  });

  it("AC4: dimension drift chips deep-link the backlog search (docs dim → FIX card)", () => {
    expect(html).toContain('href="#backlog/q:FIX-9"');
    expect(html).toContain('href="#backlog/q:US-X-1"');
    expect(html).toContain("q:"); // hash query prefilter script
  });

  it("AC5: the proposed data dimension renders dashed with FIX-248/249 case links", () => {
    expect(html).toContain('data-dim="data"');
    expect(html).toContain("proposed");
    expect(html).toContain("#backlog/q:FIX-248");
    expect(html).toContain("#backlog/q:FIX-249");
  });

  it("AC6: the copyable consistency command chip is present", () => {
    expect(html).toContain('data-copy="roll release --gate-check"'); // US-REL-007: the surviving real surface
    expect(html).toContain("✓ copied");
  });
});

describe("release scope sections — US-DOSSIER-016", () => {
  const html = render();

  it("AC1: pending grouped by epic, rows link to story dossiers with status", () => {
    expect(html).toContain("Pending delivery");
    expect(html).toContain("待交付");
    expect(html).toContain('href="alpha/FIX-9/index.html"');
  });

  it("AC2: changelog generated from merged truth with PR evidence links", () => {
    expect(html).toContain("Changelog (merged truth)");
    expect(html).toContain('href="https://github.com/seanyao/roll/pull/638"');
    expect(html).toContain("#638 merged");
  });

  it("AC3: collapsible version history with waiver marks", () => {
    expect(html).toContain("Version history");
    expect(html).toContain("v3.612.2");
    expect(html).toContain(">waived<");
  });

  it("AC4: head merged/pending equals the scope arithmetic (total - done)", () => {
    // SNAP: total 10, done 5 → pending 5 in the gate head, equal to scope count anchors
    expect(html).toMatch(/>5<\/b> <span class="lang-en">pending/);
    expect(html).toContain('data-truth="pending-count"');
    expect(html).toContain('data-truth="shipped-count"');
  });
});

// US-DOSSIER-040: the Skills catalog (audit strip + grouped skills + SKILL.md
// viewer) is MACHINE-GLOBAL — it is NOT a project tab. The console no longer
// renders a Skills pane (asserted by AC1 above: no `data-tab="skills"` /
// `id="tab-skills"`). The Skills page rendering is covered by page-skills.test.ts
// (skills.html via renderSkillsPage), reached through the MACHINE breadcrumb.
describe("Skills is machine-global, not a project tab — US-DOSSIER-040", () => {
  const html = render();

  it("the console emits no Skills project tab pane / button / skills-tab content", () => {
    expect(html).not.toContain('data-tab="skills"');
    expect(html).not.toContain('id="tab-skills"');
    // skills-tab-specific markers no longer render on the console
    expect(html).not.toContain('data-truth="skills-count"');
    expect(html).not.toContain("audit-skills --strict");
    expect(html).not.toContain("view SKILL.md hub");
    // the machine Skills breadcrumb still resolves to the machine-global page
    expect(html).toContain('data-machine="skills"');
    expect(html).toContain('href="skills.html"');
  });
});

describe("command chips + freshness — US-DOSSIER-018", () => {
  const html = render();

  it("AC1/AC2: cycle row chip carries the REAL roll cycle command with the digit-run handle", () => {
    expect(html).toContain('data-copy="roll cycle 1234"'); // digit-run handle of 20260612-x-1234
  });

  it("AC1: pending-delivery rows carry state-appropriate real commands", () => {
    expect(html).toContain("roll loop go --cards FIX-9");
  });

  it("AC3: stale-snapshot banner bound to generatedAt with the refresh hint", () => {
    expect(html).toContain('id="freshness-banner"');
    expect(html).toContain('data-generated="2026-06-13T00:00:00Z"');
    expect(html).toContain("数据已过期");
    expect(html).toContain("applyFreshness");
  });

  it("AC4: heartbeat next is a client-side countdown anchor", () => {
    expect(html).toContain('class="hb-next"');
    expect(html).toContain('data-next="2026-06-13T00:30:00Z"');
    expect(html).toContain("tickCountdown");
  });
});

// US-DOSSIER-027 — the sticky dark top-bar shell: project switcher + machine
// breadcrumb. The header assertions below are updated deliberately for this
// story: the old single-crumb slogan-only header is replaced by switcher +
// machine breadcrumb + release badge + lang toggle.
const REGISTRY: ProjectRegistryEntry[] = [
  { name: "roll", slug: "roll", path: "/Users/me/roll", releaseTag: "v3.612.2", verdict: "pass" },
  { name: "acme-api", slug: "acme-api", path: "/Users/me/acme", releaseTag: "v1.2.0", verdict: "warn" },
  { name: "zeta", slug: "zeta", path: "/Users/me/zeta" },
];

describe("top-bar shell — US-DOSSIER-027", () => {
  it("AC1: header geometry matches the design reference (54px, dark blur, hairline, green dot, Mono 600 name)", () => {
    const html = render();
    expect(html).toContain("position:sticky;top:0;z-index:30");
    expect(html).toContain("height:54px");
    expect(html).toContain("background:rgba(27,34,56,.97)");
    expect(html).toContain("backdrop-filter:blur(8px)");
    expect(html).toContain("border-bottom:1px solid #0e1424");
    // 9px green dot with the box-shadow halo
    expect(html).toContain("width:9px;height:9px;border-radius:50%;background:#178a52;box-shadow:0 0 0 3px rgba(23,138,82,.22)");
    // project name in IBM Plex Mono 600 / 15px / white
    expect(html).toMatch(/IBM Plex Mono[^"]*font-weight:600;font-size:15px;[^"]*color:#fff;[^>]*>roll</);
    // the project tabs row stays sticky just below the bar
    expect(html).toContain("position:sticky;top:54px");
    expect(html).toContain("z-index:20");
  });

  it("AC2: multi-project registry → switcher dropdown lists every project, current marked, others link to their dossier", () => {
    const html = render(SNAP, { projects: REGISTRY, currentSlug: "roll" });
    expect(html).toContain('id="proj-switch-btn"');
    expect(html).toContain('id="proj-menu"');
    expect(html).toContain('aria-haspopup="menu"');
    // dropdown header is "<brand> · this machine" (bilingual)
    expect(html).toContain("这台机器");
    expect(html).toContain("this machine");
    // every registry project is listed
    for (const p of REGISTRY) expect(html).toContain(`>${p.name}<`);
    // current project marked + routes home; another project links to its dossier
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('href="/Users/me/acme/.roll/features/index.html"');
    // the dropdown open/close interaction is wired
    expect(html).toContain("setupSwitcher");
  });

  it("AC2: missing/empty registry → single-project silent degrade (no dropdown, no error)", () => {
    const none = render(SNAP, { projects: [], currentSlug: "roll" });
    expect(none).not.toContain('id="proj-menu"');
    expect(none).not.toContain('id="proj-switch-btn"');
    // still renders the project name as a home anchor
    expect(none).toMatch(/href="#overview"[^>]*class="proj-switch-btn"/);
    expect(none).toContain(">roll<");
    // omitting projects entirely behaves identically (graceful)
    const omitted = render();
    expect(omitted).not.toContain('id="proj-menu"');
    // a lone registry row that IS the current project also stays single
    const solo = render(SNAP, { projects: [REGISTRY[0]!], currentSlug: "roll" });
    expect(solo).not.toContain('id="proj-menu"');
  });

  it("AC3: machine-global breadcrumb wires Agents · Skills · Conventions · About, bilingual, with stable routes", () => {
    const html = render();
    expect(html).toContain('aria-label="machine layer · 机器层"'); // nav has a localized aria-label
    expect(html).toContain('data-machine="agents"');
    expect(html).toContain('data-machine="skills"');
    expect(html).toContain('data-machine="conventions"');
    expect(html).toContain('data-machine="about"');
    expect(html).toContain('href="agents.html"');
    expect(html).toContain('href="conventions.html"');
    expect(html).toContain('href="about.html"');
    // bilingual machine kicker + an English/中 label pair
    expect(html).toContain(">Machine<");
    expect(html).toContain(">机器<");
    expect(html).toContain(">Agents<");
    expect(html).toContain(">约定<"); // Conventions zh
    // on the console no machine page is current (project name is the home anchor)
    expect(html).not.toContain('aria-current="page"');
  });

  it("AC4: EN/中 toggle persists to localStorage 'roll-lang'; first visit infers from navigator.language", () => {
    const html = render();
    expect(html).toContain('data-set-lang="en"');
    expect(html).toContain('data-set-lang="zh"');
    expect(html).toContain('set("roll-lang", lang)'); // write on toggle
    expect(html).toContain('get("roll-lang")'); // read on load
    expect(html).toContain('(navigator.language || "").toLowerCase().indexOf("zh") === 0'); // zh inference
  });

  it("AC5: release badge reads the snapshot tag; missing tag renders no undefined", () => {
    const withTag = render();
    expect(withTag).toMatch(/release[\s\S]{0,80}v3\.612\.2/);
    const noRel: TruthSnapshot = { ...SNAP, release: undefined };
    const html = render(noRel);
    expect(html).not.toContain("undefined");
    // the badge degrades to empty rather than rendering "release —"
    expect(html).not.toMatch(/发版<\/span><b[^>]*>—/);
  });

  it("AC6: machine-global stub pages wear the same top-bar shell and self-highlight", () => {
    const page = renderMachineStubPage({
      brand: { name: "roll", slogan: "It just works." },
      snapshot: SNAP,
      projects: REGISTRY,
      currentSlug: "roll",
      page: "conventions",
    });
    // same sticky dark bar geometry
    expect(page).toContain("background:rgba(27,34,56,.97)");
    expect(page).toContain("height:54px");
    // the breadcrumb highlights the current machine page
    expect(page).toContain('data-machine="conventions"');
    expect(page).toContain('aria-current="page"');
    // switcher + lang script ride along
    expect(page).toContain('id="proj-switch-btn"');
    expect(page).toContain('data-set-lang="zh"');
    expect(page).not.toContain("undefined");
  });

  // FIX-283 (AC1): the current-project "home" link must hop to the console
  // (index.html#overview) on a MACHINE page, where a bare #overview is a dead
  // hash — but stay #overview on the console itself.
  it("AC1 (FIX-283): machine page → current project links to index.html#overview; console keeps #overview", () => {
    // Single-project (no dropdown): the switcher button is a plain home anchor.
    const machineSolo = renderMachineStubPage({
      brand: { name: "roll", slogan: "It just works." },
      snapshot: SNAP,
      projects: [REGISTRY[0]!],
      currentSlug: "roll",
      page: "about",
    });
    expect(machineSolo).toMatch(/href="index\.html#overview"[^>]*class="proj-switch-btn"/);
    expect(machineSolo).not.toMatch(/href="#overview"[^>]*class="proj-switch-btn"/);

    // Multi-project dropdown on a machine page: the CURRENT row routes to the
    // console, not a dead #overview.
    const machineMulti = renderMachineStubPage({
      brand: { name: "roll", slogan: "It just works." },
      snapshot: SNAP,
      projects: REGISTRY,
      currentSlug: "roll",
      page: "conventions",
    });
    expect(machineMulti).toMatch(/class="proj-item on"[^>]*href="index\.html#overview"/);
    // a NON-current project still links to its own dossier (unchanged)
    expect(machineMulti).toContain('href="/Users/me/acme/.roll/features/index.html"');

    // The console (no machinePage) keeps the in-page #overview hash.
    const consoleSolo = render(SNAP, { projects: [REGISTRY[0]!], currentSlug: "roll" });
    expect(consoleSolo).toMatch(/href="#overview"[^>]*class="proj-switch-btn"/);
    expect(consoleSolo).not.toContain('href="index.html#overview"');
    const consoleMulti = render(SNAP, { projects: REGISTRY, currentSlug: "roll" });
    expect(consoleMulti).toMatch(/class="proj-item on"[^>]*href="#overview"/);
    expect(consoleMulti).not.toContain('href="index.html#overview"');
  });
});

describe("projects registry parser — US-DOSSIER-027", () => {
  it("parses the 028 array contract, sorts by name, keeps optional fields", () => {
    const text = JSON.stringify([
      { name: "zeta", slug: "zeta", path: "/z" },
      { name: "acme", slug: "acme", path: "/a", releaseTag: "v1", verdict: "pass", lastIndexedAt: "2026-06-13T00:00:00Z" },
    ]);
    const rows = parseProjectsRegistry(text);
    expect(rows.map((r) => r.name)).toEqual(["acme", "zeta"]); // deterministic order
    expect(rows[0]).toMatchObject({ slug: "acme", releaseTag: "v1", verdict: "pass" });
  });

  it("tolerates a { projects: [...] } wrapper", () => {
    const text = JSON.stringify({ projects: [{ name: "x", slug: "x", path: "/x" }] });
    expect(parseProjectsRegistry(text)).toHaveLength(1);
  });

  // FIX-283 (AC2): the web switcher shows only REACHABLE projects (path exists);
  // a dead entry (a stale tmp fixture or a since-deleted project) is filtered out
  // so it never renders as an un-clickable 404 item. `roll ls` keeps the full
  // list with missing/stale flags — that honesty is for the CLI.
  it("AC2 (FIX-283): reachableProjects drops rows whose path no longer exists", () => {
    const rows: ProjectRegistryEntry[] = [
      { name: "alive", slug: "alive", path: "/Users/me/alive" },
      { name: "dead", slug: "dead", path: "/private/tmp/roll-dossier-040.s4kDrk" },
      { name: "also-alive", slug: "also-alive", path: "/Users/me/zeta" },
    ];
    const present = (p: string): boolean => p !== "/private/tmp/roll-dossier-040.s4kDrk";
    const out = reachableProjects(rows, present);
    expect(out.map((r) => r.slug)).toEqual(["alive", "also-alive"]);
    expect(out.find((r) => r.slug === "dead")).toBeUndefined();
    // empty filter (all dead) → [] (single-project degrade is the caller's job)
    expect(reachableProjects(rows, () => false)).toEqual([]);
    // all reachable → identity (order preserved)
    expect(reachableProjects(rows, () => true)).toEqual(rows);
  });

  it("degrades to [] on malformed JSON or wrong-shape rows (never throws)", () => {
    expect(parseProjectsRegistry("not json")).toEqual([]);
    expect(parseProjectsRegistry("{}")).toEqual([]);
    expect(parseProjectsRegistry("42")).toEqual([]);
    // rows missing required string fields are dropped
    expect(parseProjectsRegistry(JSON.stringify([{ name: "x" }, { slug: 1, path: "/p" }]))).toEqual([]);
  });
});

/**
 * US-DOSSIER-034 — the bilingual + view-state closer for the 030–033 build wave.
 * Two console-wide contracts are hardened and pinned: (1) every NEW user-visible
 * string routes through bi() (EN and 中 as separate .lang-en/.lang-zh spans,
 * never inline-mixed); (2) chosen language, active tab, and EVERY collapsible
 * open-state persist to localStorage and restore across view changes + drilldown
 * / back, scoped per project, degrading safely when storage is unavailable.
 */
describe("lang/tab/section persistence + bilingual closer — US-DOSSIER-034", () => {
  const html = render();

  it("AC2: chosen language persists globally (roll-lang), inferred from navigator on first visit", () => {
    expect(html).toContain('set("roll-lang", lang)'); // write on toggle
    expect(html).toContain('get("roll-lang")'); // read on load
    expect(html).toContain('(navigator.language || "").toLowerCase().indexOf("zh") === 0'); // zh inference
    expect(html).toContain('d.setAttribute("data-lang", lang)'); // applied before first paint
    // lang is deliberately NOT project-scoped (one reading language per machine)
    expect(html).not.toContain('"roll-lang:" + scope');
  });

  it("AC3: the active tab persists (roll-tab, scoped) and restores when the hash drops", () => {
    // write the active tab on every applyTab
    expect(html).toContain('set(tabKey(), cur)');
    // restore from storage when no tab in the hash (bare reload / back from drilldown)
    expect(html).toContain('var saved = get(tabKey());');
    expect(html).toContain('if (TABS.indexOf(saved) >= 0) return saved;');
    // hash routing still resolves first (deep links win over the saved tab)
    expect(html).toContain('if (TABS.indexOf(h) >= 0) return h;');
    expect(html).toContain('window.addEventListener("hashchange"');
    // scoped per project so the switcher never carries one project's tab into another
    expect(html).toContain('function tabKey() { return "roll-tab:" + scope; }');
  });

  it("AC4: every collapsible carries a STABLE data-open-key (id, not DOM order)", () => {
    // US-DOSSIER-040: the console's collapsibles are now cycle ledger / backlog
    // epics / release history. Agents + skills moved to their machine pages
    // (their data-open-key coverage rides page-agents / page-skills below).
    expect(html).toContain('data-open-key="cy:20260612-x-1234"'); // cycle id
    expect(html).toContain('data-open-key="ep:alpha"'); // epic name
    expect(html).toContain('data-open-key="rel:v3.612.2"'); // release tag
    expect(html).toContain('data-tag="v3.612.2"'); // rel-hist keyed by tag, not order
    // agents/skills collapsibles no longer render on the console
    expect(html).not.toContain('data-open-key="ag:claude"');
    expect(html).not.toContain('data-open-key="sk:roll-build"');
  });

  it("AC4: open-state restore + persist wiring is present and runs before filters", () => {
    expect(html).toContain('function restoreOpen()');
    expect(html).toContain('function bindOpenPersistence()');
    expect(html).toContain('document.querySelectorAll("[data-open-key]")');
    // toggle listener writes the open set keyed by data-open-key
    expect(html).toContain('this.getAttribute("data-open-key")');
    expect(html).toContain('if (this.open) map[k] = 1; else delete map[k];');
    // restore happens on load, before applyPrefilter (so a filter force-open can still win)
    expect(html).toMatch(/restoreOpen\(\);[\s\S]{0,60}bindOpenPersistence\(\);[\s\S]{0,60}applyPrefilter\(\);/);
  });

  it("AC4: open-section storage is SCOPED per project (no leak across the switcher)", () => {
    expect(html).toContain('function openKey() { return "roll-open:" + scope; }');
    expect(html).toContain('var scope = d.getAttribute("data-roll-scope")');
    // the scope is stamped on <html> at generate time, from the current slug
    const scoped = render(SNAP, { projects: REGISTRY, currentSlug: "roll" });
    expect(scoped).toContain('data-roll-scope="roll"');
    expect(rollScope({ brand: { name: "roll", slogan: "" }, currentSlug: "acme" })).toBe("acme");
    expect(rollScope({ brand: { name: "roll", slogan: "" } })).toBe("roll"); // falls back to brand name
  });

  it("AC4: the Charter selected doc persists (scoped) so a bare reload keeps the reader's place", () => {
    expect(html).toContain('get("roll-charter:" + scope)');
    expect(html).toContain('set("roll-charter:" + scope, want)');
  });

  it("AC6: persistence degrades safely — all storage access is try/catch guarded", () => {
    // the shared get/set swallow storage errors (file:// / private mode)
    expect(html).toContain("function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }");
    expect(html).toContain("function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }");
    // readOpen tolerates malformed / absent JSON without throwing
    expect(html).toContain("try { var o = JSON.parse(raw); return o && typeof o === \"object\" ? o : {}; } catch (e) { return {}; }");
  });

  it("AC1/AC5: every NEW surface label is bilingual — EN and 中 both present", () => {
    for (const [en, zh] of [
      // Casting + Hooks (US-DOSSIER-030)
      ["Casting", "角色分工"],
      ["Hooks · this repo", "钩子 · 本仓"],
      ["Executor · easy", "执行 · easy"],
      ["must differ from builder", "强制异构于执行者"],
      ["follows the active client", "跟随当前交互客户端"],
      // Charter tab (US-DOSSIER-033)
      ["Charter", "章程"],
      ["Read-only · the rulebook you are governed by", "只读 · 你被约束的规则书"],
      ["Epic plans", "史诗计划"],
    ] as const) {
      expect(html).toContain(en);
      expect(html).toContain(zh);
    }
  });

  it("AC1/AC5: the new surfaces emit balanced .lang-en/.lang-zh spans, none inline-mixed", () => {
    // the bilingual primitive emits paired spans; the count is balanced (every EN
    // label has its 中 sibling) so neither side is a one-language string.
    const enSpans = [...html.matchAll(/class="lang-en"/g)].length;
    const zhSpans = [...html.matchAll(/class="lang-zh"/g)].length;
    expect(enSpans).toBe(zhSpans);
    expect(enSpans).toBeGreaterThan(0);
    // a bilingual label never renders EN and 中 jammed in one text node
    expect(html).not.toMatch(/>Casting\s*角色分工</);
    expect(html).not.toMatch(/>Charter\s*章程</);
  });

  it("AC5: EN-view vs 中-view structure is identical (lang switch is CSS, not re-render)", () => {
    // the same generated markup serves both languages — the lang attribute is set
    // by the client script, the spans are always both present in the source. So
    // an EN-only or 中-only translation gap is structurally impossible to hide.
    expect(html).toContain('html[data-lang="en"] .lang-zh{display:none;}');
    expect(html).toContain('html[data-lang="zh"] .lang-en{display:none;}');
  });
});

/**
 * US-DOSSIER-034 — the machine pages (Agents / Skills) carry the SAME persistence
 * shell: per-project scope stamp + the open-state-keyed collapsibles inherit the
 * shared CONSOLE_SCRIPT wiring, so a reader's expansions survive there too.
 */
describe("machine-page persistence parity — US-DOSSIER-034", () => {
  const agentsPage = renderAgentsMachinePage({
    brand: { name: "roll", slogan: "It just works." },
    snapshot: { release: { latestTag: "v3.612.2" } },
    agents: AGENTS,
    projects: REGISTRY,
    currentSlug: "roll",
  });
  const skillsPage = renderSkillsPage({
    brand: { name: "roll", slogan: "It just works." },
    snapshot: { release: { latestTag: "v3.612.2" } },
    skills: SKILLS,
    projects: REGISTRY,
    currentSlug: "roll",
  });

  it("AC4: machine pages stamp the per-project scope so open-state never leaks", () => {
    expect(agentsPage).toContain('data-roll-scope="roll"');
    expect(skillsPage).toContain('data-roll-scope="roll"');
  });

  it("AC4: machine-page collapsibles carry stable data-open-key (agent / skill)", () => {
    expect(agentsPage).toContain('data-open-key="ag:claude"');
    expect(skillsPage).toContain('data-open-key="sk:roll-build"');
    // the inline SKILL.md viewer toggle persists too, keyed by skill name
    expect(skillsPage).toContain('data-open-key="skmd:roll-build"');
  });

  it("AC4: the shared open-state restore/persist wiring rides the machine pages", () => {
    for (const page of [agentsPage, skillsPage]) {
      expect(page).toContain('function restoreOpen()');
      expect(page).toContain('function bindOpenPersistence()');
      expect(page).toContain('var scope = d.getAttribute("data-roll-scope")');
    }
  });

  it("AC1: machine-page copy is bilingual EN + 中 (balanced lang spans, no leak)", () => {
    for (const page of [agentsPage, skillsPage]) {
      const en = [...page.matchAll(/class="lang-en"/g)].length;
      const zh = [...page.matchAll(/class="lang-zh"/g)].length;
      expect(en).toBe(zh);
      expect(en).toBeGreaterThan(0);
      expect(page).not.toContain("undefined");
    }
  });
});
