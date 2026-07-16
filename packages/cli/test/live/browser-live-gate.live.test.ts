/**
 * US-BROW-020 — the declared live managed-lane regression gate.
 *
 * THIS FILE IS EXCLUDED FROM THE DEFAULT SUITE (`*.live.test.ts`, see
 * packages/cli/vitest.config.ts). It runs ONLY in the declared Chrome-capable
 * CI lane (`pnpm test:browser-live`) or when an operator invokes it directly.
 *
 * Honesty contract:
 *   - In a Chrome-capable, opted-in environment it starts a real
 *     chrome-devtools-mcp process + real Chrome against a hermetic local HTTP
 *     target, runs every managed-lane scenario, and asserts `verified`.
 *   - In a NON-capable environment it FAILS LOUD as an explicitly-unavailable
 *     environment gate. It never silently skips while implying the lane works.
 *
 * The printed summary is what a physical-terminal screenshot captures: real
 * transport verification + the diagnostic-only boundary (AC6).
 */
import { describe, expect, it } from "vitest";
import { renderLiveGateSummary } from "@roll/core";
import { detectLiveCapability, runLiveGate } from "../../src/lib/browser-live-gate.js";
import { runLiveSuite } from "./browser-live-suite.js";

describe("US-BROW-020 live managed-lane regression gate", () => {
  it("verifies the managed lane through real MCP + real Chrome (or fails loud when unavailable)", async () => {
    const env = detectLiveCapability();
    const result = await runLiveGate({ env, runSuite: runLiveSuite });

    // The summary is the operator/screenshot surface — always print it.
    // eslint-disable-next-line no-console
    console.log(["", ...renderLiveGateSummary(result)].join("\n"));

    if (result.verdict === "unavailable") {
      // Fail loud: this lane declares Chrome capability; an unavailable
      // environment here is a real gate failure, not a pass and not a skip.
      throw new Error(
        `Live gate UNAVAILABLE — missing: ${(result.missing ?? []).join(", ")}. ` +
          "This environment cannot host the real managed-lane suite; it is NOT verified.",
      );
    }

    expect(result.verdict).toBe("verified");
  }, 180_000);
});
