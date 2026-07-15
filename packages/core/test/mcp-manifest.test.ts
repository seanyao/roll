/** US-BROW-016 — versioned minimum tool manifest contract. */
import { describe, expect, it } from "vitest";
import {
  DevToolsProtocolError,
  MANAGED_DEVTOOLS_PACKAGE,
  MANAGED_DEVTOOLS_PACKAGE_VERSION,
  MINIMUM_DEVTOOLS_MCP_MANIFEST,
} from "../src/browser-operations/index.js";

describe("US-BROW-016 DevTools MCP manifest", () => {
  it("pins the managed package version and requires the generic CDP call tool", () => {
    expect(MINIMUM_DEVTOOLS_MCP_MANIFEST.version).toBe(MANAGED_DEVTOOLS_PACKAGE_VERSION);
    expect(MINIMUM_DEVTOOLS_MCP_MANIFEST.requiredTools).toContain("chrome_devtools_call");
  });

  it("carries the package identity for diagnostics", () => {
    expect(MANAGED_DEVTOOLS_PACKAGE).toBe("chrome-devtools-mcp");
  });

  it("exposes a typed protocol error with the devtools_protocol_error code", () => {
    const error = new DevToolsProtocolError("manifest mismatch");
    expect(error.code).toBe("devtools_protocol_error");
    expect(error.message).toBe("manifest mismatch");
  });
});
