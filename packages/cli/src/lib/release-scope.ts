/**
 * US-DOSSIER-016 — the release tab's pending-delivery and shipped-changelog
 * sections, plus the collapsible version history.
 *
 * The changelog half is generated from MERGE TRUTH, never from backlog claims:
 * `pr:merge` events when present, else the PR# annotation a Done row carries
 * (the same evidence the done-no-merge audit validates). Pending = every story
 * whose spectrum state is not yet done — by construction the same arithmetic
 * as the gate head's merged/pending bar (AC4).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEventLine } from "@roll/spec";

export interface ScopeStory {
  id: string;
  epic: string;
  title: string;
  state: string;
  prNumber?: number;
}

export interface ScopeEpicGroup {
  epic: string;
  items: ScopeStory[];
}

export interface ReleaseHistoryEntry {
  tag: string;
  date: string;
  waived: boolean;
  /** Raw changelog bullet lines for the version (already markdown-stripped). */
  items: string[];
}

export interface ReleaseScopeVM {
  pending: ScopeEpicGroup[];
  shipped: ScopeEpicGroup[];
  pendingCount: number;
  shippedCount: number;
  history: ReleaseHistoryEntry[];
}

export interface ScopeStoryInput {
  id: string;
  epic: string;
  title: string;
  /** Spectrum state from the ONE classifier (US-DOSSIER-010). */
  state: string;
  /** Raw backlog status cell (carries the PR# merge annotation). */
  claim?: string;
}

function groupByEpic(items: ScopeStory[]): ScopeEpicGroup[] {
  const map = new Map<string, ScopeStory[]>();
  for (const it of items) {
    const list = map.get(it.epic) ?? [];
    list.push(it);
    map.set(it.epic, list);
  }
  return [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([epic, list]) => ({ epic, items: list }));
}

/** PR number from merge truth: pr:merge event first, else the Done row's PR# annotation. */
function prFromEvents(projectPath: string): Map<string, number> {
  const out = new Map<string, number>();
  const path = join(projectPath, ".roll", "loop", "events.ndjson");
  if (!existsSync(path)) return out;
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const e = parseEventLine(line);
      if (e !== null && e.type === "pr:merge") out.set(e.storyId, e.prNumber);
    }
  } catch {
    /* best-effort */
  }
  return out;
}

export function collectReleaseScope(projectPath: string, stories: readonly ScopeStoryInput[]): ReleaseScopeVM {
  const prEvents = prFromEvents(projectPath);
  const pending: ScopeStory[] = [];
  const shipped: ScopeStory[] = [];
  for (const s of stories) {
    if (s.state === "done") {
      const fromEvent = prEvents.get(s.id);
      const fromClaim = /PR#(\d+)/.exec(s.claim ?? "")?.[1];
      const prNumber = fromEvent ?? (fromClaim !== undefined ? Number(fromClaim) : undefined);
      shipped.push({ id: s.id, epic: s.epic, title: s.title, state: s.state, ...(prNumber !== undefined ? { prNumber } : {}) });
    } else {
      pending.push({ id: s.id, epic: s.epic, title: s.title, state: s.state });
    }
  }
  return {
    pending: groupByEpic(pending),
    shipped: groupByEpic(shipped),
    pendingCount: pending.length,
    shippedCount: shipped.length,
    history: collectHistory(projectPath),
  };
}

/** Version history from CHANGELOG.md sections + waiver marks from gate events. */
export function collectHistory(projectPath: string): ReleaseHistoryEntry[] {
  const path = join(projectPath, "CHANGELOG.md");
  if (!existsSync(path)) return [];
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const waivedTags = new Set<string>();
  try {
    const ev = join(projectPath, ".roll", "loop", "events.ndjson");
    if (existsSync(ev)) {
      for (const line of readFileSync(ev, "utf8").split("\n")) {
        const e = parseEventLine(line);
        if (e !== null && e.type === "release:gate" && Array.isArray(e.waivedRules) && e.waivedRules.length > 0) {
          waivedTags.add(e.tag);
        }
      }
    }
  } catch {
    /* best-effort */
  }
  const out: ReleaseHistoryEntry[] = [];
  let current: ReleaseHistoryEntry | null = null;
  for (const line of text.split("\n")) {
    const head = /^## (v\S+)\s+—\s+(\S+)/.exec(line);
    if (head !== null) {
      if (current !== null) out.push(current);
      const tag = head[1] as string;
      current = { tag, date: head[2] as string, waived: waivedTags.has(tag), items: [] };
      continue;
    }
    if (current === null) continue;
    const item = /^- (.+)$/.exec(line.trim());
    if (item !== null && current.items.length < 30) {
      current.items.push((item[1] as string).replace(/`/g, "").replace(/\*\*/g, ""));
    }
  }
  if (current !== null) out.push(current);
  return out.slice(0, 8);
}
