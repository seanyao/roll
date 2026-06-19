import { parseEventLine, type RollEvent } from "@roll/spec";

export interface WatchStatusSummary {
  cycleId?: string;
  storyId?: string;
  agent?: string;
  phase?: string;
  tcrCount: number;
  lastSignal?: string;
  lastSignalAt?: number;
  outcome?: string;
  hasEnd: boolean;
}

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

function clean(input: string): string {
  return input.replace(ANSI_PATTERN, "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
}

function shortCycle(cycleId: string): string {
  return cycleId.length > 14 ? cycleId.slice(0, 14) : cycleId;
}

function shortHash(hash: string): string {
  return hash.slice(0, 9);
}

function signalLabel(ev: RollEvent): string | undefined {
  switch (ev.type) {
    case "cycle:start":
      return "cycle start";
    case "cycle:phase":
      return `phase ${ev.phase}`;
    case "cycle:stdout": {
      const data = clean(ev.data);
      return data.startsWith("heartbeat:") ? clean(data.replace(/^heartbeat:\s*/, "")) : undefined;
    }
    case "cycle:tcr":
      return `tcr ${shortHash(ev.commitHash)} ${clean(ev.message)}`;
    case "cycle:first_edit":
      return `first edit ${shortHash(ev.commitHash)}`;
    case "cycle:end":
      return `cycle ${ev.outcome}`;
    case "visual:gate":
      return `visual ${ev.verdict}`;
    case "evidence:frame-opened":
      return "evidence frame";
    case "peer:gate":
      return `peer ${ev.verdict}`;
    case "attest:gate":
      return `attest ${ev.verdict}`;
    case "pr:open":
    case "pr:merge":
      return `${ev.type} #${ev.prNumber}`;
    case "pr:close":
    case "pr:rebase":
      return `${ev.type} #${ev.prNumber}`;
    case "ci:pass":
    case "ci:fail":
    case "ci:rerun":
      return `${ev.type} #${ev.prNumber}`;
    case "alert:notify":
      return `alert ${clean(ev.message)}`;
    default:
      return undefined;
  }
}

export function summarizeWatchEvents(lines: readonly string[]): WatchStatusSummary | null {
  const summary: WatchStatusSummary = { tcrCount: 0, hasEnd: false };
  let seen = false;
  for (const line of lines) {
    const ev = parseEventLine(line);
    if (ev === null) continue;
    seen = true;
    if (ev.type === "cycle:start") {
      summary.cycleId = ev.cycleId;
      summary.storyId = ev.storyId;
      summary.agent = ev.agent;
      summary.phase = undefined;
      summary.tcrCount = 0;
      summary.outcome = undefined;
      summary.hasEnd = false;
    } else if (ev.type === "cycle:phase") {
      summary.cycleId = ev.cycleId;
      summary.phase = ev.phase;
    } else if (ev.type === "cycle:tcr") {
      summary.cycleId = ev.cycleId;
      summary.tcrCount += 1;
    } else if (ev.type === "cycle:end") {
      summary.cycleId = ev.cycleId;
      summary.outcome = ev.outcome;
      summary.hasEnd = true;
    }
    const label = signalLabel(ev);
    if (label !== undefined) {
      summary.lastSignal = label;
      summary.lastSignalAt = ev.ts;
    }
  }
  return seen ? summary : null;
}

function toMs(ts: number): number {
  return ts > 9_999_999_999 ? ts : ts * 1000;
}

function quietText(summary: WatchStatusSummary, nowMs: number): string {
  if (summary.lastSignalAt === undefined) return "quiet unknown";
  const quietMs = Math.max(0, nowMs - toMs(summary.lastSignalAt));
  const min = Math.floor(quietMs / 60_000);
  if (min < 1) return "quiet <1m";
  return `quiet ${min}m`;
}

export function renderWatchStatusSummary(summary: WatchStatusSummary, nowMs: number): string {
  const cycle = summary.cycleId !== undefined ? `cycle ${shortCycle(summary.cycleId)}` : "cycle unknown";
  const story = summary.storyId !== undefined && summary.storyId !== "" ? summary.storyId : "story unknown";
  const agent = summary.agent !== undefined && summary.agent !== "" ? summary.agent : "agent unknown";
  const phase = summary.phase !== undefined ? `phase ${summary.phase}` : "phase unknown";
  const tcr = `${summary.tcrCount} TCR`;
  const last = summary.lastSignal !== undefined ? `last ${clean(summary.lastSignal)}` : "last signal unknown";
  const outcome = summary.hasEnd ? `outcome ${summary.outcome ?? "unknown"}` : "outcome unknown/no end event";
  return `status  ${phase} · ${quietText(summary, nowMs)} · ${story} · ${agent} · ${cycle} · ${tcr} · ${last} · ${outcome}`;
}

export function renderWatchStatusFromEventLines(lines: readonly string[], nowMs: number): string | null {
  const summary = summarizeWatchEvents(lines);
  return summary === null ? null : renderWatchStatusSummary(summary, nowMs);
}
