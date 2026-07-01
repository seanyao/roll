import { parseEventLine, type RollEvent } from "@roll/spec";

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
  acceptedScore?: { peer: string; score: number; verdict: string };
  attest?: { verdict: string; scoreReason?: string };
  lastPr?: { type: string; prNumber: number };
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
    case "cycle:terminal":
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

function scoreReason(reasons: readonly string[]): string | undefined {
  return reasons.find((r) => /score/i.test(r));
}

export function summarizeWatchEvents(lines: readonly string[], durableLookup?: DurableCycleLookup): WatchStatusSummary | null {
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
      summary.acceptedScore = undefined;
      summary.attest = undefined;
      summary.lastPr = undefined;
    } else if (ev.type === "cycle:phase") {
      summary.cycleId = ev.cycleId;
      summary.phase = ev.phase;
    } else if (ev.type === "cycle:tcr") {
      summary.cycleId = ev.cycleId;
      summary.tcrCount += 1;
    } else if (ev.type === "cycle:end" || ev.type === "cycle:terminal") {
      summary.cycleId = ev.cycleId;
      summary.outcome = ev.outcome;
      summary.hasEnd = true;
    }

    if (ev.type === "pair:score") {
      summary.acceptedScore = { peer: ev.peer, score: ev.score, verdict: ev.verdict };
    } else if (ev.type === "attest:gate") {
      summary.attest = { verdict: ev.verdict, scoreReason: scoreReason(ev.reasons) };
    } else if (ev.type === "pr:open" || ev.type === "pr:merge" || ev.type === "pr:close" || ev.type === "pr:rebase") {
      summary.lastPr = { type: ev.type, prNumber: ev.prNumber };
    }

    // US-OBS-045: accepted evaluator score and attest gate are surfaced as
    // dedicated summary segments; don't let them overwrite the latest
    // non-accepted signal (e.g. a later pair:consult or pr:open).
    const label = signalLabel(ev);
    if (label !== undefined && ev.type !== "pair:score" && ev.type !== "attest:gate") {
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

function prStateLabel(type: string): string {
  switch (type) {
    case "pr:open":
      return "open";
    case "pr:merge":
      return "merged";
    case "pr:close":
      return "closed";
    case "pr:rebase":
      return "rebase";
    default:
      return type;
  }
}

export function renderWatchStatusSummary(summary: WatchStatusSummary, nowMs: number): string {
  const cycle = summary.cycleId !== undefined ? `cycle ${shortCycle(summary.cycleId)}` : "cycle unknown";
  const story = summary.storyId !== undefined && summary.storyId !== "" ? summary.storyId : "story unknown";
  const agent = summary.agent !== undefined && summary.agent !== "" ? summary.agent : "agent unknown";
  const phase = summary.phase !== undefined ? `phase ${summary.phase}` : "phase unknown";
  const tcr = `${summary.tcrCount} TCR`;

  const parts: string[] = [`status  ${phase}`, quietText(summary, nowMs), story, agent, cycle, tcr];

  if (summary.acceptedScore !== undefined) {
    parts.push(`score ${clean(summary.acceptedScore.peer)} ${summary.acceptedScore.score}/${summary.acceptedScore.verdict}`);
  }
  if (summary.attest !== undefined) {
    const attest = `attest ${summary.attest.verdict}`;
    parts.push(summary.attest.scoreReason !== undefined ? `${attest} · ${summary.attest.scoreReason}` : attest);
  }

  if (summary.lastSignal !== undefined) {
    parts.push(`last ${clean(summary.lastSignal)}`);
  }

  if (summary.hasEnd) {
    const outcome = `outcome ${summary.outcome ?? "unknown"}`;
    if (summary.lastPr !== undefined) {
      parts.push(`${outcome} · PR #${summary.lastPr.prNumber} ${prStateLabel(summary.lastPr.type)}`);
    } else {
      parts.push(outcome);
    }
  } else {
    parts.push("outcome unknown/no end event");
  }

  return parts.join(" · ");
}

export function renderWatchStatusFromEventLines(lines: readonly string[], nowMs: number, durableLookup?: DurableCycleLookup): string | null {
  const summary = summarizeWatchEvents(lines, durableLookup);
  return summary === null ? null : renderWatchStatusSummary(summary, nowMs);
}
