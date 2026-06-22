/**
 * US-OBS-021 AC1/AC6 — startDaemon integration tests.
 *
 * Spawns a real daemon on a random port, connects a WebSocket client, and
 * asserts the DossierSnapshotFrame is delivered on connect (AC1). Also tests
 * the auth provider seam (AC6).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { startDaemon, type DaemonHandle } from "../src/start-daemon.js";
import { BearerTokenAuthProvider } from "../src/transport-auth.js";
import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { DossierFrame, DossierSnapshotFrame } from "@roll/spec";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Minimal WebSocket client for testing (no external dependency). */
async function wsConnect(
  url: string,
  opts?: { headers?: Record<string, string>; timeout?: number },
): Promise<{ frames: DossierFrame[]; close: () => void }> {
  // Parse ws://host:port manually — URL constructor doesn't handle ws:// well.
  const match = url.match(/^ws:\/\/([^:/]+):(\d+)$/);
  if (!match) throw new Error(`Invalid ws URL: ${url}`);
  const hostname = match[1]!;
  const port = parseInt(match[2]!);
  const net = await import("node:net");
  const crypto = await import("node:crypto");

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: hostname, port, timeout: opts?.timeout ?? 5000 }, () => {
      // Send WebSocket upgrade request.
      const key = crypto.randomBytes(16).toString("base64");
      let req = `GET / HTTP/1.1\r\nHost: ${hostname}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n`;
      if (opts?.headers) {
        for (const [k, v] of Object.entries(opts.headers)) {
          req += `${k}: ${v}\r\n`;
        }
      }
      req += "\r\n";
      socket.write(req);
    });

    const frames: DossierFrame[] = [];
    const chunks: Buffer[] = [];
    let handshakeDone = false;

    socket.on("data", (data: Buffer) => {
      if (!handshakeDone) {
        chunks.push(data);
        const all = Buffer.concat(chunks);
        // Find \r\n\r\n (0x0d 0x0a 0x0d 0x0a) in the raw bytes.
        let headerEnd = -1;
        for (let i = 0; i < all.length - 3; i++) {
          if (all[i] === 0x0d && all[i + 1] === 0x0a && all[i + 2] === 0x0d && all[i + 3] === 0x0a) {
            headerEnd = i;
            break;
          }
        }
        if (headerEnd === -1) return; // Wait for complete header.

        const headerText = all.slice(0, headerEnd).toString("utf8");
        // Check for 101 or error.
        if (headerText.includes("401")) {
          socket.destroy();
          reject(new Error("Unauthorized"));
          return;
        }
        if (headerText.includes("400")) {
          socket.destroy();
          reject(new Error("Bad Request"));
          return;
        }
        if (!headerText.includes("101")) {
          socket.destroy();
          reject(new Error(`Unexpected response: ${headerText.slice(0, 100)}`));
          return;
        }

        handshakeDone = true;
        // Push any data after the header as frame data.
        const leftover = all.slice(headerEnd + 4);
        chunks.length = 0;
        if (leftover.length > 0) chunks.push(leftover);
      } else {
        chunks.push(data);
      }

      // Try to decode frames from accumulated buffer.
      const all = Buffer.concat(chunks);
      let consumed = 0;
      let decodedAny = false;
      while (consumed < all.length) {
        const result = decodeWsFrame(all.slice(consumed));
        if (result && result.payload) {
          try {
            frames.push(JSON.parse(result.payload) as DossierFrame);
          } catch { /* skip malformed JSON */ }
          consumed += result.consumed;
          decodedAny = true;
        } else {
          break;
        }
      }
      // Keep only unprocessed bytes.
      if (decodedAny) {
        chunks.length = 0;
        if (consumed < all.length) chunks.push(all.slice(consumed));
      }
    });

    socket.on("error", (err: Error) => {
      reject(err);
    });

    // Resolve after a short wait for the initial snapshot frame.
    setTimeout(() => {
      resolve({
        frames,
        close: () => socket.destroy(),
      });
    }, 500);
  });
}

function decodeWsFrame(
  buf: Buffer,
): { payload: string; consumed: number } | null {
  if (buf.length < 2) return null;

  const fin = (buf[0]! & 0x80) !== 0;
  if (!fin) return null; // Only handle single-frame messages.

  const opcode = buf[0]! & 0x0f;
  if (opcode !== 0x1 && opcode !== 0x2) return null; // text or binary only.

  const masked = (buf[1]! & 0x80) !== 0;
  let payloadLen = buf[1]! & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    payloadLen = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  let maskKey: Buffer | null = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    maskKey = buf.slice(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + payloadLen) return null;

  const payload = buf.slice(offset, offset + payloadLen);
  const consumed = offset + payloadLen;

  let data: Buffer;
  if (masked && maskKey) {
    data = Buffer.alloc(payloadLen);
    for (let i = 0; i < payloadLen; i++) {
      data[i] = payload[i]! ^ maskKey[i % 4]!;
    }
  } else {
    data = payload;
  }

  return { payload: data.toString("utf8"), consumed };
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("no port")));
      }
    });
  });
}

describe("startDaemon", () => {
  let tmpDir: string;
  let loopDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `roll-daemon-int-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    loopDir = join(tmpDir, ".roll", "loop");
    mkdirSync(loopDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("AC1: binds to 127.0.0.1:PORT and sends DossierSnapshotFrame on WebSocket connect", async () => {
    const port = await getFreePort();
    const handle = startDaemon({
      host: "127.0.0.1",
      port,
      cwd: tmpDir,
      heartbeatMs: 5000, // slow heartbeat so we only get snapshot
    });

    try {
      const client = await wsConnect(`ws://127.0.0.1:${port}`);
      expect(client.frames.length).toBeGreaterThanOrEqual(1);

      const snapshot = client.frames.find((f) => f.kind === "snapshot") as DossierSnapshotFrame | undefined;
      expect(snapshot).toBeDefined();
      if (snapshot) {
        expect(snapshot.kind).toBe("snapshot");
        expect(snapshot.project).toBeDefined();
        expect(snapshot.project.path).toBe(tmpDir);
        expect(typeof snapshot.collectedAt).toBe("number");
        expect(typeof snapshot.etag).toBe("string");
      }

      client.close();
    } finally {
      await handle.stop();
    }
  });

  it("AC1: plain HTTP GET returns health-check response", async () => {
    const port = await getFreePort();
    const handle = startDaemon({ host: "127.0.0.1", port, cwd: tmpDir });

    try {
      const resp = await fetch(`http://127.0.0.1:${port}`);
      expect(resp.status).toBe(200);
      const text = await resp.text();
      expect(text).toContain("ok");
    } finally {
      await handle.stop();
    }
  });

  it("AC6: NoAuthProvider allows connection without auth", async () => {
    const port = await getFreePort();
    const handle = startDaemon({ host: "127.0.0.1", port, cwd: tmpDir });

    try {
      const client = await wsConnect(`ws://127.0.0.1:${port}`);
      expect(client.frames.length).toBeGreaterThanOrEqual(1);
      client.close();
    } finally {
      await handle.stop();
    }
  });

  it("AC6: BearerTokenAuthProvider rejects connection without token", async () => {
    const port = await getFreePort();
    const handle = startDaemon({
      host: "127.0.0.1",
      port,
      cwd: tmpDir,
      auth: new BearerTokenAuthProvider("secret"),
    });

    try {
      await expect(wsConnect(`ws://127.0.0.1:${port}`, { timeout: 3000 })).rejects.toThrow("Unauthorized");
    } finally {
      await handle.stop();
    }
  });

  it("AC6: BearerTokenAuthProvider allows connection with correct token", async () => {
    const port = await getFreePort();
    const handle = startDaemon({
      host: "127.0.0.1",
      port,
      cwd: tmpDir,
      auth: new BearerTokenAuthProvider("secret"),
    });

    try {
      const client = await wsConnect(`ws://127.0.0.1:${port}`, {
        headers: { Authorization: "Bearer secret" },
      });
      expect(client.frames.length).toBeGreaterThanOrEqual(1);
      client.close();
    } finally {
      await handle.stop();
    }
  });

  it("stop() gracefully shuts down server and follower", async () => {
    const port = await getFreePort();
    const handle = startDaemon({ host: "127.0.0.1", port, cwd: tmpDir });

    await handle.stop();

    // Server should no longer accept connections.
    let fetchFailed = false;
    try {
      await fetch(`http://127.0.0.1:${port}`);
    } catch {
      fetchFailed = true;
    }
    expect(fetchFailed).toBe(true);
  });
});
