/**
 * US-PHYSICAL-010 — serveRenderedCaptureV2 unit contract.
 *
 * Render port + receipt store are injected fakes so this suite never launches
 * Chromium. Integration coverage (real PNG + loopback page) lives in the CLI
 * package as `us-physical-010-serve-rendered.integration.test.ts`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CaptureIntentV2, CaptureReceiptV2 } from "@roll/spec";
import { ROLL_CAPTURE_PROTOCOL_V2, isAcceptedCaptureReceiptV2, validateCaptureReceiptV2 } from "@roll/spec";
import {
  serveRenderedCaptureV2,
  type CaptureReceiptPersistOutcome,
  type CaptureReceiptStorePort,
  type RenderedSurfacePort,
  type RenderedSurfaceRenderResult,
} from "../src/attest/serve-rendered-capture-v2.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SURFACE = "http://localhost:3000/team";
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "roll-serve-rendered-"));
  dirs.push(root);
  mkdirSync(join(root, ".roll", "features", "capture-tool", "US-PHYSICAL-010", "run1", "screenshots"), { recursive: true });
  return root;
}

function renderedIntent(projectRoot: string, overrides: Partial<CaptureIntentV2> = {}): CaptureIntentV2 {
  const runDir = join(projectRoot, ".roll", "features", "capture-tool", "US-PHYSICAL-010", "run1");
  return {
    protocol: ROLL_CAPTURE_PROTOCOL_V2,
    requestId: "US-PHYSICAL-010-run1-team-rendered",
    storyId: "US-PHYSICAL-010",
    runId: "run1",
    surface: { id: SURFACE, declaredUrl: SURFACE, expectedAcIds: ["AC1"] },
    operation: "register-rendered",
    source: "playwright-rendered",
    inputPath: join(runDir, "screenshots", "rendered.staged.png"),
    out: join(runDir, "screenshots", "rendered.png"),
    timeoutMs: 30_000,
    createdAt: "2026-07-19T00:00:00.000+08:00",
    ...overrides,
  };
}

function physicalIntent(projectRoot: string): CaptureIntentV2 {
  const runDir = join(projectRoot, ".roll", "features", "capture-tool", "US-PHYSICAL-010", "run1");
  return {
    protocol: ROLL_CAPTURE_PROTOCOL_V2,
    requestId: "US-PHYSICAL-010-run1-team-physical",
    storyId: "US-PHYSICAL-010",
    runId: "run1",
    surface: { id: SURFACE, declaredUrl: SURFACE, expectedAcIds: ["AC1"] },
    operation: "capture-window",
    source: "roll-capture-window",
    target: { appName: "Google Chrome", windowTitle: "team" },
    out: join(runDir, "screenshots", "physical.png"),
    timeoutMs: 30_000,
    createdAt: "2026-07-19T00:00:00.000+08:00",
  };
}

class FakeStore implements CaptureReceiptStorePort {
  readonly receipts = new Map<string, CaptureReceiptV2>();
  readonly persistCalls: Array<{ intent: CaptureIntentV2; receipt: CaptureReceiptV2 }> = [];

  captureSetId(keys: Pick<CaptureReceiptV2, "storyId" | "runId" | "surfaceId">): string {
    return `${keys.storyId}|${keys.runId}|${keys.surfaceId}`;
  }

  async persistReceipt(intent: CaptureIntentV2, receipt: CaptureReceiptV2): Promise<CaptureReceiptPersistOutcome> {
    this.persistCalls.push({ intent, receipt });
    const captureSetId = this.captureSetId(receipt);
    const validation = validateCaptureReceiptV2(receipt, intent);
    if (!validation.ok) return { status: "rejected", reason: validation.errors.join("; "), captureSetId };

    const existing = this.receipts.get(receipt.requestId);
    if (existing !== undefined) {
      const same =
        existing.state === receipt.state &&
        (existing.sha256 ?? null) === (receipt.sha256 ?? null) &&
        (existing.screenshotPath ?? null) === (receipt.screenshotPath ?? null) &&
        (existing.finalUrl ?? null) === (receipt.finalUrl ?? null) &&
        (existing.reason ?? null) === (receipt.reason ?? null);
      if (same) return { status: "duplicate", receipt: existing, captureSetId, accepted: existing.state === "taken" };
      return { status: "rejected", reason: `duplicate_request_id_different_content: "${receipt.requestId}"`, captureSetId, existing };
    }

    this.receipts.set(receipt.requestId, receipt);
    return { status: "persisted", receipt, captureSetId, accepted: receipt.state === "taken" };
  }
}

function fakeRender(impl: (input: { url: string; out: string; timeoutMs: number }) => Promise<RenderedSurfaceRenderResult>): RenderedSurfacePort {
  return { render: impl };
}

describe("US-PHYSICAL-010 serveRenderedCaptureV2", () => {
  it("AC1: renders a declared surface and returns a schema-valid taken receipt with digest + responsePath", async () => {
    const projectRoot = tempProject();
    const intent = renderedIntent(projectRoot);
    const store = new FakeStore();
    const render = fakeRender(async ({ out }) => {
      writeFileSync(out, PNG_BYTES);
      return { status: "taken", screenshotPath: out, finalUrl: SURFACE };
    });

    const result = await serveRenderedCaptureV2(intent, {
      projectRoot,
      store,
      render,
      responsePathFor: (id) => resolve(projectRoot, `.roll/capture-gateway/receipts/receipt-${id}.json`),
      now: () => new Date("2026-07-19T00:00:01.000+08:00"),
    });

    expect(result.receipt.state).toBe("taken");
    expect(result.receipt.source).toBe("playwright-rendered");
    expect(result.receipt.captureClass).toBe("rendered");
    expect(result.receipt.finalUrl).toBe(SURFACE);
    expect(result.receipt.screenshotPath).toBe(intent.out);
    expect(result.receipt.sha256).toBe(`sha256:${createHash("sha256").update(PNG_BYTES).digest("hex")}`);
    expect(result.receipt.responsePath).toContain("receipt-");
    expect(isAcceptedCaptureReceiptV2(result.receipt, intent)).toBe(true);
    expect(result.persist.status).toBe("persisted");
    expect(existsSync(intent.out)).toBe(true);
  });

  it("AC2: a foreign redirect yields skipped with a durable reason and writes no taken receipt", async () => {
    const projectRoot = tempProject();
    const intent = renderedIntent(projectRoot);
    const store = new FakeStore();
    const render = fakeRender(async ({ out }) => {
      writeFileSync(out, PNG_BYTES);
      return { status: "taken", screenshotPath: out, finalUrl: "http://localhost:3000/login" };
    });

    const result = await serveRenderedCaptureV2(intent, {
      projectRoot,
      store,
      render,
      responsePathFor: (id) => join(projectRoot, `.roll/receipt-${id}.json`),
      now: () => new Date("2026-07-19T00:00:01.000+08:00"),
    });

    expect(result.receipt.state).toBe("skipped");
    expect(result.receipt.reason).toMatch(/redirect|login|invalid target/i);
    expect(result.receipt.screenshotPath).toBeUndefined();
    expect(result.receipt.sha256).toBeUndefined();
    expect(isAcceptedCaptureReceiptV2(result.receipt, intent)).toBe(false);
    expect(store.receipts.get(intent.requestId)?.state).toBe("skipped");
  });

  it("AC2: a disallowed (non-loopback) target from the render port yields skipped, never taken", async () => {
    const projectRoot = tempProject();
    const intent = renderedIntent(projectRoot, {
      surface: { id: "https://example.com/app", declaredUrl: "https://example.com/app", expectedAcIds: ["AC1"] },
    });
    const store = new FakeStore();
    const render = fakeRender(async () => ({ status: "skipped", reason: "disallowed target: rendered capture only permits loopback HTTP(S) pages" }));

    const result = await serveRenderedCaptureV2(intent, {
      projectRoot,
      store,
      render,
      responsePathFor: (id) => join(projectRoot, `.roll/receipt-${id}.json`),
      now: () => new Date("2026-07-19T00:00:01.000+08:00"),
    });

    expect(result.receipt.state).toBe("skipped");
    expect(result.receipt.reason).toMatch(/disallowed target/i);
    expect(isAcceptedCaptureReceiptV2(result.receipt, intent)).toBe(false);
  });

  it("AC3: repeating the same intent is idempotent and never overwrites an accepted receipt with different content", async () => {
    const projectRoot = tempProject();
    const intent = renderedIntent(projectRoot);
    const store = new FakeStore();
    let calls = 0;
    const render = fakeRender(async ({ out }) => {
      calls += 1;
      writeFileSync(out, PNG_BYTES);
      return { status: "taken", screenshotPath: out, finalUrl: SURFACE };
    });
    const deps = {
      projectRoot,
      store,
      render,
      responsePathFor: (id: string) => join(projectRoot, `.roll/receipt-${id}.json`),
      now: () => new Date("2026-07-19T00:00:01.000+08:00"),
    };

    const first = await serveRenderedCaptureV2(intent, deps);
    expect(first.persist.status).toBe("persisted");

    const second = await serveRenderedCaptureV2(intent, deps);
    expect(second.persist.status).toBe("duplicate");
    expect(second.receipt.sha256).toBe(first.receipt.sha256);

    // Different content for the same request id must be rejected by the store.
    const otherBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xff]);
    const hostile = fakeRender(async ({ out }) => {
      writeFileSync(out, otherBytes);
      return { status: "taken", screenshotPath: out, finalUrl: SURFACE };
    });
    const overwritten = await serveRenderedCaptureV2(intent, { ...deps, render: hostile });
    expect(overwritten.persist.status).toBe("rejected");
    expect(store.receipts.get(intent.requestId)?.sha256).toBe(first.receipt.sha256);
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it("AC4: a roll-capture-window intent is refused with an explicit physical-source reason", async () => {
    const projectRoot = tempProject();
    const intent = physicalIntent(projectRoot);
    const store = new FakeStore();
    let rendered = false;
    const render = fakeRender(async () => {
      rendered = true;
      return { status: "failed", reason: "should not be called" };
    });

    const result = await serveRenderedCaptureV2(intent, {
      projectRoot,
      store,
      render,
      responsePathFor: (id) => join(projectRoot, `.roll/receipt-${id}.json`),
      now: () => new Date("2026-07-19T00:00:01.000+08:00"),
    });

    expect(rendered).toBe(false);
    expect(result.receipt.state).toBe("skipped");
    expect(result.receipt.reason).toContain("physical source served elsewhere");
    expect(isAcceptedCaptureReceiptV2(result.receipt, intent)).toBe(false);
  });
});
