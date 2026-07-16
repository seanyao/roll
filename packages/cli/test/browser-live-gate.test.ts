/**
 * US-BROW-020 — hermetic tests for the live managed-lane gate.
 *
 * These run inside the DEFAULT `roll test` suite (no Chrome, no MCP). They
 * cover the pure evaluator invariants, the capability seam, the local target's
 * hermeticity, and the fail-loud renderer. The real Chrome+MCP execution is the
 * separate `*.live.test.ts` gate, run only in the declared CI lane.
 */
import { describe, expect, it } from "vitest";
import {
  REQUIRED_LIVE_SCENARIOS,
  evaluateLiveGate,
  isLiveEnvironmentCapable,
  renderLiveGateSummary,
} from "@roll/core";
import type {
  LiveGateEnvironment,
  LiveScenarioOutcome,
  RealManagedRunReport,
} from "@roll/spec";
import { detectLiveCapability, runLiveGate } from "../src/lib/browser-live-gate.js";
import { startLocalTarget } from "./live/local-target.js";

const CLEAN = { mcpClosed: true, chromeExited: true, tempProfileRemoved: true } as const;

function capableEnv(): LiveGateEnvironment {
  return { chromePresent: true, npxPresent: true, liveOptIn: true, missing: [] };
}

function scenario(kind: string, over: Partial<LiveScenarioOutcome> = {}): LiveScenarioOutcome {
  return {
    kind: kind as LiveScenarioOutcome["kind"],
    status: "pass",
    artifactKinds: [],
    cleanup: { ...CLEAN },
    ...over,
  };
}

function realReport(over: Partial<RealManagedRunReport> = {}): RealManagedRunReport {
  return {
    source: "real",
    mcpPackage: "chrome-devtools-mcp@1.5.0",
    transportInitialized: true,
    manifestVerified: true,
    targetOrigin: "http://127.0.0.1:52001",
    scenarios: REQUIRED_LIVE_SCENARIOS.map((k) =>
      scenario(k, { status: k === "redirect-denied" ? "denied" : k.endsWith("cleanup") ? "handled" : "pass" }),
    ),
    ...over,
  };
}

describe("US-BROW-020 evaluateLiveGate — honesty invariants", () => {
  it("returns 'unavailable' (never verified) when the environment is not capable", () => {
    const env: LiveGateEnvironment = {
      chromePresent: false,
      npxPresent: true,
      liveOptIn: false,
      missing: ["chrome-binary", "live-opt-in (set ROLL_BROWSER_LIVE=1)"],
    };
    // Even if a (impossibly) perfect report is supplied, an incapable env cannot verify.
    const result = evaluateLiveGate({ env, report: realReport() });
    expect(result.verdict).toBe("unavailable");
    expect(result.missing).toContain("chrome-binary");
    expect(result.reason).toMatch(/does not verify/i);
  });

  it("refuses to verify a fixture-sourced report even with a perfect shape", () => {
    const result = evaluateLiveGate({ env: capableEnv(), report: realReport({ source: "fixture" }) });
    expect(result.verdict).toBe("failed");
    expect(result.violations).toContain("non-real-source:fixture");
  });

  it("fails when transport did not initialize or manifest was not verified", () => {
    const result = evaluateLiveGate({
      env: capableEnv(),
      report: realReport({ transportInitialized: false, manifestVerified: false }),
    });
    expect(result.verdict).toBe("failed");
    expect(result.violations).toContain("transport-not-initialized");
    expect(result.violations).toContain("manifest-not-verified");
  });

  it("fails when a required scenario is missing", () => {
    const result = evaluateLiveGate({
      env: capableEnv(),
      report: realReport({ scenarios: [scenario("navigate")] }),
    });
    expect(result.verdict).toBe("failed");
    expect(result.violations?.some((v) => v.startsWith("missing-scenario:"))).toBe(true);
  });

  it("fails when any scenario leaked a resource (no full cleanup)", () => {
    const leaky = realReport();
    const scenarios = leaky.scenarios.map((s, i) =>
      i === 0 ? { ...s, cleanup: { ...CLEAN, tempProfileRemoved: false } } : s,
    );
    const result = evaluateLiveGate({ env: capableEnv(), report: { ...leaky, scenarios } });
    expect(result.verdict).toBe("failed");
    expect(result.violations?.some((v) => v.startsWith("scenario-not-cleaned:"))).toBe(true);
  });

  it("fails when a scenario errored", () => {
    const report = realReport();
    const scenarios = report.scenarios.map((s, i) => (i === 0 ? { ...s, status: "errored" as const } : s));
    const result = evaluateLiveGate({ env: capableEnv(), report: { ...report, scenarios } });
    expect(result.verdict).toBe("failed");
    expect(result.violations?.some((v) => v.startsWith("scenario-errored:"))).toBe(true);
  });

  it("verifies a real, complete, fully-cleaned report", () => {
    const result = evaluateLiveGate({ env: capableEnv(), report: realReport() });
    expect(result.verdict).toBe("verified");
    expect(result.reason).toMatch(/transport initialized/i);
  });

  it("fails when the environment is capable but no report was produced", () => {
    const result = evaluateLiveGate({ env: capableEnv() });
    expect(result.verdict).toBe("failed");
    expect(result.violations).toContain("no-report");
  });
});

describe("US-BROW-020 detectLiveCapability", () => {
  it("is capable only when chrome + npx + opt-in are all present", () => {
    const env = detectLiveCapability({
      env: { ROLL_BROWSER_LIVE: "1" },
      platform: "linux",
      onPath: (b) => b === "npx" || b === "google-chrome",
      pathExists: () => false,
    });
    expect(isLiveEnvironmentCapable(env)).toBe(true);
    expect(env.missing).toEqual([]);
  });

  it("reports every missing capability without opt-in / chrome", () => {
    const env = detectLiveCapability({
      env: {},
      platform: "linux",
      onPath: (b) => b === "npx",
      pathExists: () => false,
    });
    expect(env.chromePresent).toBe(false);
    expect(env.liveOptIn).toBe(false);
    expect(env.missing).toContain("chrome-binary");
    expect(env.missing).toContain("live-opt-in (set ROLL_BROWSER_LIVE=1)");
    expect(isLiveEnvironmentCapable(env)).toBe(false);
  });

  it("detects macOS Chrome.app via pathExists", () => {
    const env = detectLiveCapability({
      env: { ROLL_BROWSER_LIVE: "true" },
      platform: "darwin",
      onPath: (b) => b === "npx",
      pathExists: (p) => p === "/Applications/Google Chrome.app",
    });
    expect(env.chromePresent).toBe(true);
    expect(env.liveOptIn).toBe(true);
  });
});

describe("US-BROW-020 runLiveGate", () => {
  it("does NOT run the suite when the environment is unavailable", async () => {
    let ran = false;
    const env: LiveGateEnvironment = {
      chromePresent: false,
      npxPresent: true,
      liveOptIn: false,
      missing: ["chrome-binary", "live-opt-in (set ROLL_BROWSER_LIVE=1)"],
    };
    const result = await runLiveGate({
      env,
      runSuite: async () => {
        ran = true;
        return realReport();
      },
    });
    expect(ran).toBe(false);
    expect(result.verdict).toBe("unavailable");
  });

  it("runs the suite and scores it when capable", async () => {
    const result = await runLiveGate({ env: capableEnv(), runSuite: async () => realReport() });
    expect(result.verdict).toBe("verified");
  });
});

describe("US-BROW-020 hermetic local target", () => {
  it("serves the page + subresource on loopback and records requests, no external host", async () => {
    const target = await startLocalTarget();
    try {
      expect(target.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      const page = await fetch(target.url);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("roll-live-target");

      const data = await fetch(`${target.origin}/data.json`);
      expect(await data.json()).toEqual({ ok: true });

      // The redirect points at an off-allowlist origin and does NOT auto-follow.
      const redirect = await fetch(target.redirectUrl, { redirect: "manual" });
      expect(redirect.status).toBe(302);
      expect(redirect.headers.get("location")).toBe(`${target.offAllowlistOrigin}/`);
      expect(target.offAllowlistOrigin).not.toContain(target.origin);

      expect(target.requests).toContain("/");
      expect(target.requests).toContain("/data.json");
      expect(target.requests).toContain("/redirect");
    } finally {
      await target.close();
    }
  });
});

describe("US-BROW-020 renderLiveGateSummary", () => {
  it("loudly states the lane is NOT verified when unavailable", () => {
    const out = renderLiveGateSummary(
      evaluateLiveGate({
        env: { chromePresent: false, npxPresent: false, liveOptIn: false, missing: ["chrome-binary", "npx"] },
      }),
    ).join("\n");
    expect(out).toMatch(/UNAVAILABLE/);
    expect(out).toMatch(/NOT a pass/i);
    expect(out).toMatch(/chrome-binary/);
  });

  it("shows transport verification and the diagnostic-only boundary when verified", () => {
    const out = renderLiveGateSummary(evaluateLiveGate({ env: capableEnv(), report: realReport() })).join("\n");
    expect(out).toMatch(/transport initialized/i);
    expect(out).toMatch(/manifest verified/i);
    expect(out).toMatch(/VERIFIED/);
    expect(out).toMatch(/not visual acceptance evidence/i);
  });
});
