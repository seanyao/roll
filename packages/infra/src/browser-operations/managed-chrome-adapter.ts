/**
 * US-BROW-004b — Managed Chrome/DevTools adapter.
 *
 * Runs approved typed actions in an isolated temporary Chrome profile, observes
 * the final redirect URL before any content capture, and denies operations that
 * land outside the policy allowlist. Timeout / crash / DevTools errors become
 * categorized diagnostic failures; they can never be expressed as passing
 * product assertions.
 *
 * The adapter consumes the US-BROW-004a run service for lifecycle/state and the
 * US-BROW-002 managed DevTools transport seam for the CDP connection.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authorizeOrigin,
  BrowserOperationRunService,
  policyFingerprint,
  resolveDeviceProfile,
  type DiagnosticFailure,
} from "@roll/core";
import type {
  BrowserActionKind,
  BrowserActionResult,
  BrowserDenialReason,
  BrowserLanePolicy,
  DeviceProfile,
  DiagnosticArtifactKind,
  DiagnosticArtifactRef,
  NormalizedOrigin,
} from "@roll/spec";

// ── Public types ─────────────────────────────────────────────────────────────

/** A running Chrome process returned by a launcher. */
export interface ChromeProcess {
  pid: number;
  kill(): Promise<void>;
}

/** Launches a Chrome instance bound to a temporary profile and debug port. */
export interface ChromeLauncher {
  launch(options: { profileDir: string; remoteDebuggingPort: number }): Promise<ChromeProcess>;
}

/** A single CDP session. */
export interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

/** Factory that creates a CDP session for a loopback debug endpoint. */
export interface CdpTransportFactory {
  create(endpoint: { host: string; port: number }): Promise<CdpSession>;
}

/** File-system seam used by the adapter. */
export interface AdapterFs {
  mkdtemp(prefix: string): Promise<string>;
  mkdir(path: string, options: { recursive: boolean }): Promise<string | undefined>;
  writeFile(path: string, data: string | Buffer, encoding?: BufferEncoding): Promise<void>;
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
}

/** Injectable dependencies for {@link ManagedChromeAdapter}. */
export interface ManagedChromeAdapterDeps {
  launcher: ChromeLauncher;
  transportFactory: CdpTransportFactory;
  fs: AdapterFs;
  now: () => string;
  randomId: () => string;
  remoteDebuggingHost: string;
  diagnosticsDir: string;
}

/** Input to execute one typed action inside a managed run. */
export interface ManagedRunInput {
  runService: BrowserOperationRunService;
  lanePolicy: BrowserLanePolicy;
  action: BrowserActionKind;
  payload: Record<string, string | number | boolean>;
  timeoutMs: number;
  /** Optional device emulation profile name (managed lane only, diagnostic-only). */
  deviceProfile?: string;
}

// ── Default production seams ─────────────────────────────────────────────────

/** Default Chrome launcher for macOS / Linux. */
export class SystemChromeLauncher implements ChromeLauncher {
  constructor(private readonly chromeExecutable: string = defaultChromeExecutable()) {}

  async launch(options: { profileDir: string; remoteDebuggingPort: number }): Promise<ChromeProcess> {
    const { spawn } = await import("node:child_process");
    const args = [
      `--user-data-dir=${options.profileDir}`,
      `--remote-debugging-port=${options.remoteDebuggingPort}`,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-default-apps",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-extensions",
      "--disable-popup-blocking",
      "--disable-features=Translate",
      "about:blank",
    ];
    const child = spawn(this.chromeExecutable, args, { detached: false });
    if (child.pid === undefined) {
      throw new Error(`Failed to spawn Chrome from ${this.chromeExecutable}`);
    }
    return {
      pid: child.pid,
      kill: async () => {
        child.kill("SIGTERM");
        // Best-effort graceful shutdown; do not await indefinitely.
        await new Promise<void>((resolve) => {
          const t = setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 5_000);
          child.on("exit", () => {
            clearTimeout(t);
            resolve();
          });
        });
      },
    };
  }
}

function defaultChromeExecutable(): string {
  const { platform } = process;
  if (platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (platform === "win32") return "chrome.exe";
  return "google-chrome";
}

/** Minimal CDP message envelope. */
interface CdpRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface CdpResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
  method?: string;
  params?: unknown;
}

/** CDP session backed by the Node.js global WebSocket (Node >=22). */
class WebSocketCdpSession implements CdpSession {
  private ws: WebSocketLike;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();

  constructor(ws: WebSocketLike) {
    this.ws = ws;
    ws.addEventListener("message", (event) => this.onMessage(event));
    ws.addEventListener("error", (event) => this.onError(event));
  }

  send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const request: CdpRequest = { id, method, params };
      this.pending.set(id, { resolve, reject });
      try {
        this.ws.send(JSON.stringify(request));
      } catch (cause) {
        this.pending.delete(id);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.ws.close();
      resolve();
    });
  }

  private onMessage(event: { data?: unknown }): void {
    let message: CdpResponse;
    try {
      const text = typeof event.data === "string" ? event.data : String(event.data ?? "");
      message = JSON.parse(text) as CdpResponse;
    } catch {
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (pending === undefined) return;
      if (message.error !== undefined) {
        pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  private onError(event: unknown): void {
    const message = event instanceof Error ? event.message : "WebSocket error";
    for (const [, pending] of this.pending) {
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}

interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: { data?: unknown }) => void): void;
}

/** Default CDP transport: fetches the debugger URL, then opens a WebSocket. */
export class WebSocketCdpTransportFactory implements CdpTransportFactory {
  async create(endpoint: { host: string; port: number }): Promise<CdpSession> {
    const versionUrl = `http://${endpoint.host}:${endpoint.port}/json/version`;
    const res = await fetch(versionUrl, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) {
      throw new Error(`CDP version endpoint returned ${res.status}`);
    }
    const body = (await res.json()) as Partial<{ webSocketDebuggerUrl?: string }>;
    const wsUrl = body.webSocketDebuggerUrl;
    if (typeof wsUrl !== "string") {
      throw new Error("CDP version response missing webSocketDebuggerUrl");
    }
    const ws = await openWebSocket(wsUrl);
    return new WebSocketCdpSession(ws);
  }
}

async function openWebSocket(url: string): Promise<WebSocketLike> {
  const WS = (globalThis as Record<string, unknown>)["WebSocket"];
  if (WS === undefined || typeof WS !== "function") {
    throw new Error("WebSocket is not available in this runtime");
  }
  const ws = new (WS as new (url: string) => WebSocketLike)(url);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket connect timeout")), 5_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket error: ${String(event)}`));
    });
  });
}

// ── Adapter ──────────────────────────────────────────────────────────────────

/** Error thrown when the final origin is not in the allowlist. */
class OriginDenialError extends Error {
  constructor(readonly reason: BrowserDenialReason) {
    super(reason.message);
  }
}

/** Creates default production dependencies for {@link ManagedChromeAdapter}. */
export function defaultManagedChromeAdapterDeps(diagnosticsDir: string): ManagedChromeAdapterDeps {
  return {
    launcher: new SystemChromeLauncher(),
    transportFactory: new WebSocketCdpTransportFactory(),
    fs: nodeAdapterFs(),
    now: () => new Date().toISOString(),
    randomId: () => randomUUID(),
    remoteDebuggingHost: "127.0.0.1",
    diagnosticsDir,
  };
}

function nodeAdapterFs(): AdapterFs {
  return {
    mkdtemp: (prefix) => mkdtemp(prefix),
    mkdir: (path, options) => mkdir(path, options),
    writeFile: (path, data, encoding) => writeFile(path, data, encoding),
    rm: (path, options) => rm(path, options),
  };
}

/**
 * Managed Chrome adapter: runs approved typed actions in a temporary profile
 * and enforces origin policy before any content capture.
 */
export class ManagedChromeAdapter {
  constructor(private readonly deps: ManagedChromeAdapterDeps) {}

  /** Execute one typed action and return the action-level result plus the terminal run service. */
  async execute(input: ManagedRunInput): Promise<{ result: BrowserActionResult; service: BrowserOperationRunService }> {
    const { runService, lanePolicy, action, payload, timeoutMs } = input;
    const fingerprint = policyFingerprint(lanePolicy);
    let service = runService.authorize(fingerprint);

    if (!lanePolicy.allowedActions.includes(action)) {
      service = service.deny();
      return {
        service,
        result: actionResult(service.run.runId, "denied", [], `Action "${action}" denied by lane policy`),
      };
    }

    service = service.start();

    let profileDir: string | undefined;
    let chrome: ChromeProcess | undefined;
    let cdp: CdpSession | undefined;
    let terminalService: BrowserOperationRunService = service;
    let actionResultValue: BrowserActionResult;

    try {
      profileDir = await this.deps.fs.mkdtemp(join(tmpdir(), "roll-managed-chrome-"));
      service = service.activateProfile();

      const remoteDebuggingPort = await this.allocateDebugPort();
      chrome = await this.deps.launcher.launch({ profileDir, remoteDebuggingPort });

      cdp = await this.withTimeout(
        this.deps.transportFactory.create({ host: this.deps.remoteDebuggingHost, port: remoteDebuggingPort }),
        timeoutMs,
        "CDP connect",
      );

      // Enable the domains the typed actions need.
      await cdp.send("Runtime.enable");
      await cdp.send("Page.enable");

      // Device emulation (US-BROW-014): apply profile before any page action.
      if (input.deviceProfile !== undefined) {
        const resolved = resolveDeviceProfile(input.deviceProfile);
        if ("code" in resolved) {
          throw new DevToolsError(resolved.message);
        }
        await this.emulateDevice(cdp, resolved);
      }

      actionResultValue = await this.withTimeout(
        this.runTypedAction({ cdp, action, payload, lanePolicy }),
        timeoutMs,
        `action ${action}`,
      );

      terminalService = service.pass();
    } catch (error) {
      terminalService = this.finalizeFromError(service, error);
      actionResultValue = actionResult(
        terminalService.run.runId,
        this.actionStatusFromError(error),
        [],
        redactedSummaryFromError(error),
      );
    } finally {
      await this.close(cdp);
      await this.kill(chrome);
      terminalService = await this.cleanupProfile(profileDir, terminalService);
    }

    return { service: terminalService, result: actionResultValue };
  }

  // ── Device emulation (US-BROW-014) ──────────────────────────────────────

  /**
   * Apply device emulation via CDP before the page action runs.
   *
   * Sends Emulation.setDeviceMetricsOverride and — when the profile specifies
   * a userAgent — Network.setUserAgentOverride. This is diagnostic-only and
   * bounded to the managed lane; it never alters origin or cleanup policy.
   */
  private async emulateDevice(cdp: CdpSession, profile: DeviceProfile): Promise<void> {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: profile.width,
      height: profile.height,
      deviceScaleFactor: profile.deviceScaleFactor,
      mobile: profile.mobile,
      screenWidth: profile.width,
      screenHeight: profile.height,
      fitWindow: false,
    });
    if (profile.userAgent !== undefined) {
      await cdp.send("Network.setUserAgentOverride", {
        userAgent: profile.userAgent,
      });
    }
  }

  private async runTypedAction(options: {
    cdp: CdpSession;
    action: BrowserActionKind;
    payload: Record<string, string | number | boolean>;
    lanePolicy: BrowserLanePolicy;
  }): Promise<BrowserActionResult> {
    const { cdp, action, payload, lanePolicy } = options;

    switch (action) {
      case "navigate": {
        const url = stringPayload(payload, "url");
        await this.assertOriginAllowed(url, lanePolicy, "before navigation");
        await cdp.send("Page.navigate", { url });
        const finalUrl = await this.readCurrentUrl(cdp);
        await this.assertOriginAllowed(finalUrl, lanePolicy, "after redirect");
        return actionResult("", "ok", [], `navigated to ${finalUrl}`);
      }
      case "snapshot": {
        // DOM assertion: read textContent for the selector; no external capture.
        const selector = stringPayload(payload, "selector");
        const finalUrl = await this.readCurrentUrl(cdp);
        await this.assertOriginAllowed(finalUrl, lanePolicy, "before DOM assertion");
        const expression = `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map(n => n.textContent || "")`;
        const evalResult = (await cdp.send("Runtime.evaluate", { expression, returnByValue: true })) as {
          result?: { value?: unknown };
        };
        const domResults = stringArray(evalResult.result?.value);
        return actionResult("", "ok", [], `DOM assertion matched ${domResults.length} nodes`);
      }
      case "console": {
        const finalUrl = await this.readCurrentUrl(cdp);
        await this.assertOriginAllowed(finalUrl, lanePolicy, "before console summary");
        const expression = `JSON.stringify((window.console && window.console.__rollMessages) || [])`;
        const evalResult = (await cdp.send("Runtime.evaluate", { expression, returnByValue: true })) as {
          result?: { value?: unknown };
        };
        const messages = stringArray(JSON.parse(stringValue(evalResult.result?.value) || "[]") || []);
        return actionResult("", "ok", [], `console summary: ${messages.length} messages`);
      }
      case "network": {
        const finalUrl = await this.readCurrentUrl(cdp);
        await this.assertOriginAllowed(finalUrl, lanePolicy, "before network summary");
        const expression = `JSON.stringify((window.__rollNetworkRequests) || [])`;
        const evalResult = (await cdp.send("Runtime.evaluate", { expression, returnByValue: true })) as {
          result?: { value?: unknown };
        };
        const requests = stringArray(JSON.parse(stringValue(evalResult.result?.value) || "[]") || []);
        return actionResult("", "ok", [], `network summary: ${requests.length} requests`);
      }
      case "screenshot": {
        const finalUrl = await this.readCurrentUrl(cdp);
        await this.assertOriginAllowed(finalUrl, lanePolicy, "before screenshot");
        const capture = (await cdp.send("Page.captureScreenshot")) as { data?: string };
        const data = stringValue(capture.data);
        if (data === undefined || data === "") {
          throw new DevToolsError("Page.captureScreenshot returned empty data");
        }
        const ref = await this.writeDiagnosticArtifact("devtools-screenshot", Buffer.from(data, "base64"));
        return actionResult("", "ok", [ref], `diagnostic screenshot captured at ${finalUrl}`);
      }
      default:
        throw new DevToolsError(`Action "${action}" is not implemented in the managed adapter`);
    }
  }

  private async readCurrentUrl(cdp: CdpSession): Promise<string> {
    const result = (await cdp.send("Runtime.evaluate", { expression: "window.location.href", returnByValue: true })) as {
      result?: { value?: unknown };
    };
    const value = stringValue(result.result?.value);
    if (value === undefined) {
      throw new DevToolsError("Could not read current URL from page");
    }
    return value;
  }

  private async assertOriginAllowed(url: string, lanePolicy: BrowserLanePolicy, context: string): Promise<void> {
    const auth = authorizeOrigin(url, lanePolicy);
    if (!auth.authorized || auth.normalized === undefined) {
      const denial: BrowserDenialReason = auth.denial ?? {
        code: "origin_not_allowed",
        message: `Origin not allowed (${context}): ${url}`,
      };
      throw new OriginDenialError(denial);
    }
  }

  private async writeDiagnosticArtifact(kind: DiagnosticArtifactKind, bytes: Buffer): Promise<DiagnosticArtifactRef> {
    const artifactId = this.deps.randomId();
    const path = join(this.deps.diagnosticsDir, `${artifactId}.bin`);
    await this.deps.fs.mkdir(this.deps.diagnosticsDir, { recursive: true });
    await this.deps.fs.writeFile(path, bytes);
    const digest = createHash("sha256").update(bytes).digest("hex");
    return {
      artifactId,
      kind,
      digest,
      bytes: bytes.length,
      untrusted: true,
      diagnosticOnly: true,
    };
  }

  private finalizeFromError(service: BrowserOperationRunService, error: unknown): BrowserOperationRunService {
    if (error instanceof OriginDenialError) {
      return service.deny();
    }
    const failure = diagnosticFailureFromError(error, this.deps.now);
    return service.fail([failure]);
  }

  private actionStatusFromError(error: unknown): BrowserActionResult["status"] {
    if (error instanceof OriginDenialError) return "denied";
    return "failed";
  }

  private async close(cdp: CdpSession | undefined): Promise<void> {
    if (cdp === undefined) return;
    try {
      await cdp.close();
    } catch {
      /* best-effort */
    }
  }

  private async kill(chrome: ChromeProcess | undefined): Promise<void> {
    if (chrome === undefined) return;
    try {
      await chrome.kill();
    } catch {
      /* best-effort */
    }
  }

  private async cleanupProfile(
    profileDir: string | undefined,
    service: BrowserOperationRunService,
  ): Promise<BrowserOperationRunService> {
    if (profileDir === undefined) return service;
    try {
      await this.deps.fs.rm(profileDir, { recursive: true, force: true });
    } catch {
      /* swallow: cleanup is best-effort but the run state still records removed */
    }
    return service.removeProfile();
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, context: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new TimeoutError(`${context} exceeded ${timeoutMs}ms`));
      }, timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private async allocateDebugPort(): Promise<number> {
    // FIX-325 / isolation: pick a random high port to avoid collisions when
    // multiple managed runs exist in the same cycle.
    return 10_000 + Math.floor(Math.random() * 45_000);
  }
}

// ── Errors ───────────────────────────────────────────────────────────────────

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
  }
}

class DevToolsError extends Error {
  constructor(message: string) {
    super(message);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function diagnosticFailureFromError(error: unknown, now: () => string): DiagnosticFailure {
  if (error instanceof TimeoutError) {
    return { category: "timeout", message: error.message, at: now() };
  }
  if (error instanceof OriginDenialError) {
    return { category: "devtools-error", message: `${error.reason.code}: ${error.reason.message}`, at: now() };
  }
  if (error instanceof DevToolsError || error instanceof Error) {
    return { category: "devtools-error", message: error.message, at: now() };
  }
  return { category: "crash", message: "Chrome or adapter crashed", at: now() };
}

function redactedSummaryFromError(error: unknown): string {
  if (error instanceof OriginDenialError) return `denied: ${error.reason.message}`;
  if (error instanceof Error) return `failed: ${error.message}`;
  return "failed: unknown error";
}

function actionResult(
  runId: string,
  status: BrowserActionResult["status"],
  diagnosticRefs: DiagnosticArtifactRef[],
  redactedSummary: string,
): BrowserActionResult {
  return {
    runId,
    actionId: randomUUID(),
    status,
    diagnosticRefs,
    redactedSummary,
  };
}

function stringPayload(payload: Record<string, string | number | boolean>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string") {
    throw new DevToolsError(`Payload key "${key}" must be a string`);
  }
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
