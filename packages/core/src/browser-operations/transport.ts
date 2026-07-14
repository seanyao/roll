/** US-BROW-002 — the only authority for the managed DevTools transport. */
import type { BrowserDenialReason, BrowserOperationEvent } from "@roll/spec";

export const MANAGED_DEVTOOLS_SERVER = "chrome-devtools";
export const MANAGED_DEVTOOLS_PACKAGE = "chrome-devtools-mcp";
export const MANAGED_DEVTOOLS_PACKAGE_VERSION = "1.5.0";

export interface BrowserTransport {
  logicalServer: typeof MANAGED_DEVTOOLS_SERVER;
  command: "npx";
  args: readonly ["-y", string, "--no-usage-statistics"];
  remoteDebugging: { host: "127.0.0.1"; port: 9222 };
}

export type BrowserTransportResolution =
  | { kind: "resolved"; transport: BrowserTransport }
  | { kind: "denied"; reason: BrowserDenialReason };

const MANAGED_TRANSPORT: BrowserTransport = {
  logicalServer: MANAGED_DEVTOOLS_SERVER,
  command: "npx",
  args: ["-y", `${MANAGED_DEVTOOLS_PACKAGE}@${MANAGED_DEVTOOLS_PACKAGE_VERSION}`, "--no-usage-statistics"],
  remoteDebugging: { host: "127.0.0.1", port: 9222 },
};

/**
 * Keeps the privileged DevTools process plan outside project-controlled MCP
 * configuration. Project policy may name the logical binding, but can never
 * alter its executable, package pin, arguments, or remote-debugging endpoint.
 */
export class BrowserTransportRegistry {
  private readonly recordedEvents: BrowserOperationEvent[] = [];

  resolve(requestedServer: string): BrowserTransportResolution {
    if (requestedServer === MANAGED_DEVTOOLS_SERVER) {
      return { kind: "resolved", transport: MANAGED_TRANSPORT };
    }
    return {
      kind: "denied",
      reason: {
        code: "transport_binding_missing",
        message: `Browser policy devtools_server must exactly match \"${MANAGED_DEVTOOLS_SERVER}\"`,
        detail: { requestedServer, registeredServer: MANAGED_DEVTOOLS_SERVER },
      },
    };
  }

  /** Records a durable-domain event payload before generic MCP can resolve or spawn. */
  denyGenericMcp(serverName: string, ts: string): Extract<BrowserOperationEvent, { type: "browser:mcp-bypass-denied" }> {
    const event = {
      type: "browser:mcp-bypass-denied" as const,
      ts,
      reason: {
        code: "generic_mcp_bypass_denied" as const,
        message: `${MANAGED_DEVTOOLS_SERVER} is reserved for Browser Operations`,
        detail: { serverName },
      },
    };
    this.recordedEvents.push(event);
    return event;
  }

  events(): readonly BrowserOperationEvent[] {
    return [...this.recordedEvents];
  }
}

export function isReservedBrowserTransport(serverName: string): boolean {
  return serverName === MANAGED_DEVTOOLS_SERVER;
}
