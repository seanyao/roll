/**
 * US-OBS-037 — Collab view render contract + protocol legend (Layer A)
 *
 * Pure render primitives for the agent-collaboration visual vocabulary.
 * All functions are deterministic and never read a local clock getter:
 * timestamps are epoch-ms values supplied by the caller.
 */

import { c, stripAnsi } from "../render.js";

/** Layer A render options. */
export interface RenderOpt {
  /** When false, emit the same structural text without ANSI color codes. */
  color: boolean;
  /** When true, collapse consecutive same-shape steps into one folded line. */
  fold: boolean;
  /** Terminal width used for box drawing. */
  width?: number;
}

/** Canonical role glyphs from the Layer A protocol. */
export const ROLE_GLYPH = {
  supervise: "🧭",
  plan: "🧭",
  build: "🔨",
  peer: "🔎",
  score: "🎯",
  diagnose: "🔬",
} as const;

export type RoleKey = keyof typeof ROLE_GLYPH;

/** Gate glyph — rules, not people. */
export const GATE_GLYPH = "🚦";

/** Handoff glyph — the baton passes from one role to the next. */
export const HANDOFF_GLYPH = "→";

/** Escalation glyph — the baton returns to supervisor. */
export const ESCALATION_GLYPH = "⤴";

/** Verdict glyphs — only the outcome, never the process. */
export const VERDICT_GLYPH = {
  agree: "▸agree",
  good: "▸good",
  produced: "▸produced",
  ok: "▸ok",
} as const;

/** Terminus glyphs — where the baton ends, not success/failure. */
export const TERMINUS_GLYPH = {
  walked_full: "✓",
  split: "✂",
  escalated: ESCALATION_GLYPH,
  supervisor_fix: "🧭",
} as const;

export type TerminusKey = keyof typeof TERMINUS_GLYPH;

function withColor(opt: RenderOpt, color: string, text: string): string {
  return opt.color ? c(color, text) : text;
}

function boxWidth(opt: RenderOpt): number {
  return opt.width ?? 72;
}

/** Render a role glyph (and optional label) using the shared color palette. */
export function renderRole(role: RoleKey, opt: RenderOpt): string {
  const glyph = ROLE_GLYPH[role];
  // Supervise/plan are distinct in meaning but share the compass glyph.
  const color = role === "supervise" || role === "plan" ? "amber" : role === "build" ? "blue" : role === "peer" ? "purple" : role === "score" ? "green" : "pink";
  return withColor(opt, color, glyph);
}

/** Render a handoff line between two roles. */
export function renderHandoff(from: RoleKey, to: RoleKey, opt: RenderOpt): string {
  return `${renderRole(from, opt)} ${HANDOFF_GLYPH} ${renderRole(to, opt)}`;
}

/** Render an escalation callout that breaks the layout (full-width boxed). */
export function renderEscalationCallout(lines: string[], opt: RenderOpt): string {
  const w = boxWidth(opt);
  const top = "┏" + "━".repeat(w - 2) + "┓";
  const bottom = "┗" + "━".repeat(w - 2) + "┛";
  const badge = withColor(opt, "red", `${ESCALATION_GLYPH} escalation`);
  const header = `┃ ${badge}${" ".repeat(Math.max(0, w - 4 - stripAnsi(badge).length))} ┃`;
  const body = lines.map((line) => {
    const prefix = `┃ ${withColor(opt, "fg", line)}`;
    const pad = Math.max(0, w - 3 - stripAnsi(prefix).length);
    return prefix + " ".repeat(pad) + "┃";
  });
  return [top, header, ...body, bottom].join("\n");
}

/** Render a plain callout box (non-escalation) that also breaks the layout. */
export function renderCallout(title: string, lines: string[], opt: RenderOpt): string {
  const w = boxWidth(opt);
  const top = "┌" + "─".repeat(w - 2) + "┐";
  const bottom = "└" + "─".repeat(w - 2) + "┘";
  const titleLine = `│ ${withColor(opt, "blue", title)}${" ".repeat(Math.max(0, w - 4 - stripAnsi(title).length))} │`;
  const body = lines.map((line) => {
    const prefix = `│ ${withColor(opt, "fg", line)}`;
    const pad = Math.max(0, w - 3 - stripAnsi(prefix).length);
    return prefix + " ".repeat(pad) + "│";
  });
  return [top, titleLine, ...body, bottom].join("\n");
}

/** Format an epoch-ms timestamp as a deterministic time-spine label. */
export function formatTimeSpine(atMs: number, opt: RenderOpt): string {
  // Never read a local clock — caller provides the epoch-ms value.
  const d = new Date(atMs);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return withColor(opt, "muted", `${hh}:${mm}:${ss}`);
}

/** Fold consecutive same-shape strings into one line with a count. */
export function foldConsecutive(steps: string[]): string[] {
  if (steps.length === 0) return [];
  const out: string[] = [];
  let current = steps[0]!;
  let count = 1;
  for (let i = 1; i < steps.length; i += 1) {
    const step = steps[i]!;
    if (step === current) {
      count += 1;
      continue;
    }
    out.push(count > 1 ? `${current} ×${count}` : current);
    current = step;
    count = 1;
  }
  out.push(count > 1 ? `${current} ×${count}` : current);
  return out;
}

/** Render the Layer A protocol legend (data-independent "how to read" header). */
export function renderLegend(opt: RenderOpt): string {
  const roleLine = Object.entries(ROLE_GLYPH)
    .map(([key, glyph]) => `${glyph} ${key}`)
    .join("   ");
  const gateLine = `${GATE_GLYPH} gates (attest/truth)   ${HANDOFF_GLYPH} handoff   ${ESCALATION_GLYPH} escalation`;
  const verdictLine = Object.values(VERDICT_GLYPH).join("   ");
  const terminusLine = `${TERMINUS_GLYPH.walked_full} walked full protocol   ${TERMINUS_GLYPH.split} split   ${TERMINUS_GLYPH.escalated} escalated   ${TERMINUS_GLYPH.supervisor_fix} supervisor fix`;
  const lines = [
    withColor(opt, "fg", "Collab view — how to read"),
    withColor(opt, "muted", "Time spine uses a single epoch-ms axis (UTC)."),
    "",
    roleLine,
    gateLine,
    verdictLine,
    terminusLine,
  ];
  return lines.join("\n");
}
