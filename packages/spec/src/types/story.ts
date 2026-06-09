/** Backlog contracts (BC1, I9). */
export type StoryId = string;

export type TaskLevel = "epic" | "feature" | "story" | "action";

export type StoryStatus = "todo" | "in_progress" | "done" | "hold";

/**
 * The single canonical markdown marker for each {@link StoryStatus}. This is the
 * ONE source of truth every writer (picker/reconcile/executor) and renderer
 * consumes — no consumer may hardcode a status literal of its own (REFACTOR-047).
 */
export const STATUS_MARKER: Record<StoryStatus, string> = {
  todo: "📋 Todo",
  in_progress: "🔨 In Progress",
  done: "✅ Done",
  hold: "🚫 Hold",
};

/**
 * The ONE parser from a raw backlog status cell to the typed {@link StoryStatus}.
 *
 * Keys on the LEADING marker glyph — the status emoji appears only as the marker,
 * never in the human reason text, so a hold whose reason reads "…全 Done 后…" is
 * not misread as done (the loose-substring bug). Historical triage markers
 * `🔒 Blocked` / `⏸ Deferred` fold into `hold` — the enum has no separate
 * deferred state; all three mean "parked, not pickable". Falls back to the status
 * WORD (terminal states first) only for emoji-less cells. Returns `null` for an
 * unrecognized cell so callers fail loud rather than silently dropping a row (the
 * v2 renderer's blindness to `🚫 Hold` bug).
 */
export function classifyStatus(cell: string): StoryStatus | null {
  if (cell.includes("✅")) return "done";
  if (cell.includes("🔨")) return "in_progress";
  if (cell.includes("🚫") || cell.includes("🔒") || cell.includes("⏸")) return "hold";
  if (cell.includes("📋")) return "todo";
  // Emoji-less fallback: match the status word, most-specific terminal first.
  if (cell.includes("Done")) return "done";
  if (cell.includes("In Progress")) return "in_progress";
  if (cell.includes("Hold") || cell.includes("Blocked") || cell.includes("Deferred")) return "hold";
  if (cell.includes("Todo")) return "todo";
  return null;
}

export type StoryType = "US" | "FIX" | "REFACTOR" | "IDEA";

export interface Story {
  id: StoryId;
  description: string;
  status: StoryStatus;
  /** IDs that must be done before this story may be picked. */
  dependsOn: StoryId[];
  /** Picker must skip these outright (human-reserved). */
  manualOnly?: boolean;
}
