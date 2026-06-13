/**
 * US-DOSSIER-027 — read the cross-project registry `~/.roll/projects.json` for
 * the Truth Console top-bar project switcher. READ-ONLY here: US-DOSSIER-028
 * authors/refreshes the file (one row per project, upsert by slug). This module
 * only consumes it, and degrades gracefully to current-project-only whenever the
 * file is absent, empty, or malformed — the snapshot is honest, never erroring.
 *
 * Schema (US-DOSSIER-028 contract): a JSON array of rows
 *   { name, slug, path, releaseTag?, verdict?, lastIndexedAt? }
 * `--json` output of `roll ls` equals this file verbatim, so the registry is the
 * ONE source both the web switcher and the CLI listing read.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ProjectRegistryEntry } from "./truth-console.js";

/** The machine-level registry path (`~/.roll/projects.json`). */
export function projectsRegistryPath(home: string = homedir()): string {
  return join(home, ".roll", "projects.json");
}

/**
 * Parse the registry JSON text into well-formed rows. Pure + total: any shape
 * that is not "an array of objects with at least { name, slug, path } strings"
 * yields an empty list rather than throwing, so a malformed machine file can
 * never crash `roll index`. Deterministic: rows are sorted by name (then slug)
 * so the switcher order does not depend on write order across projects.
 */
export function parseProjectsRegistry(text: string): ProjectRegistryEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  // Tolerate either a bare array (the contract) or a `{ projects: [...] }` wrap.
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { projects?: unknown }).projects)
      ? (raw as { projects: unknown[] }).projects
      : [];
  const out: ProjectRegistryEntry[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r["name"] !== "string" || typeof r["slug"] !== "string" || typeof r["path"] !== "string") continue;
    const entry: ProjectRegistryEntry = { name: r["name"], slug: r["slug"], path: r["path"] };
    if (typeof r["releaseTag"] === "string") entry.releaseTag = r["releaseTag"];
    if (typeof r["verdict"] === "string") entry.verdict = r["verdict"];
    if (typeof r["lastIndexedAt"] === "string") entry.lastIndexedAt = r["lastIndexedAt"];
    out.push(entry);
  }
  out.sort((a, b) => (a.name === b.name ? a.slug.localeCompare(b.slug) : a.name.localeCompare(b.name)));
  return out;
}

/**
 * Read + parse `~/.roll/projects.json`. Returns `[]` when the file is missing or
 * unreadable — the single-project degrade is the caller's default (it falls back
 * to the current project alone). `home` is injectable for tests.
 */
export function collectProjectsRegistry(home: string = homedir()): ProjectRegistryEntry[] {
  let text: string;
  try {
    text = readFileSync(projectsRegistryPath(home), "utf8");
  } catch {
    return [];
  }
  return parseProjectsRegistry(text);
}

/** The ONE serialization both `roll index` writes and `roll ls --json` echoes
 *  verbatim — a JSON array of rows, 2-space indented, trailing newline. The
 *  array is the contract (US-DOSSIER-027 reads it as a bare array), so the
 *  switcher and the CLI never disagree on shape. */
export function serializeProjectsRegistry(rows: ProjectRegistryEntry[]): string {
  return `${JSON.stringify(rows, null, 2)}\n`;
}

/**
 * Pure upsert: replace (or append) the row whose `slug` matches `entry.slug`,
 * keeping every other project's row untouched, and re-sort deterministically by
 * name (then slug) — the SAME order `parseProjectsRegistry` guarantees, so the
 * registry order never depends on which project last ran `roll index`. Other
 * projects' rows are NEVER dropped (the machine file is shared; a concurrent
 * `roll index` in another repo must survive this write).
 */
export function upsertProjectRow(
  existing: ProjectRegistryEntry[],
  entry: ProjectRegistryEntry,
): ProjectRegistryEntry[] {
  const out = existing.filter((r) => r.slug !== entry.slug);
  out.push(entry);
  out.sort((a, b) => (a.name === b.name ? a.slug.localeCompare(b.slug) : a.name.localeCompare(b.name)));
  return out;
}

/**
 * Read-modify-write `~/.roll/projects.json`: UPSERT this project's row by slug
 * and write the whole array back atomically (temp file + rename), so a partial
 * write can never corrupt the shared machine file and a concurrent index in
 * another repo only loses the race, never its row. Re-reads the file just
 * before writing (last-writer-wins per slug) — we never integrate a stale
 * in-memory copy. Best-effort by contract: never throws into `roll index`'s
 * main path; returns the row list it wrote (or `existing` on failure).
 */
export function writeProjectRow(entry: ProjectRegistryEntry, home: string = homedir()): ProjectRegistryEntry[] {
  const path = projectsRegistryPath(home);
  const existing = collectProjectsRegistry(home);
  const merged = upsertProjectRow(existing, entry);
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, serializeProjectsRegistry(merged), "utf8");
    renameSync(tmp, path);
    return merged;
  } catch {
    return existing;
  }
}
