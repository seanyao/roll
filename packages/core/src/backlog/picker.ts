/**
 * StoryPicker — TS port of the v2 "pick the next workable story" path.
 *
 * v2 oracle (frozen bash, bin/roll):
 *   - `_loop_pick_next_story` (~13129-13166): iterate the type prefixes in the
 *     order FIX → US → REFACTOR; within each prefix, walk the file top-to-bottom
 *     and return the FIRST row that (a) contains the literal `📋 Todo`, (b) whose
 *     id (extracted from the FIRST column only, never the description — FIX-161)
 *     starts with `<prefix>-`, and (c) is eligible.
 *   - `_loop_story_is_eligible` (~13094-13119):
 *       Gate 0: the row's LAST non-empty cell equals exactly `📋 Todo`.
 *       Gate 1: depends-on satisfied (see below).
 *       Gate 2 (FIX-141): no open PR title references the id (token-bounded).
 *   - `_loop_check_depends_on` (~11652-11689): read the row's `depends-on:` tag
 *     (regex `depends-on:[A-Za-z][A-Za-z0-9,-]+`, first occurrence), comma-split
 *     the ids; a dep is satisfied iff its own row exists AND is ✅ Done. No
 *     depends-on tag ⇒ trivially satisfied.
 *
 * manual-only: VERIFIED ABSENT from v2 story picking. `manual-only` in bin/roll
 * only tags roll-meta routing (FIX-172~175), never the loop story pick — neither
 * `_loop_pick_next_story` nor `_loop_story_is_eligible` consults it. So this port
 * implements status + depends-on + open-PR skip ONLY, matching v2 today.
 *
 * Purity: filesystem and `gh` stay out. The open-PR check is an injected
 * predicate; done-ness is computed from the parsed items themselves (mirroring
 * bash, which re-greps the same backlog file for each dep's status).
 */
import { classifyStatus, STATUS_MARKER } from "@roll/spec";
import type { BacklogItem } from "./store.js";

/** Substring the oracle greps for to decide a dependency is satisfied. */
const DONE = STATUS_MARKER.done;

/** Type prefixes in oracle pick priority order. */
const PREFIXES = ["FIX", "US", "REFACTOR"] as const;

/** Injected predicates that keep the picker pure. */
export interface PickOptions {
  /**
   * True iff an open PR already references this story id (re-picking would make
   * a duplicate PR — FIX-141). Optional; defaults to "no open PRs".
   */
  hasOpenPr?: (id: string) => boolean;
  /**
   * True iff this story already has a MERGED delivery in runs.jsonl — its
   * deliverable is on main, so it is Done and must NEVER be re-picked (FIX-323).
   * The picker only reads backlog status text and is blind to delivery truth;
   * a merged card that got reset to 📋 Todo (e.g. a prior cycle gave_up after
   * finding the work already merged) would otherwise be re-picked every cycle,
   * burning cost on a zombie. Optional; defaults to "no merged delivery".
   */
  hasMergedDelivery?: (id: string) => boolean;
  /**
   * FIX-363 (loop resilience): true iff this story is on the runtime skip-list —
   * it failed K times (a poison pill that, before this, halted the WHOLE loop
   * after 3 consecutive fails via the cron auto-PAUSE). The loop now SKIPS it and
   * keeps delivering OTHER cards, flagging the poison pill for owner attention
   * instead of stopping. Optional; defaults to "skip nothing". Runtime-only
   * (`.roll/loop/skip-cards.json`, gitignored) — it never mutates backlog truth.
   */
  shouldSkip?: (id: string) => boolean;
}

/** First occurrence of a depends-on tag, mirroring the bash regex. */
const DEPENDS_ON_RE = /depends-on:([A-Za-z][A-Za-z0-9,-]+)/;

/** Token-bounded id reference, mirroring bash gate 2 `${id}([^0-9A-Za-z]|$)`. */
function prTitleReferences(id: string, title: string): boolean {
  const idx = title.indexOf(id);
  if (idx < 0) return false;
  const after = title.charAt(idx + id.length);
  return after === "" || !/[0-9A-Za-z]/.test(after);
}

/** Parse a row's depends-on ids (first tag only); empty when none. */
export function parseDependsOn(desc: string): string[] {
  const m = DEPENDS_ON_RE.exec(desc);
  if (m === null) return [];
  return (m[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Build a done-ness index over the parsed items (bash re-greps the file per
 * dep; here we read the same parsed model). A dep is satisfied iff a row with
 * that id exists and its status contains the ✅ Done marker.
 *
 * Shared by `pickStory` and `assessBacklog` (US-LOOP-079b).
 */
export function buildDoneIndex(items: BacklogItem[]): (id: string) => boolean {
  return (id: string): boolean =>
    items.some((it) => it.id === id && it.status.includes(DONE));
}

/**
 * Eligibility predicate covering all 5 gates (single source of truth).
 *
 * Gates (order):
 *   0. Status classifies as `todo` (FIX-300).
 *   1. Every `depends-on` id resolves to ✅ Done.
 *   2. No open PR references the id (injected, FIX-141).
 *   3. No merged delivery for this id (injected, FIX-323).
 *   4. Not on the runtime skip-list (injected, FIX-363).
 *
 * Shared by `pickStory` and `assessBacklog` (US-LOOP-079b).
 */
export function isEligible(
  item: BacklogItem,
  isDone: (id: string) => boolean,
  opts: PickOptions = {},
): boolean {
  const hasOpenPr = opts.hasOpenPr ?? (() => false);
  const hasMergedDelivery = opts.hasMergedDelivery ?? (() => false);
  const shouldSkip = opts.shouldSkip ?? (() => false);

  // Recognize the Todo marker via the single-source classifier (FIX-300),
  // not an exact-string equality. An annotated status — the Todo marker
  // followed by parenthetical text (e.g. `📋 Todo (rebased)`) — is still a
  // Todo and must stay pickable; an exact `=== "📋 Todo"` check silently
  // dropped such rows and idled the loop (FIX-301).
  if (classifyStatus(item.status) !== "todo") return false;
  for (const dep of parseDependsOn(item.desc)) {
    if (!isDone(dep)) return false;
  }
  if (hasOpenPr(item.id)) return false;
  // FIX-323: a card whose deliverable already MERGED is Done — never re-pick,
  // even if its backlog status was (wrongly) reset to 📋 Todo. The picker is
  // blind to delivery truth, so this guard is injected from runs.jsonl.
  if (hasMergedDelivery(item.id)) return false;
  // FIX-363: a poison-pill card (failed K times) is on the runtime skip-list —
  // skip it so the loop keeps delivering OTHER cards instead of halting. The
  // card stays Todo in the backlog (truth unchanged); an owner clears the
  // skip-list (or fixes the card) to re-arm it.
  if (shouldSkip(item.id)) return false;
  return true;
}

/**
 * Pure pick: choose the next workable story from `items` (already in file
 * order), applying the oracle gates. Returns the chosen item or `undefined`.
 *
 * Gates per candidate:
 *   - status classifies as `todo` (FIX-300 classifier) — tolerant of an
 *     annotated marker, e.g. `📋 Todo (rebased)` (FIX-301), not exact-match
 *   - every depends-on id resolves to a row whose status contains `✅ Done`
 *   - no open PR references the id (injected predicate)
 * Priority: all FIX first (file order), then US, then REFACTOR.
 */
export function pickStory(items: BacklogItem[], opts: PickOptions = {}): BacklogItem | undefined {
  const isDone = buildDoneIndex(items);

  for (const prefix of PREFIXES) {
    for (const it of items) {
      if (!it.id.startsWith(`${prefix}-`)) continue;
      if (isEligible(it, isDone, opts)) return it;
    }
  }
  return undefined;
}
