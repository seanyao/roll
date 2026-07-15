import { describe, expect, it } from "vitest";
import {
  probeBrowserEnvironment,
  proposedBrowserOperationsConfig,
  type BrowserEnvironmentProbeDeps,
  type DevtoolsVersionResult,
} from "../src/browser-operations/environment-probe.js";

function deps(env: NodeJS.ProcessEnv): BrowserEnvironmentProbeDeps {
  return {
    env,
    platform: "darwin",
    onPath: () => null,
    pathExists: () => false,
    version: () => null,
    tcpReachable: () => {
      throw new Error("probe must not open a real socket in this test");
    },
    devtoolsVersionCheck: () => {
      throw new Error("probe must not call /json/version in this test");
    },
  };
}

describe("US-BROW-003 probeBrowserEnvironment", () => {
  it("reports a fully-degraded environment when nothing is present and no override lies", () => {
    const obs = probeBrowserEnvironment(
      { status: "skip", detail: "headless / CI" },
      { ...deps({ CI: "1" }), tcpReachable: () => false },
    );
    expect(obs.node.present).toBe(false);
    expect(obs.chrome.present).toBe(false);
    expect(obs.devtoolsPackage.present).toBe(false);
    expect(obs.loopbackRemoteDebug.present).toBe(false);
    // Binding is assumed present until the registry proves a mismatch.
    expect(obs.transportBinding.present).toBe(true);
  });

  it("honors env overrides so difftests can fabricate deterministic fixtures", () => {
    const obs = probeBrowserEnvironment(
      { status: "available", detail: "Roll Capture ready" },
      deps({
        _ROLL_BROWSER_NODE: "present:v20.11.0",
        _ROLL_BROWSER_NPX: "present",
        _ROLL_BROWSER_CHROME: "present:/Applications/Google Chrome.app",
        _ROLL_BROWSER_MCP: "present",
        _ROLL_BROWSER_REMOTE_DEBUG: "on",
        _ROLL_BROWSER_TRANSPORT_BINDING: "present",
      }),
    );
    expect(obs.node.present).toBe(true);
    expect(obs.node.value).toBe("v20.11.0");
    expect(obs.chrome.value).toBe("/Applications/Google Chrome.app");
    expect(obs.loopbackRemoteDebug.present).toBe(true);
    expect(obs.transportBinding.present).toBe(true);
  });

  it("can fabricate a deliberately-degraded managed fixture (chrome + mcp missing)", () => {
    const obs = probeBrowserEnvironment(
      { status: "degraded", detail: "permission denied" },
      deps({
        _ROLL_BROWSER_NODE: "present",
        _ROLL_BROWSER_NPX: "present",
        _ROLL_BROWSER_CHROME: "missing",
        _ROLL_BROWSER_MCP: "missing",
        _ROLL_BROWSER_REMOTE_DEBUG: "off",
      }),
    );
    expect(obs.chrome.present).toBe(false);
    expect(obs.devtoolsPackage.present).toBe(false);
    expect(obs.loopbackRemoteDebug.present).toBe(false);
  });

  it("can fabricate a blocked transport binding fixture", () => {
    const obs = probeBrowserEnvironment(
      { status: "available", detail: "ready" },
      deps({ _ROLL_BROWSER_TRANSPORT_BINDING: "missing", _ROLL_BROWSER_REMOTE_DEBUG: "off" }),
    );
    expect(obs.transportBinding.present).toBe(false);
  });

  it("proposes a pinned machine config (no @latest, loopback-only remote debugging)", () => {
    const yaml = proposedBrowserOperationsConfig();
    expect(yaml).toContain("chrome-devtools-mcp@1.5.0");
    expect(yaml).not.toContain("@latest");
    expect(yaml).toContain('host: "127.0.0.1"');
    expect(yaml).toContain("--no-usage-statistics");
  });

  // FIX-1264 — interactive readiness must validate /json/version.
  function versionDeps(
    env: NodeJS.ProcessEnv,
    versionResult: DevtoolsVersionResult | null,
    tcpOk: boolean,
  ): BrowserEnvironmentProbeDeps {
    return {
      ...deps(env),
      tcpReachable: () => tcpOk,
      devtoolsVersionCheck: () => versionResult,
    };
  }

  it("reports interactive ready when /json/version validates (TCP open + Browser field present)", () => {
    const obs = probeBrowserEnvironment(
      { status: "skip", detail: "CI" },
      versionDeps(
        { _ROLL_BROWSER_NODE: "present", _ROLL_BROWSER_NPX: "present", _ROLL_BROWSER_CHROME: "present" },
        { valid: true, browser: "Chrome/131.0.0.0" },
        true,
      ),
    );
    expect(obs.loopbackRemoteDebug.present).toBe(true);
    expect(obs.loopbackRemoteDebug.detail).toMatch(/DevTools validated/);
  });

  it("reports interactive degraded when port is open but /json/version fails (not a DevTools endpoint)", () => {
    const obs = probeBrowserEnvironment(
      { status: "skip", detail: "CI" },
      versionDeps(
        { _ROLL_BROWSER_NODE: "present", _ROLL_BROWSER_NPX: "present", _ROLL_BROWSER_CHROME: "present" },
        { valid: false },
        true,
      ),
    );
    expect(obs.loopbackRemoteDebug.present).toBe(false);
    expect(obs.loopbackRemoteDebug.portReachable).toBe(true);
    expect(obs.loopbackRemoteDebug.detail).toMatch(/not a DevTools endpoint/);
  });

  it("reports interactive degraded when /json/version check is unavailable (CI / no curl)", () => {
    const obs = probeBrowserEnvironment(
      { status: "skip", detail: "CI" },
      versionDeps(
        { _ROLL_BROWSER_NODE: "present", _ROLL_BROWSER_NPX: "present", _ROLL_BROWSER_CHROME: "present" },
        null,
        true,
      ),
    );
    expect(obs.loopbackRemoteDebug.present).toBe(false);
    expect(obs.loopbackRemoteDebug.portReachable).toBe(true);
    expect(obs.loopbackRemoteDebug.detail).toMatch(/check unavailable/);
  });

  it("reports interactive blocked when port is not open", () => {
    const obs = probeBrowserEnvironment(
      { status: "skip", detail: "CI" },
      versionDeps(
        { _ROLL_BROWSER_NODE: "present", _ROLL_BROWSER_NPX: "present", _ROLL_BROWSER_CHROME: "present" },
        { valid: true, browser: "Chrome/131.0.0.0" },
        false,
      ),
    );
    expect(obs.loopbackRemoteDebug.present).toBe(false);
    expect(obs.loopbackRemoteDebug.portReachable).toBeUndefined();
  });

  it("honors _ROLL_BROWSER_DEVTOOLS_VERSION override (valid → present: true; invalid → present: false + portReachable)", () => {
    const valid = probeBrowserEnvironment(
      { status: "skip", detail: "CI" },
      deps({
        _ROLL_BROWSER_NODE: "present",
        _ROLL_BROWSER_NPX: "present",
        _ROLL_BROWSER_CHROME: "present",
        _ROLL_BROWSER_REMOTE_DEBUG: "on",
        _ROLL_BROWSER_DEVTOOLS_VERSION: "valid",
      }),
    );
    expect(valid.loopbackRemoteDebug.present).toBe(true);
    expect(valid.loopbackRemoteDebug.detail).toMatch(/DevTools validated \(override\)/);

    const invalid = probeBrowserEnvironment(
      { status: "skip", detail: "CI" },
      deps({
        _ROLL_BROWSER_NODE: "present",
        _ROLL_BROWSER_NPX: "present",
        _ROLL_BROWSER_CHROME: "present",
        _ROLL_BROWSER_REMOTE_DEBUG: "on",
        _ROLL_BROWSER_DEVTOOLS_VERSION: "invalid",
      }),
    );
    expect(invalid.loopbackRemoteDebug.present).toBe(false);
    expect(invalid.loopbackRemoteDebug.portReachable).toBe(true);
    expect(invalid.loopbackRemoteDebug.detail).toMatch(/not a DevTools endpoint \(override\)/);
  });
});
