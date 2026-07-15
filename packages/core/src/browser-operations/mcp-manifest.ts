/**
 * US-BROW-016 — versioned minimum tool manifest for the managed DevTools MCP
 * session.
 *
 * The manifest is the contract between Roll and the pinned chrome-devtools-mcp
 * package. The session refuses to execute any browser action until the MCP
 * server advertises every required tool from the manifest.
 */

import { MANAGED_DEVTOOLS_PACKAGE_VERSION } from "./transport.js";

/** The machine-approved minimum capability surface the MCP server must expose. */
export interface DevToolsMcpManifest {
  /** Pinned package version this manifest applies to. */
  readonly version: string;
  /** Required tool names. Missing or renamed tools fail closed. */
  readonly requiredTools: readonly string[];
}

/**
 * Minimum manifest for the pinned chrome-devtools-mcp package.
 *
 * The generic `chrome_devtools_call` tool is the only required capability at
 * this layer: it proxies CDP method calls so the managed adapter stays on the
 * MCP boundary instead of opening a raw WebSocket/CDP connection.
 */
export const MINIMUM_DEVTOOLS_MCP_MANIFEST: DevToolsMcpManifest = {
  version: MANAGED_DEVTOOLS_PACKAGE_VERSION,
  requiredTools: ["chrome_devtools_call"],
};

/** Error raised when the MCP session cannot initialize or lacks the manifest. */
export class DevToolsProtocolError extends Error {
  readonly code = "devtools_protocol_error" as const;
  constructor(message: string) {
    super(message);
  }
}
