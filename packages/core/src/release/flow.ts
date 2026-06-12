/**
 * US-REL-007 — the ONE release flow's pure pieces. `roll release` is the only
 * release command: it owns version bump → changelog fold → package gate →
 * release PR → merge → consistency gate → tag push, in that order, every
 * irreversible step behind an earlier gate. These helpers are deterministic so
 * the transaction is unit-testable without git/gh.
 */

export interface ChangelogFold {
  /** The rewritten CHANGELOG.md text. */
  text: string;
  /** The folded section body (the release notes). */
  notes: string;
}

/**
 * Fold `## Unreleased` into `## v<version> — <date>`. Fail-loud contract: an
 * absent Unreleased section or one without a single bullet returns null — an
 * empty changelog must abort the release before anything mutates.
 * A pre-written `## v<version>` section (the FIX-226 convention) is accepted
 * as already-folded: returns the text unchanged with its notes.
 */
export function foldUnreleased(text: string, version: string, dateStr: string): ChangelogFold | null {
  const heading = `## v${version} — ${dateStr}`;
  const pre = new RegExp(`^## v${version.replace(/\./g, "\\.")}\\b.*$`, "m").exec(text);
  if (pre !== null) {
    const body = sectionBody(text, pre.index + pre[0].length);
    return hasBullet(body) ? { text, notes: body.trim() } : null;
  }
  const idx = text.indexOf("## Unreleased");
  if (idx === -1) return null;
  const body = sectionBody(text, idx + "## Unreleased".length);
  if (!hasBullet(body)) return null;
  const before = text.slice(0, idx);
  const after = text.slice(idx + "## Unreleased".length + body.length);
  return {
    text: `${before}## Unreleased\n\n${heading}${body.replace(/^\n*/, "\n\n")}${after}`,
    notes: body.trim(),
  };
}

function sectionBody(text: string, from: number): string {
  let body = text.slice(from);
  const next = body.search(/\n## /);
  if (next !== -1) body = body.slice(0, next + 1);
  return body;
}

function hasBullet(s: string): boolean {
  return /^\s*-\s+\S/m.test(s);
}

/** The transaction's ordered steps — names are the observable progress output. */
export const RELEASE_STEPS = [
  "plan",
  "fold-changelog",
  "bump-version",
  "package-gate",
  "commit-push",
  "open-pr",
  "wait-merge",
  "sync-main",
  "consistency-gate",
  "tag-push",
] as const;
export type ReleaseStep = (typeof RELEASE_STEPS)[number];
