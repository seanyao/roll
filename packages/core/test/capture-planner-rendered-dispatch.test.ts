/**
 * US-PHYSICAL-013 — the CapturePlanner dispatches the rendered lane through the
 * in-process serve path (renderedCaptureLanePort) and records a taken v2 receipt
 * (with digest) on ONE CaptureSet. Uses an injected render port + in-memory store.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalizeSurfaceUrl, type CaptureIntentV2, type CaptureReceiptV2 } from "@roll/spec";
import { CapturePlanner, type CaptureReceiptStorePort, type DeclaredSurface, type CapturePlanContext } from "../src/attest/capture-planner.js";
import { renderedCaptureLanePort } from "../src/attest/serve-rendered-capture-v2.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function memStore(): CaptureReceiptStorePort & { persisted: CaptureReceiptV2[] } {
  const persisted: CaptureReceiptV2[] = [];
  return {
    persisted,
    captureSetId: (k) => `${k.storyId}:${k.runId}:${k.surfaceId}`,
    async persistReceipt(_intent: CaptureIntentV2, receipt: CaptureReceiptV2) {
      const captureSetId = `${receipt.storyId}:${receipt.runId}:${receipt.surfaceId}`;
      const accepted = receipt.state === "taken" && persisted.filter((r) => r.state === "taken").length === 0;
      persisted.push(receipt);
      return { status: "persisted" as const, receipt, captureSetId, accepted };
    },
  };
}

describe("US-PHYSICAL-013 CapturePlanner dispatches the rendered v2 lane", () => {
  it("renders a declared surface → taken v2 receipt (digest) on one CaptureSet", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "roll-p013-"));
    dirs.push(projectRoot);
    const runDir = join(projectRoot, ".roll", "features", "US-CAP", "run1");
    mkdirSync(join(runDir, "screenshots"), { recursive: true });

    const declaredUrl = "http://127.0.0.1:5173/board";
    const surfaceId = canonicalizeSurfaceUrl(declaredUrl);
    expect(surfaceId).not.toBeNull();

    const surface: DeclaredSurface = { declaredUrl, expectedAcIds: ["AC1"] };
    const ctx: CapturePlanContext = {
      storyId: "US-CAP",
      runId: "run1",
      runDir,
      projectRoot,
      // physical lane needs a window app; leave it off so only the rendered lane is eligible.
    };
    const lane = renderedCaptureLanePort({
      projectRoot,
      responsePathFor: (id) => join(runDir, `${id}.receipt.json`),
      render: {
        render: async ({ out }) => {
          writeFileSync(out, "PNGBYTES");
          return { status: "taken", screenshotPath: out, finalUrl: declaredUrl };
        },
      },
    });
    const store = memStore();
    const planner = new CapturePlanner({ now: () => new Date("2026-07-19T00:00:00.000Z") });

    const result = await planner.capture(surface, ctx, [lane], store);

    expect(result.surfaceId).toBe(surfaceId);
    expect(result.taken).toHaveLength(1);
    const receipt = result.taken[0]!.receipt;
    expect(receipt.source).toBe("playwright-rendered");
    expect(receipt.state).toBe("taken");
    expect(receipt.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    // one CaptureSet
    expect(new Set(result.persisted.map((p) => p.captureSetId)).size).toBe(1);
  });

  it("a redirect to a foreign URL yields a skipped receipt (never a fabricated taken)", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "roll-p013r-"));
    dirs.push(projectRoot);
    const runDir = join(projectRoot, ".roll", "features", "US-CAP", "run1");
    mkdirSync(join(runDir, "screenshots"), { recursive: true });
    const declaredUrl = "http://127.0.0.1:5173/board";
    const surface: DeclaredSurface = { declaredUrl, expectedAcIds: ["AC1"] };
    const ctx: CapturePlanContext = { storyId: "US-CAP", runId: "run1", runDir, projectRoot };
    const lane = renderedCaptureLanePort({
      projectRoot,
      responsePathFor: (id) => join(runDir, `${id}.receipt.json`),
      render: {
        render: async ({ out }) => {
          writeFileSync(out, "PNGBYTES");
          // final URL diverges from the declared surface → a login/foreign redirect.
          return { status: "taken", screenshotPath: out, finalUrl: "http://127.0.0.1:5173/login" };
        },
      },
    });
    const planner = new CapturePlanner({ now: () => new Date("2026-07-19T00:00:00.000Z") });
    const result = await planner.capture(surface, ctx, [lane], memStore());

    expect(result.taken).toHaveLength(0);
    const receipt = result.persisted[0]?.receipt;
    expect(receipt?.state).toBe("skipped");
    expect(receipt?.sha256).toBeUndefined();
  });
});
