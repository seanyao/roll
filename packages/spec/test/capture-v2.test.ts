import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CaptureIntentV2, CaptureProtocolAdvertisement, CaptureReceiptV2 } from "../src/index.js";
import {
  ROLL_CAPTURE_PROTOCOL_V1,
  ROLL_CAPTURE_PROTOCOL_V2,
  canonicalizeSurfaceUrl,
  captureIntentV2Schema,
  captureReceiptV2Schema,
  isAcceptedCaptureReceiptV2,
  negotiateCaptureProtocol,
  parseCaptureIntentV2,
  parseCaptureReceiptV2,
  parseCaptureProtocolAdvertisement,
  validateCaptureIntentV2,
  validateCaptureReceiptV2,
} from "../src/index.js";

const projectRoot = resolve("/repo");
const SURFACE = "http://localhost:3000/team";
const SHA = `sha256:${"a".repeat(64)}`;

function physicalIntent(overrides: Partial<CaptureIntentV2> = {}): CaptureIntentV2 {
  return {
    protocol: ROLL_CAPTURE_PROTOCOL_V2,
    requestId: "US-PHYSICAL-009-run1-team",
    storyId: "US-PHYSICAL-009",
    runId: "run1",
    surface: { id: SURFACE, declaredUrl: SURFACE, expectedAcIds: ["AC2", "AC3"] },
    operation: "capture-window",
    source: "roll-capture-window",
    target: { appName: "Google Chrome", windowTitle: "团队管理" },
    out: resolve(projectRoot, ".roll/features/capture-tool/US-PHYSICAL-009/run1/screenshots/physical.png"),
    timeoutMs: 60_000,
    createdAt: "2026-07-18T10:00:00.000+08:00",
    ...overrides,
  };
}

function physicalReceipt(overrides: Partial<CaptureReceiptV2> = {}): CaptureReceiptV2 {
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

function renderedIntent(overrides: Partial<CaptureIntentV2> = {}): CaptureIntentV2 {
  return physicalIntent({
    operation: "register-rendered",
    source: "playwright-rendered",
    target: undefined,
    inputPath: resolve(projectRoot, ".roll/features/capture-tool/US-PHYSICAL-009/run1/screenshots/rendered-staged.png"),
    ...overrides,
  });
}

function renderedReceipt(overrides: Partial<CaptureReceiptV2> = {}): CaptureReceiptV2 {
  return physicalReceipt({
    source: "playwright-rendered",
    captureClass: "rendered",
    finalUrl: SURFACE,
    target: undefined,
    ...overrides,
  });
}

describe("US-PHYSICAL-009 canonical surface", () => {
  it("canonicalizes to origin + pathname + search + hash", () => {
    expect(canonicalizeSurfaceUrl("http://localhost:3000/team?tab=1#x")).toBe("http://localhost:3000/team?tab=1#x");
    expect(canonicalizeSurfaceUrl("not a url")).toBeNull();
  });
});

describe("US-PHYSICAL-009 protocol negotiation (AC1)", () => {
  it("marks v2 available only when the host explicitly advertises it", () => {
    const both = negotiateCaptureProtocol({ protocols: [ROLL_CAPTURE_PROTOCOL_V1, ROLL_CAPTURE_PROTOCOL_V2] });
    expect(both.v1.available).toBe(true);
    expect(both.v2.available).toBe(true);
    expect(both.selected).toBe(ROLL_CAPTURE_PROTOCOL_V2);
  });

  it("retains an explicit v2-unavailable reason for a v1-only host — never guesses v2", () => {
    const v1only = negotiateCaptureProtocol({ protocols: [ROLL_CAPTURE_PROTOCOL_V1] });
    expect(v1only.v1.available).toBe(true);
    expect(v1only.v2).toEqual({ available: false, reason: expect.stringContaining("does not advertise roll.capture.v2") });
    expect(v1only.selected).toBe(ROLL_CAPTURE_PROTOCOL_V1);
  });

  it("retains an explicit v1-unavailable reason when v1 is not advertised", () => {
    const v2only = negotiateCaptureProtocol({ protocols: [ROLL_CAPTURE_PROTOCOL_V2] });
    expect(v2only.v1).toEqual({ available: false, reason: expect.stringContaining("does not advertise roll.capture.v1") });
    expect(v2only.v2.available).toBe(true);
    expect(v2only.selected).toBe(ROLL_CAPTURE_PROTOCOL_V2);
  });

  it("NEVER guesses v2 for a legacy host that advertised nothing (null / undefined)", () => {
    for (const adv of [null, undefined, {} as CaptureProtocolAdvertisement]) {
      const n = negotiateCaptureProtocol(adv);
      expect(n.v2.available).toBe(false);
      expect(n.v2).toMatchObject({ available: false, reason: expect.stringContaining("never assumed") });
      expect(n.selected).toBeNull();
    }
  });

  it("parses an advertisement, dropping non-string protocol entries", () => {
    const adv = parseCaptureProtocolAdvertisement({ protocols: ["roll.capture.v2", 5, null], hostVersion: "2.0.0" });
    expect(adv).toEqual({ protocols: ["roll.capture.v2"], hostVersion: "2.0.0" });
    expect(parseCaptureProtocolAdvertisement(42)).toBeNull();
  });
});

describe("US-PHYSICAL-009 intent validation & parsing", () => {
  it("accepts a well-formed physical intent and round-trips through the parser", () => {
    const intent = physicalIntent();
    expect(validateCaptureIntentV2(intent, { projectRoot }).ok).toBe(true);
    expect(parseCaptureIntentV2(JSON.parse(JSON.stringify(intent)))).toEqual(intent);
  });

  it("rejects a surface id that is not the canonical declared URL", () => {
    const intent = physicalIntent({ surface: { id: "http://localhost:3000/other", declaredUrl: SURFACE, expectedAcIds: ["AC2"] } });
    const r = validateCaptureIntentV2(intent, { projectRoot });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.join("; ")).toContain("not the canonical declared URL");
  });

  it("binds operation to source and requires a target / inputPath", () => {
    expect(validateCaptureIntentV2(physicalIntent({ target: undefined }), { projectRoot }).ok).toBe(false);
    expect(validateCaptureIntentV2(physicalIntent({ source: "playwright-rendered" }), { projectRoot }).ok).toBe(false);
    expect(validateCaptureIntentV2(renderedIntent(), { projectRoot }).ok).toBe(true);
    expect(validateCaptureIntentV2(renderedIntent({ inputPath: undefined }), { projectRoot }).ok).toBe(false);
  });

  it("rejects an out path outside the project .roll", () => {
    const intent = physicalIntent({ out: "/etc/evil.png" });
    expect(validateCaptureIntentV2(intent, { projectRoot }).ok).toBe(false);
  });

  it("exposes JSON schemas for both v2 payloads", () => {
    expect(captureIntentV2Schema).toMatchObject({ type: "object" });
    expect(captureReceiptV2Schema).toMatchObject({ type: "object" });
  });
});

describe("US-PHYSICAL-009 receipt validation (AC4)", () => {
  it("accepts a valid taken physical receipt bound to its intent", () => {
    const receipt = physicalReceipt();
    expect(validateCaptureReceiptV2(receipt, physicalIntent()).ok).toBe(true);
    expect(isAcceptedCaptureReceiptV2(receipt, physicalIntent())).toBe(true);
    expect(parseCaptureReceiptV2(JSON.parse(JSON.stringify(receipt)))).toEqual(receipt);
  });

  it("accepts a valid rendered receipt whose finalUrl equals the canonical surface", () => {
    expect(validateCaptureReceiptV2(renderedReceipt(), renderedIntent()).ok).toBe(true);
  });

  it("rejects MALFORMED payloads via the parser", () => {
    expect(parseCaptureReceiptV2({ protocol: ROLL_CAPTURE_PROTOCOL_V2, requestId: 7 })).toBeNull();
    expect(parseCaptureReceiptV2({ protocol: "roll.capture.v1" })).toBeNull();
    expect(parseCaptureReceiptV2("nope")).toBeNull();
  });

  it("rejects MISMATCHED identity against the intent", () => {
    const r = validateCaptureReceiptV2(physicalReceipt({ surfaceId: "http://localhost:3000/nope" }), physicalIntent());
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.join("; ")).toContain("does not match intent surface");
    expect(validateCaptureReceiptV2(physicalReceipt({ requestId: "other" }), physicalIntent()).ok).toBe(false);
  });

  it("rejects a MISSING-ARTIFACT taken receipt (no screenshotPath / no digest)", () => {
    expect(validateCaptureReceiptV2(physicalReceipt({ screenshotPath: undefined }), physicalIntent()).ok).toBe(false);
    expect(validateCaptureReceiptV2(physicalReceipt({ sha256: undefined }), physicalIntent()).ok).toBe(false);
    expect(validateCaptureReceiptV2(physicalReceipt({ sha256: "deadbeef" }), physicalIntent()).ok).toBe(false);
  });

  it("rejects a physical receipt that claims a finalUrl or a mismatched target", () => {
    expect(validateCaptureReceiptV2(physicalReceipt({ finalUrl: SURFACE }), physicalIntent()).ok).toBe(false);
    expect(validateCaptureReceiptV2(physicalReceipt({ target: { appName: "Safari" } }), physicalIntent()).ok).toBe(false);
  });

  it("rejects a rendered receipt whose finalUrl is a redirect away from the surface (invalid target)", () => {
    const r = validateCaptureReceiptV2(renderedReceipt({ finalUrl: "http://localhost:3000/login" }), renderedIntent());
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.join("; ")).toContain("does not equal the surface");
  });

  it("never accepts a legacy-native source as a v2 capture", () => {
    const r = validateCaptureReceiptV2(physicalReceipt({ source: "legacy-native" }), undefined);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.join("; ")).toContain("legacy-unverified");
  });

  it("accepts a non-taken terminal receipt only with a reason and no artifact claims", () => {
    expect(validateCaptureReceiptV2(physicalReceipt({ state: "failed", screenshotPath: undefined, sha256: undefined, reason: "app not running" }), physicalIntent()).ok).toBe(true);
    expect(validateCaptureReceiptV2(physicalReceipt({ state: "failed", sha256: undefined, reason: "x" }), physicalIntent()).ok).toBe(false); // still claims a screenshot
    expect(validateCaptureReceiptV2(physicalReceipt({ state: "skipped", screenshotPath: undefined, sha256: undefined }), physicalIntent()).ok).toBe(false); // no reason
    expect(isAcceptedCaptureReceiptV2(physicalReceipt({ state: "skipped", screenshotPath: undefined, sha256: undefined, reason: "x" }), physicalIntent())).toBe(false);
  });
});
