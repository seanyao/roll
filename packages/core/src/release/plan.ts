/**
 * roll release — version + flow planning (US-PORT-004, TS port).
 *
 * The Roll release scheme is calver: `<major>.<MMDD>.<seq>` (e.g. `3.606.2` =
 * major 3, June 6, the 2nd release that day). package.json is the single source
 * of truth for the running version (see packages/cli/src/commands/version.ts).
 *
 * These are PURE functions (no I/O, no clock): the date is always passed in so
 * they unit-test deterministically. The CLI adapter (packages/cli) reads the
 * current version + changelog state and supplies `new Date()`.
 *
 * `roll release` is READ-ONLY GUIDANCE — it computes the next version, surfaces
 * changelog readiness, and prints the ordered PR/tag flow. It never pushes a
 * tag or publishes: tagging triggers release.yml's consistency-gate and the
 * actual publish requires the maintainer's 2FA. This mirrors the loop's hard
 * rule — a release is always a human decision, never autonomous.
 */

/** A parsed calver version: `<major>.<mid>.<seq>` where mid encodes MMDD. */
export interface Version {
  major: number;
  /** month * 100 + day (e.g. June 6 → 606, Dec 5 → 1205). */
  mid: number;
  seq: number;
}

/** A release date — the day the release is cut. */
export interface ReleaseDate {
  year: number;
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
}

const DEFAULT_MAJOR = 3;

/** Parse a `<major>.<mid>.<seq>` calver string, or null if it does not conform. */
export function parseVersion(v: string): Version | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return { major: Number(m[1]), mid: Number(m[2]), seq: Number(m[3]) };
}

/** The MMDD middle segment for a release date: month * 100 + day. */
function midOf(date: ReleaseDate): number {
  return date.month * 100 + date.day;
}

/**
 * The next version under the calver scheme: the middle segment becomes today's
 * MMDD; the seq bumps when the current version already targets today, else
 * resets to 1. The current major is preserved (falls back to {@link DEFAULT_MAJOR}
 * when the current version is malformed).
 */
export function computeNextVersion(current: string, date: ReleaseDate): string {
  const parsed = parseVersion(current);
  const major = parsed?.major ?? DEFAULT_MAJOR;
  const mid = midOf(date);
  const seq = parsed && parsed.mid === mid ? parsed.seq + 1 : 1;
  return `${major}.${mid}.${seq}`;
}

/** Inputs for {@link planRelease}. */
export interface ReleasePlanInput {
  currentVersion: string;
  date: ReleaseDate;
  /** True when CHANGELOG.md has releasable notes for the planned release. */
  changelogReady: boolean;
}

/** A computed release plan — pure data the CLI renders into guidance. */
export interface ReleasePlan {
  currentVersion: string;
  nextVersion: string;
  /** The git tag whose push triggers release.yml: `v<nextVersion>`. */
  tag: string;
  changelogReady: boolean;
}

/** Build the release plan: next version, the `v*` tag, and changelog readiness. */
export function planRelease(input: ReleasePlanInput): ReleasePlan {
  const nextVersion = computeNextVersion(input.currentVersion, input.date);
  return {
    currentVersion: input.currentVersion,
    nextVersion,
    tag: `v${nextVersion}`,
    changelogReady: input.changelogReady,
  };
}
