import type { RollEvent } from "@roll/spec";

export interface MorningRunRow {
  [key: string]: unknown;
  cycle_id?: unknown;
  story_id?: unknown;
  built?: unknown;
  status?: unknown;
  outcome?: unknown;
  cost_usd?: unknown;
  ts?: unknown;
}

export interface LoopDigestModel {
  windowStart: number;
  windowEnd: number;
  cycles: number;
  deliveredStories: string[];
  returnedStories: string[];
  corrections: number;
  circuitBreakers: number;
  paused: boolean;
  totalCostUsd: number;
  alerts: string[];
  degraded: boolean;
  degradedReasons: string[];
}

/** @deprecated Use LoopDigestModel instead. */
export type MorningReportModel = LoopDigestModel;

export interface LoopDigestOptions {
  windowStart: number;
  windowEnd: number;
  runDelivered?: (row: MorningRunRow, nowSec: number) => boolean;
}

/** @deprecated Use LoopDigestOptions instead. */
export type MorningReportOptions = LoopDigestOptions;

function storyFromRun(row: MorningRunRow): string | undefined {
  if (typeof row.story_id === "string" && row.story_id !== "") return row.story_id;
  if (Array.isArray(row.built)) {
    const first = row.built.find((x): x is string => typeof x === "string" && x !== "");
    if (first !== undefined) return first;
  }
  return undefined;
}

function cycleFromRun(row: MorningRunRow): string | undefined {
  return typeof row.cycle_id === "string" && row.cycle_id.trim() !== "" ? row.cycle_id : undefined;
}

function parseRunTs(row: MorningRunRow): number | undefined {
  if (typeof row.ts !== "string") return undefined;
  const ts = Date.parse(row.ts) / 1000;
  return Number.isFinite(ts) ? ts : undefined;
}

function cycleStoryMap(events: readonly RollEvent[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const ev of events) {
    if (ev.type === "cycle:start" && ev.storyId.trim() !== "") out.set(ev.cycleId, ev.storyId);
  }
  return out;
}

function uniq(xs: Iterable<string>): string[] {
  return [...new Set([...xs].filter((x) => x.trim() !== ""))].sort();
}

export function buildLoopDigestModel(
  events: readonly RollEvent[],
  runs: readonly MorningRunRow[],
  opts: LoopDigestOptions,
): LoopDigestModel {
  const inWindow = events.filter((ev) => ev.ts >= opts.windowStart && ev.ts <= opts.windowEnd);
  const hasCycleEnd = inWindow.some((ev) => ev.type === "cycle:end");
  const stories = cycleStoryMap(events);
  const cycleIds = new Set<string>();
  const delivered = new Set<string>();
  const returned = new Set<string>();
  let corrections = 0;
  let circuitBreakers = 0;
  let paused = false;
  let totalCostUsd = 0;
  const alerts: string[] = [];
  const degradedReasons: string[] = [];

  for (const ev of inWindow) {
    if ("cycleId" in ev && typeof ev.cycleId === "string") cycleIds.add(ev.cycleId);
    if (ev.type === "cycle:end") {
      const story = stories.get(ev.cycleId);
      if (ev.outcome === "delivered" && story !== undefined) delivered.add(story);
      totalCostUsd += ev.cost.effectiveCost || ev.cost.estimatedCost || 0;
    } else if (ev.type === "correction:action") {
      corrections += 1;
      if (ev.action === "return_story" || ev.action === "reselect_story" || ev.action === "route_adjust" || ev.action === "reroute") {
        returned.add(ev.storyId);
      }
    } else if (ev.type === "correction:circuit_breaker") {
      circuitBreakers += 1;
      paused = true;
    } else if (ev.type === "policy:safety_pause") {
      paused = true;
    } else if (ev.type === "alert:notify") {
      alerts.push(ev.message);
    }
  }

  for (const row of runs) {
    const ts = parseRunTs(row);
    if (ts === undefined || ts < opts.windowStart || ts > opts.windowEnd) continue;
    const story = storyFromRun(row);
    const cycleId = cycleFromRun(row);
    const rowInCurrentCycle = cycleId !== undefined && cycleIds.has(cycleId);
    if (story !== undefined && opts.runDelivered?.(row, opts.windowEnd) === true) {
      if (cycleIds.size === 0) {
        degradedReasons.push(`delivered_without_cycle:${story}`);
      } else if (!rowInCurrentCycle) {
        degradedReasons.push(`delivered_outside_cycle_window:${story}`);
      } else {
        delivered.add(story);
      }
    }
    if (!hasCycleEnd && rowInCurrentCycle && typeof row.cost_usd === "number" && Number.isFinite(row.cost_usd)) totalCostUsd += row.cost_usd;
  }

  if (cycleIds.size === 0 && delivered.size > 0) {
    delivered.clear();
    degradedReasons.push("cycles_zero_with_delivered");
  }

  return {
    windowStart: opts.windowStart,
    windowEnd: opts.windowEnd,
    cycles: cycleIds.size,
    deliveredStories: uniq(delivered),
    returnedStories: uniq(returned),
    corrections,
    circuitBreakers,
    paused,
    totalCostUsd,
    alerts: alerts.slice(-8),
    degraded: degradedReasons.length > 0,
    degradedReasons: uniq(degradedReasons),
  };
}

/** @deprecated Use buildLoopDigestModel instead. */
export const buildMorningReportModel = buildLoopDigestModel;
