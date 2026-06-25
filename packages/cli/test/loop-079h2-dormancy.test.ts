/**
 * US-LOOP-079h2 — the enter-dormancy decision. `maybeEnterDormancy` is pure over
 * its injected deps (scheduler / clock / fs / event sink + an optional `assess`
 * override), so the whole AC matrix is deterministic with no real launchctl,
 * filesystem, or backlog parsing.
 */
import type { BacklogReason } from "@roll/spec";
import { describe, expect, it } from "vitest";
import { maybeEnterDormancy, type DormancyOutcome } from "../src/commands/loop-run-once.js";

interface Calls {
  dormantLabels: string[];
  dormantThrows: boolean;
  dormantResult: boolean;
  events: Array<Record<string, unknown>>;
  dormantWrites: Array<{ since: string; reason: BacklogReason }>;
  upserts: number;
  pauses: string[];
}

function makeDeps(
  over: Partial<{
    count: number;
    threshold: number;
    state: "PAUSED" | "DORMANT" | "ACTIVE";
    assess: { hasWork: boolean; reason: BacklogReason };
    dormantResult: boolean;
    dormantThrows: boolean;
  }> = {},
): { deps: Parameters<typeof maybeEnterDormancy>[0]; calls: Calls } {
  const calls: Calls = {
    dormantLabels: [],
    dormantThrows: over.dormantThrows ?? false,
    dormantResult: over.dormantResult ?? true,
    events: [],
    dormantWrites: [],
    upserts: 0,
    pauses: [],
  };
  const assess = over.assess ?? { hasWork: false, reason: "all_done" as BacklogReason };
  const deps = {
    slug: "roll-test",
    count: over.count ?? 3,
    threshold: over.threshold ?? 3,
    resolveState: () => over.state ?? "ACTIVE",
    readBacklog: () => "",
    assess: () => assess,
    scheduler: {
      dormant: async (label: string): Promise<boolean> => {
        calls.dormantLabels.push(label);
        if (calls.dormantThrows) throw new Error("bootout exploded");
        return calls.dormantResult;
      },
    },
    loopLabel: "com.roll.loop.roll-test",
    now: () => "2026-06-25T00:00:00.000Z",
    emit: (e: Record<string, unknown>) => calls.events.push(e),
    writeDormant: (b: { since: string; reason: BacklogReason }) => calls.dormantWrites.push(b),
    upsertDormantRun: () => {
      calls.upserts += 1;
    },
    writePause: (r: string) => calls.pauses.push(r),
  };
  return { deps, calls };
}

const eventTypes = (c: Calls): string[] => c.events.map((e) => String(e["type"]));

describe("US-LOOP-079h2 maybeEnterDormancy", () => {
  it("AC1: below threshold stays ACTIVE and never bootouts", async () => {
    const { deps, calls } = makeDeps({ count: 2, threshold: 3 });
    const out: DormancyOutcome = await maybeEnterDormancy(deps);
    expect(out).toBe("active");
    expect(calls.dormantLabels).toEqual([]);
    expect(calls.upserts).toBe(0);
    expect(eventTypes(calls)).toEqual([]);
  });

  it("AC3: at threshold with all_done → DORMANT (one bootout of the loop lane, marker, event, dormant_entered)", async () => {
    const { deps, calls } = makeDeps({ count: 3, assess: { hasWork: false, reason: "all_done" } });
    const out = await maybeEnterDormancy(deps);
    expect(out).toBe("dormant");
    expect(calls.dormantLabels).toEqual(["com.roll.loop.roll-test"]); // exactly one, the loop lane only
    expect(calls.dormantWrites).toEqual([{ since: "2026-06-25T00:00:00.000Z", reason: "all_done" }]);
    expect(eventTypes(calls)).toEqual(["loop:dormant"]);
    expect(calls.upserts).toBe(1); // dormant_entered supersedes idle_no_work
    expect(calls.pauses).toEqual([]);
  });

  it("AC3: backlog_empty and all_in_progress also dorm", async () => {
    for (const reason of ["backlog_empty", "all_in_progress"] as BacklogReason[]) {
      const { deps, calls } = makeDeps({ count: 5, assess: { hasWork: false, reason } });
      expect(await maybeEnterDormancy(deps)).toBe("dormant");
      expect(calls.dormantWrites[0]?.reason).toBe(reason);
    }
  });

  it("AC4: all_awaiting_merge is suppressed → stays ACTIVE (PR will merge)", async () => {
    const { deps, calls } = makeDeps({ count: 9, assess: { hasWork: false, reason: "all_awaiting_merge" } });
    expect(await maybeEnterDormancy(deps)).toBe("active");
    expect(calls.dormantLabels).toEqual([]);
    expect(calls.upserts).toBe(0);
  });

  it("AC4: all_blocked_by_deps is not a deep-sleep reason → stays ACTIVE (deps may complete)", async () => {
    const { deps, calls } = makeDeps({ count: 9, assess: { hasWork: false, reason: "all_blocked_by_deps" } });
    expect(await maybeEnterDormancy(deps)).toBe("active");
    expect(calls.dormantLabels).toEqual([]);
  });

  it("has_work never dorms even above threshold", async () => {
    const { deps, calls } = makeDeps({ count: 9, assess: { hasWork: true, reason: "has_work" } });
    expect(await maybeEnterDormancy(deps)).toBe("active");
    expect(calls.dormantLabels).toEqual([]);
  });

  it("AC5: bootout failure → PAUSE fallback + loop:dormant_failed, and NO dormant_entered row", async () => {
    const { deps, calls } = makeDeps({ count: 3, dormantResult: false });
    expect(await maybeEnterDormancy(deps)).toBe("dormant_failed");
    expect(calls.pauses.length).toBe(1);
    expect(eventTypes(calls)).toEqual(["loop:dormant_failed"]);
    expect(calls.upserts).toBe(0); // never claim dormant when the lane is still armed
    expect(calls.dormantWrites).toEqual([]);
  });

  it("AC5: a throwing scheduler.dormant is treated as failure (never crashes)", async () => {
    const { deps, calls } = makeDeps({ count: 3, dormantThrows: true });
    expect(await maybeEnterDormancy(deps)).toBe("dormant_failed");
    expect(calls.upserts).toBe(0);
    expect(eventTypes(calls)).toEqual(["loop:dormant_failed"]);
  });

  it("precedence: PAUSED/DORMANT state short-circuits to ACTIVE (no re-dorm)", async () => {
    for (const state of ["PAUSED", "DORMANT"] as const) {
      const { deps, calls } = makeDeps({ count: 9, state });
      expect(await maybeEnterDormancy(deps)).toBe("active");
      expect(calls.dormantLabels).toEqual([]);
    }
  });

  it("AC7 wake-epoch: a just-rearmed cycle (counter reset → 1) cannot re-dorm below threshold", async () => {
    // US-LOOP-079i resets the idle counter on rearm; the first post-wake idle
    // cycle therefore sits at count=1 < 3 and is handled by AC1 (stays ACTIVE).
    const { deps, calls } = makeDeps({ count: 1, assess: { hasWork: false, reason: "all_done" } });
    expect(await maybeEnterDormancy(deps)).toBe("active");
    expect(calls.dormantLabels).toEqual([]);
  });
});
