import { describe, expect, it, vi } from "vitest";
import { browserCommand } from "../src/commands/browser.js";
import { renderManagedRunReport, runManagedFixtureOperation, type ManagedRunReport } from "../src/lib/managed-browser-run.js";

function capture() {
  let text = "";
  return { stdout: (s: string) => (text += s), read: () => text };
}

const noWriteDeps = () => ({
  configPath: () => "/tmp/should-not-write/browser-operations.yaml",
  writeFile: () => undefined,
  fileExists: () => false,
  isTTY: () => false,
  readApproval: async () => false,
  interactiveRun: async () => ({ kind: "denied" as const, ciPassed: false, reason: { code: "interactive_no_lease" as const, message: "no" } }),
  recordBrowserEvent: () => undefined,
});

// Helper to build fixture args
function fixtureArgs(extra: string[] = []): string[] {
  return ["run", "--fixture", ...extra];
}

describe("US-BROW-004c managed run — CLI → run service → adapter → terminal result", () => {
  it("runs a typed navigate action against a fake target and reports a passed diagnostic result", async () => {
    const report = await runManagedFixtureOperation({ action: "navigate", targetUrl: "https://fake.target.test" });
    expect(report.lane).toBe("managed");
    expect(report.runState).toBe("passed");
    expect(report.result).toBe("pass");
    expect(report.actionStatus).toBe("ok");
    expect(report.profileRemoved).toBe(true);
    expect(report.failures).toHaveLength(0);
  });

  it("passes through a redirect denial end-to-end", async () => {
    const report = await runManagedFixtureOperation({
      action: "navigate",
      targetUrl: "https://fake.target.test",
      redirectTo: "https://evil.example",
    });
    expect(report.runState).toBe("denied");
    expect(report.actionStatus).toBe("denied");
    expect(report.profileRemoved).toBe(true);
  });

  it.each([
    ["timeout", "timeout"],
    ["crash", "crash"],
    ["devtools-error", "devtools-error"],
  ] as const)("passes through an injected %s failure classification", async (failure, category) => {
    const report = await runManagedFixtureOperation({
      action: "navigate",
      targetUrl: "https://fake.target.test",
      failure,
    });
    expect(report.runState).toBe("failed");
    expect(report.result).toBe("fail");
    expect(report.failures[0]?.category).toBe(category);
  });

  it("renders an operator-observable result that never conflates diagnostics with visual acceptance", () => {
    const lines = renderManagedRunReport({
      lane: "managed",
      action: "screenshot",
      targetUrl: "https://fake.target.test",
      runState: "passed",
      result: "pass",
      actionStatus: "ok",
      profileRemoved: true,
      diagnosticArtifacts: 1,
      failures: [],
      summary: "diagnostic screenshot captured",
    });
    const text = lines.join("\n");
    expect(text).toContain("owner state never entered");
    expect(text).toContain("diagnostic-only, NOT visual acceptance");
    expect(text).toContain("Diagnostic success is not visual acceptance evidence.");
    expect(text).toContain("temp profile");
  });

  it("`roll browser run --fixture` prints the operator-observable result through the CLI surface", async () => {
    const c = capture();
    const code = await browserCommand(fixtureArgs(["--action", "navigate"]), { ...noWriteDeps(), stdout: c.stdout });
    expect(code).toBe(0);
    expect(c.read()).toContain("Managed browser operation");
    expect(c.read()).toContain("run state / 运行状态:   passed");
    expect(c.read()).toContain("Diagnostic success is not visual acceptance evidence.");
  });

  it("`roll browser run --fixture --json` emits the machine-readable report with a categorized failure", async () => {
    const c = capture();
    const code = await browserCommand(fixtureArgs(["--fail", "devtools-error", "--json"]), {
      ...noWriteDeps(),
      stdout: c.stdout,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(c.read()) as { runState: string; failures: { category: string }[] };
    expect(parsed.runState).toBe("failed");
    expect(parsed.failures[0]?.category).toBe("devtools-error");
  });

  it("rejects an unsupported action loud", async () => {
    const c = capture();
    const code = await browserCommand(fixtureArgs(["--action", "click"]), { ...noWriteDeps(), stdout: c.stdout });
    expect(code).toBe(1);
  });

  // ── US-BROW-012 performance diagnostic profile ────────────────────────────

  it("runManagedFixtureOperation collects a bounded, redacted performance summary", async () => {
    const report = await runManagedFixtureOperation({
      action: "navigate",
      targetUrl: "https://fake.target.test",
      performanceProfile: "web-vitals-lite",
    });
    expect(report.result).toBe("pass");
    expect(report.performanceProfile).toBe("web-vitals-lite");
    expect(report.performanceSummary?.degraded).toBe(false);
    const names = report.performanceSummary?.metrics.map((m) => m.name) ?? [];
    expect(names).toContain("LayoutDuration");
    expect(names).not.toContain("NavigationUrl");
    expect(JSON.stringify(report.performanceSummary)).not.toContain("http");
  });

  it("performance failure degrades gracefully — navigate still passes (AC4)", async () => {
    const report = await runManagedFixtureOperation({
      action: "navigate",
      targetUrl: "https://fake.target.test",
      performanceProfile: "web-vitals-lite",
      performanceFailure: true,
    });
    expect(report.result).toBe("pass");
    expect(report.performanceSummary?.degraded).toBe(true);
    expect(report.performanceSummary?.metrics).toEqual([]);
  });

  it("renders the performance summary as opt-in, diagnostic-only", () => {
    const lines = renderManagedRunReport({
      lane: "managed",
      action: "navigate",
      targetUrl: "https://fake.target.test",
      runState: "passed",
      result: "pass",
      actionStatus: "ok",
      profileRemoved: true,
      diagnosticArtifacts: 1,
      failures: [],
      summary: "navigated to fake target",
      performanceProfile: "web-vitals-lite",
      performanceSummary: { profile: "web-vitals-lite", metrics: [{ name: "LayoutDuration", value: 1.5 }], degraded: false },
    });
    const text = lines.join("\n");
    expect(text).toContain("perf profile / 性能诊断: web-vitals-lite");
    expect(text).toContain("opt-in, diagnostic-only");
    expect(text).toContain("LayoutDuration: 1.5");
  });
});

describe("US-BROW-018 — Real MCP lane CLI surface", () => {
  it("errors when --story is missing in production mode (no silent fallback, AC1)", async () => {
    const c = capture();
    const code = await browserCommand(["run", "--url", "https://example.com"], { ...noWriteDeps(), stdout: c.stdout });
    expect(code).toBe(1);
    const out = c.read();
    expect(out).toContain("requires --story");
    expect(out).toContain("--url");
    expect(out).not.toContain("Managed browser operation"); // no silent fixture fallback
  });

  it("errors when --url is missing in production mode", async () => {
    const c = capture();
    const code = await browserCommand(["run", "--story", "US-TEST-001"], { ...noWriteDeps(), stdout: c.stdout });
    expect(code).toBe(1);
    expect(c.read()).toContain("requires --story");
  });

  it("renders a denied report when policy is absent (default disabled)", async () => {
    const c = capture();
    const code = await browserCommand(["run", "--story", "US-TEST-001", "--url", "https://example.com", "--json"], {
      ...noWriteDeps(),
      stdout: c.stdout,
    });
    // Policy defaults to disabled, so the command exits 0 with a denied report.
    expect(code).toBe(0);
    const report = JSON.parse(c.read()) as ManagedRunReport;
    expect(report.result).toBe("denied");
    expect(report.runState).toBe("denied");
    expect(report.deniedReason).toBeTruthy();
    expect(report.actionStatus).toBe("denied");
    expect(report.diagnosticArtifacts).toBe(0);
    expect(report.isRealMcp).toBe(true);
  });

  it("renders denied output in human-readable form", async () => {
    const c = capture();
    const code = await browserCommand(["run", "--story", "US-TEST-001", "--url", "https://example.com"], {
      ...noWriteDeps(),
      stdout: c.stdout,
    });
    expect(code).toBe(0);
    const out = c.read();
    expect(out).toContain("real MCP");
    expect(out).toContain("denied");
    expect(out).toContain("Diagnostic success is not visual acceptance evidence.");
  });

  it("reports real MCP fields in the rendered output", () => {
    const lines = renderManagedRunReport({
      lane: "managed",
      action: "navigate",
      targetUrl: "https://example.com",
      runState: "passed",
      result: "pass",
      actionStatus: "ok",
      profileRemoved: true,
      diagnosticArtifacts: 2,
      failures: [],
      summary: "navigated to https://example.com",
      isRealMcp: true,
      mcpVersion: "0.9.0",
      transportInitialized: true,
      manifestVerified: true,
    });
    const text = lines.join("\n");
    expect(text).toContain("real MCP");
    expect(text).toContain("mcp package / MCP 包:  0.9.0");
    expect(text).toContain("transport initialized / 传输初始化:  yes");
    expect(text).toContain("manifest verified / 清单验证:  yes");
    expect(text).toContain("Diagnostic success is not visual acceptance evidence.");
  });

  it("distinguishes real MCP from fixture in the header", () => {
    const fixture = renderManagedRunReport({
      lane: "managed",
      action: "navigate",
      targetUrl: "https://example.com",
      runState: "passed",
      result: "pass",
      actionStatus: "ok",
      profileRemoved: true,
      diagnosticArtifacts: 1,
      failures: [],
      summary: "ok",
    });
    expect(fixture.join("\n")).toContain("fixture (fake target)");

    const real = renderManagedRunReport({
      lane: "managed",
      action: "navigate",
      targetUrl: "https://example.com",
      runState: "passed",
      result: "pass",
      actionStatus: "ok",
      profileRemoved: true,
      diagnosticArtifacts: 1,
      failures: [],
      summary: "ok",
      isRealMcp: true,
      mcpVersion: "0.9.0",
      transportInitialized: true,
      manifestVerified: true,
    });
    expect(real.join("\n")).toContain("real MCP");
  });
});
