import { describe, expect, it } from "vitest";
import type { BrowserOperationEvent, CaptureBridgeLink } from "@roll/spec";
import { browserOperationsTruth, type BrowserOperationsTruthFacts } from "../src/truth/adapter.js";

const NOW = Date.parse("2026-07-15T00:00:00.000Z");

function facts(overrides: Partial<BrowserOperationsTruthFacts> = {}): BrowserOperationsTruthFacts {
  return { events: [], nowMs: NOW, ...overrides };
}

function finishedManagedRun(status: "ok" | "failed"): BrowserOperationEvent[] {
  return [
    {
      type: "browser:operation-requested",
      runId: "run-1",
      ts: "2026-07-15T00:00:00.000Z",
      holderTokenHash: "hash",
      request: {
        idempotencyKey: "key-1",
        storyId: "US-BROW-009a",
        caller: "supervisor",
        lane: "managed",
        targetUrl: "https://example.test",
        purpose: "diagnose",
      },
    },
    {
      type: "browser:operation-finished",
      runId: "run-1",
      ts: "2026-07-15T00:00:10.000Z",
      result: { runId: "run-1", actionId: "snapshot", status, diagnosticRefs: [], redactedSummary: status },
    },
  ];
}

function captureLink(canSatisfyVisualAc: boolean): CaptureBridgeLink {
  return {
    runId: "run-1",
    storyId: "US-BROW-009a",
    captureRequestId: "capture-1",
    canSatisfyVisualAc,
    reason: canSatisfyVisualAc ? "verified" : "digest_mismatch",
    linkedAt: "2026-07-15T00:00:10.000Z",
    captureResponse: canSatisfyVisualAc
      ? { protocol: "roll.capture.v1", status: "taken", requestId: "capture-1", pngPath: "capture.png" }
      : { protocol: "roll.capture.v1", status: "failed", requestId: "capture-1" },
  };
}

describe("US-BROW-009a browser operations truth adapter", () => {
  it("projects ready facts from the declared ledger, active lease, and capture classifier", () => {
    const truth = browserOperationsTruth(facts({
      events: finishedManagedRun("ok"),
      activeLease: { leaseId: "lease-1", storyId: "US-BROW-009a", expiresAt: "2026-07-15T00:15:00.000Z" },
      captureLinks: [captureLink(true)],
    }));

    expect(truth.managed.status).toBe("ready");
    expect(truth.lease).toMatchObject({ status: "ready", expiresAt: "2026-07-15T00:15:00.000Z" });
    expect(truth.capture.status).toBe("ready");
  });

  it("keeps failed ledger and invalid capture facts degraded with their declared reason", () => {
    const truth = browserOperationsTruth(facts({
      events: finishedManagedRun("failed"),
      captureLinks: [captureLink(false)],
    }));

    expect(truth.managed).toMatchObject({ status: "degraded", unavailableReason: "managed operation failed" });
    expect(truth.capture).toMatchObject({ status: "degraded", unavailableReason: "digest_mismatch" });
  });

  it("projects an expired lease with its expiry instead of treating its grant as ready", () => {
    const truth = browserOperationsTruth(facts({
      activeLease: { leaseId: "lease-expired", storyId: "US-BROW-009a", expiresAt: "2026-07-14T23:59:59.000Z" },
    }));

    expect(truth.lease).toMatchObject({
      status: "expired",
      expiresAt: "2026-07-14T23:59:59.000Z",
      unavailableReason: "owner lease expired",
    });
  });

  it("projects granted, expired, and orphaned ledger lease facts without a live lock probe", () => {
    const granted: BrowserOperationEvent = {
      type: "browser:lease-granted",
      leaseId: "lease-ledger",
      ts: "2026-07-15T00:00:00.000Z",
      storyId: "US-BROW-022",
      origin: "http://127.0.0.1:9222",
      actionSummary: "navigate to owner page",
      expiresAt: "2026-07-15T00:15:00.000Z",
      credentialExportDenied: true,
    };

    expect(browserOperationsTruth(facts({ events: [granted], storyId: "US-BROW-022" })).lease)
      .toMatchObject({ status: "ready", expiresAt: granted.expiresAt });
    expect(browserOperationsTruth(facts({
      events: [granted, { type: "browser:lease-expired", leaseId: granted.leaseId, ts: "2026-07-15T00:15:00.000Z" }],
      storyId: "US-BROW-022",
    })).lease).toMatchObject({ status: "expired", expiresAt: granted.expiresAt });
    expect(browserOperationsTruth(facts({
      events: [granted, { type: "browser:lease-orphaned", leaseId: granted.leaseId, ts: "2026-07-15T00:01:00.000Z", endpointHash: "endpoint", holderPid: 42 }],
      storyId: "US-BROW-022",
    })).lease).toMatchObject({ status: "degraded", unavailableReason: "owner lease holder was orphaned" });
  });

  it("does not project a prior cycle's capture as ready for the current cycle", () => {
    const oldCycleEvents = finishedManagedRun("ok").map((event) =>
      event.type === "browser:operation-requested"
        ? { ...event, request: { ...event.request, cycleId: "cycle-old" } }
        : event,
    );
    const currentCycleEvents: BrowserOperationEvent[] = [
      {
        type: "browser:operation-requested",
        runId: "run-current",
        ts: "2026-07-15T00:00:20.000Z",
        holderTokenHash: "hash",
        request: {
          idempotencyKey: "key-current",
          storyId: "US-BROW-009a",
          cycleId: "cycle-current",
          caller: "supervisor",
          lane: "managed",
          targetUrl: "https://example.test",
          purpose: "diagnose",
        },
      },
    ];

    const truth = browserOperationsTruth(facts({
      cycleId: "cycle-current",
      events: [...oldCycleEvents, ...currentCycleEvents],
      captureLinks: [captureLink(true)],
    }));

    expect(truth.capture).toMatchObject({ status: "unknown", unavailableReason: "no physical capture facts" });
  });

  it("keeps every missing fact unknown and never infers a pass", () => {
    const truth = browserOperationsTruth(facts());

    expect(truth.managed).toMatchObject({ status: "unknown", unavailableReason: "no managed operation facts" });
    expect(truth.lease).toMatchObject({ status: "unknown", unavailableReason: "no owner lease facts" });
    expect(truth.capture).toMatchObject({ status: "unknown", unavailableReason: "no physical capture facts" });
  });
});
