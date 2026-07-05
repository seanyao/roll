import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RollCaptureRequestV1, RollCaptureResponseV1 } from "@roll/spec";
import { ROLL_CAPTURE_PROTOCOL_V1 } from "@roll/spec";
import { checkCapturePrivacy, readPngDimensions } from "../src/index.js";

const dirs: string[] = [];

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "roll-capture-privacy-"));
  dirs.push(d);
  return d;
}

function writeMinimalPng(path: string, width: number, height: number): void {
  // PNG signature + IHDR chunk with width/height.
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrLength = Buffer.alloc(4);
  ihdrLength.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from("IHDR", "ascii");
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = Buffer.concat([ihdrLength, ihdrType, ihdrData]);
  const ihdrCrc = Buffer.alloc(4); // CRC not validated by the dimension reader
  writeFileSync(path, Buffer.concat([signature, ihdr, ihdrCrc]));
}

function request(overrides: Partial<RollCaptureRequestV1> = {}): RollCaptureRequestV1 {
  return {
    protocol: ROLL_CAPTURE_PROTOCOL_V1,
    requestId: "US-PHYSICAL-007-test",
    storyId: "US-PHYSICAL-007",
    runId: "20260705-150000",
    kind: "physical_terminal",
    target: { type: "window", appName: "Terminal.app" },
    out: join(tmp(), "physical.png"),
    timeoutMs: 30_000,
    createdAt: "2026-07-05T15:00:00.000+08:00",
    ...overrides,
  };
}

function response(overrides: Partial<RollCaptureResponseV1> = {}): RollCaptureResponseV1 {
  return {
    protocol: ROLL_CAPTURE_PROTOCOL_V1,
    requestId: "US-PHYSICAL-007-test",
    status: "taken",
    screenshotPath: join(tmp(), "physical.png"),
    responsePath: "/Users/seanyao/Library/Application Support/Roll Capture/responses/response-US-PHYSICAL-007-test.json",
    host: { appName: "Roll Capture.app", bundleId: "com.seanyao.roll.capture", version: "0.1.0" },
    startedAt: "2026-07-05T15:00:01.000+08:00",
    finishedAt: "2026-07-05T15:00:02.000+08:00",
    ...overrides,
  };
}

describe("US-PHYSICAL-007 capture privacy checker", () => {
  it("reads PNG dimensions from IHDR", () => {
    const path = join(tmp(), "1280x800.png");
    writeMinimalPng(path, 1280, 800);
    expect(readPngDimensions(path)).toEqual({ width: 1280, height: 800 });
  });

  it("returns null for non-PNG files", () => {
    const path = join(tmp(), "not-a-png.txt");
    writeFileSync(path, "hello");
    expect(readPngDimensions(path)).toBeNull();
  });

  it("rejects a window-declared capture whose image matches the display size", () => {
    const req = request({ target: { type: "window", appName: "Terminal.app" } });
    const res = response({ imageWidth: 1920, imageHeight: 1080 });
    const result = checkCapturePrivacy(req, res, { displaySize: { width: 1920, height: 1080 } });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("window capture rejected");
    expect(result.reason).toContain("1920x1080");
    expect(result.annotation.target).toContain("Terminal.app");
    expect(result.annotation.requestedBy).toContain("US-PHYSICAL-007");
  });

  it("rejects a window-declared capture whose image exceeds the fullscreen threshold", () => {
    const req = request({ target: { type: "window", appName: "Google Chrome" } });
    const res = response({ imageWidth: 3000, imageHeight: 2000 });
    const result = checkCapturePrivacy(req, res, { fullscreenThreshold: { width: 1440, height: 900 } });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("fullscreen size");
  });

  it("accepts a window-declared capture whose image is smaller than the display", () => {
    const req = request({ target: { type: "window", appName: "Terminal.app" } });
    const res = response({ imageWidth: 1280, imageHeight: 800 });
    const result = checkCapturePrivacy(req, res, { displaySize: { width: 1920, height: 1080 } });

    expect(result.ok).toBe(true);
    expect(result.annotation.declaredFullscreen).toBe(false);
  });

  it("rejects a window capture when dimensions are missing and the file cannot be read", () => {
    const req = request({ target: { type: "window", appName: "Terminal.app" } });
    const res = response({ screenshotPath: "/does/not/exist.png" });
    const result = checkCapturePrivacy(req, res, {});

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("could not read image dimensions");
  });

  it("reads dimensions from disk when the response omits them", () => {
    const dir = tmp();
    const path = join(dir, "window.png");
    writeMinimalPng(path, 1280, 800);
    const req = request({ target: { type: "window", appName: "Terminal.app" }, out: path });
    const res = response({ screenshotPath: path });
    const result = checkCapturePrivacy(req, res, { displaySize: { width: 1920, height: 1080 } });

    expect(result.ok).toBe(true);
  });

  it("rejects undeclared fullscreen display captures", () => {
    const req = request({ target: { type: "display" }, kind: "display" });
    const res = response({ imageWidth: 1920, imageHeight: 1080 });
    const result = checkCapturePrivacy(req, res, { declaredFullscreen: false });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("display capture rejected");
  });

  it("accepts explicitly declared fullscreen display captures", () => {
    const req = request({ target: { type: "display" }, kind: "display" });
    const res = response({ imageWidth: 1920, imageHeight: 1080 });
    const result = checkCapturePrivacy(req, res, { declaredFullscreen: true });

    expect(result.ok).toBe(true);
    expect(result.annotation.declaredFullscreen).toBe(true);
  });

  it("region targets bypass the window/fullscreen check", () => {
    const req = request({ target: { type: "region", x: 0, y: 0, width: 1920, height: 1080 }, kind: "region" });
    const res = response({ imageWidth: 1920, imageHeight: 1080 });
    const result = checkCapturePrivacy(req, res, {});

    expect(result.ok).toBe(true);
    expect(result.annotation.target).toContain("region");
  });
});
