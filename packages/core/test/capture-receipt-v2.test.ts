/**
 * US-PHYSICAL-009 — the gate stays v1-authoritative but must ACCEPT a valid v2
 * physical receipt, and the report renderer must carry an accepted receipt's PNG
 * to the attachment path (`screenshots/*`).
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CaptureIntentV2, CaptureReceiptV2 } from "@roll/spec";
import { ROLL_CAPTURE_PROTOCOL_V2 } from "@roll/spec";
import { classifyCaptureReceiptV2 } from "../src/attest/evidence-classifier.js";
import { captureReceiptEvidenceRef } from "../src/attest/report.js";

const projectRoot = resolve("/repo");
const SURFACE = "http://localhost:3000/team";
const SHA = `sha256:${"a".repeat(64)}`;

function intent(overrides: Partial<CaptureIntentV2> = {}): CaptureIntentV2 {
  return {
    protocol: ROLL_CAPTURE_PROTOCOL_V2,
    requestId: "US-PHYSICAL-009-run1-team",
    storyId: "US-PHYSICAL-009",
    runId: "run1",
    surface: { id: SURFACE, declaredUrl: SURFACE, expectedAcIds: ["AC2"] },
    operation: "capture-window",
    source: "roll-capture-window",
    target: { appName: "Google Chrome", windowTitle: "团队管理" },
    out: resolve(projectRoot, ".roll/features/capture-tool/US-PHYSICAL-009/run1/screenshots/physical.png"),
    timeoutMs: 60_000,
    createdAt: "2026-07-18T10:00:00.000+08:00",
    ...overrides,
  };
}

function receipt(overrides: Partial<CaptureReceiptV2> = {}): CaptureReceiptV2 {
  return {
    protocol: ROLL_CAPTURE_PROTOCOL_V2,
    requestId: "US-PHYSICAL-009-run1-team",
    storyId: "US-PHYSICAL-009",
    runId: "run1",
    surfaceId: SURFACE,
    source: "roll-capture-window",
    captureClass: "physical",
    state: "taken",
    screenshotPath: resolve(projectRoot, ".roll/features/capture-tool/US-PHYSICAL-009/run1/screenshots/physical.png"),
    sha256: SHA,
    target: { appName: "Google Chrome", windowTitle: "团队管理" },
    responsePath: resolve(projectRoot, ".roll/features/capture-tool/US-PHYSICAL-009/run1/response.json"),
    startedAt: "2026-07-18T10:00:01.000+08:00",
    finishedAt: "2026-07-18T10:00:02.000+08:00",
    ...overrides,
  };
}

describe("classifyCaptureReceiptV2", () => {
  it("accepts a valid taken physical receipt as visual AC evidence", () => {
    const r = classifyCaptureReceiptV2(receipt(), intent());
    expect(r.verdict).toBe("valid");
    expect(r.evidence?.protocol).toBe("roll.capture.v2");
    expect(r.evidence?.digest).toBe(SHA);
  });

  it("does not treat a rendered receipt as a physical AC receipt (later health resolver owns it)", () => {
    const rendered = receipt({ source: "playwright-rendered", captureClass: "rendered", finalUrl: SURFACE, target: undefined });
    expect(classifyCaptureReceiptV2(rendered).verdict).toBe("not_physical");
  });

  it("surfaces a concrete verdict for a non-taken or artifact-less receipt", () => {
    expect(classifyCaptureReceiptV2(receipt({ state: "failed", screenshotPath: undefined, sha256: undefined, reason: "x" }), intent()).verdict).toBe("capture_failed");
    expect(classifyCaptureReceiptV2(receipt({ screenshotPath: undefined }), intent()).verdict).toBe("png_missing");
    expect(classifyCaptureReceiptV2(receipt({ sha256: undefined }), intent()).verdict).toBe("digest_mismatch");
  });
});

describe("captureReceiptEvidenceRef", () => {
  it("maps an accepted physical receipt to a screenshots/* attachment ref", () => {
    const ref = captureReceiptEvidenceRef(receipt());
    expect(ref).not.toBeNull();
    expect(ref?.kind).toBe("screenshot");
    expect(ref?.href).toBe("screenshots/physical.png");
    expect(ref?.label).toContain("physical");
  });

  it("yields no ref for a non-taken receipt (deletion-not-placeholder)", () => {
    expect(captureReceiptEvidenceRef(receipt({ state: "skipped", screenshotPath: undefined, sha256: undefined, reason: "x" }))).toBeNull();
  });
});
