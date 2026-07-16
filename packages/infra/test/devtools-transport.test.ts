/** US-BROW-002 — typed infra seam for the registry-owned DevTools process. */
import { BrowserTransportRegistry } from "@roll/core";
import { describe, expect, it } from "vitest";
import {
  ManagedDevToolsTransport,
  type DevToolsConnection,
} from "../src/browser-operations/devtools-transport.js";

describe("US-BROW-002 ManagedDevToolsTransport", () => {
  it("opens only the registry-owned pinned transport for the exact policy binding", async () => {
    const connection: DevToolsConnection = { close: async () => undefined };
    const seen: unknown[] = [];
    const transport = new ManagedDevToolsTransport(
      new BrowserTransportRegistry(),
      async (plan) => {
        seen.push(plan);
        return connection;
      },
    );

    await expect(transport.open({ devtoolsServer: "chrome-devtools" })).resolves.toEqual({ kind: "connected", connection });
    expect(seen).toEqual([
      {
        logicalServer: "chrome-devtools",
        command: "npx",
        args: ["-y", "chrome-devtools-mcp@1.5.0", "--no-usage-statistics", "--isolated", "--headless"],
        remoteDebugging: { host: "127.0.0.1", port: 9222 },
      },
    ]);
  });

  it("rejects a project binding mismatch without opening a process", async () => {
    let opened = false;
    const transport = new ManagedDevToolsTransport(new BrowserTransportRegistry(), async () => {
      opened = true;
      return { close: async () => undefined };
    });

    await expect(transport.open({ devtoolsServer: "project-devtools" })).resolves.toMatchObject({
      kind: "denied",
      reason: { code: "transport_binding_missing" },
    });
    expect(opened).toBe(false);
  });

  it("ignores project-supplied command and endpoint fields instead of letting them override the pin", async () => {
    const seen: unknown[] = [];
    const transport = new ManagedDevToolsTransport(new BrowserTransportRegistry(), async (plan) => {
      seen.push(plan);
      return { close: async () => undefined };
    });

    await expect(transport.open({
      devtoolsServer: "chrome-devtools",
      command: "project-controlled-command",
      remoteDebugging: { host: "evil.test", port: 7777 },
    })).resolves.toMatchObject({ kind: "connected" });
    expect(seen).toEqual([expect.objectContaining({
      command: "npx",
      args: ["-y", "chrome-devtools-mcp@1.5.0", "--no-usage-statistics", "--isolated", "--headless"],
      remoteDebugging: { host: "127.0.0.1", port: 9222 },
    })]);
  });
});
