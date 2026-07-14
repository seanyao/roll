import { describe, expect, it } from "vitest";
import { BrowserOperationRunService } from "@roll/core";
import type { BrowserLanePolicy } from "@roll/spec";
import { ManagedChromeAdapter, createManagedFixtureDeps } from "../src/index.js";

const TARGET = "https://fake.target.test";

function managedPolicy(overrides: Partial<BrowserLanePolicy> = {}): BrowserLanePolicy {
  return {
    enabled: true,
    allowedOrigins: [TARGET],
    allowedActions: ["navigate", "snapshot", "console", "network", "screenshot"],
    maxRunsPerCycle: 5,
    timeoutMs: 5_000,
    ...overrides,
  };
}

function runService() {
  return BrowserOperationRunService.create({
    runId: "fixture-run",
    idempotencyKey: "fixture-key",
    caller: "builder",
    lane: "managed",
    requestedOrigin: TARGET,
    holderTokenHash: "hash",
    now: () => "2026-07-15T00:00:00.000Z",
  });
}

describe("US-BROW-004c managed fixture", () => {
  it("navigates a fake target to a passed run and always removes the temp profile", async () => {
    const { deps, recorder } = createManagedFixtureDeps({ targetUrl: TARGET });
    const adapter = new ManagedChromeAdapter(deps);

    const { service, result } = await adapter.execute({
      runService: runService(),
      lanePolicy: managedPolicy(),
      action: "navigate",
      payload: { url: TARGET },
      timeoutMs: 5_000,
    });

    expect(result.status).toBe("ok");
    expect(service.run.state).toBe("passed");
    expect(service.isProfileRemoved()).toBe(true);
    expect(recorder.launched).toBe(true);
    // The fake launcher used a fresh temp profile — never an owner profile.
    expect(recorder.profileDirs[0]).toContain("roll-managed-chrome-");
    expect(recorder.removedDirs).toHaveLength(1);
  });

  it("denies when the fake target redirects outside the allowlist", async () => {
    const { deps } = createManagedFixtureDeps({ targetUrl: TARGET, redirectTo: "https://evil.example" });
    const adapter = new ManagedChromeAdapter(deps);

    const { service, result } = await adapter.execute({
      runService: runService(),
      lanePolicy: managedPolicy(),
      action: "navigate",
      payload: { url: TARGET },
      timeoutMs: 5_000,
    });

    expect(result.status).toBe("denied");
    expect(service.run.state).toBe("denied");
    expect(service.isProfileRemoved()).toBe(true);
  });

  it.each([
    ["timeout", "timeout"],
    ["crash", "crash"],
    ["devtools-error", "devtools-error"],
  ] as const)("classifies an injected %s failure (never a pass)", async (failure, category) => {
    const { deps } = createManagedFixtureDeps({ targetUrl: TARGET, failure });
    const adapter = new ManagedChromeAdapter(deps);

    const { service } = await adapter.execute({
      runService: runService(),
      lanePolicy: managedPolicy(),
      action: "navigate",
      payload: { url: TARGET },
      timeoutMs: 30,
    });

    expect(service.run.state).toBe("failed");
    const terminal = service.terminalResult();
    expect(terminal?.kind).toBe("fail");
    if (terminal?.kind === "fail") {
      expect(terminal.failures[0]?.category).toBe(category);
    }
    // Failure path still cleans up the temp profile.
    expect(service.isProfileRemoved()).toBe(true);
  });

  it("captures a diagnostic-only screenshot artifact", async () => {
    const { deps } = createManagedFixtureDeps({ targetUrl: TARGET, screenshotBase64: "ZmFrZQ==" });
    const adapter = new ManagedChromeAdapter(deps);

    const { result } = await adapter.execute({
      runService: runService(),
      lanePolicy: managedPolicy(),
      action: "screenshot",
      payload: {},
      timeoutMs: 5_000,
    });

    expect(result.status).toBe("ok");
    expect(result.diagnosticRefs).toHaveLength(1);
    expect(result.diagnosticRefs[0]?.diagnosticOnly).toBe(true);
    expect(result.diagnosticRefs[0]?.untrusted).toBe(true);
  });
});
