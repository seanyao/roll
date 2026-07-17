/**
 * FIX-1052 — pending PR polling reconciler tests.
 *
 * Covers:
 *   - cloud-state → decision mapping (open/pending, open/green, merged,
 *     closed-unmerged, CI-red, offline/auth/provider-error/not_found)
 *   - bounded polling loop (terminal success, timeout, max-polls exhaust)
 *   - idempotency: already-merged records short-circuit
 *   - delivery-record construction for delivered / not-delivered outcomes
 */
import { describe, expect, it } from "vitest";
import type { DeliveryRecord } from "@roll/spec";
import { present } from "@roll/spec";
import {
  buildMergedDeliveryRecord,
  buildNotDeliveredRecord,
  decidePendingPrReconcile,
  reconcilePendingPrs,
  runPendingPrReconcile,
  type PendingPrReconcileItem,
  type PrCloudState,
  type PrStatusProvider,
} from "../src/delivery/pr-reconcile.js";

const NOW = "2026-06-30T13:36:48.000Z";
const nowIso = (): string => NOW;

function fakePendingRecord(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    storyId: "FIX-1050",
    cycleId: "20260630-210059-58201",
    lifecycleState: "pending_merge",
    prNumber: present(1111),
    prUrl: present("https://github.com/seanyao/roll/pull/1111"),
    mergedAt: { present: false, reason: "not_recorded" },
    mergeCommit: { present: false, reason: "not_recorded" },
    recordedAt: 1_779_837_600_000,
    ...overrides,
  };
}

// ── decidePendingPrReconcile ─────────────────────────────────────────────────

describe("decidePendingPrReconcile", () => {
  it("merged → mark_delivered with mergeCommit, mergedAt, origin/main", () => {
    const state: PrCloudState = {
      kind: "merged",
      mergeCommit: "35a48c7",
      mergedAt: "2026-06-30T13:36:48Z",
      checkedAt: NOW,
    };
    expect(decidePendingPrReconcile(state, { nowIso })).toEqual({
      action: "mark_delivered",
      mergeCommit: "35a48c7",
      mergedAt: "2026-06-30T13:36:48Z",
      fetchRef: "origin/main",
    });
  });

  it("E1: mark_delivered fetchRef follows the configured integration branch", () => {
    const state: PrCloudState = {
      kind: "merged",
      mergeCommit: "35a48c7",
      mergedAt: "2026-06-30T13:36:48Z",
      checkedAt: NOW,
    };
    expect(decidePendingPrReconcile(state, { nowIso, integrationBranch: "origin/dev" })).toEqual({
      action: "mark_delivered",
      mergeCommit: "35a48c7",
      mergedAt: "2026-06-30T13:36:48Z",
      fetchRef: "origin/dev",
    });
  });

  it("open + pending → wait with nextPollAt", () => {
    const state: PrCloudState = { kind: "open", ci: "pending", checkedAt: NOW };
    const d = decidePendingPrReconcile(state, { nowIso, pollIntervalSec: 30 });
    expect(d.action).toBe("wait");
    if (d.action !== "wait") throw new Error("unexpected");
    expect(d.state).toEqual(state);
    expect(d.nextPollAt).toBe("2026-06-30T13:37:18.000Z");
  });

  it("open + green → wait (still waiting for merge)", () => {
    const state: PrCloudState = { kind: "open", ci: "green", checkedAt: NOW };
    const d = decidePendingPrReconcile(state, { nowIso });
    expect(d.action).toBe("wait");
  });

  it("open + unknown → wait", () => {
    const state: PrCloudState = { kind: "open", ci: "unknown", checkedAt: NOW };
    expect(decidePendingPrReconcile(state, { nowIso }).action).toBe("wait");
  });

  it("open + red → mark_not_delivered ci_red", () => {
    const state: PrCloudState = { kind: "open", ci: "red", checkedAt: NOW };
    expect(decidePendingPrReconcile(state, { nowIso })).toEqual({
      action: "mark_not_delivered",
      reason: "ci_red",
    });
  });

  it("closed_unmerged → mark_not_delivered closed_unmerged", () => {
    const state: PrCloudState = { kind: "closed_unmerged", closedAt: NOW, checkedAt: NOW };
    expect(decidePendingPrReconcile(state, { nowIso })).toEqual({
      action: "mark_not_delivered",
      reason: "closed_unmerged",
    });
  });

  it("unreachable offline → surface_unknown retryable", () => {
    const state: PrCloudState = { kind: "unreachable", reason: "offline", checkedAt: NOW };
    const d = decidePendingPrReconcile(state, { nowIso });
    expect(d.action).toBe("surface_unknown");
    if (d.action !== "surface_unknown") throw new Error("unexpected");
    expect(d.retryable).toBe(true);
  });

  it("unreachable provider_error → surface_unknown retryable", () => {
    const state: PrCloudState = { kind: "unreachable", reason: "provider_error", checkedAt: NOW };
    const d = decidePendingPrReconcile(state, { nowIso });
    expect(d.action).toBe("surface_unknown");
    if (d.action !== "surface_unknown") throw new Error("unexpected");
    expect(d.retryable).toBe(true);
  });

  it("unreachable auth → surface_unknown not retryable", () => {
    const state: PrCloudState = { kind: "unreachable", reason: "auth", checkedAt: NOW };
    const d = decidePendingPrReconcile(state, { nowIso });
    expect(d.action).toBe("surface_unknown");
    if (d.action !== "surface_unknown") throw new Error("unexpected");
    expect(d.retryable).toBe(false);
  });

  it("unreachable not_found → surface_unknown not retryable", () => {
    const state: PrCloudState = { kind: "unreachable", reason: "not_found", checkedAt: NOW };
    const d = decidePendingPrReconcile(state, { nowIso });
    expect(d.action).toBe("surface_unknown");
    if (d.action !== "surface_unknown") throw new Error("unexpected");
    expect(d.retryable).toBe(false);
  });
});

// ── runPendingPrReconcile bounded loop ───────────────────────────────────────

describe("runPendingPrReconcile", () => {
  it("returns immediately on merged", async () => {
    const provider: PrStatusProvider = {
      name: "fake",
      pollPrStatus: async () => ({
        kind: "merged",
        mergeCommit: "35a48c7",
        mergedAt: "2026-06-30T13:36:48Z",
        checkedAt: NOW,
      }),
    };
    const r = await runPendingPrReconcile(provider, "seanyao/roll", 1111, { nowIso });
    expect(r.decision.action).toBe("mark_delivered");
    expect(r.polls).toBe(1);
    expect(r.terminal).toBe(true);
  });

  it("polls until merged", async () => {
    const states: PrCloudState[] = [
      { kind: "open", ci: "pending", checkedAt: NOW },
      { kind: "open", ci: "green", checkedAt: NOW },
      { kind: "merged", mergeCommit: "35a48c7", mergedAt: "2026-06-30T13:36:48Z", checkedAt: NOW },
    ];
    let i = 0;
    const provider: PrStatusProvider = {
      name: "fake",
      pollPrStatus: async () => states[i++]!,
    };
    const sleeps: number[] = [];
    const r = await runPendingPrReconcile(provider, "seanyao/roll", 1111, {
      nowIso,
      pollIntervalSec: 1,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
    expect(r.decision.action).toBe("mark_delivered");
    expect(r.polls).toBe(3);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it("stops at maxPolls and reports timeout", async () => {
    const provider: PrStatusProvider = {
      name: "fake",
      pollPrStatus: async () => ({ kind: "open", ci: "pending", checkedAt: NOW }),
    };
    const r = await runPendingPrReconcile(provider, "seanyao/roll", 1111, {
      nowIso,
      maxPolls: 2,
      pollIntervalSec: 0,
      sleep: async () => {},
    });
    expect(r.terminal).toBe(false);
    expect(r.polls).toBe(2);
    expect(r.decision.action).toBe("surface_unknown");
    if (r.decision.action !== "surface_unknown") throw new Error("unexpected");
    expect(r.decision.state.reason).toBe("offline");
    expect(r.decision.retryable).toBe(true);
  });

  it("stops at absolute deadline", async () => {
    let calls = 0;
    const provider: PrStatusProvider = {
      name: "fake",
      pollPrStatus: async () => ({ kind: "open", ci: "pending", checkedAt: NOW }),
    };
    const r = await runPendingPrReconcile(provider, "seanyao/roll", 1111, {
      nowIso,
      deadlineIso: NOW,
      maxPolls: 10,
      pollIntervalSec: 0,
      sleep: async () => {},
    });
    expect(r.polls).toBe(1);
    expect(r.terminal).toBe(false);
    expect(r.decision.action).toBe("surface_unknown");
  });
});

// ── delivery-record construction ─────────────────────────────────────────────

describe("buildMergedDeliveryRecord", () => {
  it("produces a done record with mergeCommit and mergedAt", () => {
    const pending = fakePendingRecord();
    const rec = buildMergedDeliveryRecord(pending, "35a48c7", "2026-06-30T13:36:48Z", 1_779_837_700_000);
    expect(rec.lifecycleState).toBe("done");
    expect(rec.mergeCommit).toEqual(present("35a48c7"));
    expect(rec.mergedAt).toEqual(present(Date.parse("2026-06-30T13:36:48Z")));
    expect(rec.prNumber).toEqual(present(1111));
    expect(rec.recordedAt).toBe(1_779_837_700_000);
  });

  it("preserves absent prNumber when pending had none", () => {
    const pending = fakePendingRecord({ prNumber: { present: false, reason: "no_publish_attempted" } });
    const rec = buildMergedDeliveryRecord(pending, "35a48c7", "2026-06-30T13:36:48Z", 1);
    expect(rec.prNumber).toEqual({ present: false, reason: "no_publish_attempted" });
  });
});

describe("buildNotDeliveredRecord", () => {
  it("closed_unmerged → abandoned", () => {
    const pending = fakePendingRecord();
    const rec = buildNotDeliveredRecord(pending, "abandoned", "closed_unmerged", 1);
    expect(rec.lifecycleState).toBe("abandoned");
    expect(rec.mergeCommit).toEqual({ present: false, reason: "not_recorded" });
  });

  it("ci_red → ci_red", () => {
    const pending = fakePendingRecord();
    const rec = buildNotDeliveredRecord(pending, "ci_red", "ci_red", 1);
    expect(rec.lifecycleState).toBe("ci_red");
  });
});

// ── batch reconcile + idempotency ────────────────────────────────────────────

describe("reconcilePendingPrs", () => {
  it("FIX-1050 fixture: pending → merged → delivered", async () => {
    const provider: PrStatusProvider = {
      name: "fake",
      pollPrStatus: async () => ({
        kind: "merged",
        mergeCommit: "35a48c7",
        mergedAt: "2026-06-30T13:36:48Z",
        checkedAt: NOW,
      }),
    };
    const item: PendingPrReconcileItem = {
      record: fakePendingRecord(),
      slug: "seanyao/roll",
      prNumber: 1111,
    };
    const results = await reconcilePendingPrs(provider, [item], { nowIso });
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.result.decision.action).toBe("mark_delivered");
    expect(r.newRecord).toBeDefined();
    expect(r.newRecord!.lifecycleState).toBe("done");
    expect(r.newRecord!.mergeCommit).toEqual(present("35a48c7"));
  });

  it("idempotency: repeated merged polls produce the same delivered record shape", async () => {
    const provider: PrStatusProvider = {
      name: "fake",
      pollPrStatus: async () => ({
        kind: "merged",
        mergeCommit: "35a48c7",
        mergedAt: "2026-06-30T13:36:48Z",
        checkedAt: NOW,
      }),
    };
    const item: PendingPrReconcileItem = {
      record: fakePendingRecord(),
      slug: "seanyao/roll",
      prNumber: 1111,
    };
    const first = await reconcilePendingPrs(provider, [item], { nowIso });
    const second = await reconcilePendingPrs(provider, [item], { nowIso });
    // The second run is a separate poll (bounded loop returns immediately because
    // the provider reports merged). The new record is structurally identical
    // except for recordedAt, which the caller controls.
    expect(first[0]!.newRecord).toBeDefined();
    expect(second[0]!.newRecord).toBeDefined();
    const { recordedAt: _a, ...a } = first[0]!.newRecord!;
    const { recordedAt: _b, ...b } = second[0]!.newRecord!;
    expect(a).toEqual(b);
  });

  it("closed_unmerged → abandoned record", async () => {
    const provider: PrStatusProvider = {
      name: "fake",
      pollPrStatus: async () => ({ kind: "closed_unmerged", closedAt: NOW, checkedAt: NOW }),
    };
    const item: PendingPrReconcileItem = {
      record: fakePendingRecord(),
      slug: "seanyao/roll",
      prNumber: 1111,
    };
    const results = await reconcilePendingPrs(provider, [item], { nowIso });
    expect(results[0]!.result.decision.action).toBe("mark_not_delivered");
    expect(results[0]!.newRecord!.lifecycleState).toBe("abandoned");
  });

  it("CI red → ci_red record", async () => {
    const provider: PrStatusProvider = {
      name: "fake",
      pollPrStatus: async () => ({ kind: "open", ci: "red", checkedAt: NOW }),
    };
    const item: PendingPrReconcileItem = {
      record: fakePendingRecord(),
      slug: "seanyao/roll",
      prNumber: 1111,
    };
    const results = await reconcilePendingPrs(provider, [item], { nowIso });
    expect(results[0]!.result.decision.action).toBe("mark_not_delivered");
    expect(results[0]!.newRecord!.lifecycleState).toBe("ci_red");
  });

  it("offline → surface_unknown with no new record", async () => {
    const provider: PrStatusProvider = {
      name: "fake",
      pollPrStatus: async () => ({ kind: "unreachable", reason: "offline", checkedAt: NOW }),
    };
    const item: PendingPrReconcileItem = {
      record: fakePendingRecord(),
      slug: "seanyao/roll",
      prNumber: 1111,
    };
    const results = await reconcilePendingPrs(provider, [item], { nowIso });
    expect(results[0]!.result.decision.action).toBe("surface_unknown");
    expect(results[0]!.newRecord).toBeUndefined();
    expect(results[0]!.reason).toBe("offline");
  });
});
