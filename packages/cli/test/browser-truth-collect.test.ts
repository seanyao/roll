import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectBrowserTimeline } from "../src/lib/browser-timeline-collect.js";
import { collectBrowserTruth } from "../src/lib/browser-truth-collect.js";
import { BrowserLeaseService, BrowserOperationLedger } from "@roll/core";

const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

function project(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "roll-browser-truth-")));
  dirs.push(dir);
  return dir;
}

describe("FIX-1263 — browser collectors honor the pinned render clock", () => {
  it("uses ROLL_RENDER_NOW for truth and timeline collection", () => {
    vi.stubEnv("ROLL_RENDER_NOW", "2030-01-02T03:04:05.678Z");
    const projectPath = project();

    expect(collectBrowserTruth({ projectPath }).collectedAt).toBe("2030-01-02T03:04:05.678Z");
    expect(collectBrowserTimeline({ projectPath }).collectedAt).toBe("2030-01-02T03:04:05.678Z");
  });
});

describe("US-BROW-022 — interactive lease ledger facts", () => {
  it("reads granted, expired, and orphaned leases from the durable event ledger", () => {
    const projectPath = project();
    const eventsPath = join(projectPath, ".roll", "browser-operations", "events.ndjson");
    const leaseDirectory = join(projectPath, ".roll", "browser-operations", "leases");
    const ledger = new BrowserOperationLedger();
    const baseNow = Date.parse("2026-07-15T00:00:00.000Z");
    const record = (event: Parameters<typeof ledger.recordBrowserEvent>[1]) => ledger.recordBrowserEvent(eventsPath, event);
    const input = (origin: string) => ({
      approval: {
        storyId: "US-BROW-022",
        origin,
        actionSummary: "navigate to owner page",
        requestedMs: 15 * 60 * 1000,
        credentialExportDenied: true,
      },
      holderPid: 42,
      holderToken: `holder-${origin}`,
      operator: "owner",
      callerTty: true,
      callerIsScheduler: false,
    });
    const active = new BrowserLeaseService(
      leaseDirectory,
      undefined,
      record,
      () => true,
      () => "owner-process",
      () => baseNow,
      () => new Date(baseNow).toISOString(),
    );
    const granted = active.grant(input("http://127.0.0.1:9222"));
    expect(granted.kind).toBe("granted");
    expect(collectBrowserTruth({ projectPath, storyId: "US-BROW-022", nowMs: baseNow + 1 }).lease.status).toBe("ready");

    active.releaseIfExpired("http://127.0.0.1:9222", baseNow + 15 * 60 * 1000);
    expect(collectBrowserTruth({ projectPath, storyId: "US-BROW-022", nowMs: baseNow + 15 * 60 * 1000 }).lease.status).toBe("expired");

    const orphaned = new BrowserLeaseService(
      leaseDirectory,
      undefined,
      record,
      () => false,
      () => "owner-process",
      () => baseNow,
      () => new Date(baseNow).toISOString(),
    );
    expect(orphaned.grant(input("http://127.0.0.1:9223")).kind).toBe("granted");
    orphaned.reclaimDeadHolder("http://127.0.0.1:9223");
    expect(collectBrowserTruth({ projectPath, storyId: "US-BROW-022", nowMs: baseNow + 1 }).lease)
      .toMatchObject({ status: "degraded", unavailableReason: "owner lease holder was orphaned" });
  });
});

describe("US-BROW-023 — persisted physical capture facts", () => {
  it("reads a capture bridge link from the durable ledger into truth and the dossier timeline", () => {
    const projectPath = project();
    const eventsPath = join(projectPath, ".roll", "browser-operations", "events.ndjson");
    const ledger = new BrowserOperationLedger();

    ledger.recordCaptureLink(eventsPath, {
      runId: "attest-run-1",
      storyId: "US-BROW-023",
      captureRequestId: "capture-1",
      captureResponse: {
        protocol: "roll.capture.v1",
        requestId: "capture-1",
        status: "taken",
        screenshotPath: "screenshots/physical.png",
        responsePath: "responses/capture-1.json",
        host: { appName: "Roll Capture.app", bundleId: "com.seanyao.roll.capture", version: "1.0.0" },
        startedAt: "2026-07-15T00:00:00.000Z",
        finishedAt: "2026-07-15T00:00:01.000Z",
      },
      canSatisfyVisualAc: true,
      reason: "physical capture is valid",
      linkedAt: "2026-07-15T00:00:01.000Z",
    });

    expect(collectBrowserTruth({ projectPath, storyId: "US-BROW-023" }).capture).toEqual({ status: "ready" });
    expect(collectBrowserTimeline({ projectPath, storyId: "US-BROW-023" }).rows).toContainEqual(
      expect.objectContaining({
        kind: "physical-capture",
        presence: "present",
        runId: "attest-run-1",
        artifact: { kind: "physical-capture", id: "screenshots/physical.png", label: "capture" },
      }),
    );
  });

  it("keeps the physical-capture timeline absent when no capture link was written", () => {
    const timeline = collectBrowserTimeline({ projectPath: project(), storyId: "US-BROW-023" });
    expect(timeline.rows).not.toContainEqual(expect.objectContaining({ kind: "physical-capture" }));
    expect(timeline.absences).toContainEqual(expect.objectContaining({ kind: "physical-capture", presence: "absent" }));
  });
});
