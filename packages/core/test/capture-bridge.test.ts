/**
 * US-BROW-006 — CaptureBridge tests.
 *
 * Tests the bridge between browser operation runs and physical capture requests:
 * 1. linkCapture() — only passed operations can create bridge links
 * 2. No rescue capture after failed/denied/expired operations
 * 3. Bridge link metadata correctness
 * 4. Story and run scoped queries
 */
import { describe, it, expect, beforeEach } from "vitest";
import { CaptureBridge, shouldBridgeCapture, buildBridgeReason } from "../src/attest/capture-bridge.js";
import type { RollCaptureResponseV1 } from "@roll/spec";

// ════════════════════════════════════════════════════════════════════════════
// Test helpers
// ════════════════════════════════════════════════════════════════════════════

function bridge(): CaptureBridge {
  return new CaptureBridge();
}

function takenCapture(): RollCaptureResponseV1 {
  return {
    protocol: "roll.capture.v1",
    requestId: "cap-001",
    status: "taken",
    screenshotPath: "/tmp/shot.png",
    responsePath: "/tmp/shot.json",
    host: { appName: "Roll Capture.app", bundleId: "com.seanyao.roll.capture", version: "1.0.0" },
    startedAt: "2026-07-14T00:00:00Z",
    finishedAt: "2026-07-14T00:00:01Z",
  } as RollCaptureResponseV1;
}

// ════════════════════════════════════════════════════════════════════════════
// linkCapture()
// ════════════════════════════════════════════════════════════════════════════

describe("CaptureBridge.linkCapture", () => {
  let b: CaptureBridge;

  beforeEach(() => {
    b = bridge();
  });

  it("creates a bridge link for a passed operation", () => {
    const link = b.linkCapture("run-001", "US-BROW-006", "cap-001", "passed", takenCapture(), "sha256:abc123");
    expect(link).not.toBeNull();
    expect(link!.runId).toBe("run-001");
    expect(link!.storyId).toBe("US-BROW-006");
    expect(link!.captureRequestId).toBe("cap-001");
    expect(link!.canSatisfyVisualAc).toBe(true);
    expect(link!.reason).toContain("passed");
  });

  it("returns null for a failed operation (no rescue capture)", () => {
    const link = b.linkCapture("run-001", "US-BROW-006", "cap-001", "failed", takenCapture());
    expect(link).toBeNull();
  });

  it("returns null for a denied operation (no rescue capture)", () => {
    const link = b.linkCapture("run-001", "US-BROW-006", "cap-001", "denied", takenCapture());
    expect(link).toBeNull();
  });

  it("returns null for an expired operation (no rescue capture)", () => {
    const link = b.linkCapture("run-001", "US-BROW-006", "cap-001", "expired", takenCapture());
    expect(link).toBeNull();
  });

  it("records link with failed capture as not satisfying visual AC", () => {
    const failedCap = { ...takenCapture(), status: "failed" as const, screenshotPath: undefined, reason: "timeout" } as RollCaptureResponseV1;
    // Even though the link is created for a passed operation, a failed capture won't satisfy visual AC
    const link = b.linkCapture("run-001", "US-BROW-006", "cap-001", "passed", failedCap, "sha256:abc123");
    expect(link).not.toBeNull();
    expect(link!.canSatisfyVisualAc).toBe(false);
  });

  it("records link timestamp", () => {
    const before = new Date().toISOString();
    const link = b.linkCapture("run-001", "US-BROW-006", "cap-001", "passed", takenCapture(), "sha256:abc123");
    expect(link!.linkedAt).toBeDefined();
    expect(link!.linkedAt >= before).toBe(true);
  });

  it("includes both operation and visual evidence reasons", () => {
    const link = b.linkCapture("run-001", "US-BROW-006", "cap-001", "passed", takenCapture(), "sha256:abc123");
    expect(link!.reason).toContain("passed");
    expect(link!.reason).toContain("visual");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Query methods
// ════════════════════════════════════════════════════════════════════════════

describe("CaptureBridge query methods", () => {
  let b: CaptureBridge;

  beforeEach(() => {
    b = bridge();
    b.linkCapture("run-001", "US-BROW-006", "cap-001", "passed", takenCapture(), "sha256:abc123");
    b.linkCapture("run-002", "US-BROW-006", "cap-002", "passed", takenCapture(), "sha256:abc123");
    b.linkCapture("run-003", "US-BROW-007", "cap-003", "passed", takenCapture(), "sha256:abc123");
    // This one won't create a link (failed operation)
    b.linkCapture("run-004", "US-BROW-006", "cap-004", "failed", takenCapture(), "sha256:abc123");
  });

  it("linksForStory returns links scoped to a story", () => {
    const links = b.linksForStory("US-BROW-006");
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.storyId === "US-BROW-006")).toBe(true);
  });

  it("linksForStory returns empty for unknown story", () => {
    expect(b.linksForStory("US-UNKNOWN")).toHaveLength(0);
  });

  it("linksForRun returns links for a specific run", () => {
    const links = b.linksForRun("run-001");
    expect(links).toHaveLength(1);
    expect(links[0]!.runId).toBe("run-001");
  });

  it("linksForRun returns empty for run with failed operation", () => {
    expect(b.linksForRun("run-004")).toHaveLength(0);
  });

  it("allLinks returns all bridge links", () => {
    expect(b.allLinks()).toHaveLength(3);
  });

  it("validVisualEvidenceCount counts valid visual evidence", () => {
    expect(b.validVisualEvidenceCount()).toBe(3);
  });

  it("validVisualEvidenceCount scoped to story", () => {
    expect(b.validVisualEvidenceCount("US-BROW-006")).toBe(2);
    expect(b.validVisualEvidenceCount("US-BROW-007")).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Clear
// ════════════════════════════════════════════════════════════════════════════

describe("CaptureBridge.clear", () => {
  it("clears all stored links", () => {
    const b = bridge();
    b.linkCapture("run-001", "US-BROW-006", "cap-001", "passed", takenCapture(), "sha256:abc123");
    expect(b.allLinks()).toHaveLength(1);
    b.clear();
    expect(b.allLinks()).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Static helpers
// ════════════════════════════════════════════════════════════════════════════

describe("Static helpers", () => {
  describe("shouldBridgeCapture", () => {
    it("returns true for passed", () => {
      expect(shouldBridgeCapture("passed")).toBe(true);
    });

    it("returns false for failed", () => {
      expect(shouldBridgeCapture("failed")).toBe(false);
    });

    it("returns false for denied", () => {
      expect(shouldBridgeCapture("denied")).toBe(false);
    });

    it("returns false for expired", () => {
      expect(shouldBridgeCapture("expired")).toBe(false);
    });
  });

  describe("buildBridgeReason", () => {
    it("handles no capture requested", () => {
      expect(buildBridgeReason("passed", false)).toBe("No capture requested");
    });

    it("handles non-passed operation", () => {
      expect(buildBridgeReason("failed", true)).toContain("not allowed");
    });

    it("handles taken capture", () => {
      expect(buildBridgeReason("passed", true, "taken")).toContain("eligible");
    });

    it("handles skipped capture", () => {
      expect(buildBridgeReason("passed", true, "skipped")).toContain("eligible");
    });

    it("handles failed capture", () => {
      expect(buildBridgeReason("passed", true, "failed")).toContain("eligible");
    });

    it("handles unknown capture status", () => {
      expect(buildBridgeReason("passed", true)).toContain("unknown");
    });
  });
});
