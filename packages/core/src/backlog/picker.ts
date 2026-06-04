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
import type { BacklogItem } from "./store.js";

/** Status string that marks a row pickable (exact, like the oracle). */
const TODO = "📋 Todo";
/** Substring the oracle greps for to decide a dependency is satisfied. */
const DONE = "✅ Done";

/** Type prefixes in oracle pick priority order. */
const PREFIXES = ["FIX", "US", "REFACTOR"] as const;

/** Injected predicates that keep the picker pure. */
export interface PickOptions {
  /**
   * True iff an open PR already references this story id (re-picking would make
   * a duplicate PR — FIX-141). Optional; defaults to "no open PRs".
   */
  hasOpenPr?: (id: string) => boolean;
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
 * Pure pick: choose the next workable story from `items` (already in file
 * order), applying the oracle gates. Returns the chosen item or `undefined`.
 *
 * Gates per candidate:
 *   - status === `📋 Todo` (exact)
 *   - every depends-on id resolves to a row whose status contains `✅ Done`
 *   - no open PR references the id (injected predicate)
 * Priority: all FIX first (file order), then US, then REFACTOR.
 */
export function pickStory(items: BacklogItem[], opts: PickOptions = {}): BacklogItem | undefined {
  const hasOpenPr = opts.hasOpenPr ?? (() => false);

  // Done-ness index over the parsed items (bash re-greps the file per dep; here
  // we read the same parsed model). A dep is satisfied iff a row with that id
  // exists and its status contains the ✅ Done marker.
  const isDone = (id: string): boolean =>
    items.some((it) => it.id === id && it.status.includes(DONE));

  const eligible = (it: BacklogItem): boolean => {
    if (it.status !== TODO) return false;
    for (const dep of parseDependsOn(it.desc)) {
      if (!isDone(dep)) return false;
    }
    if (hasOpenPr(it.id)) return false;
    return true;
  };

  for (const prefix of PREFIXES) {
    for (const it of items) {
      if (!it.id.startsWith(`${prefix}-`)) continue;
      if (eligible(it)) return it;
    }
  }
  return undefined;
}
