/**
 * US-OBS-022 AC1/AC2/AC3 — FrameHandler: opens ONE WebSocket to the daemon,
 * parses DossierFrames, and dispatches snapshot/heartbeat/error to callbacks.
 *
 * AC1: Exactly ONE WebSocket subscription. Snapshot frames carry the full
 * TruthSnapshot; ETag unchanged → skip re-render.
 * AC2: Heartbeat frames carry liveness — consumer renders a badge.
 * AC3: On connect fail / socket drop → fire onDegrade; consumer falls back
 * to the baked truth.json snapshot. Auto-reconnect on interval.
 */
import type { DossierFrame, DossierSnapshotFrame, DossierHeartbeatFrame } from "@roll/spec";

export interface FrameHandlerCallbacks {
  /** Called with each DossierSnapshotFrame. ETag dedup is handled internally. */
  onSnapshot: (frame: DossierSnapshotFrame) => void;
  /** Called with each DossierHeartbeatFrame. */
  onHeartbeat: (frame: DossierHeartbeatFrame) => void;
  /** Called when the daemon becomes unreachable (connect fail or socket drop). */
  onDegrade: (reason: string) => void;
  /** Called when the daemon reconnects after a degrade. */
  onReconnect: () => void;
}

export interface FrameHandlerOptions {
  /** WebSocket URL. Default "ws://127.0.0.1:7077". */
  url?: string;
  /** Reconnect interval in ms. Default 5000. */
  reconnectMs?: number;
}

export class FrameHandler {
  private readonly url: string;
  private readonly reconnectMs: number;
  private readonly callbacks: FrameHandlerCallbacks;

  private ws: WebSocket | null = null;
  private lastEtagByProject = new Map<string, string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private degraded = false;
  private stopped = false;

  constructor(callbacks: FrameHandlerCallbacks, opts: FrameHandlerOptions = {}) {
    this.url = opts.url ?? "ws://127.0.0.1:7077";
    this.reconnectMs = opts.reconnectMs ?? 5000;
    this.callbacks = callbacks;
  }

  /** Open the WebSocket connection. Idempotent. */
  connect(): void {
    if (this.stopped || this.ws !== null) return;
    this.degraded = false;
    try {
      this.ws = new WebSocket(this.url);
      this.ws.addEventListener("open", () => {
        if (this.degraded) {
          this.degraded = false;
          this.callbacks.onReconnect();
        }
      });
      this.ws.addEventListener("message", (event: MessageEvent) => {
        this.handleMessage(event.data);
      });
      this.ws.addEventListener("close", () => {
        this.ws = null;
        this.handleDisconnect("socket closed");
      });
      this.ws.addEventListener("error", () => {
        // The close event will fire after error; handle there.
      });
    } catch (err) {
      this.ws = null;
      this.handleDisconnect(
        err instanceof Error ? err.message : "connection failed",
      );
    }
  }

  /** Stop the handler and clear reconnect timers. */
  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ── private ────────────────────────────────────────────────────────────

  private handleMessage(data: string): void {
    try {
      const frame: DossierFrame = JSON.parse(data) as DossierFrame;
      if (frame.kind === "snapshot") {
        this.handleSnapshot(frame as DossierSnapshotFrame);
      } else if (frame.kind === "heartbeat") {
        this.handleHeartbeat(frame as DossierHeartbeatFrame);
      }
      // Unknown frame kinds are silently ignored.
    } catch {
      // Malformed JSON → skip, don't crash.
    }
  }

  private handleSnapshot(frame: DossierSnapshotFrame): void {
    // AC1: ETag unchanged → skip re-render (no churn).
    const projectSlug = frame.project.slug;
    if (frame.etag && frame.etag === this.lastEtagByProject.get(projectSlug)) return;
    if (frame.etag) {
      this.lastEtagByProject.set(projectSlug, frame.etag);
    } else {
      this.lastEtagByProject.delete(projectSlug);
    }
    this.callbacks.onSnapshot(frame);
  }

  private handleHeartbeat(frame: DossierHeartbeatFrame): void {
    this.callbacks.onHeartbeat(frame);
  }

  private handleDisconnect(reason: string): void {
    if (this.stopped) return;
    if (!this.degraded) {
      this.degraded = true;
      this.callbacks.onDegrade(reason);
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectMs);
  }
}
