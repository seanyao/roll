/**
 * US-BROW-016 — pinned Chrome DevTools MCP session contract tests.
 *
 * Most tests use a fake stdio child process so they never spawn a real
 * chrome-devtools-mcp binary. The cleanup regression test uses a local Node
 * wrapper/server tree because only a real process group exposes this leak.
 */
import { spawn as spawnChild } from "node:child_process";
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

const PROCESS_TREE_WRAPPER = String.raw`
  const { spawn } = require("node:child_process");
  const server = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  process.stdout.write("SERVER_PID:" + server.pid + "\n");
  let buffer = "";
  process.stdin.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line === "") continue;
      const message = JSON.parse(line);
      if (message.method === "initialize") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }) + "\n");
      } else if (message.method === "tools/list") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: ${JSON.stringify(MINIMUM_DEVTOOLS_MCP_MANIFEST.requiredTools.map((name) => ({ name })))} } }) + "\n");
      }
    }
  });
  process.on("SIGTERM", () => process.exit(0));
`;

function processIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ESRCH") return false;
    throw cause;
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

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
    // US-BROW-019: newline-delimited JSON-RPC — the REAL chrome-devtools-mcp
    // dialect. The previous LSP-style Content-Length framing here matched an
    // equally wrong client, so tests passed while the live probe hung.
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const nl = this.buffer.indexOf("\n");
      if (nl < 0) return;
      const line = this.buffer.slice(0, nl).toString("utf8").trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line === "") continue;
      this.handleMessage(JSON.parse(line) as { id?: number; method?: string; params?: Record<string, unknown> });
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
    this.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...payload })}\n`);
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
    let detached = false;
    const spawn: McpSpawn = (command, args, options) => {
      seenCommand = command;
      seenArgs = [...args];
      detached = options.detached;
      return child as unknown as ChildProcessWithoutNullStreams;
    };

    await McpBrowserSession.open({ runId: "run-1", now, emit: () => undefined, spawn });

    expect(seenCommand).toBe("npx");
    expect(seenArgs).toEqual([
      "-y",
      `chrome-devtools-mcp@${MANAGED_DEVTOOLS_PACKAGE_VERSION}`,
      "--no-usage-statistics",
      "--isolated",
      "--headless",
    ]);
    expect(detached).toBe(true);
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

  it("reports process cleanup failure instead of emitting a false closed event (FIX-1271)", async () => {
    const { events, emit } = captureEvents();
    const child = defaultChild();
    child.kill = () => false;
    const session = await McpBrowserSession.open({ runId: "run-cleanup-failure", now, emit, spawn: fakeSpawn(child) });

    await expect(session.close()).rejects.toThrow("MCP process cleanup failed");

    expect(events.some((event) => event.type === "browser:mcp-closed")).toBe(false);
    expect(events).toContainEqual({
      type: "browser:mcp-failed",
      runId: "run-cleanup-failure",
      ts: now(),
      category: "crash",
      message: "MCP process cleanup failed: SIGTERM was not delivered to MCP process",
    });
  });

  it("terminates a real detached wrapper and its server child on close (FIX-1271)", async () => {
    if (process.platform === "win32") return;

    let wrapperPid: number | undefined;
    let serverPid: number | undefined;
    const spawn: McpSpawn = () => {
      const child = spawnChild(process.execPath, ["--eval", PROCESS_TREE_WRAPPER], {
        detached: true,
        stdio: "pipe",
      }) as ChildProcessWithoutNullStreams;
      wrapperPid = child.pid;
      child.stdout.on("data", (chunk: Buffer) => {
        const match = /SERVER_PID:(\d+)/.exec(chunk.toString("utf8"));
        if (match?.[1] !== undefined) serverPid = Number(match[1]);
      });
      return child;
    };

    const session = await McpBrowserSession.open({ runId: "run-process-tree", now, emit: () => undefined, spawn });
    try {
      expect(await waitUntil(() => serverPid !== undefined)).toBe(true);
      expect(wrapperPid).toBeDefined();
      expect(serverPid).toBeDefined();
      expect(processIsLive(wrapperPid!)).toBe(true);
      expect(processIsLive(serverPid!)).toBe(true);

      await session.close();

      expect(await waitUntil(() => !processIsLive(wrapperPid!) && !processIsLive(serverPid!))).toBe(true);
    } finally {
      if (wrapperPid !== undefined) {
        try {
          process.kill(-wrapperPid, "SIGKILL");
        } catch (cause) {
          if (!(typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ESRCH")) throw cause;
        }
      }
    }
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
  it("raw CDP proxying fails closed — the real server has no chrome_devtools_call tool (US-BROW-019)", async () => {
    const child = defaultChild();
    child.when("tools/call", () => ({
      content: [{ type: "text", text: JSON.stringify({ result: { value: "https://example.test/" } }) }],
    }));
    const factory = new McpCdpTransportFactory({ now, spawn: fakeSpawn(child) });

    const session = await factory.create("run-2");
    // chrome-devtools-mcp@1.5.0 exposes only typed tools (navigate_page,
    // take_screenshot, …). The generic CDP proxy the old test fabricated does
    // not exist, so the manifest rejects it — fail closed, never a silent
    // passthrough to an unapproved tool name.
    await expect(session.send("Runtime.evaluate", { expression: "window.location.href" })).rejects.toThrow(
      /not approved by the manifest/,
    );
  });
});

describe("US-BROW-016 runtime wiring", () => {
  it("default production deps use the MCP session factory, not a raw CDP transport", () => {
    const deps = defaultManagedChromeAdapterDeps("/tmp/diagnostics");

    expect(deps.mcpDiagnosticSessionFactory).toBeDefined();
    expect(deps.transportFactory).toBeUndefined();
  });
});
