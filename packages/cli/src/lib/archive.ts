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
 * 不动存量 (this card): only the write side + the index + a GC command. The bulk
 * migration of existing `verification/<ID>/` trees into card folders is US-META-002;
 * until then attest keeps READING the old layout (see {@link resolveReadArchiveDir}).
 */
import { parseBacklog } from "@roll/core";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** The uncategorized epic slug — the never-block fallback bucket. */
export const UNCATEGORIZED = "uncategorized";

/** Locate the feature markdown that defines a story (heading or AC owner).
 *  An ID-named owner wins over a prose mention — both the legacy flat form
 *  (`<storyId>.md`) and the card-folder form (`<storyId>/spec.md`, FIX-225;
 *  US-META-001 layout). null when nothing matches. */
export function findFeatureFile(projectPath: string, storyId: string): string | null {
  const root = join(projectPath, ".roll", "features");
  if (!existsSync(root)) return null;
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".md")) {
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
    return null;
  }
  return hits[0] ?? null;
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
  const stories = buildStoryIndex(ids, (id) => liveEpicOf(projectPath, id));
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

/** The legacy run-store location (pre-archive layout): `.roll/verification/<ID>`. */
export function legacyArchiveDir(projectPath: string, storyId: string): string {
  return join(projectPath, ".roll", "verification", storyId);
}

/**
 * Read-compat resolver (US-META-001 → retired by US-META-002): the story-level
 * dir that actually holds runs. Prefers the new card folder; falls back to the
 * legacy `verification/<ID>` tree so already-delivered cards stay readable during
 * the migration window. null when neither exists yet.
 */
export function resolveReadArchiveDir(
  projectPath: string,
  storyId: string,
): { dir: string; layout: "card" | "legacy" } | null {
  const card = cardArchiveDir(projectPath, storyId);
  if (existsSync(card)) return { dir: card, layout: "card" };
  const legacy = legacyArchiveDir(projectPath, storyId);
  if (existsSync(legacy)) return { dir: legacy, layout: "legacy" };
  return null;
}

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
  /** truth: a `latest/` attestation pointer exists for the card. */
  delivered: boolean;
}

/** One epic group with its wish→truth tally. */
export interface DossierEpic {
  name: string;
  stories: DossierStory[];
  delivered: number;
}

/** Read a story's title/created from its spec.md (frontmatter first, H1 fallback). */
function specMeta(specPath: string): { title?: string; created?: string } {
  let text: string;
  try {
    text = readFileSync(specPath, "utf8");
  } catch {
    return {};
  }
  const out: { title?: string; created?: string } = {};
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

/**
 * Walk `.roll/features/` into the dossier model: every `<epic>/<ID>/` card
 * folder becomes a story (spec.md enriches it; a `latest/` pointer marks
 * truth). Epics sorted by name; stories by id. Pure read — no writes.
 */
export function collectDossier(projectPath: string): DossierEpic[] {
  const root = join(projectPath, ".roll", "features");
  if (!existsSync(root)) return [];
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
      let delivered = false;
      try {
        delivered = statSync(join(dir, "latest")).isDirectory(); // follows symlink
      } catch {
        /* no latest → wish only */
      }
      stories.push({
        id,
        epic,
        type: (id.split("-")[0] ?? id).toUpperCase(),
        ...specMeta(join(dir, "spec.md")),
        delivered,
      });
    }
    if (stories.length > 0) epics.push({ name: epic, stories, delivered: stories.filter((s) => s.delivered).length });
  }
  return epics;
}
