/**
 * US-DOSSIER-011 — the Truth Console shell + Overview. Numbers come from the
 * ONE TruthSnapshot; tabs are hash-routed; brand is injected; copy is fully
 * bilingual (single-language presentation via roll-lang).
 */
import { describe, expect, it } from "vitest";
import { serializeTruthSnapshot, type TruthSnapshot } from "@roll/spec";
import { renderTruthConsole } from "../src/lib/truth-console.js";
import { collectLoopHeartbeat } from "../src/lib/loop-heartbeat.js";

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
  summary: { skills: 2, violations: 0, hubLines: 110 },
  groups: [
    { key: "delivery" as const, rows: [{
      name: "roll-build", group: "delivery" as const, hubLines: 60, description: "Load when shipping a story",
      violations: [], hasGotchas: true, hasLoadTrigger: true, routeCases: { positive: 2, negative: 2 },
      usage: 7, files: [{ path: "SKILL.md", lines: 60, dir: false }, { path: "references/", lines: 0, dir: true }, { path: "references/full-contract.md", lines: 900, dir: false }],
      dirPath: "/repo/skills/roll-build", hubText: "# Roll Build\nhub text here",
    }] },
    { key: "quality" as const, rows: [{
      name: "roll-.review", group: "quality" as const, hubLines: 50, description: "Load when reviewing",
      violations: [], hasGotchas: true, hasLoadTrigger: true, routeCases: { positive: 2, negative: 2 },
      usage: 0, files: [{ path: "SKILL.md", lines: 50, dir: false }], dirPath: "/repo/skills/roll-.review", hubText: "# Review",
    }] },
    { key: "observe" as const, rows: [] },
    { key: "lifecycle" as const, rows: [] },
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

function render(snapshot: TruthSnapshot = SNAP): string {
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
  });
}

describe("renderTruthConsole — US-DOSSIER-011", () => {
  const html = render();

  it("AC1: five hash-routed tabs in the ruled order, overview first, placeholders marked", () => {
    for (const k of ["overview", "loop", "release", "backlog", "skills"]) {
      expect(html).toContain(`data-tab="${k}"`);
      expect(html).toContain(`id="tab-${k}"`);
    }
    const order = ["overview", "loop", "release", "backlog", "skills"].map((k) => html.indexOf(`data-tab="${k}"`));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("hashchange"); // tab state survives drill-down via hash
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
      skills: { summary: { skills: 0, violations: 0, hubLines: 0 }, groups: [] },
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

describe("agents panel — US-DOSSIER-014", () => {
  const html = render();

  it("AC1: rows carry runner/version/72h cycles+cost/availability; undetected greyed", () => {
    expect(html).toContain("Claude Code");
    expect(html).toContain("Kimi CLI");
    expect(html).toContain(">4<"); // cycles 72h
    expect(html).toContain("$1.25");
    expect(html).toContain("available");
    expect(html).toContain("not detected");
    expect(html).toContain("opacity:.62"); // undetected greyed
  });

  it("AC2: expanded sync truth + amber stale badge + copyable setup command", () => {
    expect(html).toContain("✓ in sync");
    expect(html).toContain("⟳ stale");
    expect(html).toContain("convention stale");
    expect(html).toContain("约定过期");
    expect(html).toContain("roll setup -f kimi");
    expect(html).toContain("nothing to sync"); // empty file list honesty
  });

  it("AC3: the 72h window is explicitly labelled (the documented trade-off)", () => {
    expect(html).toContain("72h");
    expect(html).toContain("近72h周期");
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
    expect(html).toContain('data-copy="roll release consistency check"');
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

describe("skills tab — US-DOSSIER-017", () => {
  const html = render();

  it("AC1: audit strip — skills · violations · hub lines, same yardstick note", () => {
    expect(html).toContain('data-truth="skills-count"');
    expect(html).toContain("hub lines");
    expect(html).toContain("audit-skills --strict");
  });

  it("AC2: grouped lists with usage counts (— when never invoked)", () => {
    expect(html).toContain(">Delivery<");
    expect(html).toContain(">Quality<");
    expect(html).toContain("×7");
    expect(html).toMatch(/roll-\.review[\s\S]{0,800}—/);
  });

  it("AC3: expanded anatomy — file tree with line counts, essentials checks, copyable dir chip", () => {
    expect(html).toContain("references/full-contract.md");
    expect(html).toContain("900");
    expect(html).toContain("✓ Load when");
    expect(html).toContain("✓ Gotchas");
    expect(html).toContain("2+/2−");
    expect(html).toContain('data-copy="/repo/skills/roll-build"');
  });

  it("AC4: SKILL.md hub inline in a scroll area; references stay pointers", () => {
    expect(html).toContain("view SKILL.md hub");
    expect(html).toContain("hub text here");
    expect(html).toContain("max-height:280px");
    expect(html).not.toContain("references full text"); // pointers only
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
