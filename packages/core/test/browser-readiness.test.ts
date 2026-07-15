import { describe, expect, it } from "vitest";
import type { BrowserEnvironmentObservations } from "@roll/spec";
import {
  MANAGED_DEVTOOLS_PACKAGE,
  MANAGED_DEVTOOLS_PACKAGE_VERSION,
  deriveBrowserEnvironmentReadiness,
  applyManagedProbe,
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
  it("reports managed as configured (not ready) without a live probe; interactive and capture stay ready", () => {
    const r = deriveBrowserEnvironmentReadiness(healthy());
    // US-BROW-019: static config present but no probe → configured.
    expect(r.managed.verdict).toBe("configured");
    expect(r.interactive.verdict).toBe("ready");
    expect(r.capture.verdict).toBe("ready");
  });

  it("advances managed to ready when a live probe passes", () => {
    const r = deriveBrowserEnvironmentReadiness(healthy(), {
      kind: "passed",
      version: "1.5.0",
      tools: ["chrome_devtools_call", "navigate_page", "take_snapshot"],
    });
    expect(r.managed.verdict).toBe("ready");
    expect(r.probeResult?.kind).toBe("passed");
  });

  it("degrades managed when a live probe fails", () => {
    const r = deriveBrowserEnvironmentReadiness(healthy(), {
      kind: "failed",
      failures: [{ category: "mcp-spawn", message: "spawn failed: ENOENT" }],
    });
    expect(r.managed.verdict).toBe("degraded");
    expect(r.probeResult?.kind).toBe("failed");
  });

  it("applyManagedProbe advances configured → ready on passed probe", () => {
    const base = deriveBrowserEnvironmentReadiness(healthy()).managed;
    expect(base.verdict).toBe("configured");
    const probed = applyManagedProbe(base, {
      kind: "passed",
      version: "1.5.0",
      tools: ["chrome_devtools_call"],
    });
    expect(probed.verdict).toBe("ready");
    expect(probed.reason).toMatch(/real MCP lane verified/);
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
    expect(r.managed.verdict).not.toBe("configured");
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

  // FIX-1264 — interactive readiness must validate /json/version before claiming ready.
  it("degrades interactive when TCP port is open but /json/version check fails (not a DevTools endpoint)", () => {
    const obs = healthy();
    obs.loopbackRemoteDebug = { present: false, detail: "127.0.0.1:9222 reachable but /json/version check failed — not a DevTools endpoint", value: "127.0.0.1:9222", portReachable: true };
    const r = deriveBrowserEnvironmentReadiness(obs);
    expect(r.interactive.verdict).toBe("degraded");
    expect(r.interactive.reason).toMatch(/not a DevTools endpoint/i);
    // Must not suggest auto-enable — the port IS open.
    expect(r.interactive.actions.join(" ")).not.toMatch(/roll .*enable.*remote/i);
  });

  it("keeps interactive blocked when TCP port is not open at all (no portReachable)", () => {
    const obs = healthy();
    obs.loopbackRemoteDebug = absent("owner Chrome remote debugging is not enabled on 127.0.0.1:9222");
    const r = deriveBrowserEnvironmentReadiness(obs);
    expect(r.interactive.verdict).toBe("blocked");
    expect(r.interactive.reason).toMatch(/remote debugging/i);
  });

  it("keeps interactive ready when /json/version validates (portReachable absent or present+valid)", () => {
    const obs = healthy();
    obs.loopbackRemoteDebug = present("127.0.0.1:9222 reachable + DevTools validated (Chrome/131.0.0.0)", "127.0.0.1:9222");
    const r = deriveBrowserEnvironmentReadiness(obs);
    expect(r.interactive.verdict).toBe("ready");
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
