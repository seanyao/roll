/**
 * US-OBS-037 — Collab view render contract + protocol legend (Layer A)
 *
 * Pure render primitives for the agent-collaboration visual vocabulary.
 * All functions are deterministic and never read a local clock getter:
 * timestamps are epoch-ms values supplied by the caller.
 */

import type { CollabCycleView, CollabEscalation, CollabStreamView } from "@roll/spec";
import { c, stripAnsi, strw } from "../render.js";

/** Layer A render options. */
export interface RenderOpt {
  /** When false, emit the same structural text without ANSI color codes. */
  color: boolean;
  /** When true, collapse consecutive same-shape steps into one folded line. */
  fold: boolean;
  /** Terminal width used for box drawing. */
  width?: number;
  /** Output language for role/action labels. */
  lang?: "en" | "zh";
}

export interface StreamRenderOpt extends RenderOpt {
  once: boolean;
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

// ── US-OBS-039: single-cycle collaboration view ───────────────────────────────

const LABELS = {
  en: {
    liveTitle: "Prime Agent Live — collaboration stream",
    snapshotTitle: "Prime Agent Live — collaboration snapshot",
    goalScope: "goal",
    supervisor: "supervisor",
    interventions: "interventions",
    supervise: "supervise",
    plan: "plan",
    buildLevel: "build",
    assign: "assign builder =",
    build: "build → TCR",
    handoffDiff: "handoff diff →",
    review: "peer review",
    score: "score",
    gate: "gate",
    escalation: "escalation",
    batonReturned: "baton returned from",
    toSupervisor: "to supervisor",
    walkedFull: "walked full protocol",
    split: "split",
    escalated: "escalated",
    supervisorFix: "supervisor fix",
    incomplete: "incomplete",
    scoreFailures: "score-failure folded",
    peerConsults: "peer consult folded",
    roleSupervise: "supervisor",
    roleBuild: "builder",
    rolePeer: "peer",
    roleScore: "scorer",
    rolePlanner: "planner",
  },
  zh: {
    liveTitle: "Prime Agent Live — 协同流",
    snapshotTitle: "Prime Agent Live — 协同快照",
    goalScope: "目标",
    supervisor: "supervisor",
    interventions: "介入层级",
    supervise: "监督",
    plan: "规划",
    buildLevel: "建造",
    assign: "指派 builder =",
    build: "建造 → TCR",
    handoffDiff: "交 diff →",
    review: "peer 评审",
    score: "打分",
    gate: "闸门",
    escalation: "升级",
    batonReturned: "棒子从",
    toSupervisor: "退回 supervisor",
    walkedFull: "走完整条协议链",
    split: "拆分",
    escalated: "升级",
    supervisorFix: "兜底亲建",
    incomplete: "未完结",
    scoreFailures: "score-failure 已折叠",
    peerConsults: "peer consult 已折叠",
    roleSupervise: "supervisor",
    roleBuild: "builder",
    rolePeer: "peer",
    roleScore: "scorer",
    rolePlanner: "planner",
  },
};

function mapFromRole(role: string): RoleKey {
  if (role === "build") return "build";
  if (role === "score") return "score";
  if (role === "review" || role === "peer") return "peer";
  return "supervise";
}

function roleName(role: string, labels: (typeof LABELS)["en"]): string {
  if (role === "build") return labels.roleBuild;
  if (role === "score") return labels.roleScore;
  if (role === "review" || role === "peer") return labels.rolePeer;
  if (role === "supervise" || role === "plan") return labels.roleSupervise;
  return role;
}

function terminusParts(terminus: CollabCycleView["terminus"], labels: (typeof LABELS)["en"]): [string, string] {
  switch (terminus) {
    case "walked_full":
      return [TERMINUS_GLYPH.walked_full, labels.walkedFull];
    case "escalated":
      return [TERMINUS_GLYPH.escalated, labels.escalated];
    case "split":
      return [TERMINUS_GLYPH.split, labels.split];
    case "supervisor_fix":
      return [TERMINUS_GLYPH.supervisor_fix, labels.supervisorFix];
    default:
      return ["", labels.incomplete];
  }
}

function escalationLines(
  e: CollabEscalation,
  supervisor: string,
  opt: RenderOpt,
  labels: (typeof LABELS)["en"],
): string[] {
  const fromRoleKey = mapFromRole(e.fromRole);
  const fromGlyph = renderRole(fromRoleKey, opt);
  const supGlyph = renderRole("supervise", opt);
  const header = `${labels.batonReturned} ${fromGlyph} ${roleName(e.fromRole, labels)} ${labels.toSupervisor} ${supGlyph}`;
  const detail = e.detail ? ` (${e.detail})` : "";
  const actionLine = `${renderRole("diagnose", opt)} ${supervisor} ${e.supervisorAction}${detail}`;
  return [header, actionLine];
}

/** Optional noise counters shown as folded pointers. */
export interface CollabRenderNoise {
  scoreFailures?: number;
  peerConsults?: number;
}

/** Render a single cycle as a protocol relay with handoffs and escalation. */
export function renderCollabCycle(
  view: CollabCycleView,
  opt: RenderOpt,
  noise?: CollabRenderNoise,
): string {
  const lang = opt.lang ?? "en";
  const labels = LABELS[lang];
  const lines: string[] = [];

  lines.push(`▌ ${formatTimeSpine(view.startedAtMs, opt)}  ${view.storyId}`);

  if (view.stance && (view.stance.level !== "supervise" || view.stance.note !== undefined)) {
    const roleGlyph = renderRole("supervise", opt);
    const levelText = view.stance.level === "plan" ? labels.rolePlanner : view.stance.level === "build" ? labels.supervisorFix : labels.roleSupervise;
    lines.push(`   ${roleGlyph}  ${levelText}${view.stance.note ? ` — ${view.stance.note}` : ""}`);
  }

  for (const h of view.handoffs) {
    switch (h.kind) {
      case "assign": {
        lines.push(`   ${renderHandoff("supervise", "build", opt)}  ${labels.assign} ${h.agent ?? "?"}`);
        break;
      }
      case "build": {
        lines.push(`      ${renderRole("build", opt)}  ${labels.build} ×${h.folded ?? 1}`);
        break;
      }
      case "review": {
        const peers = view.cast.peers.length > 0 ? view.cast.peers.join(" · ") : (h.agent ?? "?");
        const verdict = h.verdict ? withColor(opt, "green", `▸${h.verdict}`) : "";
        lines.push(`   ${renderHandoff("build", "peer", opt)}  ${labels.handoffDiff} ${peers}   ${verdict}`);
        break;
      }
      case "score": {
        const verdict = h.verdict ? withColor(opt, "green", `▸${h.verdict}`) : "";
        lines.push(`      ${renderRole("score", opt)}  ${labels.score}   ${verdict}`);
        break;
      }
      case "gate": {
        const verdict = h.verdict ? withColor(opt, "green", `▸${h.verdict}`) : "";
        lines.push(`      ${GATE_GLYPH}  ${labels.gate}   ${verdict}`);
        break;
      }
    }
  }

  if (view.escalation) {
    lines.push(renderEscalationCallout(escalationLines(view.escalation, view.cast.supervise, opt, labels), opt));
  }

  if (noise?.scoreFailures && noise.scoreFailures > 0) {
    lines.push(`   (+${noise.scoreFailures} ${labels.scoreFailures})`);
  }
  if (noise?.peerConsults && noise.peerConsults > 0) {
    lines.push(`   (+${noise.peerConsults} ${labels.peerConsults})`);
  }

  const [termGlyph, termLabel] = terminusParts(view.terminus, labels);
  const termText = `${termLabel} ${termGlyph}`;
  const ruleWidth = Math.max(2, boxWidth(opt) - strw(termText) - 1);
  lines.push(`${"─".repeat(ruleWidth)} ${termText}`);

  return lines.join("\n");
}

function foldedWalkedLine(
  views: readonly CollabCycleView[],
  opt: RenderOpt,
  labels: (typeof LABELS)["en"],
): string {
  const first = views[0]!;
  const last = views[views.length - 1]!;
  const stories = views.map((v) => v.storyId).join(" → ");
  const label = views.length > 1 ? `${labels.walkedFull} ${TERMINUS_GLYPH.walked_full} ×${views.length}` : `${labels.walkedFull} ${TERMINUS_GLYPH.walked_full}`;
  return `▌ ${formatTimeSpine(first.startedAtMs, opt)}..${formatTimeSpine(last.startedAtMs, opt)}  ${stories}\n` +
    `   ${renderRole("supervise", opt)} ${HANDOFF_GLYPH} ${renderRole("build", opt)} ${HANDOFF_GLYPH} ${renderRole("peer", opt)} ${HANDOFF_GLYPH} ${renderRole("score", opt)} ${HANDOFF_GLYPH} ${GATE_GLYPH}  ${label}`;
}

function streamChunks(cycles: readonly CollabCycleView[], opt: StreamRenderOpt): string[] {
  const chunks: string[] = [];
  let walkedRun: CollabCycleView[] = [];

  const flushWalked = (): void => {
    if (walkedRun.length === 0) return;
    const labels = LABELS[opt.lang ?? "en"];
    chunks.push(foldedWalkedLine(walkedRun, opt, labels));
    walkedRun = [];
  };

  for (const cycle of cycles) {
    if (opt.fold && cycle.terminus === "walked_full" && cycle.escalation === undefined) {
      walkedRun.push(cycle);
      continue;
    }
    flushWalked();
    chunks.push(renderCollabCycle(cycle, opt));
  }
  flushWalked();
  return chunks;
}

/** Render a multi-cycle collaboration stream for `roll supervisor live --collab`. */
export function renderCollabStream(view: CollabStreamView, opt: StreamRenderOpt): string {
  const lang = opt.lang ?? "en";
  const labels = LABELS[lang];
  const title = opt.once ? labels.snapshotTitle : labels.liveTitle;
  const lines = [
    "",
    `  ${title}`,
    "",
    `    ${labels.goalScope}: ${view.goalScope}`,
    `    ${labels.supervisor}: ${renderRole("supervise", opt)} ${view.supervisor}`,
    `    ${labels.interventions}: ${renderRole("supervise", opt)} ${labels.supervise} · ${renderRole("plan", opt)} ${labels.plan} · ${renderRole("build", opt)} ${labels.buildLevel}`,
    "",
  ];
  const chunks = streamChunks(view.cycles, opt);
  if (chunks.length === 0) {
    lines.push("    no cycle rows yet");
  } else {
    for (const chunk of chunks) {
      lines.push(chunk, "");
    }
  }
  return lines.join("\n") + "\n";
}
