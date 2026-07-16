/**
 * US-BROW-016 — pinned Chrome DevTools MCP session for managed browser
 * operations.
 *
 * Every managed run gets its own short-lived stdio MCP session. The session:
 *   1. Spawns the exact machine-approved `chrome-devtools-mcp` package pin.
 *   2. Completes MCP `initialize` and `tools/list`.
 *   3. Validates a versioned minimum tool manifest before any action.
 *   4. Serializes browser actions through the MCP boundary.
 *   5. Closes the session exactly once on success, denial, timeout,
 *      cancellation, or process error.
 *
 * No project-supplied command, args, endpoint, or environment override is
 * accepted. The production path never instantiates the raw WebSocket/CDP
 * adapter.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { BrowserMcpFailureCategory, BrowserOperationEvent } from "@roll/spec";
import {
  DevToolsProtocolError,
  MANAGED_DEVTOOLS_PACKAGE,
  MANAGED_DEVTOOLS_PACKAGE_VERSION,
  MINIMUM_DEVTOOLS_MCP_MANIFEST,
  type DevToolsMcpManifest,
} from "@roll/core";
import type { CdpSession } from "./managed-chrome-adapter.js";
import {
  McpDiagnosticFacade,
  type DiagnosticArtifactWriter,
} from "./mcp-diagnostic-facade.js";

// ── Public types ─────────────────────────────────────────────────────────────

/** Events emitted by {@link McpBrowserSession}. */
export type McpBrowserSessionEvent =
  | Extract<BrowserOperationEvent, { type: "browser:mcp-started" }>
  | Extract<BrowserOperationEvent, { type: "browser:mcp-initialized" }>
  | Extract<BrowserOperationEvent, { type: "browser:mcp-closed" }>
  | Extract<BrowserOperationEvent, { type: "browser:mcp-failed" }>;

/** Injectable spawn seam. The default refuses every project override. */
export type McpSpawn = (command: string, args: readonly string[]) => ChildProcessWithoutNullStreams;

/** Dependencies for {@link McpBrowserSession}. */
export interface McpBrowserSessionDeps {
  runId: string;
  now: () => string;
  emit: (event: McpBrowserSessionEvent) => void;
  manifest?: DevToolsMcpManifest;
  spawn?: McpSpawn;
}

/** Factory that creates an MCP-backed CDP session for a managed run. */
export interface McpBrowserSessionFactory {
  create(runId: string): Promise<CdpSession>;
}

/** The production typed-action MCP session returned to Browser Operations. */
export interface McpDiagnosticSession {
  facade: McpDiagnosticFacade;
  close(): Promise<void>;
}

export interface McpDiagnosticSessionFactoryOptions extends McpCdpTransportFactoryOptions {}

/** Opens a pinned MCP session and exposes only the typed diagnostic facade. */
export class McpDiagnosticSessionFactory {
  constructor(private readonly options: McpDiagnosticSessionFactoryOptions = {}) {}

  async create(runId: string, writer: DiagnosticArtifactWriter, randomId: () => string): Promise<McpDiagnosticSession> {
    const session = await McpBrowserSession.open({
      runId,
      now: this.options.now ?? (() => new Date().toISOString()),
      emit: this.options.emit ?? noopEmit,
      spawn: this.options.spawn,
      manifest: this.options.manifest,
    });
    return {
      facade: new McpDiagnosticFacade({
        caller: { call: (tool, input) => session.callTool(tool, input) },
        writer,
        randomId,
      }),
      close: () => session.close(),
    };
  }
}

/** Options for {@link McpCdpTransportFactory}. */
export interface McpCdpTransportFactoryOptions {
  now?: () => string;
  emit?: (event: McpBrowserSessionEvent) => void;
  spawn?: McpSpawn;
  manifest?: DevToolsMcpManifest;
}

// ── McpBrowserSession ────────────────────────────────────────────────────────

/**
 * Owns the lifecycle of one pinned chrome-devtools-mcp stdio session.
 *
 * The process command and arguments are hardcoded; callers cannot supply their
 * own. The session fail-closes on initialize errors, manifest mismatches, and
 * process crashes.
 */
export class McpBrowserSession {
  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly rpc: McpJsonRpcClient,
    private readonly deps: Required<Pick<McpBrowserSessionDeps, "runId" | "now" | "emit" | "manifest">>,
  ) {}

  /** Spawn, initialize, and validate the MCP session. */
  static async open(deps: McpBrowserSessionDeps): Promise<McpBrowserSession> {
    const runId = deps.runId;
    const now = deps.now;
    const emit = deps.emit;
    const manifest = deps.manifest ?? MINIMUM_DEVTOOLS_MCP_MANIFEST;
    const doSpawn = deps.spawn ?? defaultMcpSpawn;

    const command = "npx";
    const args: readonly string[] = [
      "-y",
      `${MANAGED_DEVTOOLS_PACKAGE}@${manifest.version}`,
      "--no-usage-statistics",
    ];

    let child: ChildProcessWithoutNullStreams;
    try {
      child = doSpawn(command, args);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      emit({ type: "browser:mcp-failed", runId, ts: now(), category: "crash", message: `spawn failed: ${message}` });
      throw new DevToolsProtocolError(`Failed to spawn managed DevTools MCP: ${message}`);
    }

    emit({ type: "browser:mcp-started", runId, ts: now() });

    const rpc = new McpJsonRpcClient(child);

    try {
      await rpc.initialized();
      const tools = await rpc.listTools();
      validateManifest(tools, manifest);
      emit({ type: "browser:mcp-initialized", runId, ts: now(), version: manifest.version, tools });
      return new McpBrowserSession(child, rpc, { runId, now, emit, manifest });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const category = failureCategory(cause);
      emit({ type: "browser:mcp-failed", runId, ts: now(), category, message });
      // Best-effort cleanup so the child is never leaked.
      await killQuietly(child);
      throw cause instanceof DevToolsProtocolError ? cause : new DevToolsProtocolError(message);
    }
  }

  /**
   * Call a CDP method through the MCP boundary.
   *
   * The method and parameters are forwarded to the required
   * `chrome_devtools_call` tool; the result is parsed from the tool's text
   * content.
   */
  async callTool(toolName: import("@roll/core").DevToolsMcpToolName | "chrome_devtools_call", input: Record<string, unknown>): Promise<unknown> {
    if (!this.deps.manifest.requiredTools.includes(toolName)) {
      throw new DevToolsProtocolError(`MCP tool is not approved by the manifest: ${toolName}`);
    }
    return parseToolResult(await this.rpc.callTool(toolName, input));
  }

  /** Close the session exactly once and emit the closed event. */
  async close(): Promise<void> {
    if (this.rpc.isClosed()) return;
    this.rpc.markClosed();
    await killQuietly(this.child);
    this.deps.emit({ type: "browser:mcp-closed", runId: this.deps.runId, ts: this.deps.now() });
  }
}

// ── MCP-backed CDP transport factory ─────────────────────────────────────────

/**
 * Production transport factory for the managed lane.
 *
 * Replaces the raw WebSocket/CDP factory with an MCP stdio session. The adapter
 * consumes the returned object through the same `CdpSession` interface, but the
 * underlying transport is the pinned MCP server.
 */
export class McpCdpTransportFactory implements McpBrowserSessionFactory {
  constructor(private readonly options: McpCdpTransportFactoryOptions = {}) {}

  async create(runId: string): Promise<CdpSession> {
    const session = await McpBrowserSession.open({
      runId,
      now: this.options.now ?? (() => new Date().toISOString()),
      emit: this.options.emit ?? noopEmit,
      spawn: this.options.spawn,
      manifest: this.options.manifest,
    });
    return new McpCdpSession(session);
  }
}

class McpCdpSession implements CdpSession {
  constructor(private readonly session: McpBrowserSession) {}

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.session.callTool("chrome_devtools_call", { method, params });
  }

  async close(): Promise<void> {
    await this.session.close();
  }
}

// ── JSON-RPC stdio client ────────────────────────────────────────────────────

interface McpJsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string; code?: unknown };
}

class McpJsonRpcClient {
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private closed = false;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    child.on("exit", () => this.rejectAll(new Error("MCP server exited")));
    child.on("error", (cause) => this.rejectAll(cause instanceof Error ? cause : new Error(String(cause))));
  }

  async initialized(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "roll", version: "4" },
    });
    this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<string[]> {
    const result = (await this.request("tools/list", {})) as { tools?: unknown[] } | undefined;
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    return tools.map((tool) => (isRecord(tool) && typeof tool["name"] === "string" ? tool["name"] : "")).filter(Boolean);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request("tools/call", { name, arguments: args });
  }

  isClosed(): boolean {
    return this.closed;
  }

  markClosed(): void {
    this.closed = true;
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return Promise.reject(new DevToolsProtocolError("MCP request after close"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (this.closed) return;
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(message: McpJsonRpcMessage): void {
    // MCP stdio transport is NEWLINE-DELIMITED JSON-RPC (one message per line),
    // not LSP-style Content-Length framing. chrome-devtools-mcp ignores framed
    // input's header line and replies with plain JSON lines — the previous
    // Content-Length framing made `initialize` hang forever (US-BROW-019 probe
    // caught this live; injected-spawn tests spoke the same wrong dialect on
    // both sides and never noticed).
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (!this.closed) {
      const message = this.tryParseMessage();
      if (message === undefined) return;
      this.handleMessage(message);
    }
  }

  private tryParseMessage(): McpJsonRpcMessage | undefined {
    // Newline-delimited JSON-RPC: consume one \n-terminated line per message.
    // Non-JSON lines (server logs on stdout) are skipped, not fatal.
    while (true) {
      const nl = this.buffer.indexOf("\n");
      if (nl < 0) return undefined;
      const line = this.buffer.slice(0, nl).toString("utf8").trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line === "") continue;
      try {
        return JSON.parse(line) as McpJsonRpcMessage;
      } catch {
        continue;
      }
    }
  }

  private handleMessage(message: McpJsonRpcMessage): void {
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    this.pending.delete(message.id);
    if (pending === undefined) return;
    if (message.error !== undefined) {
      pending.reject(
        new DevToolsProtocolError(
          typeof message.error.message === "string" ? message.error.message : "MCP protocol error",
        ),
      );
    } else {
      pending.resolve(message.result);
    }
  }

  private rejectAll(cause: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(cause);
    }
    this.pending.clear();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function defaultMcpSpawn(command: string, args: readonly string[]): ChildProcessWithoutNullStreams {
  if (command.trim() === "") {
    throw Object.assign(new Error("empty MCP command"), { code: "ENOENT" });
  }
  return spawn(command, args, {
    stdio: "pipe",
    env: process.env,
  }) as ChildProcessWithoutNullStreams;
}

function validateManifest(tools: string[], manifest: DevToolsMcpManifest): void {
  const missing = manifest.requiredTools.filter((required) => !tools.includes(required));
  if (missing.length > 0) {
    throw new DevToolsProtocolError(
      `MCP tool manifest mismatch for ${MANAGED_DEVTOOLS_PACKAGE}@${manifest.version}: missing ${missing.join(", ")}`,
    );
  }
}

function parseToolResult(raw: unknown): unknown {
  if (!isRecord(raw)) return undefined;
  const content = Array.isArray(raw["content"]) ? raw["content"] : [];
  const text = content
    .filter((item): item is Record<string, unknown> => isRecord(item) && item["type"] === "text")
    .map((item) => item["text"])
    .find((value): value is string => typeof value === "string");
  // US-BROW-020: the real server returns screenshots as a separate
  // `{type:"image", data:<base64>}` content item next to the prose text item —
  // text-only parsing dropped the bytes and every live screenshot failed.
  const image = content.find(
    (item): item is Record<string, unknown> => isRecord(item) && item["type"] === "image" && typeof item["data"] === "string",
  );
  if (image !== undefined) {
    return { text: text ?? "", data: image["data"], mimeType: image["mimeType"] };
  }
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function failureCategory(cause: unknown): BrowserMcpFailureCategory {
  if (cause instanceof DevToolsProtocolError) return "devtools-error";
  if (cause instanceof Error && /timed?\s*out/i.test(cause.message)) return "timeout";
  return "crash";
}

async function killQuietly(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.killed || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (!child.killed && child.exitCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 5_000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function noopEmit(_event: McpBrowserSessionEvent): void {
  /* default: events are dropped when no ledger is wired */
}
