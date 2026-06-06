/**
 * US-ATTEST-014 — the shared cycle-trace extractor (loop-fmt 三层口径).
 *
 * One reducer turns a cycle's raw {@link RollEvent} stream into a layered,
 * human-readable trace. Two of the three "口径" (granularities) live here as a
 * single chronological {@link TimelineEntry} list, each tagged with its layer:
 *
 *   - `outline` — the lifecycle spine: cycle:start → phases → cycle:end. The
 *     skeleton a reader skims to see "where the cycle got to".
 *   - `signal`  — the key turning points a reviewer actually cares about:
 *     TCR commits, Gate (CI / peer / attest), PR (open/merge/rebase/close) and
 *     ALERTs. Surfaced separately as {@link CycleSignals.turningPoints} so the
 *     signal layer is 一眼可辨.
 *
 * The third 口径 — the full raw transcript — is the cycle's agent log, not the
 * event stream; {@link boundTranscript} size-bounds it for inline embedding.
 *
 * Purity: no clock, no FS. Offsets are computed relative to the cycle's first
 * event (timezone-free, deterministic), so the same event stream always renders
 * byte-identical regardless of host locale. This is why US-PORT-012's
 * observation window can reuse the very same reducer.
 *
 * Scoping: events carrying a `cycleId` are kept only when it matches; events
 * WITHOUT a `cycleId` (pr:*, ci:*, alert:notify) are kept verbatim — the caller
 * is responsible for passing only the PR/CI/ALERT events relevant to this
 * cycle's story (it scopes them by storyId / prNumber upstream).
 */
import type { RollEvent } from "@roll/spec";

export type SignalLayer = "outline" | "signal";

export interface TimelineEntry {
  /** Raw event epoch (seconds or ms, as the event carried it). */
  ts: number;
  /** Whole seconds since the cycle's first event (>= 0; timezone-free). */
  offsetSec: number;
  layer: SignalLayer;
  /** Machine tag, e.g. `cycle:start`, `tcr`, `pr:merge`, `phase:execute`. */
  marker: string;
  /** Human one-liner (concise; bilingual where it helps). */
  label: string;
}

export interface CycleSignals {
  cycleId: string;
  /** Chronological, stable. Both layers interleaved. */
  timeline: TimelineEntry[];
  /** The signal-layer subset — tcr/Gate/PR/ALERT turning points only. */
  turningPoints: TimelineEntry[];
}

/** Normalize an event ts to whole seconds (ms epoch ≥ 1e12 → s). */
function toSeconds(ts: number): number {
  return ts >= 1e12 ? Math.floor(ts / 1000) : ts;
}

/** Clip a free-text field for a one-line label. */
function clip(s: string, n = 80): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
}

/**
 * US-PORT-012 — the canonical signal vocabulary (the "信号口径"). These are the
 * cross-cut turning points a reviewer traces: TCR commits, Gate (CI / peer /
 * attest), PR lifecycle, ALERT. BOTH consumers draw from this one list —
 * {@link extractCycleSignals} (RollEvent → timeline, for the attest report) and
 * the watch-window stream formatter (claude stream-json → tmux). "一处定义两处消费":
 * the markers and their human labels live here so the two surfaces can never
 * drift into two口径.
 */
export const SIGNAL_MARKERS = [
  "tcr",
  "ci:pass",
  "ci:fail",
  "ci:rerun",
  "peer:gate",
  "attest:gate",
  "pr:open",
  "pr:merge",
  "pr:rebase",
  "pr:close",
  "alert",
] as const;

export type SignalMarker = (typeof SIGNAL_MARKERS)[number];

const SIGNAL_MARKER_SET: ReadonlySet<string> = new Set(SIGNAL_MARKERS);

/** Is `m` one of the canonical signal markers? */
export function isSignalMarker(m: string): m is SignalMarker {
  return SIGNAL_MARKER_SET.has(m);
}

/**
 * A logical signal, source-agnostic: whether it came from a {@link RollEvent}
 * (attest) or was sniffed out of a claude stream-json line (watch), it lands
 * here. {@link signalLabel} turns it into the one canonical human one-liner.
 */
export type SignalInput =
  | { kind: "tcr"; commitHash: string; message: string }
  | { kind: "ci:pass"; prNumber: number }
  | { kind: "ci:fail"; prNumber: number; failSummary?: string }
  | { kind: "ci:rerun"; prNumber: number }
  | { kind: "peer:gate"; verdict: string }
  | { kind: "attest:gate"; verdict: string }
  | { kind: "pr:open"; prNumber: number }
  | { kind: "pr:merge"; prNumber: number }
  | { kind: "pr:rebase"; prNumber: number }
  | { kind: "pr:close"; prNumber: number; reason?: string }
  | { kind: "alert"; message: string };

/** ` · PR #N`, or "" when the number is absent (0) — the watch path's CI
 *  result text doesn't always carry one, and "PR #0" would read as a bug. */
function prSuffix(prNumber: number): string {
  return prNumber > 0 ? ` · PR #${prNumber}` : "";
}

/**
 * The single source of truth for a signal's human label. Both the attest
 * timeline and the tmux watch formatter call this, so "tmux 里看到的关键节点 =
 * 报告里 TCR log/时间线的同一份事实" is enforced by construction, not by
 * keeping two strings in sync.
 */
export function signalLabel(input: SignalInput): string {
  switch (input.kind) {
    case "tcr":
      return `TCR ${input.commitHash.slice(0, 9)} · ${clip(input.message)}`;
    case "ci:pass":
      return `Gate CI 通过${prSuffix(input.prNumber)}`;
    case "ci:fail":
      return `Gate CI 失败${prSuffix(input.prNumber)}${input.failSummary !== undefined && input.failSummary !== "" ? ` · ${clip(input.failSummary)}` : ""}`;
    case "ci:rerun":
      return `Gate CI 重跑${prSuffix(input.prNumber)}`;
    case "peer:gate":
      return `Peer gate · ${input.verdict}`;
    case "attest:gate":
      return `Attest gate · ${input.verdict}`;
    case "pr:open":
      return `PR #${input.prNumber} 开启 · opened`;
    case "pr:merge":
      return `PR #${input.prNumber} 合并 · merged`;
    case "pr:rebase":
      return `PR #${input.prNumber} rebase`;
    case "pr:close":
      return `PR #${input.prNumber} 关闭 · closed${input.reason !== undefined && input.reason !== "" ? ` · ${clip(input.reason)}` : ""}`;
    case "alert":
      return `ALERT · ${clip(input.message)}`;
  }
}

/**
 * Map ONE event to a timeline entry, or null when the event type is not part of
 * the per-cycle process trace (loop:* / policy:* / route:* / stdout are skipped
 * — they are not the turning points a reviewer traces). `offsetSec` is filled
 * by the caller (it needs the cycle's base ts).
 */
function toEntry(ev: RollEvent): Omit<TimelineEntry, "offsetSec"> | null {
  switch (ev.type) {
    case "cycle:start":
      return { ts: ev.ts, layer: "outline", marker: "cycle:start", label: `周期开始 · cycle start${ev.storyId !== "" ? ` · ${ev.storyId}` : ""}` };
    case "cycle:phase":
      return { ts: ev.ts, layer: "outline", marker: `phase:${ev.phase}`, label: `阶段 · phase · ${ev.phase}` };
    case "cycle:end":
      return { ts: ev.ts, layer: "outline", marker: "cycle:end", label: `周期结束 · cycle end · ${ev.outcome}` };
    case "cycle:tcr":
      return { ts: ev.ts, layer: "signal", marker: "tcr", label: signalLabel({ kind: "tcr", commitHash: ev.commitHash, message: ev.message }) };
    case "ci:pass":
      return { ts: ev.ts, layer: "signal", marker: "ci:pass", label: signalLabel({ kind: "ci:pass", prNumber: ev.prNumber }) };
    case "ci:fail":
      return { ts: ev.ts, layer: "signal", marker: "ci:fail", label: signalLabel({ kind: "ci:fail", prNumber: ev.prNumber, failSummary: ev.failSummary }) };
    case "ci:rerun":
      return { ts: ev.ts, layer: "signal", marker: "ci:rerun", label: signalLabel({ kind: "ci:rerun", prNumber: ev.prNumber }) };
    case "peer:gate":
      return { ts: ev.ts, layer: "signal", marker: "peer:gate", label: signalLabel({ kind: "peer:gate", verdict: ev.verdict }) };
    case "attest:gate":
      return { ts: ev.ts, layer: "signal", marker: "attest:gate", label: signalLabel({ kind: "attest:gate", verdict: ev.verdict }) };
    case "pr:open":
      return { ts: ev.ts, layer: "signal", marker: "pr:open", label: signalLabel({ kind: "pr:open", prNumber: ev.prNumber }) };
    case "pr:merge":
      return { ts: ev.ts, layer: "signal", marker: "pr:merge", label: signalLabel({ kind: "pr:merge", prNumber: ev.prNumber }) };
    case "pr:rebase":
      return { ts: ev.ts, layer: "signal", marker: "pr:rebase", label: signalLabel({ kind: "pr:rebase", prNumber: ev.prNumber }) };
    case "pr:close":
      return { ts: ev.ts, layer: "signal", marker: "pr:close", label: signalLabel({ kind: "pr:close", prNumber: ev.prNumber, reason: ev.reason }) };
    case "alert:notify":
      return { ts: ev.ts, layer: "signal", marker: "alert", label: signalLabel({ kind: "alert", message: ev.message }) };
    default:
      return null;
  }
}

/** Does this event belong to the cycle's trace? cycleId-bearing → must match. */
function inScope(ev: RollEvent, cycleId: string): boolean {
  if ("cycleId" in ev && typeof (ev as { cycleId?: unknown }).cycleId === "string") {
    return (ev as { cycleId: string }).cycleId === cycleId;
  }
  return true; // pr:* / ci:* / alert:notify — caller-scoped, kept verbatim
}

/** Reduce a cycle's event stream into the layered trace. Pure. */
export function extractCycleSignals(events: RollEvent[], cycleId: string): CycleSignals {
  const indexed = events
    .map((ev, i) => ({ ev, i }))
    .filter(({ ev }) => inScope(ev, cycleId));
  // stable chronological sort (ts asc, original order as tiebreaker)
  indexed.sort((a, b) => toSeconds(a.ev.ts) - toSeconds(b.ev.ts) || a.i - b.i);

  const partial = indexed.map(({ ev }) => toEntry(ev)).filter((e): e is Omit<TimelineEntry, "offsetSec"> => e !== null);
  const baseSec = partial.length > 0 ? toSeconds(partial[0]!.ts) : 0;
  const timeline: TimelineEntry[] = partial.map((e) => ({ ...e, offsetSec: Math.max(0, toSeconds(e.ts) - baseSec) }));

  return {
    cycleId,
    timeline,
    turningPoints: timeline.filter((t) => t.layer === "signal"),
  };
}

export interface BoundedTranscript {
  /** The (possibly middle-elided) text to embed. */
  text: string;
  truncated: boolean;
  /** Length (UTF-16 code units) of the original transcript. */
  totalLen: number;
  /** Length actually embedded (head + tail when truncated). */
  shownLen: number;
}

export interface BoundTranscriptOpts {
  /** Cap above which the middle is elided (default 60_000). */
  maxLen?: number;
  /** Head kept when over the cap (default 24_000). */
  headLen?: number;
  /** Tail kept when over the cap (default 24_000). */
  tailLen?: number;
}

/**
 * Size-bound a raw transcript for inline embedding: under the cap it passes
 * through untouched; over the cap the middle is elided with a clear bilingual
 * truncation marker and the original byte count, so a reader knows there is more
 * and the machine original (path indexed by the caller) holds the full record.
 * Pure & deterministic — length measured in UTF-16 code units, no Buffer.
 */
export function boundTranscript(raw: string, opts: BoundTranscriptOpts = {}): BoundedTranscript {
  const maxLen = opts.maxLen ?? 60_000;
  const headLen = opts.headLen ?? 24_000;
  const tailLen = opts.tailLen ?? 24_000;
  const totalLen = raw.length;
  if (totalLen <= maxLen) {
    return { text: raw, truncated: false, totalLen, shownLen: totalLen };
  }
  const head = raw.slice(0, headLen);
  const tail = raw.slice(totalLen - tailLen);
  const elided = totalLen - head.length - tail.length;
  const marker = `\n\n… 中间省略 ${elided} 字符 / ${elided} chars elided（完整原件见下方索引 · full log at the indexed path）…\n\n`;
  const text = head + marker + tail;
  return { text, truncated: true, totalLen, shownLen: head.length + tail.length };
}
