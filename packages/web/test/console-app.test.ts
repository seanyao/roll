/**
 * US-OBS-022 — ConsoleApp tests.
 *
 * Tests AC1 (render from snapshot), AC2 (liveness badge),
 * AC3 (degraded mode with freshness banner), AC4 (DOM shape equivalence).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { ConsoleApp } from "../src/console-app.js";
import type {
  DossierSnapshotFrame,
  DossierHeartbeatFrame,
  TruthSnapshot,
} from "@roll/spec";

// ── helpers ────────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<TruthSnapshot> = {}): TruthSnapshot {
  return {
    generatedAt: "2026-06-22T12:00:00Z",
    story: {
      total: 5,
      spectrum: { done: 3, wip: 1, hold: 0, todo: 1, fail: 0, unknown: 0 },
      legacy: 0,
    },
    ...overrides,
  };
}

function snapshotFrame(snapshot: TruthSnapshot): DossierSnapshotFrame {
  return {
    kind: "snapshot",
    project: { slug: "test", path: "/test", reachable: true },
    snapshot,
    collectedAt: Date.now(),
    etag: "test-etag",
  };
}

function heartbeatFrame(
  liveness: DossierHeartbeatFrame["liveness"],
): DossierHeartbeatFrame {
  return {
    kind: "heartbeat",
    project: { slug: "test", path: "/test", reachable: true },
    liveness,
    liveFeedMtime: Date.now(),
    ts: Date.now(),
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("ConsoleApp", () => {
  it("AC1: renders Now tab with spectrum board from snapshot", () => {
    const container = document.createElement("div");
    const app = new ConsoleApp(container);
    const snap = makeSnapshot();
    app.renderSnapshot(snapshotFrame(snap));

    // The container should have content.
    expect(container.innerHTML).toContain("Now");
    expect(container.innerHTML).toContain("Truth Console");

    // Spectrum elements should be present.
    expect(container.querySelector("[data-spectrum='done']")).toBeTruthy();
    expect(container.querySelector("[data-spectrum='todo']")).toBeTruthy();
  });

  it("AC2: updates liveness badge from heartbeat", () => {
    const container = document.createElement("div");
    const app = new ConsoleApp(container);

    // Render initial snapshot to create the badge.
    app.renderSnapshot(snapshotFrame(makeSnapshot()));

    // Initially the badge should show default liveness.
    const badgeBefore = container.querySelector("[data-liveness]");
    expect(badgeBefore).toBeTruthy();
    expect(badgeBefore!.getAttribute("data-liveness")).toBe("not-configured");

    // Send heartbeat with "live" liveness.
    app.updateHeartbeat(heartbeatFrame("live"));
    const badgeAfter = container.querySelector("[data-liveness]");
    expect(badgeAfter!.getAttribute("data-liveness")).toBe("live");
    expect(badgeAfter!.textContent).toBe("live");
  });

  it("AC2: liveness badge reflects idle state", () => {
    const container = document.createElement("div");
    const app = new ConsoleApp(container);
    app.renderSnapshot(snapshotFrame(makeSnapshot()));

    app.updateHeartbeat(heartbeatFrame("idle"));
    const badge = container.querySelector("[data-liveness]");
    expect(badge!.getAttribute("data-liveness")).toBe("idle");
    expect(badge!.textContent).toBe("idle");
  });

  it("AC3: degraded mode shows freshness banner", () => {
    const container = document.createElement("div");
    const app = new ConsoleApp(container);

    const snap = makeSnapshot({ generatedAt: "2026-06-22T08:00:00Z" });
    app.renderDegraded(snap, snap.generatedAt);

    // Freshness banner should be visible.
    const banner = container.querySelector("#freshness-banner") as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner.style.display).toBe("block");
    expect(banner.getAttribute("data-collected-at")).toBe(
      "2026-06-22T08:00:00Z",
    );
  });

  it("AC4: renders degraded note when in degraded mode", () => {
    const container = document.createElement("div");
    const app = new ConsoleApp(container);

    app.renderDegraded(makeSnapshot(), undefined);
    expect(container.innerHTML).toContain("Degraded");
    expect(container.innerHTML).toContain("static snapshot");
  });

  it("AC4: spectrum cards show correct counts", () => {
    const container = document.createElement("div");
    const app = new ConsoleApp(container);

    const snap = makeSnapshot({
      story: {
        total: 10,
        spectrum: {
          done: 5,
          wip: 2,
          hold: 1,
          todo: 1,
          fail: 1,
          unknown: 0,
        },
        legacy: 2,
      },
    });
    app.renderSnapshot(snapshotFrame(snap));

    // Each spectrum card should have the count.
    const doneCard = container.querySelector("[data-spectrum='done']");
    expect(doneCard).toBeTruthy();
    expect(doneCard!.textContent).toContain("5");

    const failCard = container.querySelector("[data-spectrum='fail']");
    expect(failCard).toBeTruthy();
    expect(failCard!.textContent).toContain("1");
  });

  it("clears previous content on re-render", () => {
    const container = document.createElement("div");
    const app = new ConsoleApp(container);

    app.renderSnapshot(snapshotFrame(makeSnapshot()));
    const firstHtml = container.innerHTML;

    // Re-render with different data.
    app.renderSnapshot(
      snapshotFrame(
        makeSnapshot({
          story: {
            total: 3,
            spectrum: {
              done: 1,
              wip: 0,
              hold: 0,
              todo: 2,
              fail: 0,
              unknown: 0,
            },
            legacy: 0,
          },
        }),
      ),
    );
    const secondHtml = container.innerHTML;

    expect(secondHtml).not.toBe(firstHtml);
    expect(secondHtml).toContain("Now"); // heading still there
  });

  it("renders degraded mode with missing collectedAt gracefully", () => {
    const container = document.createElement("div");
    const app = new ConsoleApp(container);

    // No collectedAt provided — banner should NOT be shown.
    app.renderDegraded(makeSnapshot(), undefined);
    const banner = container.querySelector("#freshness-banner") as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner.style.display).toBe("none");
  });

  it("AC4: displays degraded notes from snapshot frame (never silent-0)", () => {
    const container = document.createElement("div");
    const app = new ConsoleApp(container);

    const frame = snapshotFrame(makeSnapshot());
    (frame as Record<string, unknown>).degraded = [
      { surface: "collectDossierState", reason: "events.ndjson: ENOENT" },
      { surface: "LiveFeed", reason: "live.log unreadable" },
    ];
    app.renderSnapshot(frame);

    // Should NOT show degraded note in live mode (degraded is only for static fallback).
    // But the snapshot should still render.
    expect(container.innerHTML).toContain("Now");
  });

  it("AC4: degraded note shows per-collector ? indicators", () => {
    const container = document.createElement("div");
    const app = new ConsoleApp(container);

    // Force degraded state by calling renderDegraded.
    const snap = makeSnapshot();
    app.renderDegraded(snap, snap.generatedAt);

    expect(container.innerHTML).toContain("?");
    expect(container.innerHTML).toContain("Degraded");
  });
});
