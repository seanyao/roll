/**
 * US-CYCLE-004 — best-effort runner hook that records a role's turn into the
 * per-card round-journal. Auto-writes from the spawn/gate paths so there is no
 * manual step. NEVER throws and NEVER blocks the cycle's critical path — a
 * journal write is pure observability.
 */
import { appendRoundEntryAsync } from "@roll/core";
import type { CycleContext } from "@roll/core";
import { cardArchiveDir } from "../lib/archive.js";
import type { Ports } from "./ports.js";

export interface RoundTurn {
  /** builder | evaluator | designer | scorer | gate | … */
  role: string;
  /** Epoch ms when the turn started. */
  start: number;
  /** Wall-clock duration in ms. */
  durMs: number;
  /** delivered | failed | timeout | passed | blocked | … */
  outcome: string;
  /** Gate (local test/lint) time attributed to this turn, ms. */
  gateTimeMs?: number;
  /** Override the model (defaults to ctx.model). */
  model?: string;
}

/** The comparison-window label (dogfood era) — from env, else "unknown". */
function resolveEra(): string {
  const era = (process.env["ROLL_ERA"] ?? "").trim();
  return era === "" ? "unknown" : era;
}

/**
 * Append one turn to the card's round-journal. Best-effort AND non-blocking
 * (AC2): the write goes through the ASYNC append (fs.promises), fire-and-forget —
 * the caller returns immediately and the disk I/O yields the event loop instead
 * of freezing it, even on a slow/stalled filesystem. No round is computed here
 * (that would need a racy read-modify-write count); the readout DERIVES the
 * round from `cycleId`. Any rejection is swallowed — the cycle is never affected.
 *
 * The single-line jsonl append is the source of truth; the derived `.md` is NOT
 * written here (it is regenerated on demand by the readout).
 */
export function recordSpawnRound(ports: Ports, ctx: CycleContext, turn: RoundTurn): void {
  const storyId = ctx.storyId ?? "";
  if (storyId === "") return; // story-less cycles have no card to journal into
  const model = turn.model ?? (ctx.model !== undefined && ctx.model !== "" ? ctx.model : undefined);
  const cycleId = ctx.cycleId;
  let cardDir: string;
  try {
    cardDir = cardArchiveDir(ports.repoCwd, storyId);
  } catch {
    return; // cannot resolve a card dir → nothing to journal
  }
  // Fire-and-forget async append — never awaited, never blocks the hot path.
  void appendRoundEntryAsync(cardDir, {
    card: storyId,
    role: turn.role,
    ...(model !== undefined ? { model } : {}),
    start: turn.start,
    durMs: turn.durMs,
    outcome: turn.outcome,
    ...(turn.gateTimeMs !== undefined ? { gateTimeMs: turn.gateTimeMs } : {}),
    era: resolveEra(),
    ...(cycleId !== undefined && cycleId !== "" ? { cycleId } : {}),
  }).catch(() => {
    /* best-effort observability — never affect the cycle */
  });
}
