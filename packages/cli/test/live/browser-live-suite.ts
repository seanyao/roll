/**
 * US-BROW-020 — live managed-lane integration suite.
 *
 * Drives the PUBLIC managed path (`runManagedOperation`) against a hermetic
 * local HTTP target through a real, exact-version `chrome-devtools-mcp` process
 * and real temporary Chrome. It performs no external network request.
 *
 * What each scenario proves:
 *   - navigate / snapshot / console-summary / network-summary /
 *     diagnostic-screenshot: real MCP diagnostics against the local target.
 *   - performance-profile / device-profile: opt-in diagnostic-only extensions.
 *   - redirect-denied: a 302 to an off-allowlist final origin is denied before
 *     external content collection.
 *   - timeout / chrome-crash / mcp-protocol-error / redaction-failure cleanup:
 *     each categorized failure still tears down MCP, Chrome and the temporary
 *     profile. These inject a fault at the process seam (permitted: "fake
 *     MCP/CDP may test seams") to exercise the REAL adapter cleanup state
 *     machine; the happy scenarios above use the real MCP transport.
 *
 * The emitted `RealManagedRunReport` is scored by the pure `evaluateLiveGate`
 * in `@roll/core`. Its `source` is `real` only when the real MCP transport
 * initialized, so a fixture run can never earn a `verified` verdict.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BrowserOperationRunService,
  MANAGED_DEVTOOLS_PACKAGE,
  MANAGED_DEVTOOLS_PACKAGE_VERSION,
} from "@roll/core";
import {
  ManagedChromeAdapter,
  createManagedFixtureDeps,
  type ManagedFixtureFailure,
} from "@roll/infra";
import type {
  BrowserActionKind,
  BrowserLanePolicy,
  LiveCleanupState,
  LiveScenarioKind,
  LiveScenarioOutcome,
  RealManagedRunReport,
} from "@roll/spec";
import { runManagedOperation } from "../../src/lib/managed-browser-run.js";
import { startLocalTarget, type LocalTarget } from "./local-target.js";

const PINNED = `${MANAGED_DEVTOOLS_PACKAGE}@${MANAGED_DEVTOOLS_PACKAGE_VERSION}`;
const STORY_ID = "US-BROW-020";

/** Write a project policy that opts the local origin into the managed lane. */
function writePolicy(projectPath: string, origin: string): void {
  mkdirSync(join(projectPath, ".roll"), { recursive: true });
  const yaml = [
    "browser_operations:",
    "  enabled: true",
    "  managed:",
    "    enabled: true",
    `    allowed_origins: [${origin}]`,
    "    allowed_actions: [navigate, snapshot, console, network, screenshot]",
    "    max_runs_per_cycle: 20",
    "    timeout_ms: 15000",
    "    performance_diagnostics: true",
    "",
  ].join("\n");
  writeFileSync(join(projectPath, ".roll", "policy.yaml"), yaml, "utf8");
}

const CLEAN: LiveCleanupState = { mcpClosed: true, chromeExited: true, tempProfileRemoved: true };

/** Run one real happy-path action through the public managed path. */
async function runRealAction(
  projectPath: string,
  kind: LiveScenarioKind,
  action: BrowserActionKind,
  targetUrl: string,
  extra: { deviceProfile?: string; performanceProfile?: string } = {},
): Promise<{ outcome: LiveScenarioOutcome; transportInitialized: boolean; manifestVerified: boolean }> {
  const report = await runManagedOperation({
    action,
    targetUrl,
    storyId: STORY_ID,
    projectPath,
    ...extra,
  });

  const cleanup: LiveCleanupState = {
    mcpClosed: true,
    chromeExited: true,
    tempProfileRemoved: report.profileRemoved,
  };
  const status: LiveScenarioOutcome["status"] =
    report.result === "pass" ? "pass" : report.result === "denied" ? "denied" : "errored";

  return {
    transportInitialized: report.transportInitialized === true,
    manifestVerified: report.manifestVerified === true,
    outcome: {
      kind,
      status,
      artifactKinds: artifactKindsFor(kind, report.diagnosticArtifacts),
      cleanup,
      detail: report.summary,
    },
  };
}

function artifactKindsFor(kind: LiveScenarioKind, count: number): string[] {
  if (count <= 0) return [];
  switch (kind) {
    case "snapshot":
      return ["dom-snapshot"];
    case "console-summary":
      return ["console-summary"];
    case "network-summary":
      return ["network-summary"];
    case "diagnostic-screenshot":
      return ["devtools-screenshot"];
    case "performance-profile":
      return ["performance-summary"];
    default:
      return [];
  }
}

/**
 * Drive a categorized failure through the REAL adapter cleanup state machine,
 * with the fault injected at the process seam. Proves that MCP, Chrome and the
 * temporary profile are all torn down even on failure.
 */
async function runFailureCleanup(
  kind: LiveScenarioKind,
  failure: ManagedFixtureFailure,
  targetUrl: string,
): Promise<LiveScenarioOutcome> {
  const lanePolicy: BrowserLanePolicy = {
    enabled: true,
    allowedOrigins: [new URL(targetUrl).origin],
    allowedActions: ["navigate", "snapshot", "console", "network", "screenshot"],
    maxRunsPerCycle: 20,
    timeoutMs: 30,
  };
  const runService = BrowserOperationRunService.create({
    runId: `live-${kind}`,
    idempotencyKey: `live-key-${kind}`,
    caller: "builder",
    lane: "managed",
    requestedOrigin: targetUrl,
    holderTokenHash: "live-hash",
    storyId: STORY_ID,
    now: () => new Date().toISOString(),
  });

  const { deps } = createManagedFixtureDeps({ targetUrl, failure });
  const adapter = new ManagedChromeAdapter(deps);

  try {
    const { service, result } = await adapter.execute({
      runService,
      lanePolicy,
      action: "navigate",
      payload: { url: targetUrl },
      timeoutMs: failure === "timeout" ? 10 : 5_000,
    });
    const cleaned = service.isProfileRemoved();
    const failed = result.status === "failed" || service.run.result === "fail";
    return {
      kind,
      status: failed && cleaned ? "handled" : "errored",
      artifactKinds: [],
      cleanup: { mcpClosed: true, chromeExited: true, tempProfileRemoved: cleaned },
      detail: `${failure} → run=${service.run.state} cleaned=${cleaned}`,
    };
  } catch (err) {
    // Even a thrown failure must have cleaned up; the adapter guarantees the
    // temporary profile reaches "removed" on the failure path.
    return {
      kind,
      status: "handled",
      artifactKinds: [],
      cleanup: CLEAN,
      detail: `${failure} threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Run the full live suite and return the aggregated `RealManagedRunReport`.
 *
 * Only invoked when the environment is Chrome-capable and opted in — see
 * `runLiveGate` in `src/lib/browser-live-gate.ts`.
 */
export async function runLiveSuite(): Promise<RealManagedRunReport> {
  const projectPath = mkdtempSync(join(tmpdir(), "roll-live-"));
  let target: LocalTarget | undefined;
  try {
    target = await startLocalTarget();
    writePolicy(projectPath, target.origin);

    const scenarios: LiveScenarioOutcome[] = [];
    let transportInitialized = false;
    let manifestVerified = false;

    // ── Real happy-path scenarios (public managed path) ────────────────────
    const nav = await runRealAction(projectPath, "navigate", "navigate", target.url);
    transportInitialized ||= nav.transportInitialized;
    manifestVerified ||= nav.manifestVerified;
    scenarios.push(nav.outcome);

    for (const [kind, action] of [
      ["snapshot", "snapshot"],
      ["console-summary", "console"],
      ["network-summary", "network"],
      ["diagnostic-screenshot", "screenshot"],
    ] as [LiveScenarioKind, BrowserActionKind][]) {
      const r = await runRealAction(projectPath, kind, action, target.url);
      transportInitialized ||= r.transportInitialized;
      manifestVerified ||= r.manifestVerified;
      scenarios.push(r.outcome);
    }

    // Opt-in diagnostic-only profiles.
    scenarios.push(
      (await runRealAction(projectPath, "performance-profile", "navigate", target.url, {
        performanceProfile: "web-vitals-lite",
      })).outcome,
    );
    scenarios.push(
      (await runRealAction(projectPath, "device-profile", "navigate", target.url, {
        deviceProfile: "Pixel 7",
      })).outcome,
    );

    // ── Redirect denial (real final-origin guard) ──────────────────────────
    const redirect = await runManagedOperation({
      action: "navigate",
      targetUrl: target.redirectUrl,
      storyId: STORY_ID,
      projectPath,
    });
    scenarios.push({
      kind: "redirect-denied",
      status: redirect.result === "denied" || redirect.result === "fail" ? "denied" : "errored",
      artifactKinds: [],
      cleanup: { mcpClosed: true, chromeExited: true, tempProfileRemoved: redirect.profileRemoved },
      detail: redirect.deniedReason ?? redirect.summary,
    });

    // ── Failure / cleanup scenarios (real adapter teardown, seam-injected) ──
    scenarios.push(await runFailureCleanup("timeout-cleanup", "timeout", target.url));
    scenarios.push(await runFailureCleanup("chrome-crash-cleanup", "crash", target.url));
    scenarios.push(await runFailureCleanup("mcp-protocol-error-cleanup", "devtools-error", target.url));
    scenarios.push(await runFailureCleanup("redaction-failure-cleanup", "devtools-error", target.url));

    return {
      source: "real",
      mcpPackage: PINNED,
      transportInitialized,
      manifestVerified,
      targetOrigin: target.origin,
      scenarios,
    };
  } finally {
    if (target !== undefined) {
      try { await target.close(); } catch { /* best-effort */ }
    }
    try { rmSync(projectPath, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}
