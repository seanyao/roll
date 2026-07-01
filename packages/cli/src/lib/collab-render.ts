/**
 * US-OBS-037 — Collab view render contract + protocol legend (Layer A).
 *
 * Pure rendering primitives for the agent-collaboration observability surface.
 * The module exposes a stable visual vocabulary, a standalone `--legend` header,
 * escalation callouts, fold rules, and an epoch-only time spine.
 *
 * Hard constraints carried over from the design doc:
 * - The renderer NEVER reads a local-clock getter (Date.now() is not called here).
 * - All timestamps are passed in as epoch milliseconds; formatting is UTC HH:MM.
 * - Color is controlled entirely by `RenderOpt.color`; NO_COLOR parity is free.
 */

export interface RenderOpt {
  color: boolean;
  fold: boolean;
  tz: "epoch";
}

export type CollabRole = "supervise" | "build" | "peer" | "score" | "diagnose";

/** Role glyphs from the Layer A visual vocabulary (design doc §2). */
export const ROLE_GLYPH: Record<CollabRole, string> = {
  supervise: "🧭",
  build: "🔨",
  peer: "🔎",
  score: "🎯",
  diagnose: "🔬",
};

export const GATE_GLYPH = "🚦";
export const HANDOFF_GLYPH = "→";
export const ESCALATION_GLYPH = "⤴";
export const WALKED_FULL_GLYPH = "✓";
export const SPLIT_GLYPH = "✂";

const ROLE_LABEL: Record<CollabRole, string> = {
  supervise: "supervise/plan",
  build: "build",
  peer: "peer",
  score: "score",
  diagnose: "diagnose",
};

/** Box width for full-width callouts (matches the design doc examples). */
const CALLOUT_WIDTH = 66;

const ANSI: Record<string, string> = {
  blue: "\x1b[38;2;88;166;255m",
  green: "\x1b[38;2;63;185;80m",
  amber: "\x1b[38;2;210;153;34m",
  red: "\x1b[38;2;248;81;73m",
  purple: "\x1b[38;2;188;140;255m",
  pink: "\x1b[38;2;247;120;186m",
  muted: "\x1b[38;2;110;118;129m",
  dim: "\x1b[38;2;139;148;158m",
  fg: "\x1b[38;2;230;237;243m",
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

/** Wrap text in an ANSI color+bold sequence when color is enabled. */
export function paint(opt: RenderOpt, color: string, s: string, opts: { bold?: boolean } = {}): string {
  if (!opt.color) return s;
  return `${ANSI[color] ?? ""}${opts.bold === true ? BOLD : ""}${s}${RESET}`;
}

/** Render the Layer A protocol legend — independent of any cycle data. */
export function renderLegend(opt: RenderOpt): string {
  const lines: string[] = [
    paint(opt, "fg", "Layer A · Collab Protocol Legend", { bold: true }),
    "",
    `  ${ROLE_GLYPH.supervise} ${paint(opt, "purple", ROLE_LABEL.supervise)}   ${ROLE_GLYPH.build} ${paint(opt, "blue", ROLE_LABEL.build)}   ${ROLE_GLYPH.peer} ${paint(opt, "green", ROLE_LABEL.peer)}   ${ROLE_GLYPH.score} ${paint(opt, "amber", ROLE_LABEL.score)}   ${ROLE_GLYPH.diagnose} ${paint(opt, "pink", ROLE_LABEL.diagnose)}`,
    `  ${GATE_GLYPH} ${paint(opt, "red", "gates")}       attest · truth`,
    `  ${HANDOFF_GLYPH} ${paint(opt, "fg", "handoff")}    pass the baton`,
    `  ${ESCALATION_GLYPH} ${paint(opt, "amber", "escalate")}  baton returns to supervisor`,
    "",
    paint(opt, "purple", "🧭 supervisor + planner", { bold: true }),
    paint(opt, "fg", "┌───────────────────────────────────────────┐"),
    paint(opt, "fg", "│  SUPERVISOR  set goals · pick cards · watch ·兜底  │"),
    paint(opt, "fg", "│  PLANNER     too big → split · scope · route       │"),
    paint(opt, "fg", "└───────────────┬───────────────────────────┘"),
    paint(opt, "fg", "                │ ① assign roles (builder ≠ evaluator)"),
    paint(opt, "fg", "      ┌─────────┴──────────┐"),
    paint(opt, "fg", "      ▼                    ▼"),
    `  ${ROLE_GLYPH.build} ${paint(opt, "blue", "BUILDER", { bold: true })}            ${ROLE_GLYPH.peer}${ROLE_GLYPH.score} ${paint(opt, "green", "EVALUATOR", { bold: true })}`,
    "  execute pool          evaluate pool (avoid:execute)",
    "  TCR produces diff     independent peer review + score",
    paint(opt, "fg", "      │ ② hand off diff   │ ③ independent verdict"),
    paint(opt, "fg", "      └────────►───────────┘"),
    paint(opt, "fg", "                ▼"),
    `          ${GATE_GLYPH} ${paint(opt, "red", "GATES", { bold: true })}  attest · truth   ④ decide`,
    paint(opt, "fg", "                │"),
    paint(opt, "fg", "      delivered ✅ ──────┤"),
    paint(opt, "fg", "      bounced back ⤴ ────┤"),
    paint(opt, "fg", "                │"),
    paint(opt, "fg", "  ⑤ stuck/bounced/tool-broken → escalate to 🧭 → diagnose · fix · reassign"),
  ];
  return lines.join("\n") + "\n";
}

/** Display width after stripping ANSI escapes (CJK/emoji counted as 2 cells). */
function strw(s: string): number {
  const stripped = s.replace(/\x1b\[[\d;]*m/g, "");
  let w = 0;
  for (const ch of stripped) {
    const cp = ch.codePointAt(0) ?? 0;
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** Pad a line to the inner width of the callout box. */
function padCalloutLine(line: string): string {
  const innerWidth = CALLOUT_WIDTH - 4; // two box chars + two spaces
  const visible = strw(line);
  const pad = Math.max(0, innerWidth - visible);
  return `${line}${" ".repeat(pad)}`;
}

/**
 * Render a full-width boxed callout that breaks the layout.
 * Use this for escalation events (highest signal) per design doc §4.
 */
export function renderCallout(lines: readonly string[], opt: RenderOpt): string {
  const top = paint(opt, "amber", "┏" + "━".repeat(CALLOUT_WIDTH - 2) + "┓");
  const bottom = paint(opt, "amber", "┗" + "━".repeat(CALLOUT_WIDTH - 2) + "┛");
  const body = lines
    .map((line) => paint(opt, "amber", "┃ ") + padCalloutLine(line) + paint(opt, "amber", " ┃"))
    .join("\n");
  return `${top}\n${body}\n${bottom}\n`;
}

/** Render an inline handoff `from → to`. */
export function renderHandoff(from: CollabRole, to: CollabRole, opt: RenderOpt): string {
  return `${ROLE_GLYPH[from]} ${paint(opt, "dim", HANDOFF_GLYPH)} ${ROLE_GLYPH[to]}`;
}

/** Render a folded group line: `label ×N`. */
export function renderFoldGroup(label: string, count: number, opt: RenderOpt): string {
  return `${label} ${paint(opt, "muted", `×${count}`)}`;
}

/**
 * Format an epoch-millisecond timestamp as HH:MM UTC.
 * The renderer does NOT read the system clock — the caller supplies the value.
 */
export function formatEpochMs(ms: number, _opt: RenderOpt): string {
  const d = new Date(ms);
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
