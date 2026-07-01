import type { RollEvent, CycleActivityEvent } from "@roll/spec";
import type { ActivityKind, ActivitySignal, Segment } from "./activity-signal.js";
import { signalKindForMarker } from "./signals.js";
import { extractCycleSignals, type TimelineEntry } from "./transcript.js";

function toMs(ts: number): number {
  return ts >= 1e12 ? ts : ts * 1000;
}

function segmentForMarker(marker: string): Segment {
  if (marker === "cycle:start") return "cycle";
  if (marker === "cycle:end") return "end";
  if (marker.startsWith("phase:") || marker === "tcr" || marker === "first-edit" || marker === "build:heartbeat") return "build";
  if (marker.startsWith("peer") || marker.startsWith("pair:")) return "peer";
  if (marker.startsWith("ci:") || marker === "attest:gate" || marker === "visual:gate" || marker === "evidence:frame-opened") return "ci";
  if (marker.startsWith("pr:")) return "pr";
  if (marker === "alert") return "end";
  return "cycle";
}

function kindForMarker(marker: string): ActivityKind {
  if (marker === "tcr") return "tcr";
  if (marker === "build:heartbeat") return "heartbeat";
  if (marker.startsWith("pr:")) return "pr";
  if (marker.startsWith("ci:") || marker.endsWith(":gate") || marker.startsWith("pair:") || marker === "evidence:frame-opened") return "gate";
  if (marker === "alert") return "alert";
  return "lifecycle";
}

function resultForMarker(marker: string): ActivitySignal["result"] | undefined {
  if (marker.endsWith(":pass") || marker === "pr:merge") return "pass";
  if (marker.endsWith(":fail") || marker === "pr:close" || marker === "alert") return "fail";
  if (marker === "peer:gate" || marker === "attest:gate" || marker === "visual:gate") return "pending";
  if (marker === "pr:open" || marker === "pr:rebase") return "pending";
  return undefined;
}

function refForEntry(entry: TimelineEntry): string | undefined {
  const pr = /PR #(\d+)/.exec(entry.label);
  if (pr?.[1] !== undefined) return `#${pr[1]}`;
  const tcr = /^TCR\s+([0-9a-f]+)/i.exec(entry.label);
  if (tcr?.[1] !== undefined) return tcr[1];
  return undefined;
}

function timelineEntryToActivitySignal(cycleId: string, entry: TimelineEntry): ActivitySignal {
  const signalKind = signalKindForMarker(entry.marker) ?? undefined;
  return {
    ts: toMs(entry.ts),
    cycleId,
    seg: segmentForMarker(entry.marker),
    kind: kindForMarker(entry.marker),
    tier: entry.layer === "signal" ? "A" : "B",
    summary: entry.label,
    ...(resultForMarker(entry.marker) !== undefined ? { result: resultForMarker(entry.marker) } : {}),
    ...(refForEntry(entry) !== undefined ? { ref: refForEntry(entry) } : {}),
    ...(signalKind !== undefined ? { signalKind } : {}),
  };
}

export function cycleActivitySignalsFromEvents(events: RollEvent[], cycleId: string): ActivitySignal[] {
  return extractCycleSignals(events, cycleId).timeline.map((entry) => timelineEntryToActivitySignal(cycleId, entry));
}

// ════════════════════════════════════════════════════════════════════════════
// US-OBS-026 — standard CycleActivityEvent projection from durable events.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Pure projection: {@link RollEvent}[] → {@link CycleActivityEvent}[].
 *
 * AGENT-AGNOSTIC — uses ONLY the durable facts in events.ndjson (the runner's
 * own observations: cycle:phase, cycle:first_edit, cycle:tcr, cycle:stdout,
 * cycle:end, ci:*, pr:*, peer:gate, attest:gate, visual:gate). Does NOT
 * depend on any per-agent normalizer; claude / codex / kimi / pi / any future
 * agent all produce the same standard events.
 *
 * Events are filtered to the given `cycleId`; events without a `cycleId`
 * (pr:*, ci:*) are scoped by the caller. Unknown / malformed / torn events
 * are skipped without throwing — the stream is always rebuildable (I8).
 *
 * The output is a chronological, deterministic list; the same input always
 * produces the same output regardless of host locale or clock.
 */
export function cycleActivityFromEvents(
  events: readonly RollEvent[],
  cycleId: string,
): CycleActivityEvent[] {
  const out: CycleActivityEvent[] = [];

  // First pass: find the agent from cycle:start (so CI/PR events that don't
  // carry a cycleId still get the right agent regardless of input order).
  let agent = "";
  for (const ev of events) {
    if (ev.type === "cycle:start" && ev.cycleId === cycleId) {
      agent = ev.agent;
      break;
    }
  }

  for (const ev of events) {
    // Filter: keep events matching this cycleId, plus cycleId-less events
    // (pr:*, ci:*) that the caller has pre-scoped.
    if ("cycleId" in ev && typeof (ev as { cycleId?: unknown }).cycleId === "string") {
      if ((ev as { cycleId: string }).cycleId !== cycleId) continue;
    }

    // Cycle start.
    if (ev.type === "cycle:start") {
      out.push({
        kind: "lifecycle",
        cycle_id: cycleId,
        ts: ev.ts,
        agent,
        payload: {
          event: "cycle:start",
          detail: ev.storyId !== "" ? ev.storyId : undefined,
        },
      });
      continue;
    }

    // Phase transitions.
    if (ev.type === "cycle:phase") {
      out.push({
        kind: "phase",
        cycle_id: cycleId,
        ts: ev.ts,
        agent,
        payload: { phase: ev.phase },
      });
      continue;
    }

    // TCR commits (the runner's observation).
    if (ev.type === "cycle:tcr") {
      out.push({
        kind: "tcr",
        cycle_id: cycleId,
        ts: ev.ts,
        agent,
        payload: {
          commitHash: ev.commitHash,
          message: ev.message,
          ...(ev.commitTs !== undefined ? { commitTs: ev.commitTs } : {}),
          firstEdit: false,
        },
      });
      continue;
    }

    // First edit marker (cycle:first_edit).
    if (ev.type === "cycle:first_edit") {
      out.push({
        kind: "tcr",
        cycle_id: cycleId,
        ts: ev.ts,
        agent,
        payload: {
          commitHash: ev.commitHash,
          message: "first edit",
          firstEdit: true,
        },
      });
      continue;
    }

    // Stdout lines (including heartbeats).
    if (ev.type === "cycle:stdout") {
      out.push({
        kind: "stdout",
        cycle_id: cycleId,
        ts: ev.ts,
        agent,
        payload: { data: ev.data },
      });
      continue;
    }

    // Cycle end.
    if (ev.type === "cycle:end") {
      out.push({
        kind: "lifecycle",
        cycle_id: cycleId,
        ts: ev.ts,
        agent,
        payload: {
          event: "cycle:end",
          detail: ev.outcome,
        },
      });
      continue;
    }

    // Gate events.
    if (ev.type === "ci:pass") {
      out.push({
        kind: "gate",
        cycle_id: cycleId,
        ts: ev.ts,
        agent,
        payload: { gate: "ci", verdict: "pass", ref: `#${ev.prNumber}` },
      });
      continue;
    }
    if (ev.type === "ci:fail") {
      out.push({
        kind: "gate",
        cycle_id: cycleId,
        ts: ev.ts,
        agent,
        payload: {
          gate: "ci",
          verdict: "fail",
          detail: ev.failSummary || undefined,
          ref: `#${ev.prNumber}`,
        },
      });
      continue;
    }
    if (ev.type === "ci:rerun") {
      out.push({
        kind: "gate",
        cycle_id: cycleId,
        ts: ev.ts,
        agent,
        payload: { gate: "ci", verdict: "rerun", ref: `#${ev.prNumber}` },
      });
      continue;
    }
    if (ev.type === "peer:gate") {
      out.push({
        kind: "gate",
        cycle_id: cycleId,
        ts: ev.ts,
        agent,
        payload: {
          gate: "peer",
          verdict: ev.verdict,
          detail: ev.reasons.length > 0 ? ev.reasons.join("; ") : undefined,
        },
      });
      continue;
    }
    if (ev.type === "attest:gate") {
      out.push({
        kind: "gate",
        cycle_id: cycleId,
        ts: ev.ts,
        agent,
        payload: {
          gate: "attest",
          verdict: ev.verdict,
          detail: ev.reasons.length > 0 ? ev.reasons.join("; ") : undefined,
        },
      });
      continue;
    }
    if (ev.type === "visual:gate") {
      out.push({
        kind: "gate",
        cycle_id: cycleId,
        ts: ev.ts,
        agent,
        payload: {
          gate: "visual",
          verdict: ev.verdict,
          detail: ev.code !== undefined ? ev.code : undefined,
          ...(ev.reasons !== undefined && ev.reasons.length > 0 ? { detail: ev.reasons.join("; ") } : {}),
        },
      });
      continue;
    }
    if (ev.type === "evidence:frame-opened") {
      out.push({
        kind: "gate",
        cycle_id: cycleId,
        ts: ev.ts,
        agent,
        payload: { gate: "evidence", verdict: "opened", detail: ev.runDir },
      });
      continue;
    }

    // PR events.
    if (ev.type === "pr:open") {
      out.push({
        kind: "gate",
        cycle_id: cycleId,
        ts: ev.ts,
        agent,
        payload: { gate: "pr", verdict: "open", ref: `#${ev.prNumber}` },
      });
      continue;
    }
    if (ev.type === "pr:merge") {
      out.push({
        kind: "gate",
        cycle_id: cycleId,
        ts: ev.ts,
        agent,
        payload: { gate: "pr", verdict: "merged", ref: `#${ev.prNumber}` },
      });
      continue;
    }
    if (ev.type === "pr:close") {
      out.push({
        kind: "gate",
        cycle_id: cycleId,
        ts: ev.ts,
        agent,
        payload: { gate: "pr", verdict: "closed", detail: ev.reason || undefined },
      });
      continue;
    }
    if (ev.type === "pr:rebase") {
      out.push({
        kind: "gate",
        cycle_id: cycleId,
        ts: ev.ts,
        agent,
        payload: { gate: "pr", verdict: "rebase", ref: `#${ev.prNumber}` },
      });
      continue;
    }

    // Alert events.
    if (ev.type === "alert:notify") {
      out.push({
        kind: "gate",
        cycle_id: cycleId,
        ts: ev.ts,
        agent,
        payload: { gate: "alert", verdict: "notify", detail: ev.message },
      });
      continue;
    }

    // State change: routing resolution.
    if (ev.type === "route:resolve") {
      out.push({
        kind: "state_change",
        cycle_id: cycleId,
        ts: ev.ts,
        agent: ev.agent,
        payload: {
          from: "picking",
          to: "routed",
          reason: `${ev.agent} ← ${ev.rule}`,
        },
      });
      continue;
    }

    // All other event types are skipped (loop:*, policy:*, goal:*, story:split,
    // pair:*, correction:*, etc.) — they are not part of the per-cycle activity
    // standard projection.
  }

  // Sort chronologically by ts, preserving original order for same-ts events.
  out.sort((a, b) => a.ts - b.ts);
  return out;
}
