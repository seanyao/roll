/**
 * Frozen-expectation test: reconcile (TTL "进行中" detection).
 *
 * `reconcileStuckBacklog` was proven equal to the python oracle
 * `lib/loop_unstick.py` under diff-test (fresh temp git repo + sandboxed
 * ROLL_SHARED_ROOT + slug resolution per case). Per US-PORT-009b the oracle is
 * retired: the `python3`/`git` spawns and the slug/event-file plumbing — which
 * existed only to drive the oracle — are dropped. `reconcileStuckBacklog` is a
 * pure function over (backlog, events, now, ttl); we feed events pinned at fixed
 * hour offsets from a fixed `now` and assert the frozen revert decisions.
 */
import { describe, expect, it } from "vitest";
import { type UnstickEvent, reconcileStuckBacklog } from "../src/index.js";

const HOUR = 3_600_000;

interface EventSpec {
  stage: string;
  detail?: string;
  label?: string;
  outcome?: string;
  hoursAgo: number;
}

function tsEvents(now: number, events: EventSpec[]): UnstickEvent[] {
  return events.map((e) => ({
    stage: e.stage,
    ...(e.detail !== undefined ? { detail: e.detail } : {}),
    ...(e.label !== undefined ? { label: e.label } : {}),
    ...(e.outcome !== undefined ? { outcome: e.outcome } : {}),
    ts: now - e.hoursAgo * HOUR,
  }));
}

const STALE: EventSpec[] = [
  { stage: "pick_todo", detail: "US-1", label: "c", hoursAgo: 6.01 },
  { stage: "cycle_end", label: "c", outcome: "failed", hoursAgo: 6 },
];
const FRESH: EventSpec[] = [
  { stage: "pick_todo", detail: "US-1", label: "c", hoursAgo: 2.01 },
  { stage: "cycle_end", label: "c", outcome: "failed", hoursAgo: 2 },
];
const ABORTED_STALE: EventSpec[] = [
  { stage: "pick_todo", detail: "US-1", label: "c", hoursAgo: 5.01 },
  { stage: "cycle_end", label: "c", outcome: "aborted", hoursAgo: 5 },
];
const NO_CYCLE: EventSpec[] = [{ stage: "pick_todo", detail: "US-1", label: "c", hoursAgo: 6 }];
const DELIVERED_STALE: EventSpec[] = [
  { stage: "pick_todo", detail: "US-1", label: "c", hoursAgo: 6.01 },
  { stage: "cycle_end", label: "c", outcome: "delivered", hoursAgo: 6 },
];

const BACKLOG = "| US-1 | foo bar | 🔨 In Progress |\n";

describe("frozen: reconcileStuckBacklog == loop_unstick.py TTL gate", () => {
  const cases: Array<{
    name: string;
    events: EventSpec[];
    ttl: number;
    revert: { storyId: string; outcome: string; ageHours: number } | null;
  }> = [
    { name: "stuck-and-stale (failed 6h > 4h TTL)", events: STALE, ttl: 4, revert: { storyId: "US-1", outcome: "failed", ageHours: 6 } },
    { name: "stuck-but-fresh (failed 2h < 4h TTL)", events: FRESH, ttl: 4, revert: null },
    { name: "failed-latest-cycle aborted, stale", events: ABORTED_STALE, ttl: 4, revert: { storyId: "US-1", outcome: "aborted", ageHours: 5 } },
    { name: "no-cycle-record (still running)", events: NO_CYCLE, ttl: 4, revert: null },
    { name: "delivered latest cycle is never reverted", events: DELIVERED_STALE, ttl: 4, revert: null },
  ];

  for (const { name, events, ttl, revert } of cases) {
    it(name, () => {
      const now = 1_700_000_000_000;
      const ts = reconcileStuckBacklog(BACKLOG, tsEvents(now, events), now, ttl);
      if (revert === null) {
        expect(ts).toHaveLength(0);
      } else {
        expect(ts).toHaveLength(1);
        expect(ts[0]?.storyId).toBe(revert.storyId);
        expect(ts[0]?.outcome).toBe(revert.outcome);
        expect(ts[0]?.ageHours ?? 0).toBeCloseTo(revert.ageHours, 1);
      }
    });
  }
});
