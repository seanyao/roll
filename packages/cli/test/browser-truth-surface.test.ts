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
  it("shows per-lane readiness with markers", () => {
    const lines = renderBrowserTruthSupervisorLine(truth());
    const out = lines.join("\n");
    expect(out).toContain("browser readiness:");
    expect(out).toContain("✓ managed: ready");
    expect(out).toContain("✓ interactive: ready");
    expect(out).toContain("✓ capture: ready");
    expect(out).toContain("expires 2026-07-15T01:00:00.000Z");
  });

  it("shows per-lane reasons and lease expiry when degraded/expired/unknown", () => {
    const t = truth({
      managed: { status: "unknown", unavailableReason: "no facts" },
      lease: { status: "expired", expiresAt: "2026-07-14T23:59:00.000Z", unavailableReason: "owner lease expired" },
      capture: { status: "degraded", unavailableReason: "bad" },
    });
    const lines = renderBrowserTruthSupervisorLine(t);
    const out = lines.join("\n");
    expect(out).toContain("✗ managed: unknown — no facts");
    expect(out).toContain("~ interactive: expired — owner lease expired (expires 2026-07-14T23:59:00.000Z)");
    expect(out).toContain("~ capture: degraded — bad");
  });

  it("shows lease expiry when present even without unavailable reason", () => {
    const t = truth({
      lease: { status: "ready", expiresAt: "2026-07-15T12:00:00.000Z" },
    });
    const lines = renderBrowserTruthSupervisorLine(t);
    const out = lines.join("\n");
    expect(out).toContain("✓ interactive: ready (expires 2026-07-15T12:00:00.000Z)");
  });

  it("returns 4 lines (header + 3 lanes)", () => {
    const lines = renderBrowserTruthSupervisorLine(truth());
    expect(lines).toHaveLength(4);
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

// US-BROW-009b AC: 截图捕获用户可见状态表面 — frozen snapshots of the
// operator-facing readiness output for all four states (ready, degraded,
// expired, no-fact/unknown).
describe("US-BROW-009b user-visible status surface snapshots", () => {
  it("snapshot: all-ready doctor row", () => {
    expect(renderBrowserTruthDoctorRow(truth()).join("\n")).toMatchSnapshot();
  });

  it("snapshot: degraded/expired doctor row with reasons", () => {
    const t = truth({
      managed: { status: "degraded", unavailableReason: "managed operation failed" },
      lease: { status: "expired", expiresAt: "2026-07-14T23:59:00.000Z", unavailableReason: "owner lease expired" },
      capture: { status: "degraded", unavailableReason: "digest_mismatch" },
    });
    expect(renderBrowserTruthDoctorRow(t).join("\n")).toMatchSnapshot();
  });

  it("snapshot: all-unknown/no-fact doctor row — never infers a pass", () => {
    const t = truth({
      managed: { status: "unknown", unavailableReason: "no managed operation facts" },
      lease: { status: "unknown", unavailableReason: "no owner lease facts" },
      capture: { status: "unknown", unavailableReason: "no physical capture facts" },
    });
    expect(renderBrowserTruthDoctorRow(t).join("\n")).toMatchSnapshot();
  });

  it("snapshot: all-ready supervisor next output", () => {
    expect(renderBrowserTruthSupervisorLine(truth()).join("\n")).toMatchSnapshot();
  });

  it("snapshot: degraded/expired/unknown supervisor next with per-lane reasons and lease expiry", () => {
    const t = truth({
      managed: { status: "unknown", unavailableReason: "no facts" },
      lease: { status: "expired", expiresAt: "2026-07-14T23:59:00.000Z", unavailableReason: "owner lease expired" },
      capture: { status: "degraded", unavailableReason: "bad" },
    });
    expect(renderBrowserTruthSupervisorLine(t).join("\n")).toMatchSnapshot();
  });

  it("snapshot: all-ready verbose block", () => {
    expect(renderBrowserTruthVerbose(truth()).join("\n")).toMatchSnapshot();
  });

  it("snapshot: degraded/expired/unknown verbose block with all reasons", () => {
    const t = truth({
      managed: { status: "degraded", unavailableReason: "browser unavailable" },
      lease: { status: "expired", expiresAt: "2026-07-14T23:59:00.000Z", unavailableReason: "lease timed out" },
      capture: { status: "unknown", unavailableReason: "no capture bridge" },
    });
    expect(renderBrowserTruthVerbose(t).join("\n")).toMatchSnapshot();
  });
});
