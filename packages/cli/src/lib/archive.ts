/**
 * US-META-001 — archive-layout write-side support.
 *
 * The card folder `.roll/features/<epic>/<ID>/` is the single home for a card's
 * deliverables (attest runs, screenshots, evidence). Locating the right epic for
 * a story is driven by a backlog-generated authoritative index
 * (`.roll/index.json`): a deterministic ID→epic map. Anything the index can't
 * place falls back to `features/uncategorized/<ID>/` — resolution NEVER blocks a
 * write (D1, same posture as attest's never-block failure policy).
 *
 * Lifecycle note: US-META-002a/b migrated the legacy `verification/<ID>/` trees
 * into card folders; US-META-002c retired the read-compat — the card folder is
 * the single home for a story's run artifacts.
 */
import { parseBacklog } from "@roll/core";
import { type AuditPrEvidence, type TruthReason, type TruthState } from "@roll/core";
import { markPhaseDone } from "./story-page.js";
import { classifyStatus, type StoryStatus } from "@roll/spec";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { storyTruthFromBacklog } from "./truth-adapter.js";

/** The uncategorized epic slug — the never-block fallback bucket. */
export const UNCATEGORIZED = "uncategorized";

/** Every feature markdown that could define a story, in resolution priority:
 *  ID-named owners (the legacy flat `<storyId>.md` and the card-folder
 *  `<storyId>/spec.md`, FIX-225 / US-META-001) first, then prose/content
 *  mentions in walk order. `findFeatureFile` takes the top candidate; AC
 *  extraction (attest) may walk PAST a content-free stub owner — a
 *  migrate-features `spec.md` (US-META-007) owns the card folder yet carries no
 *  `**AC:**` block, while the real ACs still live in the epic feature file
 *  (FIX-226). Exposing the full list lets that caller fall through. */
export function findFeatureFiles(projectPath: string, storyId: string): string[] {
  const root = join(projectPath, ".roll", "features");
  if (!existsSync(root)) return [];
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "notes" || e.name === "evidence" || e.name === "screenshots" || e.name === "latest") continue;
        if (/^\d{4}-\d{2}-\d{2}T/.test(e.name) || e.name.startsWith("cycle-") || e.name === "pre-evidence-backfill") continue;
        walk(p);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        const idOwned =
          e.name === `${storyId}.md` || (e.name === "spec.md" && basename(dir) === storyId);
        if (idOwned) hits.unshift(p); // ID-named owner wins
        else {
          try {
            if (readFileSync(p, "utf8").includes(storyId)) hits.push(p);
          } catch {
            /* unreadable file: skip */
          }
        }
      }
    }
  };
  try {
    walk(root);
  } catch {
    return [];
  }
  return hits;
}

/** The top feature markdown that defines a story (heading or AC owner); null
 *  when nothing matches. See {@link findFeatureFiles} for the full priority. */
export function findFeatureFile(projectPath: string, storyId: string): string | null {
  return findFeatureFiles(projectPath, storyId)[0] ?? null;
}

/** The card's report filename — carries the ID so a tab/download/share is
 *  self-identifying (owner 2026-06-06): `<ID>-report.html`. */
export function reportFileName(storyId: string): string {
  return `${storyId}-report.html`;
}

/** A directory name that can serve as an epic (not empty/`.`/the `features` root itself). */
function isEpicName(name: string): boolean {
  return name !== "" && name !== "." && name !== "features";
}

/**
 * Derive the epic from a feature file path — the single owner of the
 * `features/<epic>/<ID>/spec.md` layout knowledge.
 *
 * The file lives inside the story directory, so the epic is TWO levels up:
 *   spec.md → <ID>/ → <epic>/
 * Legacy fallback: a file directly under `features/<epic>/` (no story subdir)
 * takes its epic from ONE level up. Returns null when neither level yields one.
 */
export function epicFromFeaturePath(featureFile: string): string | null {
  const storyDir = dirname(featureFile);
  const epic = basename(dirname(storyDir));
  if (isEpicName(epic)) return epic;
  const legacy = basename(storyDir);
  return isEpicName(legacy) ? legacy : null;
}

/**
 * Resolve a story's epic by LIVE filesystem walk (see {@link epicFromFeaturePath}
 * for the layout rules). Returns null when the file is missing or has no epic
 * parent — falls back to `uncategorized` at the call site.
 */
export function liveEpicOf(projectPath: string, storyId: string): string | null {
  const file = findFeatureFile(projectPath, storyId);
  if (file === null) return null;
  return epicFromFeaturePath(file);
}

/**
 * FIX-275 — bulk epic resolution with ONE tree walk.
 *
 * `generateIndex` used to call {@link liveEpicOf} per backlog ID, each walking
 * the whole `.roll/features/` tree (O(ids × tree); 1m28s on the real repo at
 * card-count ~350). This resolver snapshots the walk once and resolves every ID
 * against it with the EXACT per-ID semantics:
 *   - ID-owned files (`<id>.md`, `<id>/spec.md`) beat content mentions; among
 *     several owners the LAST in walk order wins (the original `unshift`).
 *   - Otherwise the FIRST file in walk order whose content mentions the ID wins.
 *   - No hit → null (→ uncategorized at the call site).
 * Single-ID callers ({@link liveEpicOf} / {@link findFeatureFile}) are untouched.
 */
export function bulkLiveEpics(projectPath: string, ids: readonly string[]): Map<string, string | null> {
  const result = new Map<string, string | null>();
  const remaining = new Set(ids);
  const files: Array<{ path: string; name: string; dirName: string }> = [];
  const root = join(projectPath, ".roll", "features");
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "notes" || e.name === "evidence" || e.name === "screenshots" || e.name === "latest") continue;
        if (/^\d{4}-\d{2}-\d{2}T/.test(e.name) || e.name.startsWith("cycle-") || e.name === "pre-evidence-backfill") continue;
        walk(p);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        files.push({ path: p, name: e.name, dirName: basename(dir) });
      }
    }
  };
  try {
    if (existsSync(root)) walk(root);
  } catch {
    /* unreadable tree → every id resolves null, same as the per-ID walk */
  }
  // Pass 1: ID-owned files. Overwriting per walk order reproduces "later owner
  // wins" (each unshift put the newest owner at the head).
  const owner = new Map<string, string>();
  for (const f of files) {
    const id = f.name === "spec.md" ? f.dirName : f.name.slice(0, -3);
    if (remaining.has(id)) owner.set(id, f.path);
  }
  for (const [id, p] of owner) {
    result.set(id, epicFromFeaturePath(p));
    remaining.delete(id);
  }
  // Pass 2: content mentions — each file read at most ONCE, first hit wins.
  for (const f of files) {
    if (remaining.size === 0) break;
    let content: string;
    try {
      content = readFileSync(f.path, "utf8");
    } catch {
      continue;
    }
    for (const id of [...remaining]) {
      if (content.includes(id)) {
        result.set(id, epicFromFeaturePath(f.path));
        remaining.delete(id);
      }
    }
  }
  for (const id of remaining) result.set(id, null);
  return result;
}

/** Read `.roll/index.json` → ID→epic map; {} on absence / malformed (lenient). */
export function readIndex(projectPath: string): Record<string, string> {
  const p = join(projectPath, ".roll", "index.json");
  if (!existsSync(p)) return {};
  try {
    const obj = JSON.parse(readFileSync(p, "utf8")) as { stories?: Record<string, string> };
    const s = obj?.stories;
    if (s === undefined || s === null || typeof s !== "object") return {};
    return s;
  } catch {
    return {};
  }
}

/**
 * (Re)generate `.roll/index.json` from the backlog: every backlog story id whose
 * epic the live walk can place is recorded. Deterministic + idempotent (sorted,
 * no volatile fields). Returns the written map.
 */
export function generateIndex(projectPath: string): Record<string, string> {
  const backlogPath = join(projectPath, ".roll", "backlog.md");
  let ids: string[] = [];
  if (existsSync(backlogPath)) {
    try {
      ids = parseBacklog(readFileSync(backlogPath, "utf8")).map((it) => it.id);
    } catch {
      ids = [];
    }
  }
  // FIX-275: one walk for all ids (was a full-tree walk PER id).
  const bulk = bulkLiveEpics(projectPath, ids);
  const stories = buildStoryIndex(ids, (id) => bulk.get(id) ?? null);
  const rollDir = join(projectPath, ".roll");
  if (!existsSync(rollDir)) mkdirSync(rollDir, { recursive: true });
  writeFileSync(join(rollDir, "index.json"), serializeIndex(stories));
  return stories;
}

/**
 * The epic to place a story under, consulting the authoritative index first,
 * then a live walk, then null (→ uncategorized). attest stays usable even when
 * the index has not been regenerated yet.
 */
export function epicForStory(projectPath: string, storyId: string): string | null {
  const fromIndex = readIndex(projectPath)[storyId];
  if (fromIndex !== undefined && fromIndex !== "") return fromIndex;
  return liveEpicOf(projectPath, storyId);
}

/**
 * The WRITE destination for a card's deliverables: `features/<epic>/<ID>/`, or
 * `features/uncategorized/<ID>/` when no epic resolves. Never throws — resolution
 * never blocks a write (D1).
 */
export function cardArchiveDir(projectPath: string, storyId: string): string {
  const epic = epicForStory(projectPath, storyId) ?? UNCATEGORIZED;
  return join(projectPath, ".roll", "features", epic, storyId);
}

/**
 * US-DOSSIER-007 AC2: at PR-open, mount the EXECUTION section onto the story's
 * dossier page with the fact known *right now* — the PR number/link — rather
 * than leaving it for a later full re-render to reconstruct from squash-flattened
 * history (which loses it). Best-effort: returns false (never throws) when the
 * page or its execution anchor is absent. Idempotent via `markPhaseDone`.
 */
export function mountExecutionAtPublish(projectPath: string, storyId: string, prUrl: string): boolean {
  try {
    const idxPath = join(cardArchiveDir(projectPath, storyId), "index.html");
    if (!existsSync(idxPath)) return false;
    const html = readFileSync(idxPath, "utf8");
    const num = /\/pull\/(\d+)/.exec(prUrl)?.[1];
    const label = num !== undefined ? `PR #${num}` : "PR";
    const safe = prUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const mounted = markPhaseDone(html, "execution", `<p><a href="${safe}">${label}</a></p>`);
    if (mounted === html) return false; // no execution anchor matched
    writeFileSync(idxPath, mounted, "utf8");
    return true;
  } catch {
    return false;
  }
}

// US-META-002c: the legacy `.roll/verification/<ID>` read-compat
// (legacyArchiveDir / resolveReadArchiveDir) is retired — the tree is migrated
// (002b) and deleted; the card folder is the single home for run artifacts.

/**
 * Pure: build the ID→epic map from a list of story ids and an epic resolver.
 * Stories the resolver can't place (returns null) are OMITTED — at lookup time
 * they fall back to `uncategorized`, so the index only records confident hits.
 */
export function buildStoryIndex(ids: string[], epicOf: (id: string) => string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const epic = epicOf(id);
    if (epic !== null && epic !== "") out[id] = epic;
  }
  return out;
}

/**
 * Pure: serialize the index to deterministic JSON (sorted keys, trailing
 * newline). Same input → byte-identical output, so regeneration is idempotent.
 */
export function serializeIndex(stories: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(stories).sort()) sorted[k] = stories[k] as string;
  return JSON.stringify({ stories: sorted }, null, 2) + "\n";
}

// ── US-DOSSIER-001 — dossier data model ──────────────────────────────────────

/** One story as the dossier sees it (US-DOSSIER-001a minimal shape;
 *  001d extends with phases / AC status). */
export interface DossierStory {
  id: string;
  epic: string;
  /** ID family: US | FIX | REFACTOR | IDEA | … (prefix before the first dash). */
  type: string;
  /** Human title — spec.md frontmatter `title:`, else the H1 remainder. */
  title?: string;
  /** spec.md frontmatter `created:` when present. */
  created?: string;
  /** truth: a `latest/` attest pointer exists, OR the spec heading marks it ✅
   *  done (IDEA-003 — v2-migrated cards that predate the attest chain). When the
   *  card is in the backlog, that authoritative status decides (status==="done"). */
  delivered: boolean;
  /** The backlog status when this card is in .roll/backlog.md — the live source
   *  of truth the dossier aligns to (done | in_progress | hold | todo). Undefined
   *  for cards absent from the backlog (archived history). */
  status?: StoryStatus;
  /** Raw backlog status cell: the owner's claim, including PR annotations. */
  claim?: string;
  /** Truth selector verdict for backlog-present cards. Undefined for archive-only history. */
  truthState?: TruthState;
  truthReason?: TruthReason;
  /** Completed lifecycle stations (definition/design/execution/delivery/
   *  retrospective) for the index spine — computed from real evidence by the
   *  index command (stationsDone) and attached here; undefined until enriched. */
  stages?: readonly string[];
  /** US-DOSSIER-008: a *legacy* (pre-v3) delivery — done by the backlog's
   *  authority but with NO v3 evidence chain (no `latest/` attest pointer, no
   *  `ac-map.json`). Honoured as done, but marked apart so the board does not
   *  read it as half-finished just because the evidence-based spine is bare. */
  legacy: boolean;
}

export type DossierEpicDocKind = "overview" | "plan" | "doc";

export interface DossierEpicDoc {
  file: string;
  href: string;
  kind: DossierEpicDocKind;
  title: string;
}

/** One epic group with its wish→truth tally. */
export interface DossierEpic {
  name: string;
  stories: DossierStory[];
  delivered: number;
  docs?: DossierEpicDoc[];
}

export interface CollectDossierOptions {
  /** story id → delivery PR evidence snapshot. Absence means unavailable, not false. */
  prEvidence?: Record<string, AuditPrEvidence>;
  nowSec?: number;
  /** FIX-278: durable, offline merge-truth probe — true when git history carries
   *  a merge commit referencing this story id. Lets the rebuild path recover the
   *  delivered state without a live PR-evidence snapshot. Absence ⇒ no signal. */
  mergeEvidence?: (storyId: string) => boolean;
}

/**
 * A story heading whose text carries a ✅ status marker (IDEA-003 / owner ruling).
 * v2-migrated cards record their status in the heading itself
 * (`## US-XXX … ✅` done / `📋` todo / `🔨` wip). These predate the attest chain
 * and will never get a `latest/` report, so the ✅ on the heading is the card's
 * own evidence of completion — the dossier honours it as a delivered signal. The
 * FIRST story-id heading decides (a ✅ elsewhere in prose does not count). */
function specMarkedDone(text: string): boolean {
  for (const line of text.split("\n")) {
    if (!/^#{1,4}\s/.test(line)) continue;
    if (!/\b(?:US|FIX|REFACTOR|BUG|IDEA)-[A-Z0-9]/.test(line)) continue;
    return /✅/u.test(line);
  }
  return false;
}

/** Read a story's title/created/done-marker from its spec.md (frontmatter first, H1 fallback). */
function specMeta(specPath: string): { title?: string; created?: string; markedDone: boolean } {
  let text: string;
  try {
    text = readFileSync(specPath, "utf8");
  } catch {
    return { markedDone: false };
  }
  const out: { title?: string; created?: string; markedDone: boolean } = { markedDone: specMarkedDone(text) };
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  if (fm !== null) {
    const t = /^title:\s*(.+)$/m.exec(fm[1] ?? "");
    const c = /^created:\s*(.+)$/m.exec(fm[1] ?? "");
    if (t !== null) out.title = (t[1] ?? "").trim();
    if (c !== null) out.created = (c[1] ?? "").trim();
  }
  if (out.title === undefined) {
    // H1 fallback: `# <ID> — title` / `# <ID> · title` (hand-written specs).
    const h1 = /^#\s+\S+\s*(?:[—·:-]\s*)?(.*)$/m.exec(text);
    if (h1 !== null && (h1[1] ?? "").trim() !== "") out.title = (h1[1] ?? "").trim().replace(/\s*[✅🚫🔨].*$/u, "");
  }
  return out;
}

function markdownTitle(path: string, fallback: string): string {
  try {
    const text = readFileSync(path, "utf8");
    const h1 = /^#\s+(.+)$/m.exec(text);
    const title = (h1?.[1] ?? "").trim();
    if (title !== "") return title;
  } catch {
    /* unreadable doc: use filename fallback */
  }
  return fallback;
}

function epicDocKind(epic: string, file: string): DossierEpicDocKind {
  if (file === `${epic}.md`) return "overview";
  if (file.endsWith("-plan.md")) return "plan";
  return "doc";
}

function epicDocRank(kind: DossierEpicDocKind): number {
  if (kind === "overview") return 0;
  if (kind === "plan") return 1;
  return 2;
}

function compareEpicDocFile(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function collectEpicDocs(root: string, epic: string): DossierEpicDoc[] {
  const dir = join(root, epic);
  let files: string[] = [];
  try {
    files = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name);
  } catch {
    return [];
  }
  return files
    .map((file) => {
      const kind = epicDocKind(epic, file);
      const fallback = file.replace(/\.md$/, "");
      return {
        file,
        href: encodeURIComponent(file),
        kind,
        title: markdownTitle(join(dir, file), fallback),
      };
    })
    .sort((a, b) => epicDocRank(a.kind) - epicDocRank(b.kind) || compareEpicDocFile(a.file, b.file));
}

/**
 * Walk `.roll/features/` into the dossier model: every `<epic>/<ID>/` card
 * folder becomes a story (spec.md enriches it; a `latest/` pointer marks
 * truth). Epics sorted by name; stories by id. Pure read — no writes.
 */
export function collectDossier(projectPath: string, opts: CollectDossierOptions = {}): DossierEpic[] {
  const root = join(projectPath, ".roll", "features");
  if (!existsSync(root)) return [];
  // Align with the backlog: it is the live source of truth for type + status.
  // Build id → backlog StoryStatus so each card's state matches what the owner
  // reads in .roll/backlog.md (done/in_progress/hold/todo). Cards absent from
  // the backlog (archived history) fall back to the features-folder heuristic.
  const backlogStatus = new Map<string, StoryStatus>();
  const backlogRawStatus = new Map<string, string>();
  try {
    const backlogText = readFileSync(join(projectPath, ".roll", "backlog.md"), "utf8");
    for (const item of parseBacklog(backlogText)) {
      const st = classifyStatus(item.status);
      if (st !== null) backlogStatus.set(item.id, st);
      backlogRawStatus.set(item.id, item.status);
    }
  } catch {
    /* no backlog → heuristic-only */
  }
  const epics: DossierEpic[] = [];
  let epicDirs: string[] = [];
  try {
    epicDirs = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  for (const epic of epicDirs) {
    const stories: DossierStory[] = [];
    let entries: string[] = [];
    try {
      entries = readdirSync(join(root, epic), { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^[A-Z][A-Z0-9]*-/.test(e.name))
        .map((e) => e.name)
        .sort();
    } catch {
      continue;
    }
    for (const id of entries) {
      const dir = join(root, epic, id);
      const meta = specMeta(join(dir, "spec.md"));
      // Delivered = a v3 attest `latest/` report exists OR (IDEA-003) the card's
      // own heading marks it ✅ done — so v2-migrated history that predates the
      // attest chain reads as delivered when it carries evidence of completion.
      let delivered = meta.markedDone;
      let hasLatest = false;
      try {
        if (statSync(join(dir, "latest")).isDirectory()) {
          delivered = true; // follows symlink
          hasLatest = true;
        }
      } catch {
        /* no latest → fall back to the heading marker */
      }
      // Backlog carries the owner's claim; truth adjudication comes from the
      // selector. Without a PR evidence snapshot the selector returns unknown or
      // grandfathered instead of guessing that a Done claim has merged.
      const status = backlogStatus.get(id);
      const rawStatus = backlogRawStatus.get(id);
      // FIX-278: durable merge truth, reconstructed OFFLINE from git history (a
      // merge commit referencing this id, e.g. `… (#476)`). `roll index
      // --rebuild` passes no live PR-evidence snapshot, so the backlog selector
      // returns unknown for post-epoch cards — without this signal it would
      // strip the delivered banner off already-merged story pages (143 in one
      // real run). A merge commit IS the merge truth the selector is waiting on.
      const merged = opts.mergeEvidence?.(id) ?? false;
      const storyTruth = rawStatus !== undefined
        ? storyTruthFromBacklog(id, rawStatus, { prEvidence: opts.prEvidence?.[id], nowSec: opts.nowSec })
        : undefined;
      // The selector may PROMOTE a card to delivered (a confident live verdict);
      // git merge evidence CORROBORATES a backlog Done claim — claim + merged
      // code = delivered. Gating on status==="done" keeps this from promoting a
      // Todo card a commit body merely references, and keeps a *premature* Done
      // (claimed done but NOT merged) correctly not-delivered: the selector's
      // unknown stands. The selector may never ERASE a confirmed-merged card.
      if (storyTruth !== undefined) delivered = storyTruth.delivered || (status === "done" && merged);
      // US-DOSSIER-008: delivered with NO v3 evidence chain (no latest/ attest
      // pointer, no ac-map.json) ⇒ a pre-v3 legacy delivery — done, but never
      // re-instrumented to v3 rigor, so it is marked apart from evidenced cards.
      const legacy = delivered && !hasLatest && !existsSync(join(dir, "ac-map.json"));
      const story: DossierStory = {
        id,
        epic,
        type: (id.split("-")[0] ?? id).toUpperCase(),
        delivered,
        legacy,
      };
      if (status !== undefined) story.status = status;
      if (rawStatus !== undefined) story.claim = rawStatus;
      if (storyTruth !== undefined) {
        story.truthState = storyTruth.state;
        story.truthReason = storyTruth.reason;
      }
      if (meta.title !== undefined) story.title = meta.title;
      if (meta.created !== undefined) story.created = meta.created;
      stories.push(story);
    }
    if (stories.length > 0) {
      epics.push({
        name: epic,
        stories,
        delivered: stories.filter((s) => s.delivered).length,
        docs: collectEpicDocs(root, epic),
      });
    }
  }
  return epics;
}
