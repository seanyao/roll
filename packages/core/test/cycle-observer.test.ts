/**
 * US-LOOP-076 (folds in FIX-310) — the runner-observed cycle signal source.
 *
 * Pins the agent-agnostic core: standard signals are DERIVED from the runner's
 * own git/clock observation, never from any agent's stdout. The same logic runs
 * for claude / codex / kimi / pi — there is no agent parameter here at all, which
 * is the whole point (a black box for non-claude agents was the bug).
 *
 *   - observeBuildStart fires the execute-phase marker exactly once;
 *   - observeCommits emits one cycle:tcr per NEW commit, dedupes across snapshots,
 *     preserves git timestamps (so per-commit timing is real), order-stable;
 *   - maybeBuildHeartbeat beats only after the quiet gap, and a fresh commit
 *     resets the baseline (a commit IS liveness).
 */
import { describe, expect, it } from "vitest";
import type { RollEvent } from "@roll/spec";
import {
  BUILD_HEARTBEAT_GAP_MS,
  maybeBuildHeartbeat,
  newCycleObserverState,
  observeBuildStart,
  observeCommits,
  type ObservedCommit,
} from "../src/loop/cycle-observer.js";

const CYCLE = "20260615-100000-99999";

function commit(hash: string, message: string, tsSec: number): ObservedCommit {
  return { hash, message, tsSec };
}

describe("cycle-observer — runner-derived standard signals (agent-agnostic)", () => {
  it("observeBuildStart emits cycle:phase execute exactly once", () => {
    const st = newCycleObserverState(CYCLE);
    const first = observeBuildStart(st, 1_000);
    expect(first).toEqual([{ type: "cycle:phase", cycleId: CYCLE, phase: "execute", ts: 1_000 }]);
    // idempotent: a second call is a no-op (the phase already opened).
    expect(observeBuildStart(st, 2_000)).toEqual([]);
  });

  it("observeCommits emits one cycle:tcr per NEW commit, in order, with git ts", () => {
    const st = newCycleObserverState(CYCLE);
    const out = observeCommits(
      [commit("aaa111", "tcr: red", 1700000010), commit("bbb222", "tcr: green", 1700000040)],
      st,
      5_000,
    );
    expect(out).toEqual<RollEvent[]>([
      { type: "cycle:tcr", cycleId: CYCLE, commitHash: "aaa111", message: "tcr: red", ts: 1700000010 },
      { type: "cycle:tcr", cycleId: CYCLE, commitHash: "bbb222", message: "tcr: green", ts: 1700000040 },
    ]);
  });

  it("dedupes already-seen commits across snapshots (no double emit)", () => {
    const st = newCycleObserverState(CYCLE);
    observeCommits([commit("aaa111", "tcr: red", 1700000010)], st, 5_000);
    // re-poll: same commit + one new → only the new one is emitted.
    const second = observeCommits(
      [commit("aaa111", "tcr: red", 1700000010), commit("ccc333", "tcr: refactor", 1700000070)],
      st,
      10_000,
    );
    expect(second.map((e) => (e as { commitHash: string }).commitHash)).toEqual(["ccc333"]);
  });

  it("falls back to nowMs when a commit ts is missing/zero", () => {
    const st = newCycleObserverState(CYCLE);
    const out = observeCommits([commit("ddd444", "tcr: no-ts", 0)], st, 9_000);
    expect((out[0] as { ts: number }).ts).toBe(9); // floor(9000ms / 1000)
  });

  it("ignores empty-hash rows defensively", () => {
    const st = newCycleObserverState(CYCLE);
    expect(observeCommits([commit("", "garbage", 1700000010)], st, 1_000)).toEqual([]);
  });

  it("maybeBuildHeartbeat beats only after the quiet gap", () => {
    const T0 = 1_000_000; // a realistic non-zero wall-clock base (ms)
    const st = newCycleObserverState(CYCLE);
    observeBuildStart(st, T0); // sets the heartbeat baseline to T0
    // just before the gap: silent.
    expect(maybeBuildHeartbeat(st, T0 + BUILD_HEARTBEAT_GAP_MS - 1)).toEqual([]);
    // at the gap: one beat (a tagged cycle:stdout so no new event type is needed).
    const beat = maybeBuildHeartbeat(st, T0 + BUILD_HEARTBEAT_GAP_MS);
    expect(beat).toHaveLength(1);
    expect(beat[0]!.type).toBe("cycle:stdout");
    expect((beat[0] as { data: string }).data).toContain("heartbeat: building");
  });

  it("a new commit resets the heartbeat baseline (commit IS liveness)", () => {
    const T0 = 1_000_000;
    const st = newCycleObserverState(CYCLE);
    observeBuildStart(st, T0);
    // a commit lands right at the gap boundary → no beat now, baseline moved.
    observeCommits([commit("aaa111", "tcr: x", 1700000010)], st, T0 + BUILD_HEARTBEAT_GAP_MS);
    expect(maybeBuildHeartbeat(st, T0 + BUILD_HEARTBEAT_GAP_MS + 10)).toEqual([]);
    // only after another full quiet gap does it beat.
    expect(maybeBuildHeartbeat(st, T0 + BUILD_HEARTBEAT_GAP_MS * 2)).toHaveLength(1);
  });
});
