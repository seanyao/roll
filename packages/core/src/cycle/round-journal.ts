/**
 * US-CYCLE-004 — round-journal: a per-card, per-round, append-only mechanical
 * ledger of who did what for how long with what outcome. "Observe before you
 * optimize": every later efficiency lever needs a baseline, a comparison window
 * (by `era`), and a rollback criterion, and the current gate-time buckets don't
 * reconcile with the 30–60 min/card budget. This is the data spine.
 *
 * Truth source is `round-journal.jsonl` (one JSON object per line, append-only).
 * `round-journal.md` is a human-readable table DERIVED from the jsonl. Distinct
 * from `supervisor:journal` (a global narrative event stream): this is a
 * per-card-per-round machine ledger that reuses the atomic-append discipline,
 * not that event type. See the card spec's "8 questions" for the durability
 * contract (concurrency, schema evolution, bad-line tolerance, cleanup).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const ROUND_JOURNAL_SCHEMA_VERSION = 1;
export const ROUND_JOURNAL_JSONL = "round-journal.jsonl";
export const ROUND_JOURNAL_MD = "round-journal.md";

/** One row of the ledger: a single role's turn within a card's round. */
export interface RoundJournalEntry {
  schemaVersion: number;
  /** Card id (also implied by file location; kept in-line for portable reads). */
  card: string;
  /** Round index within the card (1-based; repair rounds increment it). */
  round: number;
  /** builder | evaluator | designer | scorer | gate | … */
  role: string;
  /** Resolved model, when known. */
  model?: string;
  /** Epoch ms when this turn started. */
  start: number;
  /** Wall-clock duration of this turn in ms. */
  durMs: number;
  /** delivered | failed | blocked | passed | timeout | … */
  outcome: string;
  /** Gate (local test/lint/CI-precheck) time attributed to this turn, ms. */
  gateTimeMs?: number;
  /** Comparison window label (e.g. a dogfood era) so baselines don't drift. */
  era?: string;
  /** Owning cycle id, when known. */
  cycleId?: string;
}

/** Fields a caller supplies; schemaVersion is stamped automatically. */
export type RoundJournalInput = Omit<RoundJournalEntry, "schemaVersion">;

function jsonlPath(cardDir: string): string {
  return join(cardDir, ROUND_JOURNAL_JSONL);
}
function mdPath(cardDir: string): string {
  return join(cardDir, ROUND_JOURNAL_MD);
}

/**
 * Append one entry to the card's jsonl ledger and re-render the .md table.
 * Best-effort: NEVER throws — an observability write must not block the cycle's
 * critical path (spawn/gate/delivery). Returns true iff the jsonl line landed.
 *
 * Concurrency: one line per entry via `appendFileSync` (POSIX O_APPEND is atomic
 * for a single write under PIPE_BUF), so concurrent roles/processes never
 * interleave a line. The .md is a derived view re-rendered atomically (tmp +
 * rename); jsonl remains the source of truth.
 */
export function appendRoundEntry(cardDir: string, input: RoundJournalInput): boolean {
  const entry: RoundJournalEntry = { schemaVersion: ROUND_JOURNAL_SCHEMA_VERSION, ...input };
  try {
    mkdirSync(cardDir, { recursive: true });
    const p = jsonlPath(cardDir);
    // Guard against a prior half-written line (a crash mid-append leaves a row
    // with no trailing newline): if the file does not end in "\n", prefix one so
    // this entry lands on its own line instead of concatenating onto the corrupt
    // tail. The corrupt row is then the ONLY casualty (skipped by the reader).
    let prefix = "";
    if (existsSync(p)) {
      try {
        const cur = readFileSync(p, "utf8");
        if (cur.length > 0 && !cur.endsWith("\n")) prefix = "\n";
      } catch {
        /* unreadable → append anyway; reader tolerates */
      }
    }
    appendFileSync(p, `${prefix}${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    return false; // best-effort — do not block delivery on a journal write
  }
  // NOTE: the derived `.md` is intentionally NOT re-rendered here. Rewriting the
  // whole table on every append is O(n) work on a hot path; the jsonl is the
  // source of truth, and the .md is regenerated on demand at read time
  // (`aggregateRounds`/the readout command call `renderRoundJournalMd`). Keeping
  // append to a single bounded line preserves the non-blocking contract (AC2).
  return true;
}

export interface ReadResult {
  entries: RoundJournalEntry[];
  /** Count of malformed/half-written lines skipped (bad-line tolerance). */
  skipped: number;
}

/**
 * Read all valid entries from the card's jsonl, tolerating malformed lines
 * (a half-written trailing line, a corrupt row) by skipping + counting them.
 * Missing file → empty result. Unknown/older schemaVersion fields are preserved
 * as-is (tolerant reader: never rejects a row for an unexpected field).
 */
export function readRoundEntries(cardDir: string): ReadResult {
  const p = jsonlPath(cardDir);
  if (!existsSync(p)) return { entries: [], skipped: 0 };
  let text: string;
  try {
    text = readFileSync(p, "utf8");
  } catch {
    return { entries: [], skipped: 0 };
  }
  const entries: RoundJournalEntry[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      // Required shape: role (string) + finite durMs (number). Anything else is
      // a malformed row (skipped + counted). Extra/unknown fields are preserved
      // for forward-schema tolerance; but SHARED fields the readout relies on
      // are normalized so a hand-corrupted value (e.g. `"era": 1`) can never
      // crash aggregation (localeCompare) or rendering downstream.
      if (raw !== null && typeof raw === "object" && typeof raw["role"] === "string" && typeof raw["durMs"] === "number" && Number.isFinite(raw["durMs"])) {
        const norm = { ...raw } as unknown as RoundJournalEntry;
        if (typeof raw["era"] !== "string") delete (norm as { era?: unknown }).era;
        if (typeof raw["model"] !== "string") delete (norm as { model?: unknown }).model;
        if (typeof raw["outcome"] !== "string") norm.outcome = String(raw["outcome"] ?? "");
        if (typeof raw["round"] !== "number") norm.round = 0;
        entries.push(norm);
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }
  return { entries, skipped };
}

// ─── aggregation / readout ───────────────────────────────────────────────────

export interface RoundStats {
  count: number;
  medianMs: number;
  meanMs: number;
  p90Ms: number;
  /** Sum(gateTimeMs) / Sum(durMs) as a 0..1 share — the "fixed overhead" proxy. */
  gateShare: number;
}

export interface EraStats extends RoundStats {
  era: string;
}

export interface RoundAggregate {
  overall: RoundStats;
  /** Per-era windows, sorted by era label. */
  byEra: EraStats[];
  skipped: number;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  // Nearest-rank; deterministic and dependency-free.
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx] ?? 0;
}

function statsFor(entries: readonly RoundJournalEntry[]): RoundStats {
  const durs = entries.map((e) => e.durMs).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const count = durs.length;
  if (count === 0) return { count: 0, medianMs: 0, meanMs: 0, p90Ms: 0, gateShare: 0 };
  const sum = durs.reduce((a, b) => a + b, 0);
  const totalGate = entries.reduce((a, e) => a + (Number.isFinite(e.gateTimeMs) ? (e.gateTimeMs ?? 0) : 0), 0);
  return {
    count,
    medianMs: percentile(durs, 50),
    meanMs: Math.round(sum / count),
    p90Ms: percentile(durs, 90),
    gateShare: sum > 0 ? totalGate / sum : 0,
  };
}

/** Aggregate a card's entries overall and split by `era` window. */
export function aggregateRounds(cardDir: string): RoundAggregate {
  const { entries, skipped } = readRoundEntries(cardDir);
  const eras = new Map<string, RoundJournalEntry[]>();
  for (const e of entries) {
    const key = e.era ?? "unknown";
    const bucket = eras.get(key);
    if (bucket) bucket.push(e);
    else eras.set(key, [e]);
  }
  const byEra: EraStats[] = [...eras.entries()]
    .map(([era, es]) => ({ era, ...statsFor(es) }))
    .sort((a, b) => a.era.localeCompare(b.era));
  return { overall: statsFor(entries), byEra, skipped };
}

// ─── human-readable .md view (derived from jsonl) ────────────────────────────

function isoOrDash(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  try {
    return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
  } catch {
    return "—";
  }
}

/** Render the derived human table atomically (tmp + rename). */
export function renderRoundJournalMd(cardDir: string, entries: readonly RoundJournalEntry[]): void {
  const lines: string[] = [
    "# Round journal",
    "",
    "> Derived from `round-journal.jsonl` (the append-only source of truth). Do not edit by hand.",
    "",
    "| round | role | model | start | dur (s) | gate (s) | outcome | era |",
    "|------:|------|-------|-------|--------:|---------:|---------|-----|",
  ];
  for (const e of entries) {
    const durS = (e.durMs / 1000).toFixed(1);
    const gateS = e.gateTimeMs !== undefined ? (e.gateTimeMs / 1000).toFixed(1) : "—";
    lines.push(
      `| ${e.round} | ${e.role} | ${e.model ?? "—"} | ${isoOrDash(e.start)} | ${durS} | ${gateS} | ${e.outcome} | ${e.era ?? "unknown"} |`,
    );
  }
  lines.push("");
  const target = mdPath(cardDir);
  const tmp = `${target}.tmp`;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(tmp, lines.join("\n"), "utf8");
  renameSync(tmp, target);
}

/** One-line-per-era readout string (median/mean/p90/gate-share), for the CLI. */
export function formatRoundReadout(agg: RoundAggregate): string {
  const fmt = (s: RoundStats): string =>
    `n=${s.count} median=${(s.medianMs / 1000).toFixed(1)}s mean=${(s.meanMs / 1000).toFixed(1)}s p90=${(s.p90Ms / 1000).toFixed(1)}s gate=${(s.gateShare * 100).toFixed(0)}%`;
  const out: string[] = [`overall: ${fmt(agg.overall)}`];
  for (const e of agg.byEra) out.push(`era ${e.era}: ${fmt(e)}`);
  if (agg.skipped > 0) out.push(`(${agg.skipped} malformed line(s) skipped)`);
  return out.join("\n");
}
