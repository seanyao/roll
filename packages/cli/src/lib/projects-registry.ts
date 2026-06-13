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
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
