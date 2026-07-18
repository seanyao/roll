/**
 * FIX-005 — physical evidence for a local synthetic page must have a visible
 * target window, while never touching the owner's Chrome profile or tabs.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateRollCaptureRequestV1,
  type RollCaptureRequestV1,
  type RollCaptureResponseV1,
} from "@roll/spec";
import { type ChromeLauncher, type ChromeProcess, SystemChromeLauncher } from "./browser-operations/managed-chrome-adapter.js";
import { RollCaptureProvider, type RollCaptureProviderPort } from "./roll-capture.js";

const CHROME_APP_NAME = "Google Chrome";
const PAGE_DISCOVERY_ATTEMPTS = 40;
const PAGE_DISCOVERY_INTERVAL_MS = 200;
const WINDOW_TITLE_SETTLE_MS = 3_000;

export interface ControlledLocalWindowCaptureInput {
  /** The product project's root; screenshot output must remain under `.roll`. */
  projectRoot: string;
  /** The one local synthetic page to make visible. Network and file URLs are refused. */
  url: string;
  /**
   * Exact title rendered by the synthetic page. It must carry a caller-created
   * nonce so another Chrome window cannot be selected accidentally.
   */
  windowTitle: string;
  /** The caller supplies evidence identity/output, but not the physical window selector. */
  request: Omit<RollCaptureRequestV1, "target">;
}

/** Public safe entry: wraps one loopback page in a nonce-titled local window. */
export interface ControlledLocalPageCaptureInput {
  projectRoot: string;
  url: string;
  request: Omit<RollCaptureRequestV1, "target">;
}

export interface ControlledLocalWindowCaptureResult {
  status: "taken" | "skipped" | "failed" | "timeout";
  path?: string;
  reason?: string;
  response?: RollCaptureResponseV1;
  selector?: { appName: typeof CHROME_APP_NAME; windowTitle: string };
}

export interface ControlledPage {
  url: string;
  webSocketDebuggerUrl: string;
}

export interface ControlledPagePort {
  find(input: { endpoint: string; expectedUrl: string }): Promise<ControlledPage | null>;
}

export interface ControlledCaptureWrapper {
  url: string;
  windowTitle: string;
  close(): Promise<void>;
}

export interface ControlledLocalWindowCaptureDeps {
  chrome: ChromeLauncher;
  fs: {
    mkdtemp(prefix: string): Promise<string>;
    rm(path: string, options: { recursive: true; force: true }): Promise<void>;
  };
  ports: { allocate(): Promise<number> };
  pages: ControlledPagePort;
  provider: RollCaptureProviderPort;
  sleep(ms: number): Promise<void>;
}

export interface ControlledLocalPageCaptureDeps extends ControlledLocalWindowCaptureDeps {
  wrappers: {
    open(input: { url: string; storyId: string }): Promise<ControlledCaptureWrapper>;
  };
}

/**
 * Start a disposable, nonce-titled wrapper around an exact loopback page, then
 * capture only that wrapper window. The wrapper is the reason the macOS window
 * title is deterministic without inspecting or modifying the app under test.
 */
export async function captureControlledLocalPage(
  input: ControlledLocalPageCaptureInput,
  deps: ControlledLocalPageCaptureDeps = defaultControlledLocalPageCaptureDeps(),
): Promise<ControlledLocalWindowCaptureResult> {
  const urlFailure = localUrlFailure(input.url);
  if (urlFailure !== undefined) return { status: "failed", reason: urlFailure };

  let wrapper: ControlledCaptureWrapper | undefined;
  try {
    wrapper = await deps.wrappers.open({ url: input.url, storyId: input.request.storyId ?? "evidence" });
    return await captureControlledLocalWindow({
      projectRoot: input.projectRoot,
      url: wrapper.url,
      windowTitle: wrapper.windowTitle,
      request: input.request,
    }, deps);
  } catch (error) {
    return {
      status: "failed",
      reason: `controlled local page wrapper failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (wrapper !== undefined) await closeWrapperQuietly(wrapper);
  }
}

export async function captureControlledLocalWindow(
  input: ControlledLocalWindowCaptureInput,
  deps: ControlledLocalWindowCaptureDeps = defaultControlledLocalWindowCaptureDeps(),
): Promise<ControlledLocalWindowCaptureResult> {
  const urlFailure = localUrlFailure(input.url);
  if (urlFailure !== undefined) return { status: "failed", reason: urlFailure };
  if (!input.windowTitle.startsWith("Roll Capture ") || input.windowTitle.length <= "Roll Capture ".length) {
    return { status: "failed", reason: "controlled local window capture requires a nonce-bearing title beginning with Roll Capture " };
  }
  if (input.request.kind !== "web") {
    return { status: "failed", reason: "controlled local window capture only accepts web evidence" };
  }

  const initialRequest: RollCaptureRequestV1 = {
    ...input.request,
    target: { type: "window", appName: CHROME_APP_NAME },
  };
  const requestValidation = validateRollCaptureRequestV1(initialRequest, { projectRoot: input.projectRoot });
  if (!requestValidation.ok) return { status: "failed", reason: requestValidation.errors.join("; ") };

  let profileDir: string | undefined;
  let chrome: ChromeProcess | undefined;
  try {
    profileDir = await deps.fs.mkdtemp(join(tmpdir(), "roll-controlled-capture-"));
    const remoteDebuggingPort = await deps.ports.allocate();
    chrome = await deps.chrome.launch({
      profileDir: join(profileDir, "profile"),
      remoteDebuggingPort,
      visibility: "visible",
      initialUrl: input.url,
    });

    const endpoint = `http://127.0.0.1:${remoteDebuggingPort}`;
    const page = await waitForExactLocalPage(endpoint, input.url, deps);
    if (page === null) {
      return { status: "failed", reason: "isolated local page was not discovered before capture" };
    }

    // macOS obtains a window title asynchronously from Chromium. Keeping the
    // process alive through this short settle interval avoids a false missing-window skip.
    await deps.sleep(WINDOW_TITLE_SETTLE_MS);

    const request: RollCaptureRequestV1 = {
      ...input.request,
      target: { type: "window", appName: CHROME_APP_NAME, windowTitle: input.windowTitle },
    };
    await deps.provider.writeRequest(request);
    const result = await deps.provider.waitForResponse(request, { timeoutMs: request.timeoutMs });
    const selector = { appName: CHROME_APP_NAME, windowTitle: input.windowTitle } as const;
    if (result.status === "taken") return { status: "taken", path: result.path, response: result.response, selector };
    if (result.status === "timeout") return { status: "timeout", reason: result.reason, selector };
    return { status: result.status, reason: result.reason, response: result.response, selector };
  } catch (error) {
    return {
      status: "failed",
      reason: `controlled local window capture failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (chrome !== undefined) await killQuietly(chrome);
    if (profileDir !== undefined) await removeQuietly(profileDir, deps);
  }
}

function defaultControlledLocalWindowCaptureDeps(): ControlledLocalWindowCaptureDeps {
  return {
    chrome: new SystemChromeLauncher(),
    fs: { mkdtemp, rm },
    ports: { allocate: allocateLoopbackPort },
    pages: defaultControlledPagePort(),
    provider: new RollCaptureProvider(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

function defaultControlledLocalPageCaptureDeps(): ControlledLocalPageCaptureDeps {
  return {
    ...defaultControlledLocalWindowCaptureDeps(),
    wrappers: { open: createControlledCaptureWrapper },
  };
}

function localUrlFailure(raw: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "controlled local window capture requires a valid loopback URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "controlled local window capture only permits loopback HTTP(S) pages";
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return "controlled local window capture refuses URL credentials";
  }
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname)) {
    return "controlled local window capture only permits loopback pages";
  }
  return undefined;
}

export function isLoopbackCaptureUrl(raw: string): boolean {
  return localUrlFailure(raw) === undefined;
}

async function waitForExactLocalPage(
  endpoint: string,
  expectedUrl: string,
  deps: ControlledLocalWindowCaptureDeps,
): Promise<ControlledPage | null> {
  for (let attempt = 0; attempt < PAGE_DISCOVERY_ATTEMPTS; attempt += 1) {
    let page: ControlledPage | null = null;
    try {
      page = await deps.pages.find({ endpoint, expectedUrl });
    } catch {
      // Chrome has not bound its private loopback port yet. The bounded retry
      // remains inside the isolated process and never falls back to owner Chrome.
    }
    if (page !== null) return page;
    await deps.sleep(PAGE_DISCOVERY_INTERVAL_MS);
  }
  return null;
}

async function killQuietly(chrome: ChromeProcess): Promise<void> {
  try {
    await chrome.kill();
  } catch {
    // The profile cleanup below still runs if Chrome was already gone.
  }
}

async function removeQuietly(path: string, deps: ControlledLocalWindowCaptureDeps): Promise<void> {
  try {
    await deps.fs.rm(path, { recursive: true, force: true });
  } catch {
    // A failed cleanup never changes the truthful capture result.
  }
}

async function closeWrapperQuietly(wrapper: ControlledCaptureWrapper): Promise<void> {
  try {
    await wrapper.close();
  } catch {
    // The browser/profile cleanup still completed; a local wrapper cannot turn
    // a truthful capture result into a false success.
  }
}

async function createControlledCaptureWrapper(input: { url: string; storyId: string }): Promise<ControlledCaptureWrapper> {
  const { createServer } = await import("node:http");
  const nonce = randomNonce();
  const windowTitle = `Roll Capture ${safeStoryLabel(input.storyId)} ${nonce}`;
  const frameOrigin = new URL(input.url).origin;
  const body = [
    "<!doctype html>",
    `<title>${escapeHtml(windowTitle)}</title>`,
    "<style>html,body,iframe{margin:0;border:0;width:100%;height:100%;overflow:hidden}</style>",
    `<iframe title="synthetic capture target" src="${escapeHtmlAttribute(input.url)}"></iframe>`,
  ].join("");
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; frame-src ${frameOrigin}`,
    });
    response.end(body);
  });
  const address = await new Promise<{ port: number }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const bound = server.address();
      if (bound === null || typeof bound === "string") {
        server.close(() => reject(new Error("could not allocate the local capture wrapper")));
        return;
      }
      resolve({ port: bound.port });
    });
  });
  return {
    url: `http://127.0.0.1:${address.port}/`,
    windowTitle,
    close: () => new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))),
  };
}

function randomNonce(): string {
  // macOS may truncate long app-window names in CGWindow metadata. A 48-bit
  // nonce keeps the selector short while making collisions impractical.
  return randomUUID().replace(/-/gu, "").slice(0, 12);
}

function safeStoryLabel(raw: string): string {
  const sanitized = raw.replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 48);
  return sanitized === "" ? "evidence" : sanitized;
}

function escapeHtml(raw: string): string {
  return raw.replace(/[&<>]/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char] ?? char);
}

function escapeHtmlAttribute(raw: string): string {
  return escapeHtml(raw).replace(/"/gu, "&quot;");
}

function defaultControlledPagePort(): ControlledPagePort {
  return {
    async find({ endpoint, expectedUrl }) {
      const response = await fetch(`${endpoint}/json/list`);
      if (!response.ok) return null;
      const targets = await response.json();
      if (!Array.isArray(targets)) return null;
      for (const target of targets) {
        if (!isExactLocalPage(target, expectedUrl)) continue;
        return { url: target.url, webSocketDebuggerUrl: target.webSocketDebuggerUrl };
      }
      return null;
    },
  };
}

function isExactLocalPage(value: unknown, expectedUrl: string): value is ControlledPage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate["type"] === "page" &&
    candidate["url"] === expectedUrl &&
    typeof candidate["webSocketDebuggerUrl"] === "string" &&
    isLoopbackWebSocket(candidate["webSocketDebuggerUrl"]);
}

function isLoopbackWebSocket(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return (parsed.protocol === "ws:" || parsed.protocol === "wss:") &&
      ["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function allocateLoopbackPort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("could not allocate a loopback debugging port")));
        return;
      }
      server.close((error) => error === undefined ? resolve(address.port) : reject(error));
    });
  });
}
