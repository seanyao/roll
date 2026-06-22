/**
 * US-OBS-020 — DossierFrame type contract tests.
 *
 * Covers AC3 (discriminant + round-trip), AC4 (ETag determinism),
 * AC5 (bandwidth/perf guard), and AC6 (barrel re-export).
 */
import { describe, it, expect } from "vitest";
import type {
  DossierFrame,
  DossierSnapshotFrame,
  DossierHeartbeatFrame,
  ProjectIdentity,
  DegradedNote,
} from "../src/types/dossier-frame.js";
import {
  hashSnapshot,
  isSnapshotFrame,
  isHeartbeatFrame,
} from "../src/types/dossier-frame.js";
import type { TruthSnapshot, TruthSnapshotStory } from "../src/types/truth-snapshot.js";
import type { RollEvent } from "../src/types/events.js";

// ── helpers ──────────────────────────────────────────────────────────

function makeProject(overrides?: Partial<ProjectIdentity>): ProjectIdentity {
  return {
    slug: "a1b2c3",
    path: "/Users/test/roll-v3",
    reachable: true,
    ...overrides,
  };
}

function makeMinimalSnapshot(overrides?: Partial<TruthSnapshot>): TruthSnapshot {
  const story: TruthSnapshotStory = {
    total: 3,
    spectrum: { done: 1, wip: 1, hold: 0, todo: 1, fail: 0, unknown: 0 },
    legacy: 0,
  };
  return {
    generatedAt: "2026-06-22T12:00:00Z",
    story,
    ...overrides,
  };
}

function makeSnapshotFrame(overrides?: Partial<DossierSnapshotFrame>): DossierSnapshotFrame {
  const snapshot = makeMinimalSnapshot();
  return {
    kind: "snapshot",
    project: makeProject(),
    snapshot,
    collectedAt: 1750400000000,
    etag: hashSnapshot(snapshot),
    ...overrides,
  } as DossierSnapshotFrame;
}

function makeHeartbeatFrame(overrides?: Partial<DossierHeartbeatFrame>): DossierHeartbeatFrame {
  return {
    kind: "heartbeat",
    project: makeProject(),
    liveness: "live",
    liveFeedMtime: 1750400000000,
    ts: 1750400001000,
    ...overrides,
  };
}

// ── AC3: type guard + JSON round-trip ─────────────────────────────────

describe("AC3 — type guard discriminant + JSON round-trip", () => {
  it("isSnapshotFrame returns true for snapshot frame", () => {
    const frame = makeSnapshotFrame();
    expect(isSnapshotFrame(frame)).toBe(true);
    expect(isHeartbeatFrame(frame)).toBe(false);
  });

  it("isHeartbeatFrame returns true for heartbeat frame", () => {
    const frame = makeHeartbeatFrame();
    expect(isHeartbeatFrame(frame)).toBe(true);
    expect(isSnapshotFrame(frame)).toBe(false);
  });

  it("type guard narrows correctly in a conditional", () => {
    const frames: DossierFrame[] = [makeSnapshotFrame(), makeHeartbeatFrame()];
    const snapshots = frames.filter(isSnapshotFrame);
    const heartbeats = frames.filter(isHeartbeatFrame);
    expect(snapshots).toHaveLength(1);
    expect(heartbeats).toHaveLength(1);
    // TypeScript narrowing: accessing kind-specific fields
    expect(snapshots[0].snapshot).toBeDefined();
    expect(heartbeats[0].liveness).toBe("live");
  });

  it("snapshot frame round-trips through JSON with etag intact", () => {
    const original = makeSnapshotFrame({ degraded: [{ surface: "events", reason: "unparseable line" }] });
    const json = JSON.stringify(original);
    const parsed: DossierSnapshotFrame = JSON.parse(json);

    expect(parsed.kind).toBe("snapshot");
    expect(parsed.etag).toBe(original.etag);
    expect(parsed.collectedAt).toBe(original.collectedAt);
    expect(parsed.project.slug).toBe(original.project.slug);
    expect(parsed.project.path).toBe(original.project.path);
    expect(parsed.project.reachable).toBe(original.project.reachable);
    expect(parsed.snapshot.generatedAt).toBe(original.snapshot.generatedAt);
    expect(parsed.snapshot.story.total).toBe(original.snapshot.story.total);
    expect(parsed.degraded).toHaveLength(1);
    expect(parsed.degraded![0].surface).toBe("events");
  });

  it("snapshot frame round-trips with full TruthSnapshot intact (complex)", () => {
    const fullSnapshot: TruthSnapshot = {
      generatedAt: "2026-06-22T12:00:00Z",
      collectedAt: "2026-06-22T12:00:01Z",
      story: {
        total: 10,
        spectrum: { done: 5, wip: 2, hold: 1, todo: 1, fail: 1, unknown: 0 },
        legacy: 3,
      },
      audit: { fail: 0, warn: 2, unknown: 0, collectedAt: "2026-06-22T12:00:00Z" },
      cycle: { cycles3d: 8, failed3d: 1, costUsd3d: 2.5, costByCurrency3d: { USD: 2.5 }, collectedAt: "2026-06-22T12:00:00Z" },
      release: { latestTag: "v3.1.0", verdict: "pass" },
      loop: {
        lanes: [{ name: "loop", source: "launchd", running: true, mode: "auto", everyMin: 15, lastAt: "2026-06-22T11:45:00Z", nextAt: "2026-06-22T12:00:00Z" }],
        collectedAt: "2026-06-22T12:00:00Z",
      },
      stories: [
        {
          id: "US-OBS-016",
          epic: "loop-observability",
          ladder: "attested",
          evidence: { report: true, acMap: true, visualEvidence: true },
          truthState: "done",
          truthReason: "merged+attest",
          legacy: false,
        },
      ],
    };
    const frame: DossierSnapshotFrame = {
      kind: "snapshot",
      project: makeProject(),
      snapshot: fullSnapshot,
      collectedAt: 1750400000000,
      etag: hashSnapshot(fullSnapshot),
    };

    const json = JSON.stringify(frame);
    const parsed: DossierSnapshotFrame = JSON.parse(json);

    expect(parsed.etag).toBe(frame.etag);
    expect(parsed.snapshot.story.total).toBe(10);
    expect(parsed.snapshot.audit?.warn).toBe(2);
    expect(parsed.snapshot.cycle?.cycles3d).toBe(8);
    expect(parsed.snapshot.cycle?.costByCurrency3d?.USD).toBe(2.5);
    expect(parsed.snapshot.release?.latestTag).toBe("v3.1.0");
    expect(parsed.snapshot.loop?.lanes).toHaveLength(1);
    expect(parsed.snapshot.stories).toHaveLength(1);
    expect(parsed.snapshot.stories![0].ladder).toBe("attested");
  });

  it("heartbeat frame round-trips through JSON", () => {
    const recentEvent: RollEvent = {
      type: "cycle:phase",
      cycleId: "c-test",
      phase: "build",
      ts: 1750400000500,
    };
    const original = makeHeartbeatFrame({ recentEvents: [recentEvent] });
    const json = JSON.stringify(original);
    const parsed: DossierHeartbeatFrame = JSON.parse(json);

    expect(parsed.kind).toBe("heartbeat");
    expect(parsed.liveness).toBe("live");
    expect(parsed.liveFeedMtime).toBe(original.liveFeedMtime);
    expect(parsed.ts).toBe(original.ts);
    expect(parsed.recentEvents).toHaveLength(1);
    expect(parsed.recentEvents![0].type).toBe("cycle:phase");
  });

  it("snapshot frame deserialized JSON still discriminates correctly", () => {
    const frame = makeSnapshotFrame();
    const json = JSON.stringify(frame);
    const parsed = JSON.parse(json) as DossierFrame;
    expect(isSnapshotFrame(parsed)).toBe(true);
    expect(isHeartbeatFrame(parsed)).toBe(false);
  });

  it("heartbeat frame deserialized JSON still discriminates correctly", () => {
    const frame = makeHeartbeatFrame();
    const json = JSON.stringify(frame);
    const parsed = JSON.parse(json) as DossierFrame;
    expect(isHeartbeatFrame(parsed)).toBe(true);
    expect(isSnapshotFrame(parsed)).toBe(false);
  });
});

// ── AC4: ETag determinism ────────────────────────────────────────────

describe("AC4 — ETag determinism", () => {
  it("same snapshot → same etag", () => {
    const snap = makeMinimalSnapshot();
    const etag1 = hashSnapshot(snap);
    const etag2 = hashSnapshot(snap);
    expect(etag1).toBe(etag2);
    expect(etag1).toHaveLength(8);
  });

  it("stable across two serializations of an equal snapshot", () => {
    // Construct two structurally-equal but separately-created snapshots.
    const a: TruthSnapshot = {
      generatedAt: "2026-06-22T12:00:00Z",
      story: { total: 5, spectrum: { done: 2, wip: 1, hold: 1, todo: 1, fail: 0, unknown: 0 }, legacy: 0 },
    };
    const b: TruthSnapshot = {
      generatedAt: "2026-06-22T12:00:00Z",
      story: { total: 5, spectrum: { done: 2, wip: 1, hold: 1, todo: 1, fail: 0, unknown: 0 }, legacy: 0 },
    };
    expect(hashSnapshot(a)).toBe(hashSnapshot(b));
  });

  it("differs when the snapshot changes (total count)", () => {
    const snap1 = makeMinimalSnapshot({ story: { total: 5, spectrum: { done: 2, wip: 1, hold: 1, todo: 1, fail: 0, unknown: 0 }, legacy: 0 } });
    const snap2 = makeMinimalSnapshot({ story: { total: 6, spectrum: { done: 3, wip: 1, hold: 1, todo: 1, fail: 0, unknown: 0 }, legacy: 0 } });
    expect(hashSnapshot(snap1)).not.toBe(hashSnapshot(snap2));
  });

  it("differs when the snapshot changes (spectrum)", () => {
    const snap1 = makeMinimalSnapshot({ story: { total: 3, spectrum: { done: 1, wip: 1, hold: 0, todo: 1, fail: 0, unknown: 0 }, legacy: 0 } });
    const snap2 = makeMinimalSnapshot({ story: { total: 3, spectrum: { done: 0, wip: 1, hold: 1, todo: 1, fail: 0, unknown: 0 }, legacy: 0 } });
    expect(hashSnapshot(snap1)).not.toBe(hashSnapshot(snap2));
  });

  it("differs when optional fields appear/disappear", () => {
    const snap1 = makeMinimalSnapshot();
    const snap2 = makeMinimalSnapshot({ audit: { fail: 1, warn: 0, unknown: 0 } });
    expect(hashSnapshot(snap1)).not.toBe(hashSnapshot(snap2));
  });

  it("etag is hex string of length 8", () => {
    const etag = hashSnapshot(makeMinimalSnapshot());
    expect(etag).toMatch(/^[0-9a-f]{8}$/);
  });

  it("equal snapshot via JSON round-trip still produces same etag", () => {
    const snap = makeMinimalSnapshot();
    const etag1 = hashSnapshot(snap);
    const roundTripped: TruthSnapshot = JSON.parse(JSON.stringify(snap));
    const etag2 = hashSnapshot(roundTripped);
    expect(etag1).toBe(etag2);
  });
});

// ── AC5: bandwidth/perf guard ────────────────────────────────────────

describe("AC5 — bandwidth/perf guard", () => {
  it("heartbeat frame serializes well under 2 KB (no embedded TruthSnapshot)", () => {
    const frame = makeHeartbeatFrame({
      recentEvents: [
        { type: "cycle:phase", cycleId: "c-abc", phase: "build", ts: 1750400000500 },
        { type: "cycle:tcr", cycleId: "c-abc", commitHash: "abc123def456", message: "tcr: fix thing", ts: 1750400001000 },
      ],
    });
    const json = JSON.stringify(frame);
    expect(json.length).toBeLessThan(2048);
    // Heartbeat must NOT contain a snapshot field.
    expect(json).not.toContain('"snapshot"');
  });

  it("heartbeat frame without recentEvents is tiny (< 512 bytes)", () => {
    const frame = makeHeartbeatFrame();
    const json = JSON.stringify(frame);
    expect(json.length).toBeLessThan(512);
  });

  it("snapshot frame is larger (contains full TruthSnapshot) — sanity check", () => {
    const frame = makeSnapshotFrame();
    const json = JSON.stringify(frame);
    // A snapshot frame must be larger than a raw heartbeat — it carries the
    // full TruthSnapshot.
    expect(json.length).toBeGreaterThan(256);
  });

  it("no diff field on snapshot frame", () => {
    const frame = makeSnapshotFrame();
    const json = JSON.stringify(frame);
    expect(json).not.toContain('"diff"');
    expect(json).not.toContain('"patch"');
  });

  it("no diff field on heartbeat frame", () => {
    const frame = makeHeartbeatFrame();
    const json = JSON.stringify(frame);
    expect(json).not.toContain('"diff"');
    expect(json).not.toContain('"patch"');
  });

  it("no delta or patch protocol field in DossierSnapshotFrame type", () => {
    // Structural test: a manually-constructed frame with no diff-like keys
    const frame = makeSnapshotFrame();
    const keys = Object.keys(frame);
    expect(keys).not.toContain("diff");
    expect(keys).not.toContain("patch");
    expect(keys).not.toContain("delta");
  });

  it("no delta or patch protocol field in DossierHeartbeatFrame type", () => {
    const frame = makeHeartbeatFrame();
    const keys = Object.keys(frame);
    expect(keys).not.toContain("diff");
    expect(keys).not.toContain("patch");
    expect(keys).not.toContain("delta");
  });

  it("heartbeat with max realistic recentEvents stays under budget", () => {
    // 20 events is a generous tail; should still be light.
    const events: RollEvent[] = Array.from({ length: 20 }, (_, i) => ({
      type: "cycle:stdout" as const,
      cycleId: `c-${i}`,
      data: `line ${i}: some agent output that is moderately long`,
      ts: 1750400000000 + i * 1000,
    }));
    const frame = makeHeartbeatFrame({ recentEvents: events });
    const json = JSON.stringify(frame);
    // 20 medium events should still fit in a few KB.
    expect(json.length).toBeLessThan(8192);
    expect(json).not.toContain('"snapshot"');
  });
});

// ── AC6 barrel re-export is verified via the imports above resolving. ─

// ── additional correctness guards ─────────────────────────────────────

describe("DossierFrame — structural contract", () => {
  it("DossierSnapshotFrame has all required fields", () => {
    const frame = makeSnapshotFrame();
    expect(frame.kind).toBe("snapshot");
    expect(frame.project).toBeDefined();
    expect(frame.snapshot).toBeDefined();
    expect(typeof frame.collectedAt).toBe("number");
    expect(typeof frame.etag).toBe("string");
  });

  it("DossierHeartbeatFrame has all required fields", () => {
    const frame = makeHeartbeatFrame();
    expect(frame.kind).toBe("heartbeat");
    expect(frame.project).toBeDefined();
    expect(frame.liveness).toBe("live");
    expect(frame.ts).toBeGreaterThan(0);
  });

  it("heartbeat frame NEVER carries snapshot (structural)", () => {
    const frame = makeHeartbeatFrame();
    expect((frame as Record<string, unknown>).snapshot).toBeUndefined();
  });

  it("heartbeat recentEvents are raw RollEvents", () => {
    const event: RollEvent = {
      type: "cycle:start",
      cycleId: "c-1",
      storyId: "US-OBS-020",
      agent: "claude",
      model: "sonnet",
      ts: 1750400000000,
    };
    const frame = makeHeartbeatFrame({ recentEvents: [event] });
    expect(frame.recentEvents![0].type).toBe("cycle:start");
  });

  it("liveness accepts all four valid values", () => {
    const valid: Array<DossierHeartbeatFrame["liveness"]> = [
      "live",
      "idle",
      "paused",
      "not-configured",
    ];
    for (const l of valid) {
      const frame = makeHeartbeatFrame({ liveness: l });
      expect(frame.liveness).toBe(l);
    }
  });

  it("degraded is optional on snapshot frame", () => {
    const frameWithout = makeSnapshotFrame();
    expect(frameWithout.degraded).toBeUndefined();

    const frameWith = makeSnapshotFrame({
      degraded: [{ surface: "events", reason: "torn line" }],
    });
    expect(frameWith.degraded).toHaveLength(1);
  });

  it("liveFeedMtime can be null (no live.log exists)", () => {
    const frame = makeHeartbeatFrame({ liveFeedMtime: null });
    expect(frame.liveFeedMtime).toBeNull();
  });
});
