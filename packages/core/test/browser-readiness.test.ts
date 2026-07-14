import { describe, expect, it } from "vitest";
import type { BrowserEnvironmentObservations } from "@roll/spec";
import {
  MANAGED_DEVTOOLS_PACKAGE,
  MANAGED_DEVTOOLS_PACKAGE_VERSION,
  deriveBrowserEnvironmentReadiness,
} from "../src/browser-operations/readiness.js";

function present(detail = "ok", value?: string) {
  return value === undefined ? { present: true, detail } : { present: true, detail, value };
}
function absent(detail: string) {
  return { present: false, detail };
}

function healthy(): BrowserEnvironmentObservations {
  return {
    node: present("Node LTS present", "v20.11.0"),
    npx: present("npx present", "/usr/bin/npx"),
    chrome: present("Google Chrome present", "/Applications/Google Chrome.app"),
    devtoolsPackage: present(`${MANAGED_DEVTOOLS_PACKAGE}@${MANAGED_DEVTOOLS_PACKAGE_VERSION} pinned`),
    loopbackRemoteDebug: present("127.0.0.1:9222 reachable", "127.0.0.1:9222"),
    transportBinding: present("devtools_server matches registry"),
    capture: { status: "available", detail: "Roll Capture ready" },
  };
}

describe("US-BROW-003 deriveBrowserEnvironmentReadiness", () => {
  it("reports every lane ready when all dependencies pass", () => {
    const r = deriveBrowserEnvironmentReadiness(healthy());
    expect(r.managed.verdict).toBe("ready");
    expect(r.interactive.verdict).toBe("ready");
    expect(r.capture.verdict).toBe("ready");
  });

  it("degrades managed (not blocked) when Chrome or the MCP package is missing, leaving other paths usable", () => {
    const obs = healthy();
    obs.chrome = absent("Google Chrome not found");
    obs.devtoolsPackage = absent("chrome-devtools-mcp not configured");
    const r = deriveBrowserEnvironmentReadiness(obs);
    expect(r.managed.verdict).toBe("degraded");
    expect(r.managed.reason).toMatch(/chrome|chrome-devtools-mcp/i);
    // Honest unavailable must not read as a pass.
    expect(r.managed.verdict).not.toBe("ready");
    expect(r.managed.actions.join(" ")).toMatch(/setup|install/i);
  });

  it("blocks managed when the transport binding is missing (never guesses at run time)", () => {
    const obs = healthy();
    obs.transportBinding = absent("devtools_server does not match a registered logical key");
    const r = deriveBrowserEnvironmentReadiness(obs);
    expect(r.managed.verdict).toBe("blocked");
    expect(r.managed.reason).toMatch(/transport|binding/i);
  });

  it("blocks interactive when owner Chrome remote debugging is not enabled (never auto-enables)", () => {
    const obs = healthy();
    obs.loopbackRemoteDebug = absent("owner Chrome remote debugging is not enabled");
    const r = deriveBrowserEnvironmentReadiness(obs);
    expect(r.interactive.verdict).toBe("blocked");
    expect(r.interactive.reason).toMatch(/remote debugging/i);
    // The interactive verdict must never instruct an auto-enable.
    expect(r.interactive.actions.join(" ")).not.toMatch(/roll .*enable.*remote/i);
  });

  it("degrades interactive when node/npx is missing before it can reach the endpoint", () => {
    const obs = healthy();
    obs.node = absent("Node is not on PATH");
    const r = deriveBrowserEnvironmentReadiness(obs);
    expect(r.interactive.verdict).toBe("degraded");
  });

  it("maps capture skip and degraded onto honest non-ready verdicts", () => {
    const skip = deriveBrowserEnvironmentReadiness({ ...healthy(), capture: { status: "skip", detail: "headless / CI" } });
    expect(skip.capture.verdict).toBe("degraded");
    const degraded = deriveBrowserEnvironmentReadiness({ ...healthy(), capture: { status: "degraded", detail: "permission denied" } });
    expect(degraded.capture.verdict).toBe("degraded");
    expect(degraded.capture.reason).toMatch(/permission denied/);
  });

  it("captures the flat observation list for the browser:environment-checked event", () => {
    const r = deriveBrowserEnvironmentReadiness(healthy());
    const ids = r.observations.map((o) => o.id).sort();
    expect(ids).toEqual(
      ["capture", "chrome", "devtools_mcp", "loopback_remote_debug", "node", "npx", "transport_binding"].sort(),
    );
  });
});
