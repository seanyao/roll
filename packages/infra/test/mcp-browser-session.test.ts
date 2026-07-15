/**
 * US-BROW-016 — pinned Chrome DevTools MCP session contract tests.
 *
 * All tests use a fake stdio child process so they never spawn a real
 * chrome-devtools-mcp binary.
 */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { DevToolsProtocolError, MANAGED_DEVTOOLS_PACKAGE_VERSION, MINIMUM_DEVTOOLS_MCP_MANIFEST } from "@roll/core";
import { describe, expect, it } from "vitest";
import {
  McpBrowserSession,
  McpCdpTransportFactory,
  type McpBrowserSessionEvent,
  type McpSpawn,
} from "../src/browser-operations/mcp-session.js";
import { defaultManagedChromeAdapterDeps } from "../src/browser-operations/managed-chrome-adapter.js";

const now = () => "2026-07-15T00:00:00.000Z";

class FakeMcpChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  exitCode: number | null = null;
  private buffer = Buffer.alloc(0);
  private handlers = new Map<string, (params: Record<string, unknown>) => unknown>();
  private nextFailure?: { method: string; error: string };
  private hangingMethods = new Set<string>();

  when(method: string, result: (params: Record<string, unknown>) => unknown): void {
    this.handlers.set(method, result);
  }

  hang(method: string): void {
    this.hangingMethods.add(method);
  }

  failNext(method: string, error: string): void {
    this.nextFailure = { method, error };
  }

  crash(message: string): void {
    this.emit("error", new Error(message));
  }

  constructor() {
    super();
    this.stdin.on("data", (chunk: Buffer) => this.onData(chunk));
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    if (this.killed) return false;
    this.killed = true;
    this.exitCode = 0;
    setImmediate(() => this.emit("exit", 0, signal));
    return true;
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const sep = this.buffer.indexOf("\r\n\r\n");
      if (sep < 0) return;
      const header = this.buffer.slice(0, sep).toString("utf8");
      const length = /^Content-Length:\s*(\d+)$/im.exec(header)?.[1];
      if (length === undefined) return;
      const bodyLength = Number.parseInt(length, 10);
      const start = sep + 4;
      if (this.buffer.length < start + bodyLength) return;
      const body = this.buffer.slice(start, start + bodyLength);
      this.buffer = this.buffer.slice(start + bodyLength);
      this.handleMessage(JSON.parse(body.toString("utf8")) as { id?: number; method?: string; params?: Record<string, unknown> });
    }
  }

  private handleMessage(message: { id?: number; method?: string; params?: Record<string, unknown> }): void {
    const id = message.id;
    const method = message.method ?? "";
    const params = message.params ?? {};
    if (method === "notifications/initialized") return;
    if (this.hangingMethods.has(method)) return;

    if (this.nextFailure !== undefined && this.nextFailure.method === method) {
      const { error } = this.nextFailure;
      this.nextFailure = undefined;
      this.reply(id, { error: { code: -32_000, message: error } });
      return;
    }

    const handler = this.handlers.get(method);
    if (handler === undefined) {
      this.reply(id, { error: { code: -32_601, message: `Method not found: ${method}` } });
      return;
    }
    try {
      this.reply(id, { result: handler(params) });
    } catch (cause) {
      this.reply(id, { error: { code: -32_000, message: cause instanceof Error ? cause.message : String(cause) } });
    }
  }

  private reply(id: number | undefined, payload: { result?: unknown; error?: unknown }): void {
    if (id === undefined) return;
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, ...payload }), "utf8");
    this.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.stdout.write(body);
  }
}

function fakeSpawn(child: FakeMcpChild): McpSpawn {
  return () => child as unknown as ChildProcessWithoutNullStreams;
}

function defaultChild(): FakeMcpChild {
  const child = new FakeMcpChild();
  child.when("initialize", () => ({
    protocolVersion: "2024-11-05",
    capabilities: {},
    serverInfo: { name: "chrome-devtools-mcp", version: MANAGED_DEVTOOLS_PACKAGE_VERSION },
  }));
  child.when("tools/list", () => ({ tools: MINIMUM_DEVTOOLS_MCP_MANIFEST.requiredTools.map((name) => ({ name })) }));
  return child;
}

function captureEvents(): { events: McpBrowserSessionEvent[]; emit: (event: McpBrowserSessionEvent) => void } {
  const events: McpBrowserSessionEvent[] = [];
  return { events, emit: (event) => events.push(event) };
}

describe("US-BROW-016 McpBrowserSession", () => {
  it("spawns the exact pinned command with telemetry disabled and accepts no override", async () => {
    const child = defaultChild();
    let seenCommand = "";
    let seenArgs: string[] = [];
    const spawn: McpSpawn = (command, args) => {
      seenCommand = command;
      seenArgs = [...args];
      return child as unknown as ChildProcessWithoutNullStreams;
    };

    await McpBrowserSession.open({ runId: "run-1", now, emit: () => undefined, spawn });

    expect(seenCommand).toBe("npx");
    expect(seenArgs).toEqual(["-y", `chrome-devtools-mcp@${MANAGED_DEVTOOLS_PACKAGE_VERSION}`, "--no-usage-statistics"]);
  });

  it("emits started and initialized after successful initialize + manifest verification", async () => {
    const { events, emit } = captureEvents();
    const child = defaultChild();

    await McpBrowserSession.open({ runId: "run-1", now, emit, spawn: fakeSpawn(child) });

    expect(events).toEqual([
      { type: "browser:mcp-started", runId: "run-1", ts: now() },
      {
        type: "browser:mcp-initialized",
        runId: "run-1",
        ts: now(),
        version: MANAGED_DEVTOOLS_PACKAGE_VERSION,
        tools: MINIMUM_DEVTOOLS_MCP_MANIFEST.requiredTools,
      },
    ]);
  });

  it("fails closed as devtools_protocol_error when initialize returns an error", async () => {
    const { events, emit } = captureEvents();
    const child = new FakeMcpChild();
    child.failNext("initialize", "initialize refused");

    await expect(
      McpBrowserSession.open({ runId: "run-1", now, emit, spawn: fakeSpawn(child) }),
    ).rejects.toBeInstanceOf(DevToolsProtocolError);

    expect(events.some((e) => e.type === "browser:mcp-started")).toBe(true);
    expect(events.some((e) => e.type === "browser:mcp-initialized")).toBe(false);
    const failed = events.find((e) => e.type === "browser:mcp-failed");
    expect(failed).toBeDefined();
    expect(failed?.type === "browser:mcp-failed" && failed.category).toBe("devtools-error");
  });

  it("fails closed as devtools_protocol_error when the manifest is missing a required tool", async () => {
    const { events, emit } = captureEvents();
    const child = new FakeMcpChild();
    child.when("initialize", () => ({
      protocolVersion: "2024-11-05",
      capabilities: {},
      serverInfo: { name: "chrome-devtools-mcp", version: MANAGED_DEVTOOLS_PACKAGE_VERSION },
    }));
    child.when("tools/list", () => ({ tools: [{ name: "wrong_tool" }] }));

    const error = await expect(
      McpBrowserSession.open({ runId: "run-1", now, emit, spawn: fakeSpawn(child) }),
    ).rejects.toBeInstanceOf(DevToolsProtocolError);

    expect(error).toBeTruthy();
    const failed = events.find((e) => e.type === "browser:mcp-failed");
    expect(failed?.type === "browser:mcp-failed" && failed.category).toBe("devtools-error");
  });

  it("classifies a process crash as a crash failure", async () => {
    const { events, emit } = captureEvents();
    const child = new FakeMcpChild();
    // Hang on initialize so the crash is the only terminating signal.
    child.hang("initialize");
    const spawn: McpSpawn = () => {
      const proc = child as unknown as ChildProcessWithoutNullStreams;
      // Simulate spawn failure delivered asynchronously.
      setImmediate(() => child.crash("spawn ENOENT"));
      return proc;
    };

    await expect(McpBrowserSession.open({ runId: "run-1", now, emit, spawn })).rejects.toBeInstanceOf(
      DevToolsProtocolError,
    );

    const failed = events.find((e) => e.type === "browser:mcp-failed");
    expect(failed?.type === "browser:mcp-failed" && failed.category).toBe("crash");
  });

  it("closes exactly once and emits a closed event", async () => {
    const { events, emit } = captureEvents();
    const child = defaultChild();
    const session = await McpBrowserSession.open({ runId: "run-1", now, emit, spawn: fakeSpawn(child) });

    await session.close();
    await session.close();

    expect(child.killed).toBe(true);
    expect(events.filter((e) => e.type === "browser:mcp-closed")).toHaveLength(1);
  });

  it("calls only a manifest-approved typed MCP tool", async () => {
    const child = defaultChild();
    let captured: { toolName: string; args: Record<string, unknown> } | undefined;
    child.when("tools/call", (params) => {
      captured = { toolName: String(params.name), args: params.arguments as Record<string, unknown> };
      return { content: [{ type: "text", text: JSON.stringify({ result: { value: "ok" } }) }] };
    });

    const session = await McpBrowserSession.open({ runId: "run-1", now, emit: () => undefined, spawn: fakeSpawn(child) });
    const result = await session.callTool("navigate_page", { url: "https://example.test" });

    expect(captured).toEqual({
      toolName: "navigate_page",
      args: { url: "https://example.test" },
    });
    expect(result).toEqual({ result: { value: "ok" } });
  });

  it("rejects typed calls after close", async () => {
    const child = defaultChild();
    const session = await McpBrowserSession.open({ runId: "run-1", now, emit: () => undefined, spawn: fakeSpawn(child) });
    await session.close();

    await expect(session.callTool("navigate_page", {})).rejects.toBeInstanceOf(DevToolsProtocolError);
  });
});

describe("US-BROW-016 McpCdpTransportFactory", () => {
  it("creates a CdpSession backed by the MCP session", async () => {
    const child = defaultChild();
    child.when("tools/call", () => ({
      content: [{ type: "text", text: JSON.stringify({ result: { value: "https://example.test/" } }) }],
    }));
    const factory = new McpCdpTransportFactory({ now, spawn: fakeSpawn(child) });

    const session = await factory.create("run-2");
    const result = await session.send("Runtime.evaluate", { expression: "window.location.href" });

    expect(result).toEqual({ result: { value: "https://example.test/" } });
  });
});

describe("US-BROW-016 runtime wiring", () => {
  it("default production deps use the MCP session factory, not a raw CDP transport", () => {
    const deps = defaultManagedChromeAdapterDeps("/tmp/diagnostics");

    expect(deps.mcpDiagnosticSessionFactory).toBeDefined();
    expect(deps.transportFactory).toBeUndefined();
  });
});
