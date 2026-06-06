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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** The uncategorized epic slug — the never-block fallback bucket. */
export const UNCATEGORIZED = "uncategorized";

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
