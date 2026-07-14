import { describe, expect, it } from "vitest";
import type { BrowserOperationEvent, CaptureBridgeLink, DiagnosticArtifactRef } from "@roll/spec";
import { browserOperationsTimeline, type BrowserOperationsTruthFacts } from "../src/truth/adapter.js";

const NOW = Date.parse("2026-07-15T00:00:00.000Z");

function facts(overrides: Partial<BrowserOperationsTruthFacts> = {}): BrowserOperationsTruthFacts {
  return { events: [], nowMs: NOW, collectedAt: "2026-07-15T00:00:00.000Z", ...overrides };
}

function diagnostic(artifactId = "diag-1"): DiagnosticArtifactRef {
  return {
    artifactId,
    kind: "console-summary",
    digest: "abc",
    bytes: 12,
    untrusted: true,
    diagnosticOnly: true,
  };
}

function managedRunEvents(): BrowserOperationEvent[] {
  return [
    {
      type: "browser:operation-requested",
      runId: "run-1",
      ts: "2026-07-15T00:00:00.000Z",
      holderTokenHash: "hash",
      request: {
        idempotencyKey: "key-1",
        storyId: "US-BROW-013",
        caller: "supervisor",
        lane: "managed",
        targetUrl: "https://example.test",
        purpose: "diagnose",
      },
    },
    {
      type: "browser:operation-started",
      runId: "run-1",
      ts: "2026-07-15T00:00:01.000Z",
    },
    {
      type: "browser:operation-finished",
      runId: "run-1",
      ts: "2026-07-15T00:00:10.000Z",
      result: {
        runId: "run-1",
        actionId: "snapshot",
        status: "ok",
        diagnosticRefs: [diagnostic()],
        redactedSummary: "ok",
      },
    },
  ];
}

function interactiveLeaseEvents(): BrowserOperationEvent[] {
  return [
    {
      type: "browser:lease-granted",
      leaseId: "lease-1",
      ts: "2026-07-15T00:00:00.000Z",
      storyId: "US-BROW-013",
      origin: "https://example.test",
      actionSummary: "approve",
      expiresAt: "2026-07-15T00:15:00.000Z",
      credentialExportDenied: true,
    },
    {
      type: "browser:operation-requested",
      runId: "run-interactive",
      ts: "2026-07-15T00:00:02.000Z",
      holderTokenHash: "hash",
      request: {
        idempotencyKey: "key-interactive",
        storyId: "US-BROW-013",
        caller: "supervisor",
        lane: "interactive",
        targetUrl: "https://example.test",
        purpose: "verify",
      },
    },
    {
      type: "browser:operation-started",
      runId: "run-interactive",
      ts: "2026-07-15T00:00:03.000Z",
    },
    {
      type: "browser:operation-finished",
      runId: "run-interactive",
      ts: "2026-07-15T00:00:08.000Z",
      result: {
        runId: "run-interactive",
        actionId: "navigate",
        status: "ok",
        diagnosticRefs: [],
        redactedSummary: "ok",
      },
    },
    {
      type: "browser:lease-released",
      leaseId: "lease-1",
      ts: "2026-07-15T00:00:09.000Z",
    },
  ];
}

function captureLink(ok: boolean): CaptureBridgeLink {
  return {
    runId: "run-1",
    storyId: "US-BROW-013",
    captureRequestId: "capture-1",
    canSatisfyVisualAc: ok,
    reason: ok ? "verified" : "digest_mismatch",
    linkedAt: "2026-07-15T00:00:12.000Z",
    captureResponse: ok
      ? {
          protocol: "roll.capture.v1",
          status: "taken",
          requestId: "capture-1",
          screenshotPath: "screenshots/capture.png",
          responsePath: "capture.response.json",
          host: { appName: "Roll Capture.app", bundleId: "com.seanyao.roll.capture", version: "1.0.0" },
          startedAt: "2026-07-15T00:00:11.000Z",
          finishedAt: "2026-07-15T00:00:12.000Z",
        }
      : {
          protocol: "roll.capture.v1",
          status: "failed",
          requestId: "capture-1",
          responsePath: "capture.response.json",
          reason: "digest_mismatch",
          host: { appName: "Roll Capture.app", bundleId: "com.seanyao.roll.capture", version: "1.0.0" },
          startedAt: "2026-07-15T00:00:11.000Z",
          finishedAt: "2026-07-15T00:00:12.000Z",
        },
  };
}

describe("US-BROW-013 browserOperationsTimeline", () => {
  it("managed-only: orders start/finish and reports lease/capture absences", () => {
    const timeline = browserOperationsTimeline(facts({ events: managedRunEvents() }));

    expect(timeline.hasFacts).toBe(true);
    expect(timeline.rows.map((row) => row.kind)).toEqual(["operation-start", "operation-finish"]);
    expect(timeline.rows[1]?.artifact).toEqual({
      kind: "diagnostic",
      id: "diag-1",
      label: "console-summary",
    });
    expect(timeline.absences.map((row) => row.kind)).toEqual([
      "lease-grant",
      "lease-expiry",
      "lease-release",
      "physical-capture",
    ]);
    expect(timeline.absences.every((row) => row.presence === "absent" && row.ts === undefined)).toBe(true);
    expect(timeline).toMatchSnapshot();
  });

  it("interactive: keeps lease grant → op → release ordering from declared stamps", () => {
    const timeline = browserOperationsTimeline(facts({ events: interactiveLeaseEvents() }));

    expect(timeline.rows.map((row) => [row.kind, row.ts])).toEqual([
      ["lease-grant", "2026-07-15T00:00:00.000Z"],
      ["operation-start", "2026-07-15T00:00:03.000Z"],
      ["operation-finish", "2026-07-15T00:00:08.000Z"],
      ["lease-release", "2026-07-15T00:00:09.000Z"],
    ]);
    expect(timeline.absences.map((row) => row.kind)).toEqual(["lease-expiry", "physical-capture"]);
    expect(timeline).toMatchSnapshot();
  });

  it("capture-failed: records the physical-capture fact with failure detail, no invented pass", () => {
    const timeline = browserOperationsTimeline(
      facts({ events: managedRunEvents(), captureLinks: [captureLink(false)] }),
    );

    const capture = timeline.rows.find((row) => row.kind === "physical-capture");
    expect(capture).toMatchObject({
      presence: "present",
      detail: "failed — digest_mismatch",
      artifact: { kind: "physical-capture", id: "capture-1", label: "capture" },
    });
    expect(timeline.absences.map((row) => row.kind)).not.toContain("physical-capture");
    expect(timeline).toMatchSnapshot();
  });

  it("no-fact: hasFacts is false and every category is an honest absence", () => {
    const timeline = browserOperationsTimeline(facts());

    expect(timeline.hasFacts).toBe(false);
    expect(timeline.rows).toEqual([]);
    expect(timeline.absences).toHaveLength(6);
    expect(timeline.absences.every((row) => row.presence === "absent" && row.detail !== undefined)).toBe(true);
    expect(timeline).toMatchSnapshot();
  });

  it("does not invent chronological stamps for absences even when other facts exist", () => {
    const timeline = browserOperationsTimeline(facts({ events: managedRunEvents() }));
    for (const absence of timeline.absences) {
      expect(absence.ts).toBeUndefined();
      expect(absence.presence).toBe("absent");
    }
  });
});
