import { describe, expect, it, vi } from "vitest";
import {
  InteractiveChromeAdapter,
  type InteractiveChromeAdapterDeps,
} from "../src/browser-operations/interactive-chrome-adapter.js";
import type { BrowserLease } from "@roll/spec";

const lease = (overrides: Partial<BrowserLease> = {}): BrowserLease => ({
  leaseId: "lease-1",
  browser: "owner-chrome",
  storyId: "US-BROW-008b",
  origin: "http://127.0.0.1:9222",
  scope: "interactive-read-write",
  ownerApproval: { approvedAt: "2026-07-15T00:00:00.000Z", operator: "owner", reason: "navigate" },
  acquiredAt: "2026-07-15T00:00:00.000Z",
  expiresAt: "2026-07-15T00:15:00.000Z",
  holderPid: 123,
  holderProcessIdentity: "owner",
  holderTokenHash: "hash",
  endpointHash: "endpoint",
  ...overrides,
});

function deps(overrides: Partial<InteractiveChromeAdapterDeps> = {}): InteractiveChromeAdapterDeps {
  return {
    discoverTargets: async () => [{ id: "tab-1", url: "https://app.example.test/account", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/1" }],
    connect: async () => ({ send: vi.fn(async () => ({ result: { value: "https://app.example.test/account" } })), close: vi.fn(async () => undefined) }),
    nowMs: () => Date.parse("2026-07-15T00:01:00.000Z"),
    ...overrides,
  };
}

describe("US-BROW-008b InteractiveChromeAdapter", () => {
  it("rejects an expired lease before target discovery", async () => {
    const discoverTargets = vi.fn(async () => []);
    const adapter = new InteractiveChromeAdapter(deps({ discoverTargets }));

    const result = await adapter.execute({
      lease: lease({ expiresAt: "2026-07-15T00:00:00.000Z" }),
      origin: "https://app.example.test",
      action: { kind: "navigate", url: "https://app.example.test/account" },
    });

    expect(result).toMatchObject({ kind: "denied", reason: { code: "interactive_lease_expired" } });
    expect(discoverTargets).not.toHaveBeenCalled();
  });

  it("connects only to an origin-matching owner tab and closes DevTools without closing Chrome", async () => {
    const send = vi.fn(async (method: string) => method === "Runtime.evaluate"
      ? { result: { value: "https://app.example.test/account" } }
      : {});
    const close = vi.fn(async () => undefined);
    const connect = vi.fn(async () => ({ send, close }));
    const adapter = new InteractiveChromeAdapter(deps({
      discoverTargets: async () => [
        { id: "other", url: "https://elsewhere.example.test", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/0" },
        { id: "target", url: "https://app.example.test/account", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/1" },
      ],
      connect,
    }));

    const result = await adapter.execute({
      lease: lease(),
      origin: "https://app.example.test",
      action: { kind: "navigate", url: "https://app.example.test/account" },
    });

    expect(result).toMatchObject({ kind: "completed", tabId: "target", ciPassed: false });
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ id: "target" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("fails closed when no owner tab matches the approved origin", async () => {
    const connect = vi.fn();
    const adapter = new InteractiveChromeAdapter(deps({
      discoverTargets: async () => [{ id: "other", url: "https://elsewhere.example.test", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/0" }],
      connect,
    }));

    const result = await adapter.execute({
      lease: lease(),
      origin: "https://app.example.test",
      action: { kind: "click", selector: "button[type=submit]" },
    });

    expect(result).toMatchObject({ kind: "denied", reason: { code: "devtools_unavailable" } });
    expect(connect).not.toHaveBeenCalled();
  });

  it("has no typed credential, storage, or network-body action surface", () => {
    const action: Parameters<InteractiveChromeAdapter["execute"]>[0]["action"] = { kind: "fill", selector: "#name", value: "Ada" };
    expect(action).toEqual({ kind: "fill", selector: "#name", value: "Ada" });
    // @ts-expect-error credential export is intentionally outside the closed action type.
    const forbidden: Parameters<InteractiveChromeAdapter["execute"]>[0]["action"] = { kind: "cookie_export" };
    expect(forbidden).toBeDefined();
  });
});
