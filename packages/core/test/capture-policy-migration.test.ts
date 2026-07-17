/**
 * US-EVID-032 — CapturePolicyMigration (AC1) + scorer_focus.
 *
 * The migration must be opt-in / capability-aware / idempotent / reversible and
 * must NEVER force-flip an existing project to best_effort. When either the v2
 * gateway or the renderer is unavailable it retains the recorded policy with an
 * explicit reason code (`provider_v2_unavailable` / `renderer_unavailable`),
 * never a guessed fallback.
 */
import { describe, expect, it } from "vitest";
import {
  BEST_EFFORT_CAPTURE_MODE,
  planCapturePolicyMigration,
  readCaptureMode,
  revertCapturePolicyMigration,
  type CaptureMigrationCapabilities,
} from "../src/attest/capture-policy-migration.js";

const READY: CaptureMigrationCapabilities = {
  gateway: { available: true },
  renderer: { available: true },
};

const LIVE_POLICY = [
  "loop_safety:",
  "  attest_gate: hard",
  "  prebuild_dist: true",
  "acceptance:",
  "  # a preserved comment",
  "  screenshot_exempt_epics: [feedback-truth-alignment]",
  "",
].join("\n");

describe("planCapturePolicyMigration — capability gate (AC1)", () => {
  it("enables best_effort ONLY when both gateway and renderer are ready", () => {
    const plan = planCapturePolicyMigration({ policyYaml: LIVE_POLICY, capabilities: READY });
    expect(plan.action).toBe("enabled");
    expect(plan.reasonCode).toBe("gateway-and-renderer-ready");
    expect(plan.changed).toBe(true);
    expect(readCaptureMode(plan.nextYaml)).toBe(BEST_EFFORT_CAPTURE_MODE);
    // Unrelated content is preserved verbatim.
    expect(plan.nextYaml).toContain("attest_gate: hard");
    expect(plan.nextYaml).toContain("# a preserved comment");
    expect(plan.nextYaml).toContain("screenshot_exempt_epics: [feedback-truth-alignment]");
  });

  it("retains existing policy with provider_v2_unavailable when the gateway is down (scorer_focus)", () => {
    const caps: CaptureMigrationCapabilities = {
      gateway: { available: false, reason: "host does not advertise roll.capture.v2" },
      renderer: { available: true },
    };
    const plan = planCapturePolicyMigration({ policyYaml: LIVE_POLICY, capabilities: caps });
    expect(plan.action).toBe("retained");
    expect(plan.reasonCode).toBe("provider_v2_unavailable");
    expect(plan.changed).toBe(false);
    expect(plan.nextYaml).toBe(LIVE_POLICY); // never a guessed fallback
    expect(readCaptureMode(plan.nextYaml)).toBeNull();
  });

  it("retains existing policy with renderer_unavailable when only the renderer is down", () => {
    const caps: CaptureMigrationCapabilities = {
      gateway: { available: true },
      renderer: { available: false, reason: "Playwright Chromium is not installed" },
    };
    const plan = planCapturePolicyMigration({ policyYaml: LIVE_POLICY, capabilities: caps });
    expect(plan.action).toBe("retained");
    expect(plan.reasonCode).toBe("renderer_unavailable");
    expect(plan.changed).toBe(false);
    expect(plan.nextYaml).toBe(LIVE_POLICY);
  });

  it("does NOT force-flip an existing non-best_effort project when capability is unavailable (scorer_focus)", () => {
    const legacy = "acceptance:\n  capture:\n    mode: legacy\n";
    const caps: CaptureMigrationCapabilities = { gateway: { available: false }, renderer: { available: true } };
    const plan = planCapturePolicyMigration({ policyYaml: legacy, capabilities: caps });
    expect(plan.action).toBe("retained");
    expect(readCaptureMode(plan.nextYaml)).toBe("legacy"); // retained, not flipped
    expect(plan.nextYaml).toBe(legacy);
  });
});

describe("planCapturePolicyMigration — idempotency (AC1)", () => {
  it("is a no-op on a project already on best_effort", () => {
    const first = planCapturePolicyMigration({ policyYaml: LIVE_POLICY, capabilities: READY });
    const second = planCapturePolicyMigration({ policyYaml: first.nextYaml, capabilities: READY });
    expect(second.action).toBe("already-best-effort");
    expect(second.changed).toBe(false);
    expect(second.nextYaml).toBe(first.nextYaml);
  });

  it("re-running enable yields byte-identical output (deterministic)", () => {
    const a = planCapturePolicyMigration({ policyYaml: LIVE_POLICY, capabilities: READY }).nextYaml;
    const b = planCapturePolicyMigration({ policyYaml: LIVE_POLICY, capabilities: READY }).nextYaml;
    expect(a).toBe(b);
  });
});

describe("revertCapturePolicyMigration — reversibility (AC1)", () => {
  it("migrate then revert restores the original policy byte-for-byte (no prior mode)", () => {
    const enabled = planCapturePolicyMigration({ policyYaml: LIVE_POLICY, capabilities: READY });
    const reverted = revertCapturePolicyMigration(enabled.nextYaml);
    expect(reverted.reverted).toBe(true);
    expect(reverted.restoredMode).toBeNull();
    expect(reverted.nextYaml).toBe(LIVE_POLICY);
  });

  it("restores a prior recorded mode when one existed", () => {
    const prior = "acceptance:\n  capture:\n    mode: standard\n    sources: [roll_capture_window]\n";
    const enabled = planCapturePolicyMigration({ policyYaml: prior, capabilities: READY });
    expect(readCaptureMode(enabled.nextYaml)).toBe(BEST_EFFORT_CAPTURE_MODE);
    // A sibling capture key must be preserved through the migration.
    expect(enabled.nextYaml).toContain("sources: [roll_capture_window]");
    const reverted = revertCapturePolicyMigration(enabled.nextYaml);
    expect(reverted.reverted).toBe(true);
    expect(reverted.restoredMode).toBe("standard");
    expect(readCaptureMode(reverted.nextYaml)).toBe("standard");
    expect(reverted.nextYaml).toContain("sources: [roll_capture_window]");
    expect(reverted.nextYaml).not.toContain("migrated_from");
  });

  it("is a no-op when there is no migration marker to reverse", () => {
    const reverted = revertCapturePolicyMigration(LIVE_POLICY);
    expect(reverted.reverted).toBe(false);
    expect(reverted.changed).toBe(false);
    expect(reverted.nextYaml).toBe(LIVE_POLICY);
  });
});

describe("fresh project with no acceptance block", () => {
  it("appends a well-formed acceptance.capture block and is reversible", () => {
    const yaml = "loop_safety:\n  attest_gate: hard\n";
    const enabled = planCapturePolicyMigration({ policyYaml: yaml, capabilities: READY });
    expect(readCaptureMode(enabled.nextYaml)).toBe(BEST_EFFORT_CAPTURE_MODE);
    expect(enabled.nextYaml).toContain("acceptance:");
    const reverted = revertCapturePolicyMigration(enabled.nextYaml);
    expect(reverted.nextYaml).toBe(yaml);
  });

  it("handles an empty policy file", () => {
    const enabled = planCapturePolicyMigration({ policyYaml: "", capabilities: READY });
    expect(readCaptureMode(enabled.nextYaml)).toBe(BEST_EFFORT_CAPTURE_MODE);
  });
});
