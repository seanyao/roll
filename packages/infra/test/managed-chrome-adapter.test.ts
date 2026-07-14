/** US-BROW-004b — Managed Chrome/DevTools adapter integration tests.
 *
 * All tests use a fake CDP transport and a fake Chrome launcher so they never
 * require a real Chrome binary. The temp-profile lifecycle uses the real file
 * system to prove cleanup actually deletes the directory.
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserOperationRunService } from "@roll/core";
import type { BrowserActionKind, BrowserActionResult, BrowserLanePolicy } from "@roll/spec";
import { describe, expect, it } from "vitest";
import {
  ManagedChromeAdapter,
  type AdapterFs,
  type ChromeLauncher,
  type ChromeProcess,
  type CdpSession,
  type CdpTransportFactory,
  type ManagedChromeAdapterDeps,
  type ManagedRunInput,
} from "../src/browser-operations/managed-chrome-adapter.js";

const now = () => "2026-07-15T00:00:00.000Z";

const lanePolicy = (allowedOrigins: string[]): BrowserLanePolicy => ({
  enabled: true,
  allowedOrigins,
  allowedActions: ["navigate", "snapshot", "console", "network", "screenshot"],
});

function newRun(overrides?: { runId?: string; idempotencyKey?: string }): BrowserOperationRunService {
  return BrowserOperationRunService.create({
    runId: overrides?.runId ?? "run-1",
    idempotencyKey: overrides?.idempotencyKey ?? "key-1",
    storyId: "US-BROW-004b",
    caller: "builder",
    lane: "managed",
    requestedOrigin: "https://example.test",
    holderTokenHash: "hash-1",
    now,
  });
}

class FakeCdpSession implements CdpSession {
  private handlers: Map<string, (params: Record<string, unknown>) => unknown> = new Map();

  when(method: string, result: (params: Record<string, unknown>) => unknown): void {
    this.handlers.set(method, result);
  }

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const handler = this.handlers.get(method);
    if (handler === undefined) {
      throw new Error(`Unexpected CDP method: ${method}`);
    }
    return handler(params ?? {});
  }

  async close(): Promise<void> {
    /* no-op */
  }
}

class FakeTransportFactory implements CdpTransportFactory {
  readonly sessions: FakeCdpSession[] = [];
  private configured: ((session: FakeCdpSession) => void) | undefined;
  private hangMs: number | undefined;

  configure(fn: (session: FakeCdpSession) => void): void {
    this.configured = fn;
  }

  hangNextConnect(ms: number): void {
    this.hangMs = ms;
  }

  async create(_endpoint: { host: string; port: number }): Promise<CdpSession> {
    if (this.hangMs !== undefined) {
      const ms = this.hangMs;
      this.hangMs = undefined;
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    const session = new FakeCdpSession();
    // Default happy path: current URL matches the allowlisted origin.
    session.when("Runtime.evaluate", (params) => {
      const expression = String(params.expression ?? "");
      if (expression.includes("window.location.href")) {
        return { result: { value: "https://example.test/after" } };
      }
      if (expression.includes("__rollMessages")) {
        return { result: { value: JSON.stringify(["hello"]) } };
      }
      if (expression.includes("__rollNetworkRequests")) {
        return { result: { value: JSON.stringify(["/api"]) } };
      }
      if (expression.includes("querySelectorAll")) {
        return { result: { value: ["node text"] } };
      }
      return { result: { value: undefined } };
    });
    session.when("Runtime.enable", () => ({}));
    session.when("Page.enable", () => ({}));
    session.when("Page.navigate", () => ({ frameId: "frame-1" }));
    session.when("Page.captureScreenshot", () => ({ data: "aGVsbG8=" }));
    this.configured?.(session);
    this.sessions.push(session);
    return session;
  }
}

class FakeLauncher implements ChromeLauncher {
  readonly launches: Array<{ profileDir: string; remoteDebuggingPort: number }> = [];
  private failNext = false;

  failNextLaunch(): void {
    this.failNext = true;
  }

  async launch(options: { profileDir: string; remoteDebuggingPort: number }): Promise<ChromeProcess> {
    this.launches.push(options);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Chrome launch failed");
    }
    return { pid: 42, kill: async () => undefined };
  }
}

async function makeDeps(): Promise<ManagedChromeAdapterDeps & { diagnosticsDir: string; transport: FakeTransportFactory; launcher: FakeLauncher }> {
  const diagnosticsDir = await mkdtemp(join(tmpdir(), "roll-diag-"));
  const transport = new FakeTransportFactory();
  const launcher = new FakeLauncher();
  return {
    launcher,
    transportFactory: transport,
    fs: nodeAdapterFs(),
    now,
    randomId: () => `id-${Math.random().toString(36).slice(2)}`,
    remoteDebuggingHost: "127.0.0.1",
    diagnosticsDir,
    transport,
    launcher,
  };
}

function nodeAdapterFs(): AdapterFs {
  return {
    mkdtemp: (prefix) => mkdtemp(prefix),
    mkdir: (path, options) => import("node:fs/promises").then((fs) => fs.mkdir(path, options)),
    writeFile: (path, data, encoding) => import("node:fs/promises").then((fs) => fs.writeFile(path, data, encoding)),
    rm: (path, options) => rm(path, options),
  };
}

async function run(
  deps: ManagedChromeAdapterDeps,
  action: BrowserActionKind,
  payload: Record<string, string | number | boolean> = {},
  allowedOrigins = ["https://example.test"],
  timeoutMs = 5_000,
): Promise<{ result: BrowserActionResult; service: BrowserOperationRunService }> {
  const adapter = new ManagedChromeAdapter(deps);
  const runService = newRun();
  const input: ManagedRunInput = {
    runService,
    lanePolicy: lanePolicy(allowedOrigins),
    action,
    payload,
    timeoutMs,
  };
  return adapter.execute(input);
}

async function dirExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("US-BROW-004b ManagedChromeAdapter", () => {
  it("creates and removes a temporary profile on success", async () => {
    const deps = await makeDeps();
    const { result, service } = await run(deps, "navigate", { url: "https://example.test" });

    expect(result.status).toBe("ok");
    expect(service.isProfileRemoved()).toBe(true);
    expect(service.isTerminal()).toBe(true);
    expect(service.run.state).toBe("passed");
    expect(deps.launcher.launches).toHaveLength(1);
    expect(await dirExists(deps.launcher.launches[0].profileDir)).toBe(false);
  });

  it("removes the temporary profile even when the run fails", async () => {
    const deps = await makeDeps();
    deps.launcher.failNextLaunch();

    const { result, service } = await run(deps, "navigate", { url: "https://example.test" });

    expect(result.status).toBe("failed");
    expect(service.isProfileRemoved()).toBe(true);
    expect(service.run.state).toBe("failed");
    expect(service.terminalResult()?.kind).toBe("fail");
    if (deps.launcher.launches.length > 0) {
      expect(await dirExists(deps.launcher.launches[0].profileDir)).toBe(false);
    }
  });

  it("denies the final URL when it redirects outside the allowlist", async () => {
    const deps = await makeDeps();
    deps.transport.configure((session) => {
      session.when("Runtime.evaluate", (params) => {
        const expression = String(params.expression ?? "");
        if (expression.includes("window.location.href")) {
          return { result: { value: "https://evil.test/redirected" } };
        }
        return { result: { value: undefined } };
      });
    });

    const { result, service } = await run(deps, "navigate", { url: "https://example.test" });

    expect(result.status).toBe("denied");
    expect(service.run.state).toBe("denied");
    expect(service.isTerminal()).toBe(true);
  });

  it("denies screenshot when final origin is not allowed", async () => {
    const deps = await makeDeps();
    deps.transport.configure((session) => {
      session.when("Runtime.evaluate", (params) => {
        const expression = String(params.expression ?? "");
        if (expression.includes("window.location.href")) {
          return { result: { value: "https://evil.test/page" } };
        }
        return { result: { value: undefined } };
      });
    });

    const { result, service } = await run(deps, "screenshot");

    expect(result.status).toBe("denied");
    expect(service.run.state).toBe("denied");
    // No diagnostic screenshot artifact should have been written.
    expect(result.diagnosticRefs).toHaveLength(0);
  });

  it("categorizes DevTools errors as diagnostic failures", async () => {
    const deps = await makeDeps();
    deps.transport.configure((session) => {
      session.when("Runtime.enable", () => {
        throw new Error("CDP Runtime.enable failed");
      });
    });

    const { result, service } = await run(deps, "navigate", { url: "https://example.test" });

    expect(result.status).toBe("failed");
    expect(service.run.state).toBe("failed");
    const terminal = service.terminalResult();
    expect(terminal?.kind).toBe("fail");
    if (terminal?.kind === "fail") {
      expect(terminal.failures[0].category).toBe("devtools-error");
    }
  });

  it("categorizes timeout as a diagnostic failure", async () => {
    const deps = await makeDeps();
    deps.transport.hangNextConnect(60_000);

    const { result, service } = await run(deps, "navigate", { url: "https://example.test" }, ["https://example.test"], 1);

    expect(result.status).toBe("failed");
    expect(service.run.state).toBe("failed");
    const terminal = service.terminalResult();
    expect(terminal?.kind).toBe("fail");
    if (terminal?.kind === "fail") {
      expect(terminal.failures[0].category).toBe("timeout");
    }
  });

  it("runs DOM assertion and returns ok", async () => {
    const deps = await makeDeps();
    const { result, service } = await run(deps, "snapshot", { selector: "h1" });

    expect(result.status).toBe("ok");
    expect(service.run.state).toBe("passed");
  });

  it("runs console summary and returns ok", async () => {
    const deps = await makeDeps();
    const { result, service } = await run(deps, "console");

    expect(result.status).toBe("ok");
    expect(service.run.state).toBe("passed");
  });

  it("runs network summary and returns ok", async () => {
    const deps = await makeDeps();
    const { result, service } = await run(deps, "network");

    expect(result.status).toBe("ok");
    expect(service.run.state).toBe("passed");
  });

  it("writes a diagnostic screenshot artifact when allowed", async () => {
    const deps = await makeDeps();
    const { result, service } = await run(deps, "screenshot");

    expect(result.status).toBe("ok");
    expect(service.run.state).toBe("passed");
    expect(result.diagnosticRefs).toHaveLength(1);
    expect(result.diagnosticRefs[0].kind).toBe("devtools-screenshot");
    expect(result.diagnosticRefs[0].diagnosticOnly).toBe(true);
    expect(result.diagnosticRefs[0].bytes).toBeGreaterThan(0);
  });

  it("is deterministic for retry idempotency (same key replays the same shape)", async () => {
    const deps = await makeDeps();

    const first = await run(deps, "navigate", { url: "https://example.test" });
    expect(first.result.status).toBe("ok");
    expect(first.service.run.state).toBe("passed");

    // A second run with the same idempotency key but a different runId should
    // execute cleanly through the same adapter shape. The idempotency contract
    // lives in the ledger; here we prove the adapter itself does not mutate
    // the run key and produces the same terminal status.
    const second = await run(deps, "navigate", { url: "https://example.test" });
    expect(second.result.status).toBe("ok");
    expect(second.service.run.state).toBe("passed");
    expect(second.service.run.idempotencyKey).toBe(first.service.run.idempotencyKey);
  });

  it("denies disallowed actions before launching Chrome", async () => {
    const deps = await makeDeps();
    const runService = newRun();
    const adapter = new ManagedChromeAdapter(deps);
    const { result, service } = await adapter.execute({
      runService,
      lanePolicy: lanePolicy(["https://example.test"]),
      action: "click",
      payload: { selector: "button" },
      timeoutMs: 5_000,
    });

    expect(result.status).toBe("denied");
    expect(service.run.state).toBe("denied");
    expect(deps.launcher.launches).toHaveLength(0);
  });
});
