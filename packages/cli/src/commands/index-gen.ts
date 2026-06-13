/**
 * US-META-001 — `roll index`: (re)generate `.roll/index.json`, the authoritative
 * ID→epic map the archive layout uses to place a card's deliverables under
 * `features/<epic>/<ID>/`. Also regenerates `features/index.html`, redesigned
 * as the Delivery Dossier front page (US-DOSSIER-001a; supersedes the
 * US-META-003 flat table). Deterministic + idempotent.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHROME_CONTROLS, CHROME_CSS, CHROME_SCRIPT, bi } from "@roll/core";
import { parseEventLine } from "@roll/spec";
import { buildTruthSnapshot } from "@roll/core";
import { serializeTruthSnapshot } from "@roll/spec";
import { collectDossier, generateIndex } from "../lib/archive.js";
import { SPINE_STAGES, countLegacyStories, deriveDeliveryLadder, storySpectrumState, type TruthBoardInput, type TruthBoardVerdict } from "../lib/dossier-index.js";
import type { TruthSnapshotStoryEntry } from "@roll/spec";
import { renderTruthConsole, renderMachineStubPage, type BacklogEpicVM, type BacklogVM } from "../lib/truth-console.js";
import { collectProjectsRegistry } from "../lib/projects-registry.js";
import { collectCycleLedger } from "../lib/cycle-ledger.js";
import { collectAgentPanel } from "../lib/agent-panel.js";
import { collectReleasePanel } from "../lib/release-panel.js";
import { collectReleaseScope } from "../lib/release-scope.js";
import { collectSkillsPanel } from "../lib/skills-panel.js";
import { collectLoopHeartbeat, defaultHeartbeatDeps } from "../lib/loop-heartbeat.js";
import { launchAgentsDir } from "./loop-sched.js";
import { projectSlug } from "./dashboard.js";
import { morningReportHref } from "../lib/morning-report.js";
import { renderEpicPage } from "../lib/epic-page.js";
import { buildDossierRunCache, collectStoryDossierInput, renderStoryDossier, stationsDone, storyEvidenceFlags, storyHasMergeEvidence, type StoryDossierInput } from "../lib/story-dossier.js";
import { renderMarkdown } from "../lib/markdown.js";
import { cycleTruthFromRow, outcomeToPanel } from "../lib/truth-adapter.js";

function iso(sec: number): string {
  return new Date(sec * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function renderNowSec(): number {
  const v = process.env["ROLL_RENDER_NOW"] ?? "";
  if (v.trim() !== "") {
    const ms = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

function readJsonl(path: string): Array<Record<string, unknown>> | undefined {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const out: Array<Record<string, unknown>> = [];
  for (const line of content.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const v = JSON.parse(line) as unknown;
      if (typeof v === "object" && v !== null && !Array.isArray(v)) out.push(v as Record<string, unknown>);
    } catch {
      /* lenient snapshot reader */
    }
  }
  return out;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function tsSec(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string" || v === "") return undefined;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

function latestConsistencyAudit(projectPath: string): TruthBoardInput["audit"] | undefined {
  const dir = join(projectPath, ".roll", "reports", "consistency");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return undefined;
  }
  const latest = files.at(-1);
  if (latest === undefined) return undefined;
  try {
    const obj = JSON.parse(readFileSync(join(dir, latest), "utf8")) as Record<string, unknown>;
    const summary = obj["summary"];
    if (typeof summary !== "object" || summary === null || Array.isArray(summary)) return undefined;
    const rec = summary as Record<string, unknown>;
    const generatedAt = str(obj["generatedAt"]);
    return {
      fail: num(rec["fail"]) ?? 0,
      warn: num(rec["warn"]) ?? 0,
      unknown: num(rec["unknown"]) ?? 0,
      ...(generatedAt !== undefined ? { collectedAt: generatedAt } : {}),
    };
  } catch {
    return undefined;
  }
}

function cycleTruthBoard(projectPath: string, nowSec: number): TruthBoardInput["cycle"] | undefined {
  const path = join(projectPath, ".roll", "loop", "runs.jsonl");
  const cutoff = nowSec - 72 * 3600;
  const facts = readJsonl(path);
  if (facts === undefined) return undefined;
  const rows = facts.filter((r) => {
    const ts = tsSec(r["ts"]);
    return ts !== undefined && ts >= cutoff && ts <= nowSec;
  });
  let failed = 0;
  let cost = 0;
  let latestTs = 0;
  for (const row of rows) {
    const ts = tsSec(row["ts"]) ?? 0;
    latestTs = Math.max(latestTs, ts);
    const truth = cycleTruthFromRow(row, { nowSec });
    if (outcomeToPanel(truth.outcome, truth.state) === "fail") failed += 1;
    cost += num(row["cost_effective_usd"]) ?? num(row["cost_usd"]) ?? 0;
  }
  return {
    cycles3d: rows.length,
    failed3d: failed,
    costUsd3d: Number(cost.toFixed(4)),
    ...(latestTs > 0 ? { collectedAt: iso(latestTs) } : {}),
  };
}

function releaseVerdict(v: string | undefined): TruthBoardVerdict {
  if (v === "pass") return "pass";
  if (v === "blocked") return "fail";
  if (v === "waived") return "warn";
  return "unknown";
}

function releaseTruthBoard(projectPath: string, nowSec: number): TruthBoardInput["release"] | undefined {
  const path = join(projectPath, ".roll", "loop", "events.ndjson");
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  let latestGate: { tag?: string; verdict?: string; waivedRules: string[]; ts: number } | undefined;
  const activeWaivers: string[] = [];
  for (const line of content.split("\n")) {
    const ev = parseEventLine(line);
    if (ev === null) continue;
    if (ev.type === "release:gate") {
      latestGate = {
        tag: ev.tag,
        verdict: ev.verdict,
        waivedRules: ev.waivedRules,
        ts: ev.ts,
      };
    } else if (ev.type === "release:waiver" && ev.expiresSec > nowSec) {
      activeWaivers.push(ev.scope);
    }
  }
  if (latestGate === undefined) return undefined;
  const waiver = [...latestGate.waivedRules, ...activeWaivers].filter((x) => x.trim() !== "").join(", ");
  return {
    ...(latestGate.tag !== undefined ? { latestTag: latestGate.tag } : {}),
    verdict: releaseVerdict(latestGate.verdict),
    ...(waiver !== "" ? { waiver } : {}),
    collectedAt: iso(latestGate.ts),
  };
}

function maxCollectedAt(parts: Array<string | undefined>): string | undefined {
  let best = "";
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const p of parts) {
    if (p === undefined || p === "") continue;
    const ms = Date.parse(p);
    if (Number.isFinite(ms) && ms > bestMs) {
      best = p;
      bestMs = ms;
    } else if (!Number.isFinite(ms) && best === "") {
      best = p;
    }
  }
  return best === "" ? undefined : best;
}

export function collectTruthBoardInput(projectPath: string, nowSec = renderNowSec()): TruthBoardInput {
  const audit = latestConsistencyAudit(projectPath);
  const cycle = cycleTruthBoard(projectPath, nowSec);
  const release = releaseTruthBoard(projectPath, nowSec);
  const collectedAt = maxCollectedAt([audit?.collectedAt, cycle?.collectedAt, release?.collectedAt]);
  return {
    generatedAt: iso(nowSec),
    ...(collectedAt !== undefined ? { collectedAt } : {}),
    ...(audit !== undefined ? { audit } : {}),
    ...(cycle !== undefined ? { cycle } : {}),
    ...(release !== undefined ? { release } : {}),
  };
}

/** US-DOSSIER-004: render a card's spec.md → a self-contained spec.html (the
 *  minimal markdown renderer + dossier chrome), so the "Design doc" link opens
 *  a rendered page, not raw markdown. Returns null when spec.md is absent. */
function renderSpecHtml(storyDir: string, id: string): string | null {
  const specPath = join(storyDir, "spec.md");
  if (!existsSync(specPath)) return null;
  let md: string;
  try {
    md = readFileSync(specPath, "utf8");
  } catch {
    return null;
  }
  return (
    `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${id} · spec</title>\n<style>\n${CHROME_CSS}</style>\n${CHROME_SCRIPT}\n` +
    `</head>\n<body>\n${CHROME_CONTROLS}\n` +
    `<p class="crumb"><a href="index.html">← ${bi("Story Dossier", "故事档案")}</a></p>\n` +
    `<article class="md">\n${renderMarkdown(md)}\n</article>\n` +
    `<footer>Roll · ${bi("rendered from", "渲染自")} <code>spec.md</code></footer>\n</body>\n</html>\n`
  );
}

/** `roll index` — regenerate the backlog-derived ID→epic index + the three
 *  dossier layers (front page → epic pages → story dossiers, US-DOSSIER-001d). */
export function indexCommand(args: string[]): number {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      "Usage: roll index [--rebuild]\n" +
        "  Regenerate .roll/index.json + the Delivery Dossier (front page, every epic page).\n" +
        "  Story dossier pages are living mount boards: each lifecycle node mounts its own\n" +
        "  facts onto the existing page, so by default an existing story page is left intact.\n" +
        "  --rebuild  force a full re-render of every story page from source (reconciliation:\n" +
        "             derailed/hand-merged or migrated history cards). Overwrites mounted content.\n",
    );
    return 0;
  }
  // US-DOSSIER-007 (AC3): full re-render is the explicit reconciliation tool, not
  // the hot path — by default we never overwrite an existing story page (its
  // incremental mounts would be lost when source can't reconstruct them).
  const rebuild = args.includes("--rebuild");
  const cwd = process.cwd();
  const stories = generateIndex(cwd);
  const n = Object.keys(stories).length;
  process.stdout.write(`index.json regenerated\n索引已重建\n  ${n} stories mapped to epics (.roll/index.json)\n`);

  if (existsSync(join(cwd, ".roll", "features"))) {
    const pages = generateDossierPages(cwd, rebuild);
    process.stdout.write(`Delivery Dossier regenerated (${pages} pages)\n交付档案已重建（${pages} 页）\n`);
  }

  return 0;
}

/** US-DOSSIER-012: fold the dossier epics into the Backlog tab's view model —
 *  the SAME spectrum classifier the snapshot tally uses, so the counts match
 *  truth.json by construction. */
function backlogViewModel(epics: ReturnType<typeof collectDossier>): BacklogVM {
  const toVM = (e: (typeof epics)[number]): BacklogEpicVM => ({
    name: e.name,
    done: e.delivered,
    total: e.stories.length,
    stories: e.stories.map((s) => ({
      id: s.id,
      epic: s.epic,
      type: s.type,
      title: s.title ?? s.id,
      state: storySpectrumState(s),
      legacy: s.legacy === true,
      stages: [...(s.stages ?? [])],
    })),
  });
  const shipping: BacklogEpicVM[] = [];
  const settled: BacklogEpicVM[] = [];
  for (const e of epics) {
    if (e.stories.length > 0 && e.delivered === e.stories.length) settled.push(toVM(e));
    else shipping.push(toVM(e));
  }
  return { shipping, settled };
}

/**
 * Generate the dossier pages from the live card tree (US-DOSSIER-001a/b/c/d):
 * front page + every epic page always; story pages only when missing (mount
 * board, US-DOSSIER-007) unless `rebuild` forces a full re-render. Per-page
 * best-effort; returns the page count.
 */
export function generateDossierPages(cwd: string, rebuild: boolean): number {
  const featuresDir = join(cwd, ".roll", "features");
  if (!existsSync(featuresDir)) return 0;
  // FIX-275: ONE shared facts build for the whole run — git log snapshot,
  // project-wide self-score trend, spec refs + depends-on map (each was
  // previously recomputed per card). FIX-278: built BEFORE collectDossier so the
  // git snapshot can supply offline merge truth to the delivered derivation —
  // the rebuild path has no live PR-evidence snapshot, so a merge commit is what
  // keeps an already-merged card's delivered banner from being stripped.
  const runCache = buildDossierRunCache(cwd);
  const epics = collectDossier(cwd, { mergeEvidence: (id) => storyHasMergeEvidence(runCache.git, id) });
  // US-DOSSIER: enrich each story with its real lifecycle stations (read its
  // evidence via the same collector the per-story page uses) so the index spine
  // reflects definition→design→execution→delivery→retrospective accurately.
  // FIX-275: keep each card's collected input for the render phase below —
  // the same spec.md/ac-map/latest/notes were previously read TWICE per card.
  const inputs = new Map<string, StoryDossierInput>();
  for (const epic of epics) {
    for (const story of epic.stories) {
      try {
        const input = collectStoryDossierInput(cwd, story, runCache);
        inputs.set(`${epic.name}/${story.id}`, input);
        story.stages = [...stationsDone(input)];
      } catch {
        /* best-effort — spine just shows fewer stations */
      }
    }
  }
  // US-DOSSIER-021: the per-story delivery-ladder + evidence registry, built from
  // the SAME epic-sorted/id-sorted `collectDossier` walk so order is deterministic
  // (no Date.now()/Math.random()). The `merged` rung reuses the `delivered` signal
  // collectDossier already folds (truth selector + FIX-278 offline merge truth);
  // we never re-derive merge here. Carried onto the ONE snapshot below.
  const storyRegistry: TruthSnapshotStoryEntry[] = epics.flatMap((epic) =>
    epic.stories.map((story) => {
      const evidence = storyEvidenceFlags(cwd, story);
      return {
        id: story.id,
        epic: story.epic,
        ladder: deriveDeliveryLadder(story, evidence),
        evidence,
        truthState: storySpectrumState(story),
        ...(story.truthReason !== undefined ? { truthReason: story.truthReason } : {}),
        legacy: story.legacy === true,
      };
    }),
  );
  let pages = 0;
  try {
    // US-DOSSIER-010: ONE aggregation per run — the snapshot is serialized once,
    // written to truth.json AND embedded verbatim in index.html, so every
    // surface reads the same numbers from the same computation.
    const truth = collectTruthBoardInput(cwd);
    const snapshot = buildTruthSnapshot({
      generatedAt: truth.generatedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      ...(truth.collectedAt !== undefined ? { collectedAt: truth.collectedAt } : {}),
      storyStates: epics.flatMap((e) => e.stories.map(storySpectrumState)),
      legacyCount: countLegacyStories(epics),
      ...(truth.audit !== undefined ? { audit: truth.audit } : {}),
      ...(truth.cycle !== undefined ? { cycle: truth.cycle } : {}),
      ...(truth.release !== undefined ? { release: truth.release } : {}),
      // US-DOSSIER-011: the loop heartbeat is part of the ONE snapshot too.
      loop: collectLoopHeartbeat(defaultHeartbeatDeps(cwd, projectSlug(), launchAgentsDir())),
      // US-DOSSIER-021: the per-story ladder + evidence registry rides the SAME
      // snapshot, so truth.json and the index.html embed carry it identically.
      stories: storyRegistry,
    });
    const snapshotJson = serializeTruthSnapshot(snapshot);
    writeFileSync(join(featuresDir, "truth.json"), snapshotJson, "utf8");
    // US-DOSSIER-011: index.html IS the Truth Console now — five sticky tabs,
    // overview first; the legacy ledger lives on under the Backlog tab.
    writeFileSync(
      join(featuresDir, "index.html"),
      renderTruthConsole({
        snapshot,
        snapshotJson,
        brand: {
          name: process.env["ROLL_BRAND_NAME"] ?? "roll",
          slogan: process.env["ROLL_BRAND_SLOGAN"] ?? "It just works.",
        },
        backlog: backlogViewModel(epics),
        spineKeys: SPINE_STAGES.map((s) => s.key),
        cycles: collectCycleLedger(cwd),
        agents: collectAgentPanel(cwd),
        releasePanel: collectReleasePanel(cwd),
        skills: collectSkillsPanel(cwd),
        // US-DOSSIER-027: the top-bar project switcher reads the cross-project
        // registry (US-DOSSIER-028 writes it). Absent today → [] → the console
        // degrades to current-project-only via currentSlug, never erroring.
        projects: collectProjectsRegistry(),
        currentSlug: projectSlug(cwd),
        // kimi pair-review: the PR links need the repo slug — reuse the
        // FIX-275 git snapshot (one probe per run) instead of a fresh git call.
        ...(runCache.git?.slug !== undefined ? { githubSlug: runCache.git.slug } : {}),
        releaseScope: collectReleaseScope(
          cwd,
          epics.flatMap((e) =>
            e.stories.map((st) => ({
              id: st.id,
              epic: st.epic,
              title: st.title ?? st.id,
              state: storySpectrumState(st),
              ...(st.claim !== undefined ? { claim: st.claim } : {}),
            })),
          ),
        ),
      }),
      "utf8",
    );
    pages += 1;
    // US-DOSSIER-027: emit the four machine-global pages the top-bar breadcrumb
    // routes to (Agents · Skills · Conventions · About). Later stories fill them
    // with real content; today they are stub targets so the links never 404 and
    // already wear the sticky top-bar shell.
    const machineBar = {
      brand: { name: process.env["ROLL_BRAND_NAME"] ?? "roll", slogan: process.env["ROLL_BRAND_SLOGAN"] ?? "It just works." },
      snapshot,
      projects: collectProjectsRegistry(),
      currentSlug: projectSlug(cwd),
    };
    const MACHINE_PAGES = [
      ["agents", "agents.html"],
      ["skills", "skills.html"],
      ["conventions", "conventions.html"],
      ["about", "about.html"],
    ] as const;
    for (const [page, file] of MACHINE_PAGES) {
      try {
        writeFileSync(join(featuresDir, file), renderMachineStubPage({ ...machineBar, page }), "utf8");
        pages += 1;
      } catch {
        /* best-effort */
      }
    }
  } catch {
    /* best-effort */
  }
  for (const epic of epics) {
    try {
      writeFileSync(join(featuresDir, epic.name, "index.html"), renderEpicPage(epic), "utf8");
      pages += 1;
    } catch {
      /* best-effort */
    }
    for (const story of epic.stories) {
      const storyDir = join(featuresDir, epic.name, story.id);
      try {
        const storyIndex = join(storyDir, "index.html");
        // Mount board: only (re)render when forced or when the page is missing
        // (a brand-new card needs its initial skeleton).
        if (rebuild || !existsSync(storyIndex)) {
          writeFileSync(
            storyIndex,
            renderStoryDossier(inputs.get(`${epic.name}/${story.id}`) ?? collectStoryDossierInput(cwd, story, runCache)),
            "utf8",
          );
          pages += 1;
        }
        // US-DOSSIER-004: rendered spec.html the "Design doc" link points at.
        const specHtml = renderSpecHtml(storyDir, story.id);
        if (specHtml !== null) {
          writeFileSync(join(storyDir, "spec.html"), specHtml, "utf8");
          pages += 1;
        }
      } catch {
        /* best-effort */
      }
    }
  }
  return pages;
}

/**
 * FIX-231: truth-changing nodes (story new / attest / backlog set-status) call
 * this to keep the board's AGGREGATE pages fresh — front + epic pages follow
 * every state change instead of waiting for a manual `roll index`. Story pages
 * stay mount boards (only missing ones get a skeleton; mounted content is never
 * clobbered — US-DOSSIER-007). Best-effort by contract: a refresh failure WARNs
 * and never blocks the caller's main path.
 */
export function refreshAggregates(cwd: string): void {
  try {
    generateDossierPages(cwd, false);
  } catch (e) {
    process.stderr.write(`[roll] WARN dossier refresh failed (board may lag until \`roll index\`): ${String(e)}\n`);
  }
}
