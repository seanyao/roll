/**
 * US-PHYSICAL-010 (evaluation contract) — integration fixture.
 *
 * Spins a loopback HTML page, serves a real Playwright-rendered PNG through
 * serveRenderedCaptureV2 + RollCaptureReceiptStore, and asserts a schema-valid
 * taken v2 receipt with a content digest of the written image.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CaptureIntentV2 } from "@roll/spec";
import { ROLL_CAPTURE_PROTOCOL_V2, isAcceptedCaptureReceiptV2 } from "@roll/spec";
import { serveRenderedCaptureV2 } from "@roll/core";
import { RollCaptureReceiptStore, createPlaywrightRenderedSurfacePort, chromiumInstalled } from "@roll/infra";

const dirs: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function listenLoopback(html: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("failed to bind loopback server");
  const url = `http://127.0.0.1:${address.port}/team`;
  return {
    url,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("US-PHYSICAL-010 serveRenderedCaptureV2 integration (real PNG + receipt)", () => {
  it("renders a loopback page to a real PNG and persists a taken v2 receipt with digest", async () => {
    if (!chromiumInstalled()) {
      // Fail loud: the card's substitute evidence requires a real rendered PNG.
      throw new Error("Chromium is not installed; run `npx playwright install chromium` before this integration");
    }

    const projectRoot = mkdtempSync(join(tmpdir(), "roll-physical-010-"));
    dirs.push(projectRoot);
    const runDir = join(projectRoot, ".roll", "features", "capture-tool", "US-PHYSICAL-010", "run1");
    const screenshotsDir = join(runDir, "screenshots");
    mkdirSync(screenshotsDir, { recursive: true });
    const captureRoot = join(projectRoot, ".roll", "capture-gateway");

    const page = await listenLoopback("<!doctype html><html><body><h1>US-PHYSICAL-010</h1></body></html>");
    const surfaceId = page.url;

    const intent: CaptureIntentV2 = {
      protocol: ROLL_CAPTURE_PROTOCOL_V2,
      requestId: "US-PHYSICAL-010-run1-team-rendered",
      storyId: "US-PHYSICAL-010",
      runId: "run1",
      surface: { id: surfaceId, declaredUrl: surfaceId, expectedAcIds: ["AC1"] },
      operation: "register-rendered",
      source: "playwright-rendered",
      inputPath: join(screenshotsDir, "rendered.staged.png"),
      out: join(screenshotsDir, "rendered.png"),
      timeoutMs: 60_000,
      createdAt: new Date().toISOString(),
    };

    const store = new RollCaptureReceiptStore({ root: captureRoot });
    const result = await serveRenderedCaptureV2(intent, {
      projectRoot,
      store,
      render: createPlaywrightRenderedSurfacePort(),
      responsePathFor: (id) => store.receiptPath(id),
    });

    expect(result.receipt.state).toBe("taken");
    expect(result.persist.status).toBe("persisted");
    expect(isAcceptedCaptureReceiptV2(result.receipt, intent)).toBe(true);
    expect(result.receipt.source).toBe("playwright-rendered");
    expect(result.receipt.finalUrl).toBe(surfaceId);
    expect(result.receipt.responsePath).toBe(store.receiptPath(intent.requestId));

    const png = readFileSync(intent.out);
    expect(statSync(intent.out).size).toBeGreaterThan(100);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(result.receipt.sha256).toBe(`sha256:${createHash("sha256").update(png).digest("hex")}`);

    const onDisk = await store.readReceipt(intent.requestId);
    expect(onDisk?.sha256).toBe(result.receipt.sha256);
    expect(onDisk?.state).toBe("taken");
  }, 90_000);
});
