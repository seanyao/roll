/** US-BROW-002 — fixed DevTools transport ownership and policy binding. */
import { describe, expect, it } from "vitest";
import {
  BrowserTransportRegistry,
  MANAGED_DEVTOOLS_PACKAGE,
  MANAGED_DEVTOOLS_PACKAGE_VERSION,
} from "../src/browser-operations/transport.js";

describe("US-BROW-002 BrowserTransportRegistry", () => {
  it("owns one exact pinned logical binding without accepting runtime command or endpoint overrides", () => {
    const registry = new BrowserTransportRegistry();

    expect(registry.resolve("chrome-devtools")).toEqual({
      kind: "resolved",
      transport: {
        logicalServer: "chrome-devtools",
        command: "npx",
        args: ["-y", `${MANAGED_DEVTOOLS_PACKAGE}@${MANAGED_DEVTOOLS_PACKAGE_VERSION}`, "--no-usage-statistics", "--isolated", "--headless"],
        remoteDebugging: { host: "127.0.0.1", port: 9222 },
      },
    });
  });

  it("fails closed when project policy names anything except the registered logical server", () => {
    const registry = new BrowserTransportRegistry();

    expect(registry.resolve("project-devtools")).toEqual({
      kind: "denied",
      reason: {
        code: "transport_binding_missing",
        message: 'Browser policy devtools_server must exactly match "chrome-devtools"',
        detail: { requestedServer: "project-devtools", registeredServer: "chrome-devtools" },
      },
    });
  });

  it("does not let a consumer mutation change the next resolved pin", () => {
    const registry = new BrowserTransportRegistry();
    const first = registry.resolve("chrome-devtools");
    if (first.kind !== "resolved") throw new Error("expected fixed transport");
    (first.transport.remoteDebugging as { host: string }).host = "evil.test";
    (first.transport.args as string[])[1] = "chrome-devtools-mcp@latest";

    const second = registry.resolve("chrome-devtools");
    expect(second).toMatchObject({
      kind: "resolved",
      transport: {
        args: ["-y", "chrome-devtools-mcp@1.5.0", "--no-usage-statistics", "--isolated", "--headless"],
        remoteDebugging: { host: "127.0.0.1", port: 9222 },
      },
    });
  });

  it("returns a typed generic MCP bypass event without owning persistence", () => {
    let recorded = 0;
    const registry = new BrowserTransportRegistry(() => {
      recorded += 1;
    });

    expect(registry.denyGenericMcp("chrome-devtools", "2026-07-15T00:00:00.000Z")).toEqual({
      type: "browser:mcp-bypass-denied",
      ts: "2026-07-15T00:00:00.000Z",
      reason: {
        code: "generic_mcp_bypass_denied",
        message: "chrome-devtools is reserved for Browser Operations",
        detail: { serverName: "chrome-devtools" },
      },
    });
    expect(recorded).toBe(0);
  });
});
