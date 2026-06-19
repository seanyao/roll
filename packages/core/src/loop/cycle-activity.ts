import type { RollEvent } from "@roll/spec";
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
  if (marker.startsWith("peer")) return "peer";
  if (marker.startsWith("ci:") || marker === "attest:gate" || marker === "visual:gate" || marker === "evidence:frame-opened") return "ci";
  if (marker.startsWith("pr:")) return "pr";
  if (marker === "alert") return "end";
  return "cycle";
}

function kindForMarker(marker: string): ActivityKind {
  if (marker === "tcr") return "tcr";
  if (marker === "build:heartbeat") return "heartbeat";
  if (marker.startsWith("pr:")) return "pr";
  if (marker.startsWith("ci:") || marker.endsWith(":gate") || marker === "evidence:frame-opened") return "gate";
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
