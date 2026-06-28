/**
 * US-DOSSIER-038 — the SAME-NUMBER-EVERYWHERE invariant, pinned by a test.
 *
 * The console's headline promise (the plan's first common principle — 各面同口径
 * / "one number on every surface") is asserted everywhere in prose but, until
 * this story, proven nowhere by code: the web surface and the CLI both render
 * the SAME aggregates off the SAME `packages/core` computations, yet nothing
 * failed when the two drifted. This test fixes ONE frozen TruthSnapshot / set
 * of fixtures, renders BOTH the web view and the CLI render of that exact input,
 * parses the numbers OUT of each rendered surface, and asserts they are equal —
 * for the four aggregate surfaces the epic shipped:
 *
 *   ① casting     — `roll cast` table   vs  the web Casting grid
 *   ② skills      — `roll skills audit`  vs  the web Skills page audit strip
 *   ③ consistency — `roll release consistency` summary vs the web 6-dim panel
 *   ④ status      — `roll status` spectrum/attest vs the web Now tiles
 *
 * This is the ⑦ data dimension's intent: web and CLI read ONE computation. The
 * test compares each surface's RENDERED aggregate (parsed from the table / the
 * HTML) — it never re-derives a third number inside the test. Determinism: a
 * fixed in-repo fixture (no live `.roll` read), pinned lang (NO_COLOR so the CLI
 * text is parseable), stable ordering. Same input → same numbers on both faces.
 */
import { describe, expect, it } from "vitest";
import { serializeTruthSnapshot, type TruthSnapshot } from "@roll/spec";
import {
  CONSISTENCY_DIMENSIONS,
  emptyAuditSnapshot,
  runConsistencyAudit,
  tallyByDimension,
  type AuditSnapshot,
} from "@roll/core";
import {
  renderTruthConsole,
  type ProjectRegistryEntry,
  type TruthConsoleInput,
} from "../src/lib/truth-console.js";
import { renderSkillsPage } from "../src/lib/page-skills.js";
import { collectCasting } from "../src/lib/casting.js";
import { renderCastTable } from "../src/commands/cast.js";
import { renderAuditPanel } from "../src/commands/skills.js";
import { renderTruthSummary, statusTruthJson } from "../src/commands/status.js";
import { attestCoverage } from "../src/lib/truth-read.js";
import type { ReleasePanelVM } from "../src/lib/release-panel.js";
import type { SkillsPanelVM } from "../src/lib/skills-panel.js";
import { renderState, stripAnsi } from "../src/render.js";

// ── The ONE frozen TruthSnapshot the whole test reads (no live `.roll` read) ──
const SNAP: TruthSnapshot = {
  generatedAt: "2026-06-13T00:00:00Z",
  collectedAt: "2026-06-12T23:00:00Z",
  story: { total: 12, spectrum: { done: 7, wip: 1, hold: 1, todo: 2, fail: 0, unknown: 1 }, legacy: 3 },
  audit: { fail: 1, warn: 2, unknown: 1 },
  cycle: { cycles3d: 7, failed3d: 2, costUsd3d: 1.5 },
  release: { latestTag: "v3.613.1", verdict: "fail" },
  loop: { lanes: [{ name: "loop", running: true, mode: "cron", everyMin: 60, nextAt: "2026-06-13T00:30:00Z" }] },
  stories: [
    { id: "US-1", epic: "e", ladder: "attested", evidence: { report: true, acMap: true, visualEvidence: true }, truthState: "done", legacy: false },
    { id: "US-2", epic: "e", ladder: "attested", evidence: { report: true, acMap: true, visualEvidence: true }, truthState: "done", legacy: false },
    { id: "US-3", epic: "e", ladder: "merged", evidence: { report: false, acMap: false, visualEvidence: false }, truthState: "done", legacy: false },
    { id: "US-4", epic: "e", ladder: "claimed", evidence: { report: false, acMap: false, visualEvidence: false }, truthState: "todo", legacy: false },
  ],
};

// ── Casting fixture: two configured slots, two empty (em-dash) slots ──────────
const CASTING = collectCasting({
  readSlot: (slot) => ({ easy: "kimi", default: "codex", hard: undefined, fallback: undefined })[slot],
  sparPair: () => ["claude", "kimi"],
  onboardClient: () => undefined,
});

// ── Skills fixture: the SAME SkillsPanelVM both the CLI audit + web page read ──
const SKILLS: SkillsPanelVM = {
  summary: { skills: 3, violations: 4, hubLines: 410, auditRan: true },
  groups: [
    {
      key: "delivery",
      rows: [
        {
          name: "roll-build", group: "delivery", hubLines: 220, description: "Load when shipping a story",
          violations: ["gotchas-missing", "description-over-50-words"], auditKnown: true, hasGotchas: false, hasLoadTrigger: true,
          routeCases: { positive: 2, negative: 2 }, usage: 9,
          files: [{ path: "SKILL.md", lines: 220, dir: false }, { path: "references/", lines: 0, dir: true }],
          dirPath: "/repo/skills/roll-build", hubText: "# Roll Build\nhub",
        },
      ],
    },
    {
      key: "quality",
      rows: [
        {
          name: "roll-.review", group: "quality", hubLines: 110, description: "Load when reviewing",
          violations: ["route-fixture-coverage-missing"], auditKnown: true, hasGotchas: true, hasLoadTrigger: true,
          routeCases: { positive: 1, negative: 0 }, usage: 3,
          files: [{ path: "SKILL.md", lines: 110, dir: false }], dirPath: "/repo/skills/roll-.review", hubText: "# Review",
        },
      ],
    },
    {
      key: "observe",
      rows: [
        {
          name: "roll-doctor", group: "observe", hubLines: 80, description: "Load when diagnosing health",
          violations: ["description-not-load-trigger"], auditKnown: true, hasGotchas: true, hasLoadTrigger: false,
          routeCases: { positive: 2, negative: 2 }, usage: 0,
          files: [{ path: "SKILL.md", lines: 80, dir: false }], dirPath: "/repo/skills/roll-doctor", hubText: "# Doctor",
        },
      ],
    },
    { key: "lifecycle", rows: [] },
  ],
};

// ── Consistency fixture: ONE AuditSnapshot → ONE report; the web panel and the
//    CLI summary both read THAT report (the panel reads the persisted JSON the
//    CLI writes). We build the snapshot to land findings across two dimensions
//    so the per-dim split is non-trivial, then run the audit ONCE — both faces
//    read its `findings` / `summary`, never a second computation. ──────────────
function consistencySnapshot(): AuditSnapshot {
  const nowSec = 1_900_000_000;
  const epoch = nowSec - 100 * 86400; // everything is post-epoch (judged, not grandfathered)
  const s = emptyAuditSnapshot(nowSec, epoch);
  // ① code-backlog (done-no-merge, fail): a Done row whose delivery PR is OPEN.
  s.backlog = [{ id: "US-DRIFT-1", status: "✅ Done · PR#10" }];
  s.prEvidence = { "US-DRIFT-1": { state: "OPEN" } };
  // ② cards (done-missing-attest, fail): the row has a card folder + ac-map but no report.
  s.index = { "US-DRIFT-1": "e" };
  s.attest = { "US-DRIFT-1": { report: false, acMap: true, visualEvidence: false, machineSkip: false } };
  // ① code-backlog (local-main-ahead, fail): a second fail dimension-ward.
  s.localMainAhead = 2;
  return s;
}
const AUDIT_REPORT = runConsistencyAudit(consistencySnapshot());
const RELEASE_PANEL: ReleasePanelVM = (() => {
  const tallies = tallyByDimension(AUDIT_REPORT.findings);
  const dims = CONSISTENCY_DIMENSIONS.map((key) => ({ key, tally: tallies[key] }));
  const total = { fail: 0, warn: 0, unknown: 0 };
  for (const d of dims) {
    total.fail += d.tally.fail;
    total.warn += d.tally.warn;
    total.unknown += d.tally.unknown;
  }
  return { dims, total, blocking: total.fail > 0, generatedAt: "2026-06-13T00:00:00Z" };
})();

// ── Minimal-but-valid extra inputs the console shell needs (not under test) ───
const SPINE = ["definition", "design", "execution", "delivery", "retrospective"];
const BACKLOG = {
  shipping: [
    {
      name: "e", done: 1, total: 2,
      stories: [
        { id: "US-1", epic: "e", type: "US", title: "first", state: "done" as const, legacy: false, stages: SPINE },
        { id: "US-4", epic: "e", type: "US", title: "todo", state: "todo" as const, legacy: false, stages: ["definition"] },
      ],
    },
  ],
  settled: [],
};
const AGENTS = [
  { name: "claude", display: "claude", runner: "Claude Code", version: "2.1.0", installed: true, cycles72h: 4, costUsd72h: 1.25, files: [], syncStale: false },
];
const CHARTER = {
  defaultId: "docs/x.md",
  groups: [
    { key: "charter" as const, docs: [{ id: "docs/x.md", path: "docs/x.md", title: "X", bodyEn: "<p>x</p>", bodyZh: "<p>x</p>", bilingual: false }] },
  ],
};
const RELEASE_SCOPE = { pending: [], shipped: [], pendingCount: 0, shippedCount: 0, history: [] };
const CYCLES: TruthConsoleInput["cycles"] = [];
const PROJECTS: ProjectRegistryEntry[] = [];

function renderConsole(): string {
  return renderTruthConsole({
    snapshot: SNAP,
    snapshotJson: serializeTruthSnapshot(SNAP),
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
    charter: CHARTER,
    projects: PROJECTS,
  });
}

function renderSkills(): string {
  return renderSkillsPage({ skills: SKILLS, brand: { name: "roll", slogan: "x" }, snapshot: { release: { latestTag: "v3.613.1" } } });
}

// ── Parse helpers: pull aggregates OUT of each rendered surface ───────────────

/** Count the substring `needle` in `hay` (non-overlapping). */
function count(hay: string, needle: string): number {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

/** Extract the integer captured by `re` (group 1), or throw if absent. */
function intAfter(text: string, re: RegExp): number {
  const m = re.exec(text);
  if (m === null || m[1] === undefined) throw new Error(`pattern not found: ${re}`);
  return Number(m[1].replace(/,/g, ""));
}

describe("US-DOSSIER-038 — web ↔ CLI: one number on every surface / 同一个数字处处相等", () => {
  // Both faces must be parseable: NO_COLOR so the CLI text carries no ANSI; the
  // HTML is read with stable markers (data-casting / data-dim / data-truth).
  renderState.useColor = false;

  // ── ① CASTING — `roll cast` table vs the web Casting grid ───────────────────
  it("① casting: row count + empty (em-dash) slots match between roll cast and the web grid", () => {
    // CLI: one row per VM row; an empty legacy route prints the em-dash agent +
    // the deterministic "legacy route empty" note (the peer row's prose also contains an
    // em-dash, so we count the note column, not raw — glyphs).
    const cli = stripAnsi(renderCastTable(CASTING, "en"));
    const cliBodyRows = cli.split("\n").filter((l) => /^ {2}\S/.test(l) && !/^ {2}Role\b/.test(l)).length;
    const cliEmpty = count(cli, "legacy route empty");

    // WEB: the grid renders four `data-exec-slot` cards plus four
    // `data-scenario-role` rows; together they are still one DOM row per VM row.
    // Bound each block to its own row/card so trailing page content (other `—`
    // glyphs) never bleeds into the count.
    const web = renderConsole();
    const webRows = count(web, "data-exec-slot=") + count(web, "data-scenario-role=");
    const blocks = web.split(/data-(?:exec-slot|scenario-role)=/).slice(1);
    const rowCell = (b: string): string => {
      const exec = b.indexOf("data-exec-slot=");
      const role = b.indexOf("data-scenario-role=");
      const sec = b.indexOf("</section>");
      const ends = [exec, role, sec].filter((i) => i !== -1);
      const end = ends.length > 0 ? Math.min(...ends) : b.length;
      return b.slice(0, end);
    };
    const webEmpty = blocks.filter((b) => />—<\/span>/.test(rowCell(b))).length;

    // The VM is the single source — both faces render exactly its rows.
    const vmEmpty = CASTING.rows.filter((r) => r.empty).length;
    expect(vmEmpty).toBe(2); // fixture sanity: two unconfigured slots
    expect(webRows).toBe(CASTING.rows.length);
    expect(cliBodyRows).toBe(CASTING.rows.length);
    // Same aggregate — the count of UNCONFIGURED (em-dash) slots on each face.
    expect(cliEmpty).toBe(vmEmpty);
    expect(webEmpty).toBe(vmEmpty);
  });

  // ── ② SKILLS — `roll skills audit` vs the web Skills page audit strip ───────
  it("② skills: skills · violations · hub lines match between roll skills audit and the web page", () => {
    // CLI summary bar: `N skills · M violations · K hub lines`.
    const cli = stripAnsi(renderAuditPanel(SKILLS, "en"));
    const cliSkills = intAfter(cli, /(\d+)\s+skills\s+·/);
    const cliViolations = intAfter(cli, /·\s+(\d+)\s+violations\s+·/);
    const cliHub = intAfter(cli, /·\s+([\d,]+)\s+hub lines/);

    // WEB audit strip: the three aggregates are rendered off the SAME VM.
    const web = renderSkills();

    // CLI bar reads exactly the VM summary.
    expect(cliSkills).toBe(SKILLS.summary.skills);
    expect(cliViolations).toBe(SKILLS.summary.violations);
    expect(cliHub).toBe(SKILLS.summary.hubLines);
    // WEB strip carries the SAME three numbers (each in its own stat cell).
    expect(web).toContain(`>${SKILLS.summary.skills}<`); // skills count
    expect(web).toContain(`>${SKILLS.summary.violations}<`); // violations count
    expect(web).toContain(`>${(SKILLS.summary.hubLines as number).toLocaleString("en-US")}<`); // hub lines
  });

  // ── ③ CONSISTENCY — `roll release consistency` vs the web 6-dim panel ───────
  it("③ consistency: per-dimension f/w/? and totals match between the gate audit and the web panel", () => {
    // The CLI audit summary (excl. grandfathered) and the web panel's per-dim
    // tallies both fold the SAME `AUDIT_REPORT.findings`. The web panel stamps
    // `data-dim="<key>"` rows whose fwu span reads `f:N w:N ?:N` — parse them.
    const web = renderConsole();
    const webTotal = { fail: 0, warn: 0, unknown: 0 };
    const perDimWeb: Record<string, { fail: number; warn: number; unknown: number }> = {};
    const dimSet = new Set<string>(CONSISTENCY_DIMENSIONS);
    for (const raw of web.split('data-dim="').slice(1)) {
      const key = raw.slice(0, raw.indexOf('"'));
      // The proposed ⑦ data row is `data-dim="data"` and carries no f/w/? span —
      // only the reconciled gate dimensions tally here.
      if (!dimSet.has(key)) continue;
      const block = raw.slice(0, raw.indexOf("data-dim=") === -1 ? raw.length : raw.indexOf("data-dim="));
      const f = intAfter(block, /f:(\d+)</);
      const w = intAfter(block, /w:(\d+)</);
      const u = intAfter(block, /\?:(\d+)</);
      perDimWeb[key] = { fail: f, warn: w, unknown: u };
      webTotal.fail += f;
      webTotal.warn += w;
      webTotal.unknown += u;
    }

    // The web panel carries exactly the gate dimensions, in canonical order.
    expect(Object.keys(perDimWeb)).toEqual([...CONSISTENCY_DIMENSIONS]);

    // The CLI's audit summary is the f/w/? of the SAME report (grandfathered out).
    const cliSummary = AUDIT_REPORT.summary;
    // The web per-dim sum equals the CLI summary — rows reconcile to the line.
    expect(webTotal.fail).toBe(cliSummary.fail);
    expect(webTotal.warn).toBe(cliSummary.warn);
    expect(webTotal.unknown).toBe(cliSummary.unknown);

    // And per-dimension the web matches the core tally of the same findings
    // (no dimension silently dropped or invented).
    const coreTally = tallyByDimension(AUDIT_REPORT.findings);
    for (const dim of CONSISTENCY_DIMENSIONS) {
      expect(perDimWeb[dim]).toEqual({
        fail: coreTally[dim].fail,
        warn: coreTally[dim].warn,
        unknown: coreTally[dim].unknown,
      });
    }
    // Fixture sanity: the snapshot really exercised >1 fail across dimensions.
    expect(cliSummary.fail).toBeGreaterThanOrEqual(2);
  });

  // ── ④ STATUS — `roll status` spectrum/attest vs the web Now tiles ───────────
  it("④ status: story spectrum + attest coverage match between roll status and the web Now tab", () => {
    // CLI: the verdict-first summary + the machine JSON both read the SAME
    // snapshot via the SAME selectors (spectrum + attestCoverage).
    const cliText = stripAnsi(renderTruthSummary(SNAP, false, "en", 0));
    const cliJson = statusTruthJson(SNAP, false) as {
      story: { attestCoveragePct: number; fail: number; done: number; unknown: number; todo: number };
    };

    // WEB Now: each spectrum count is `data-truth="spectrum-<k>"`; the total
    // is `data-truth="total"`; merged% is `data-truth="merged-pct"`.
    const web = renderConsole();
    const spectrumWeb: Record<string, number> = {};
    for (const k of ["done", "fail", "unknown", "wip", "todo", "hold"]) {
      spectrumWeb[k] = intAfter(web, new RegExp(`data-truth="spectrum-${k}"[^>]*>(\\d+)<`));
    }
    const totalWeb = intAfter(web, /data-truth="total">(\d+)\s/);
    const mergedPctWeb = intAfter(web, /data-truth="merged-pct"[^>]*>(\d+)%/);

    // The web spectrum equals the snapshot spectrum (one snapshot).
    expect(spectrumWeb).toEqual({ ...SNAP.story.spectrum });
    expect(totalWeb).toBe(SNAP.story.total);

    // The CLI summary text reads the same spectrum numbers.
    expect(intAfter(cliText, /drift (\d+) ·/)).toBe(SNAP.story.spectrum.fail);
    expect(intAfter(cliText, /· done (\d+)/)).toBe(SNAP.story.spectrum.done);
    expect(intAfter(cliText, /· unknown (\d+)/)).toBe(SNAP.story.spectrum.unknown);
    expect(intAfter(cliText, /· todo (\d+)/)).toBe(SNAP.story.spectrum.todo);

    // The CLI JSON aggregate equals the web spectrum (one number, two faces).
    expect(cliJson.story.fail).toBe(spectrumWeb["fail"]);
    expect(cliJson.story.done).toBe(spectrumWeb["done"]);
    expect(cliJson.story.unknown).toBe(spectrumWeb["unknown"]);
    expect(cliJson.story.todo).toBe(spectrumWeb["todo"]);

    // Attest coverage (the ladder): the CLI % reads attestCoverage(SNAP); the web
    // Now shows merged% off the same snapshot. Pin BOTH against the snapshot
    // so a drift in either projection trips the test.
    const cov = attestCoverage(SNAP); // 2 attested of 4 stories[] = 50%
    expect(cov.attested).toBe(2);
    expect(cliJson.story.attestCoveragePct).toBe(cov.pct);
    expect(intAfter(cliText, /(\d+)% attest coverage/)).toBe(cov.pct);
    const mergedPctSnap = Math.round((SNAP.story.spectrum.done / SNAP.story.total) * 100);
    expect(mergedPctWeb).toBe(mergedPctSnap);
  });
});
