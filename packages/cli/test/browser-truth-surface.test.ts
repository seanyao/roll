/**
 * US-BROW-009b — surface rendering tests for browser operations truth adapter.
 * Covers ready / degraded / expired / no-fact (unknown) states across all three
 * rendering functions: compact doctor row, supervisor line, and verbose block.
 */
import { describe, expect, it } from "vitest";
import type { BrowserOperationsTruth } from "@roll/spec";
import {
  renderBrowserTruthDoctorRow,
  renderBrowserTruthSupervisorLine,
  renderBrowserTruthVerbose,
} from "../src/lib/browser-truth-surface.js";

function truth(overrides: Partial<BrowserOperationsTruth> = {}): BrowserOperationsTruth {
  return {
    managed: { status: "ready" },
    lease: { status: "ready", expiresAt: "2026-07-15T01:00:00.000Z" },
    capture: { status: "ready" },
    collectedAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("US-BROW-009b renderBrowserTruthDoctorRow", () => {
  it("shows all three lanes ready with markers", () => {
    const lines = renderBrowserTruthDoctorRow(truth());
    expect(lines.join("\n")).toContain("✓ managed: ready");
    expect(lines.join("\n")).toContain("✓ interactive: ready");
    expect(lines.join("\n")).toContain("✓ capture: ready");
  });

  it("shows degraded lanes with reason", () => {
    const t = truth({
      managed: { status: "degraded", unavailableReason: "managed operation failed" },
      lease: { status: "expired", expiresAt: "2026-07-14T23:59:00.000Z", unavailableReason: "owner lease expired" },
      capture: { status: "degraded", unavailableReason: "digest_mismatch" },
    });
    const lines = renderBrowserTruthDoctorRow(t);
    const out = lines.join("\n");
    expect(out).toContain("~ managed: degraded — managed operation failed");
    expect(out).toContain("~ interactive: expired — owner lease expired");
    expect(out).toContain("~ capture: degraded — digest_mismatch");
    expect(out).toContain("expires 2026-07-14T23:59:00.000Z");
  });

  it("marks all-unknown as honest unknown, never infers a pass", () => {
    const t = truth({
      managed: { status: "unknown", unavailableReason: "no managed operation facts" },
      lease: { status: "unknown", unavailableReason: "no owner lease facts" },
      capture: { status: "unknown", unavailableReason: "no physical capture facts" },
    });
    const lines = renderBrowserTruthDoctorRow(t);
    const out = lines.join("\n");
    expect(out).toContain("✗ managed: unknown — no managed operation facts");
    expect(out).toContain("✗ interactive: unknown — no owner lease facts");
    expect(out).toContain("✗ capture: unknown — no physical capture facts");
    // Must never contain "ready" or "✓" for unknown lanes.
    expect(out).not.toContain("✓ managed");
    expect(out).not.toContain("✓ interactive");
    expect(out).not.toContain("✓ capture");
  });
});

describe("US-BROW-009b renderBrowserTruthSupervisorLine", () => {
  it("shows compact readiness line", () => {
    const line = renderBrowserTruthSupervisorLine(truth());
    expect(line).toContain("browser readiness:");
    expect(line).toContain("managed:ready");
    expect(line).toContain("interactive:ready");
    expect(line).toContain("capture:ready");
  });

  it("flags degraded/expired/unknown lanes", () => {
    const t = truth({
      managed: { status: "unknown", unavailableReason: "no facts" },
      lease: { status: "expired", expiresAt: "2026-07-14T23:59:00.000Z", unavailableReason: "expired" },
      capture: { status: "degraded", unavailableReason: "bad" },
    });
    const line = renderBrowserTruthSupervisorLine(t);
    expect(line).toContain("(3 lane(s) not ready)");
  });

  it("does not flag when all ready", () => {
    const line = renderBrowserTruthSupervisorLine(truth());
    expect(line).not.toContain("not ready");
  });
});

describe("US-BROW-009b renderBrowserTruthVerbose", () => {
  it("shows all lanes with padded columns", () => {
    const lines = renderBrowserTruthVerbose(truth());
    const out = lines.join("\n");
    expect(out).toContain("managed:");
    expect(out).toContain("interactive:");
    expect(out).toContain("capture:");
    expect(out).toContain("ready");
    expect(out).toContain("expires 2026-07-15T01:00:00.000Z");
  });

  it("includes reasons for degraded/expired/unknown", () => {
    const t = truth({
      managed: { status: "degraded", unavailableReason: "browser unavailable" },
      lease: { status: "expired", expiresAt: "2026-07-14T23:59:00.000Z", unavailableReason: "lease timed out" },
      capture: { status: "unknown", unavailableReason: "no capture bridge" },
    });
    const lines = renderBrowserTruthVerbose(t);
    const out = lines.join("\n");
    expect(out).toContain("browser unavailable");
    expect(out).toContain("lease timed out");
    expect(out).toContain("no capture bridge");
  });
});
