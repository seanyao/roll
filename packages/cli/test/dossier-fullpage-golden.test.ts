/**
 * US-OBS-017 — full-page golden Vitest snapshot over the rendered dossier HTML.
 *
 * Freezes a `toMatchSnapshot()` golden from `renderTruthConsole` fed with a
 * deterministic `collectDossierState(cwd)` fixture. This pins the WHOLE page
 * so the static (index.html-baked) view and any future live-served view can
 * never silently diverge byte-for-byte.
 *
 * Architecture (per the anti-drift spine):
 *   ONE read selector — `collectDossierState(cwd)` — is imported and used to
 *   produce the TruthSnapshot. The test never re-computes a second way.
 *   `renderTruthConsole` renders from THAT snapshot. Mutating any snapshot
 *   field (e.g. a StoryStatus shape change) MUST fail the golden until the
 *   snapshot is regenerated.
 *
 * Determinism:
 *   - ROLL_RENDER_NOW pinned to a constant ISO timestamp
 *   - All file fixtures use fixed paths / IDs / timestamps
 *   - Extra inputs (agents, skills, etc.) are fixed stubs — the golden
 *     captures the FULL page HTML, not just a fragment.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { serializeTruthSnapshot } from "@roll/spec";
import { collectDossierState } from "@roll/core";
import { renderTruthConsole, type TruthConsoleInput } from "../src/lib/truth-console.js";
import { collectCasting } from "../src/lib/casting.js";
import { renderState } from "../src/render.js";

// ── Cleanup ──────────────────────────────────────────────────────────────────
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmFs(d);
});
function rmFs(d: string): void {
  try { execFileSync("rm", ["-rf", d]); } catch { /* best-effort */ }
}

// ── Deterministic render time ────────────────────────────────────────────────
beforeEach(() => {
  process.env["ROLL_RENDER_NOW"] = "2026-06-20T12:00:00.000Z";
});

// ── Rich file fixture (produces a meaningful TruthSnapshot via collectDossierState) ──
function fixture(): string {
  const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-golden-")));
  dirs.push(p);
  const f = join(p, ".roll", "features");

  // ── Epic "delivery-dossier" — one attested delivered story, one todo story ──
  const alphaDir = join(f, "delivery-dossier");
  mkdirSync(join(alphaDir, "US-A-1", "2026-06-01T00-00-00"), { recursive: true });
  writeFileSync(
    join(alphaDir, "US-A-1", "spec.md"),
    [
      "---",
      "id: US-A-1",
      "title: Alpha — first shipped story",
      "type: us",
      "created: 2026-06-01",
      "---",
      "",
      "# US-A-1 — Alpha story",
    ].join("\n"),
  );
  symlinkSync(
    join(alphaDir, "US-A-1", "2026-06-01T00-00-00"),
    join(alphaDir, "US-A-1", "latest"),
  );
  // Attest evidence (report + ac-map + screenshots → ladder = attested)
  writeFileSync(join(alphaDir, "US-A-1", "ac-map.json"), "[]");
  mkdirSync(join(alphaDir, "US-A-1", "latest", "screenshots"), { recursive: true });
  writeFileSync(
    join(alphaDir, "US-A-1", "latest", "US-A-1-report.html"),
    "<html><body>attest report</body></html>",
  );

  // Todo story with spec frontmatter
  mkdirSync(join(alphaDir, "US-A-2"), { recursive: true });
  writeFileSync(
    join(alphaDir, "US-A-2", "spec.md"),
    [
      "---",
      "id: US-A-2",
      "title: Alpha — second story (todo)",
      "type: us",
      "created: 2026-06-05",
      "---",
      "",
      "# US-A-2 — Second story",
    ].join("\n"),
  );

  // ── Epic "loop-observability" — one wip story ──
  mkdirSync(join(f, "loop-observability", "US-OBS-1"), { recursive: true });
  writeFileSync(
    join(f, "loop-observability", "US-OBS-1", "spec.md"),
    [
      "---",
      "id: US-OBS-1",
      "title: Observability first card",
      "type: us",
      "created: 2026-06-10",
      "---",
      "",
      "# US-OBS-1 — Observability card",
    ].join("\n"),
  );

  // ── Backlog ──
  writeFileSync(
    join(p, ".roll", "backlog.md"),
    [
      "| US-A-1 | Alpha — first shipped story | ✅ Done · PR#100 |",
      "| US-A-2 | Alpha — second story (todo) | 📋 Todo |",
      "| US-OBS-1 | Observability first card | 🔨 In Progress |",
    ].join("\n"),
  );

  // ── Cycle runs ──
  const loopDir = join(p, ".roll", "loop");
  mkdirSync(loopDir, { recursive: true });
  writeFileSync(
    join(loopDir, "runs.jsonl"),
    [
      `{"cycle_id":"c1","ts":"2026-06-20T10:00:00Z","status":"delivered","outcome":"delivered","cost_usd":0.5}`,
      `{"cycle_id":"c2","ts":"2026-06-20T11:00:00Z","status":"delivered","outcome":"delivered","cost_usd":0.8}`,
    ].join("\n"),
  );

  // ── Consistency audit ──
  mkdirSync(join(p, ".roll", "reports", "consistency"), { recursive: true });
  writeFileSync(
    join(p, ".roll", "reports", "consistency", "audit-1.json"),
    JSON.stringify({ generatedAt: "2026-06-20T10:00:00Z", summary: { fail: 0, warn: 1, unknown: 0 } }),
  );

  return p;
}

// ── Fixed extra inputs for renderTruthConsole (AC2: pinned, deterministic) ───
const SPINE = ["definition", "design", "execution", "delivery", "retrospective"];

function buildInput(snapshot: ReturnType<typeof collectDossierState>): TruthConsoleInput {
  const snapshotJson = serializeTruthSnapshot(snapshot);

  // Backlog: one shipping epic with the stories from the snapshot
  const backlog = {
    shipping: [
      {
        name: "delivery-dossier",
        done: 1,
        total: 2,
        stories: [
          { id: "US-A-1", epic: "delivery-dossier", type: "US", title: "Alpha — first shipped story", state: "done" as const, legacy: false, stages: SPINE },
          { id: "US-A-2", epic: "delivery-dossier", type: "US", title: "Alpha — second story (todo)", state: "todo" as const, legacy: false, stages: ["definition"] },
        ],
      },
      {
        name: "loop-observability",
        done: 0,
        total: 1,
        stories: [
          { id: "US-OBS-1", epic: "loop-observability", type: "US", title: "Observability first card", state: "wip" as const, legacy: false, stages: ["definition"] },
        ],
      },
    ],
    settled: [] as typeof backlog["shipping"],
  };

  const agents = [
    {
      name: "claude", display: "claude", runner: "Claude Code", version: "2.1.0",
      installed: true, cycles72h: 2, costUsd72h: 1.3,
      files: [{ path: "/home/u/.claude/CLAUDE.md", kind: "CLAUDE.md", state: "sync" as const }],
      syncStale: false,
    },
  ];

  const skills = {
    summary: { skills: 1, violations: 0 as number | "unknown", hubLines: 60, auditRan: true },
    groups: [
      { key: "delivery" as const, rows: [{
        name: "roll-build", group: "delivery" as const, hubLines: 60,
        description: "Load when shipping a story",
        violations: [], auditKnown: true, hasGotchas: true, hasLoadTrigger: true,
        routeCases: { positive: 2, negative: 2 }, usage: 1,
        files: [{ path: "SKILL.md", lines: 60, dir: false }],
        dirPath: "/repo/skills/roll-build", hubText: "# Roll Build\nhub text",
      }] },
      { key: "quality" as const, rows: [] },
      { key: "observe" as const, rows: [] },
      { key: "lifecycle" as const, rows: [] },
    ],
  };

  const casting = collectCasting({
    readSlot: (slot) => ({ easy: "kimi", default: "codex", hard: "claude", fallback: "claude" })[slot],
    sparPair: () => ["claude", "kimi"],
    onboardClient: () => undefined,
  });

  const releasePanel = {
    dims: [] as Array<{ key: string; tally: { fail: number; warn: number; unknown: number } }>,
    total: { fail: 0, warn: 0, unknown: 0 },
    blocking: false,
    generatedAt: "2026-06-20T12:00:00Z",
  };

  const charter = {
    defaultId: "docs/manifesto.md",
    groups: [
      {
        key: "charter" as const,
        docs: [{ id: "docs/manifesto.md", path: "docs/manifesto.md", title: "Manifesto", bodyEn: "<p>main is truth</p>", bodyZh: "<p>main is truth</p>", bilingual: false }],
      },
      { key: "guide" as const, docs: [] },
      { key: "plans" as const, docs: [] },
    ],
  };

  const releaseScope = { pending: [] as Array<{ id: string; epic: string; title: string }>, shipped: [] as Array<{ id: string; epic: string; title: string }>, pendingCount: 0, shippedCount: 0, history: [] as Array<{ tag: string; stories: Array<{ id: string; epic: string; title: string }> }> };

  return {
    snapshot,
    snapshotJson,
    brand: { name: "roll", slogan: "It just works." },
    backlog,
    spineKeys: SPINE,
    cycles: [],
    agents,
    releasePanel,
    skills,
    casting,
    charter,
    releaseScope,
    githubSlug: "seanyao/roll",
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────
renderState.useColor = false;

describe("US-OBS-017 — full-page dossier golden snapshot", () => {
  it("AC1: renders the full dossier page from collectDossierState fixture against a committed golden", () => {
    const cwd = fixture();
    // AC3: the golden is sourced from the SAME collectDossierState(cwd) selector
    const snapshot = collectDossierState(cwd);
    const input = buildInput(snapshot);
    const html = renderTruthConsole(input);

    // AC1: snapshot the WHOLE rendered HTML (not a fragment)
    expect(html).toMatchSnapshot();
  });

  it("AC2: the snapshot is deterministic — repeated renders produce identical output", () => {
    const cwd = fixture();
    const snapshotA = collectDossierState(cwd);
    const snapshotB = collectDossierState(cwd);

    const htmlA = renderTruthConsole(buildInput(snapshotA));
    const htmlB = renderTruthConsole(buildInput(snapshotB));

    // Same input → byte-identical output
    expect(htmlA).toBe(htmlB);
  });

  it("AC4: mutating a snapshot field changes the golden and would fail the snapshot", () => {
    const cwd = fixture();
    const snapshot = collectDossierState(cwd);
    const htmlOriginal = renderTruthConsole(buildInput(snapshot));

    // Mutate a field: change the story total
    const mutated = { ...snapshot, story: { ...snapshot.story, total: snapshot.story.total + 1 } };
    const htmlMutated = renderTruthConsole(buildInput(mutated as typeof snapshot));

    // The HTML should differ — proving the golden catches shape changes
    expect(htmlMutated).not.toBe(htmlOriginal);
  });

  it("AC4b: mutating the generatedAt timestamp changes the rendered page", () => {
    const cwd = fixture();
    const snapshot = collectDossierState(cwd);
    const htmlOriginal = renderTruthConsole(buildInput(snapshot));

    // Mutate generatedAt (a timestamp field that used to drift)
    const mutated = { ...snapshot, generatedAt: "2027-01-01T00:00:00Z" };
    const htmlMutated = renderTruthConsole(buildInput(mutated));

    // Different timestamp → different HTML
    expect(htmlMutated).not.toBe(htmlOriginal);
  });

  it("AC3: the test imports collectDossierState(cwd) — the same selector both surfaces use", () => {
    const cwd = fixture();
    const snapshot = collectDossierState(cwd);

    // Verify the snapshot has the expected shape from the fixture
    expect(snapshot.generatedAt).toBe("2026-06-20T12:00:00Z");
    expect(snapshot.story.total).toBeGreaterThanOrEqual(2);
    expect(snapshot.stories).toBeDefined();
    expect(snapshot.stories!.length).toBeGreaterThanOrEqual(2);
  });
});
