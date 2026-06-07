/**
 * US-REL-SHIP — `roll release ship` plan: validate the preconditions for
 * tagging + pushing a release, purely from injected facts (the CLI gathers
 * git/consistency state; this stays IO-free and unit-testable).
 *
 * The release commit has ALREADY bumped package.json to the target version,
 * so the tag is `v<currentVersion>` — the version the working tree carries —
 * NOT planRelease's nextVersion (that is the not-yet-bumped guidance value).
 *
 * Hard rule preserved: ship NEVER runs npm publish and never bypasses 2FA.
 * It stops at the tag push that triggers release.yml. A human typing the
 * command is the human decision; the autonomous loop never calls it.
 */

/** Observable facts the CLI feeds in (all already gathered, no IO here). */
export interface ShipFacts {
  /** package.json version — becomes the tag target. */
  currentVersion: string;
  /** Current git branch. */
  branch: string;
  /** Working tree clean (no uncommitted changes)? */
  clean: boolean;
  /** Local HEAD === origin/<defaultBranch> (fetched, in sync)? */
  syncedWithOrigin: boolean;
  /** Does the tag `v<currentVersion>` already exist (local or remote)? */
  tagExists: boolean;
  /** Did `roll consistency check` pass all dimensions? */
  consistencyPass: boolean;
  /** The branch a release must be cut from (usually "main"). */
  defaultBranch: string;
}

export interface ShipPlan {
  ok: boolean;
  tag: string;
  /** Blocking reasons (empty iff ok). Stable keys for i18n + tests. */
  blockers: ShipBlocker[];
}

export type ShipBlocker =
  | "not-default-branch"
  | "dirty-tree"
  | "out-of-sync"
  | "tag-exists"
  | "consistency-failed";

/** Pure gate: returns the tag + any blocking reasons. ok ⇔ zero blockers. */
export function planShip(facts: ShipFacts): ShipPlan {
  const blockers: ShipBlocker[] = [];
  if (facts.branch !== facts.defaultBranch) blockers.push("not-default-branch");
  if (!facts.clean) blockers.push("dirty-tree");
  if (!facts.syncedWithOrigin) blockers.push("out-of-sync");
  if (facts.tagExists) blockers.push("tag-exists");
  if (!facts.consistencyPass) blockers.push("consistency-failed");
  return { ok: blockers.length === 0, tag: `v${facts.currentVersion}`, blockers };
}
