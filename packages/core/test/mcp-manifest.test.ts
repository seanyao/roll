/** US-BROW-016 — versioned minimum tool manifest contract. */
import { describe, expect, it } from "vitest";
import {
  approveBrowserAction,
  DevToolsProtocolError,
  MANAGED_DEVTOOLS_PACKAGE,
  MANAGED_DEVTOOLS_PACKAGE_VERSION,
  MINIMUM_DEVTOOLS_MCP_MANIFEST,
  resolveMcpToolForAction,
} from "../src/browser-operations/index.js";

describe("US-BROW-017 DevTools MCP manifest", () => {
  it("pins the managed package version and requires every typed facade tool", () => {
    expect(MINIMUM_DEVTOOLS_MCP_MANIFEST.version).toBe(MANAGED_DEVTOOLS_PACKAGE_VERSION);
    expect(MINIMUM_DEVTOOLS_MCP_MANIFEST.requiredTools).toEqual([
      "navigate_page",
      "take_snapshot",
      "list_console_messages",
      "list_network_requests",
      "take_screenshot",
      "click",
      "fill",
      "press_key",
    ]);
  });

  it("carries the package identity for diagnostics", () => {
    expect(MANAGED_DEVTOOLS_PACKAGE).toBe("chrome-devtools-mcp");
  });

  it("maps only the closed browser action vocabulary to manifest-approved MCP tools", () => {
    expect(approveBrowserAction("navigate")).toEqual({ kind: "navigate", tool: "navigate_page" });
    expect(approveBrowserAction("press_key")).toEqual({ kind: "press_key", tool: "press_key" });
    expect(resolveMcpToolForAction("screenshot")).toBe("take_screenshot");
    expect(approveBrowserAction("evaluate_script")).toMatchObject({ code: "action_not_allowed" });
    expect(resolveMcpToolForAction("chrome_devtools_call")).toBeUndefined();
  });

  it("exposes a typed protocol error with the devtools_protocol_error code", () => {
    const error = new DevToolsProtocolError("manifest mismatch");
    expect(error.code).toBe("devtools_protocol_error");
    expect(error.message).toBe("manifest mismatch");
  });
});
