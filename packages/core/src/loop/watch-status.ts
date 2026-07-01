import { parseEventLine, type RollEvent } from "@roll/spec";
import { analyzeCycleActivity, type CycleActivityAnalysis } from "./cycle-activity.js";

/** FIX-382: durable cycle→story/agent lookup from runs.jsonl, used as fallback
 *  when the in-window events don't contain a cycle:start. */
export type DurableCycleLookup = Record<string, { storyId: string; agent: string }>;

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
  /** US-OBS-042: active / silent / ended classification derived from recent events. */
  classification?: CycleActivityAnalysis["classification"];
  /** US-OBS-042: parsed bounded micro-step plan, if emitted by the builder. */
  microStep?: CycleActivityAnalysis["microStep"];
  /** US-OBS-042: last detected test:red or test:green transition. */
  testTransition?: CycleActivityAnalysis["testTransition"];
  /** US-OBS-042: advisory green-without-commit state. */
  greenUncommitted?: CycleActivityAnalysis["greenUncommitted"];
  /** US-OBS-042: advisory oversized-action state. */
  oversizedAction?: CycleActivityAnalysis["oversizedAction"];
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
    // ── FIX-934: pair:* signal labels ─────────────────────────────────────
    case "pair:selected": {
      // FIX-1054: show attempt/reason so a fallback selection is distinguishable
      // from the first ranked pick in the operator view.
      const tag = ev.attempt !== undefined && ev.attempt > 1 ? ` [attempt ${ev.attempt}${ev.reason !== undefined ? `: ${clean(ev.reason)}` : ""}]` : "";
      return `pair ${clean(ev.workingAgent)} → ${clean(ev.peer)} (${clean(ev.stage)})${tag}`;
    }
    // FIX-1054: serial-dispatch policy signals — skipped candidates are a POLICY
    // decision (a reviewer/scorer was accepted), and fan-out is an explicit,
    // bounded, reasoned escalation.
    case "pair:skipped":
      return `pair skipped ${ev.peers.map(clean).join(",")} (${clean(ev.reason)})`;
    case "pair:fanout":
      return `pair fanout ${clean(ev.stage)} ${clean(ev.reason)} limit=${ev.limit}`;
    case "pair:verdict":
      return `pair ${clean(ev.peer)} ${ev.verdict} (${ev.findings} finding${ev.findings === 1 ? "" : "s"})`;
    case "pair:score":
      return `pair ${clean(ev.peer)} ${ev.score} ${ev.verdict}`;
    case "pair:consult": {
      const durSec = (ev.durationMs / 1000).toFixed(1);
      const causeTag = ev.cause !== undefined ? ` (${ev.cause})` : "";
      return `pair ${clean(ev.peer)} ${ev.outcome} ${durSec}s${causeTag}`;
    }
    case "pair:none-available":
      return `pair ${clean(ev.stage)} none-available`;
    case "pair:score-failure":
      return `pair ${clean(ev.peer)} ${ev.cause}`;
    case "pair:excluded":
      return `pair ${clean(ev.agent)} excluded ${ev.cause} (${ev.failures})`;
    default:
      return undefined;
  }
}

export function summarizeWatchEvents(lines: readonly string[], durableLookup?: DurableCycleLookup, nowMs?: number): WatchStatusSummary | null {
  const summary: WatchStatusSummary = { tcrCount: 0, hasEnd: false };
  const events: RollEvent[] = [];
  let seen = false;
  for (const line of lines) {
    const ev = parseEventLine(line);
    if (ev === null) continue;
    events.push(ev);
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
  // FIX-382: when cycle:start is outside the event window, fall back to the
  // durable runs.jsonl lookup by cycleId to resolve storyId/agent.
  if (seen && summary.cycleId !== undefined) {
    if ((summary.storyId === undefined || summary.storyId === "") && durableLookup !== undefined) {
      const dur = durableLookup[summary.cycleId];
      if (dur !== undefined) summary.storyId = dur.storyId;
    }
    if ((summary.agent === undefined || summary.agent === "") && durableLookup !== undefined) {
      const dur = durableLookup[summary.cycleId];
      if (dur !== undefined) summary.agent = dur.agent;
    }
  }
  // US-OBS-042: enrich with the activity analyzer when a timestamp is supplied.
  if (seen && summary.cycleId !== undefined && nowMs !== undefined) {
    const analysis = analyzeCycleActivity(events, summary.cycleId, nowMs);
    summary.classification = analysis.classification;
    if (analysis.microStep !== undefined) summary.microStep = analysis.microStep;
    if (analysis.testTransition !== undefined) summary.testTransition = analysis.testTransition;
    if (analysis.greenUncommitted !== undefined) summary.greenUncommitted = analysis.greenUncommitted;
    if (analysis.oversizedAction !== undefined) summary.oversizedAction = analysis.oversizedAction;
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
  const classification = summary.classification !== undefined ? summary.classification : "active";
  const tcr = `${summary.tcrCount} TCR`;
  const last = summary.lastSignal !== undefined ? `last ${clean(summary.lastSignal)}` : "last signal unknown";
  const outcome = summary.hasEnd ? `outcome ${summary.outcome ?? "unknown"}` : "outcome unknown/no end event";

  const parts: string[] = [
    phase,
    classification,
    quietText(summary, nowMs),
    story,
    agent,
    cycle,
  ];

  if (summary.microStep !== undefined) {
    parts.push(`action ${summary.microStep.actionId} ${summary.microStep.summary}`);
  }
  if (summary.testTransition !== undefined) {
    parts.push(`test:${summary.testTransition.state}`);
  }

  parts.push(tcr);

  if (summary.greenUncommitted !== undefined) {
    const min = Math.floor(summary.greenUncommitted.durationSec / 60);
    const duration = min < 1 ? "<1m" : `${min}m`;
    parts.push(`green-uncommitted ${duration}`);
  }
  if (summary.oversizedAction !== undefined) {
    parts.push(
      `action oversized · ${summary.oversizedAction.filesTouched} files / ${summary.oversizedAction.contractAreas} areas`,
    );
  }

  parts.push(last, outcome);
  return `status  ${parts.join(" · ")}`;
}

export function renderWatchStatusFromEventLines(lines: readonly string[], nowMs: number, durableLookup?: DurableCycleLookup): string | null {
  const summary = summarizeWatchEvents(lines, durableLookup, nowMs);
  return summary === null ? null : renderWatchStatusSummary(summary, nowMs);
}
