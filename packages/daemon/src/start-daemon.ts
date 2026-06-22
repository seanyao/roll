/**
 * US-OBS-021 AC1 — startDaemon: creates a read-only WebSocket server that
 * broadcasts DossierFrames to connected clients.
 *
 * Uses Node.js built-in `node:http` with manual WebSocket upgrade — zero
 * external dependencies. Read-only by construction: the daemon never writes
 * files, never depends on any other service.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import type { Socket } from "node:net";
import type { DossierFrame } from "@roll/spec";
import { FileFollower } from "./file-follower.js";
import type { AuthProvider } from "./transport-auth.js";
import { NoAuthProvider } from "./transport-auth.js";

// WebSocket magic GUID per RFC 6455 §4.2.2.
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface DaemonOptions {
  /** Host to bind. Default "127.0.0.1". */
  host?: string;
  /** Port to bind. Default 7077. */
  port?: number;
  /** Auth provider. Default NoAuthProvider. */
  auth?: AuthProvider;
  /** Snapshot debounce TTL in ms. Default 30_000. */
  snapshotTtlMs?: number;
  /** Heartbeat interval in ms. Default 45_000. */
  heartbeatMs?: number;
  /** Project root directory. Default process.cwd(). */
  cwd?: string;
}

export interface DaemonHandle {
  /** The HTTP/WS server instance. */
  server: Server;
  /** The file follower instance. */
  follower: FileFollower;
  /** Bound address. */
  address: string;
  /** Graceful shutdown. */
  stop: () => Promise<void>;
}

/** Connected WebSocket client tracked for broadcast. */
interface WsClient {
  socket: Socket;
  /** True once the opening handshake is complete. */
  ready: boolean;
}

/**
 * Start the daemon: creates HTTP server with WebSocket upgrade, starts
 * FileFollower, and begins broadcasting frames.
 */
export function startDaemon(opts: DaemonOptions = {}): DaemonHandle {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 7077;
  const authProvider = opts.auth ?? new NoAuthProvider();
  const cwd = opts.cwd ?? process.cwd();

  const clients = new Set<WsClient>();
  let lastSnapshotFrame: DossierFrame | null = null;

  // ── HTTP server with WebSocket upgrade ────────────────────────────────

  const server = createServer((_req, res) => {
    // Plain HTTP requests get a minimal health-check response.
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("roll-daemon ok\n");
  });

  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    // AC6: auth provider seam — authorize before opening WebSocket.
    const headers = normalizeHeaders(req.headers);
    if (!authProvider.authorize({ headers })) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const key = headers["sec-websocket-key"];
    if (!key) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    // Complete WebSocket opening handshake (RFC 6455 §4.2.2).
    const acceptKey = createHash("sha1")
      .update(key + WS_GUID)
      .digest("base64");

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
        "\r\n",
    );

    const client: WsClient = { socket, ready: true };
    clients.add(client);

    // AC1: send cached snapshot frame to new client on connect.
    if (lastSnapshotFrame) {
      const payload = JSON.stringify(lastSnapshotFrame);
      const data = encodeTextFrame(payload);
      try { socket.write(data); } catch { /* client disconnected */ }
    }

    socket.on("close", () => {
      clients.delete(client);
    });
    socket.on("error", () => {
      // Client error (disconnect, network issue) — silently remove.
      clients.delete(client);
    });

    // Drain any leftover data from the upgrade.
    if (head.length > 0) {
      // Discard — no client→server protocol in this read-only daemon.
    }
  });

  // ── FileFollower ──────────────────────────────────────────────────────

  const follower = new FileFollower({
    cwd,
    snapshotTtlMs: opts.snapshotTtlMs,
    heartbeatMs: opts.heartbeatMs,
    onFrame: (frame: DossierFrame) => {
      if (frame.kind === "snapshot") lastSnapshotFrame = frame;
      broadcast(clients, frame);
    },
  });

  // ── Bind & start ──────────────────────────────────────────────────────

  server.listen(port, host);
  follower.start();

  const stop = async (): Promise<void> => {
    follower.stop();
    // Close all WebSocket clients.
    for (const client of clients) {
      try { client.socket.end(); } catch { /* already closed */ }
    }
    clients.clear();
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  };

  return {
    server,
    follower,
    address: `ws://${host}:${port}`,
    stop,
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

function normalizeHeaders(
  headers: IncomingMessage["headers"],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) {
      out[k.toLowerCase()] = Array.isArray(v) ? v[0] ?? "" : v;
    }
  }
  return out;
}

/**
 * Encode a text frame per RFC 6455 §5.6.
 * Single-frame, unmasked (server→client), text opcode.
 */
function encodeTextFrame(payload: string): Buffer {
  const json = Buffer.from(payload, "utf8");
  const len = json.length;

  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text opcode
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, json]);
}

/** Broadcast a DossierFrame to all connected WebSocket clients. */
function broadcast(clients: Set<WsClient>, frame: DossierFrame): void {
  const payload = JSON.stringify(frame);
  const data = encodeTextFrame(payload);
  for (const client of clients) {
    if (client.ready) {
      try {
        client.socket.write(data);
      } catch {
        // Client disconnected mid-write — will be cleaned up on next close event.
      }
    }
  }
}
