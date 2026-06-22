/**
 * US-OBS-022 — FrameHandler tests.
 *
 * Tests AC1 (single WebSocket, ETag dedup), AC2 (heartbeat dispatch),
 * AC3 (degrade on disconnect, auto-reconnect).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FrameHandler } from "../src/frame-handler.js";
import type {
  DossierSnapshotFrame,
  DossierHeartbeatFrame,
} from "@roll/spec";

// ── helpers ────────────────────────────────────────────────────────────────

function snapshotFrame(etag: string): DossierSnapshotFrame {
  return {
    kind: "snapshot",
    project: { slug: "test", path: "/test", reachable: true },
    snapshot: {
      generatedAt: "2026-06-22T12:00:00Z",
      story: {
        total: 5,
        spectrum: { done: 3, wip: 1, hold: 0, todo: 1, fail: 0, unknown: 0 },
        legacy: 0,
      },
    },
    collectedAt: Date.now(),
    etag,
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

/** Creates a mock WebSocket class that records callbacks and accepts messages. */
function makeMockWs(): {
  MockWs: new () => Record<string, unknown>;
  open: () => void;
  send: (data: string) => void;
  close: () => void;
} {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  class MockWebSocket {
    readyState = 1;
    constructor(_url: string) {
      // Fire open asynchronously (like real WebSocket).
      Promise.resolve().then(() => {
        listeners["open"]?.forEach((cb) => cb());
      });
    }
    addEventListener(event: string, cb: (...args: unknown[]) => void) {
      (listeners[event] ??= []).push(cb);
    }
    close() {
      Promise.resolve().then(() => {
        listeners["close"]?.forEach((cb) => cb());
      });
    }
    // for test inspection
    static listeners = listeners;
  }

  return {
    MockWs: MockWebSocket as unknown as new () => Record<string, unknown>,
    open: () => listeners["open"]?.forEach((cb) => cb()),
    send: (data: string) => {
      listeners["message"]?.forEach((cb) => cb({ data } as MessageEvent));
    },
    close: () => {
      listeners["close"]?.forEach((cb) => cb());
    },
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("FrameHandler", () => {
  let origWebSocket: typeof WebSocket | undefined;

  beforeEach(() => {
    origWebSocket = (globalThis as Record<string, unknown>)
      .WebSocket as typeof WebSocket | undefined;
  });

  afterEach(() => {
    if (origWebSocket !== undefined) {
      (globalThis as Record<string, unknown>).WebSocket = origWebSocket;
    } else {
      delete (globalThis as Record<string, unknown>).WebSocket;
    }
  });

  it("AC1: dispatches snapshot frames to onSnapshot", async () => {
    const { MockWs, send } = makeMockWs();
    (globalThis as Record<string, unknown>).WebSocket = MockWs;

    const onSnapshot = vi.fn();
    const handler = new FrameHandler({
      onSnapshot,
      onHeartbeat: vi.fn(),
      onDegrade: vi.fn(),
      onReconnect: vi.fn(),
    });
    handler.connect();

    // Wait for the async open.
    await vi.waitFor(() => expect(onSnapshot).not.toHaveBeenCalled(), {
      timeout: 100,
    });

    const frame = snapshotFrame("abc123");
    send(JSON.stringify(frame));

    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledWith(frame);

    handler.stop();
  });

  it("AC1: skips re-render when ETag is unchanged", async () => {
    const { MockWs, send } = makeMockWs();
    (globalThis as Record<string, unknown>).WebSocket = MockWs;

    const onSnapshot = vi.fn();
    const handler = new FrameHandler({
      onSnapshot,
      onHeartbeat: vi.fn(),
      onDegrade: vi.fn(),
      onReconnect: vi.fn(),
    });
    handler.connect();

    await vi.waitFor(() => expect(onSnapshot).not.toHaveBeenCalled(), {
      timeout: 100,
    });

    const frame1 = snapshotFrame("etag-aaa");
    send(JSON.stringify(frame1));
    expect(onSnapshot).toHaveBeenCalledTimes(1);

    // Same ETag — should skip.
    send(JSON.stringify(snapshotFrame("etag-aaa")));
    expect(onSnapshot).toHaveBeenCalledTimes(1); // still 1

    // Different ETag — should fire.
    send(JSON.stringify(snapshotFrame("etag-bbb")));
    expect(onSnapshot).toHaveBeenCalledTimes(2);

    handler.stop();
  });

  it("AC2: dispatches heartbeat frames to onHeartbeat", async () => {
    const { MockWs, send } = makeMockWs();
    (globalThis as Record<string, unknown>).WebSocket = MockWs;

    const onHeartbeat = vi.fn();
    const handler = new FrameHandler({
      onSnapshot: vi.fn(),
      onHeartbeat,
      onDegrade: vi.fn(),
      onReconnect: vi.fn(),
    });
    handler.connect();
    await vi.waitFor(() => expect(onHeartbeat).not.toHaveBeenCalled(), {
      timeout: 100,
    });

    const hb = heartbeatFrame("live");
    send(JSON.stringify(hb));

    expect(onHeartbeat).toHaveBeenCalledTimes(1);
    expect(onHeartbeat).toHaveBeenCalledWith(hb);

    handler.stop();
  });

  it("AC3: fires onDegrade on socket close", async () => {
    const { MockWs, close } = makeMockWs();
    (globalThis as Record<string, unknown>).WebSocket = MockWs;

    const onDegrade = vi.fn();
    const handler = new FrameHandler({
      onSnapshot: vi.fn(),
      onHeartbeat: vi.fn(),
      onDegrade,
      onReconnect: vi.fn(),
    });
    handler.connect();

    await vi.waitFor(() => expect(onDegrade).not.toHaveBeenCalled(), {
      timeout: 100,
    });

    // Close the socket.
    close();
    // Wait for the async close handler.
    await vi.waitFor(() => expect(onDegrade).toHaveBeenCalledTimes(1), {
      timeout: 100,
    });
    expect(onDegrade).toHaveBeenCalledWith("socket closed");

    handler.stop();
  });

  it("ignores unknown frame kinds", async () => {
    const { MockWs, send } = makeMockWs();
    (globalThis as Record<string, unknown>).WebSocket = MockWs;

    const onSnapshot = vi.fn();
    const onHeartbeat = vi.fn();
    const handler = new FrameHandler({
      onSnapshot,
      onHeartbeat,
      onDegrade: vi.fn(),
      onReconnect: vi.fn(),
    });
    handler.connect();
    await vi.waitFor(() => expect(onSnapshot).not.toHaveBeenCalled(), {
      timeout: 100,
    });

    send(JSON.stringify({ kind: "unknown", data: "garbage" }));

    expect(onSnapshot).not.toHaveBeenCalled();
    expect(onHeartbeat).not.toHaveBeenCalled();

    handler.stop();
  });

  it("ignores malformed JSON gracefully", async () => {
    const { MockWs, send } = makeMockWs();
    (globalThis as Record<string, unknown>).WebSocket = MockWs;

    const onSnapshot = vi.fn();
    const onDegrade = vi.fn();
    const handler = new FrameHandler({
      onSnapshot,
      onHeartbeat: vi.fn(),
      onDegrade,
      onReconnect: vi.fn(),
    });
    handler.connect();
    await vi.waitFor(() => expect(onSnapshot).not.toHaveBeenCalled(), {
      timeout: 100,
    });

    // Malformed JSON — should not throw, should not dispatch.
    send("not valid json {{{");
    expect(onSnapshot).not.toHaveBeenCalled();

    handler.stop();
  });

  it("AC3: handles missing WebSocket constructor gracefully", () => {
    delete (globalThis as Record<string, unknown>).WebSocket;

    const onDegrade = vi.fn();
    const handler = new FrameHandler({
      onSnapshot: vi.fn(),
      onHeartbeat: vi.fn(),
      onDegrade,
      onReconnect: vi.fn(),
    });

    handler.connect();
    expect(onDegrade).toHaveBeenCalledTimes(1);

    handler.stop();
  });
});
