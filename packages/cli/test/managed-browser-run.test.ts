import { describe, expect, it } from "vitest";
import { browserCommand } from "../src/commands/browser.js";
import { renderManagedRunReport, runManagedFixtureOperation } from "../src/lib/managed-browser-run.js";

function capture() {
  let text = "";
  return { stdout: (s: string) => (text += s), read: () => text };
}

const noWriteDeps = () => ({
  configPath: () => "/tmp/should-not-write/browser-operations.yaml",
  writeFile: () => undefined,
  fileExists: () => false,
});

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

  it("`roll browser run` prints the operator-observable result through the CLI surface", async () => {
    const c = capture();
    const code = await browserCommand(["run", "--action", "navigate"], { ...noWriteDeps(), stdout: c.stdout });
    expect(code).toBe(0);
    expect(c.read()).toContain("Managed browser operation");
    expect(c.read()).toContain("run state / 运行状态:   passed");
    expect(c.read()).toContain("Diagnostic success is not visual acceptance evidence.");
  });

  it("`roll browser run --json` emits the machine-readable report with a categorized failure", async () => {
    const c = capture();
    const code = await browserCommand(["run", "--fail", "devtools-error", "--json"], {
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
    const code = await browserCommand(["run", "--action", "click"], { ...noWriteDeps(), stdout: c.stdout });
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
    // No URL/trace anywhere in the summary (AC3 data minimization).
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
