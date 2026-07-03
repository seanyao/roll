import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CaptureLedgerEntry, RollCaptureRequestV1, RollCaptureResponseV1 } from "../src/index.js";
import {
  PHYSICAL_SCREENSHOT_TOOL_CONTRACT,
  ROLL_CAPTURE_PROTOCOL_V1,
  rollCaptureResponseV1Schema,
  validateRollCaptureResponseV1,
  validateRollCaptureRequestV1,
} from "../src/index.js";

const projectRoot = resolve("/repo");

function validRequest(overrides: Partial<RollCaptureRequestV1> = {}): RollCaptureRequestV1 {
  return {
    protocol: ROLL_CAPTURE_PROTOCOL_V1,
    requestId: "US-PHYSICAL-001-physical-terminal",
    storyId: "US-PHYSICAL-001",
    runId: "20260703-193533",
    kind: "physical_terminal",
    target: { type: "window", appName: "Terminal", windowTitle: "roll attest US-PHYSICAL-001" },
    out: resolve(projectRoot, ".roll/features/capture-tool/US-PHYSICAL-001/latest/screenshots/terminal.png"),
    timeoutMs: 30_000,
    createdAt: "2026-07-03T11:35:00.000+08:00",
    ...overrides,
  };
}

describe("US-PHYSICAL-001 Roll Capture protocol contract", () => {
  it("declares physical.screenshot as the roll-capture darwin protocol tool", () => {
    expect(PHYSICAL_SCREENSHOT_TOOL_CONTRACT).toMatchObject({
      id: "physical.screenshot",
      provider: "roll-capture",
      protocol: "roll.capture.v1",
      platform: "darwin",
      kind: "physical",
    });
  });

  it("serializes request, response, and ledger fields exactly like the Swift protocol", () => {
    const request: RollCaptureRequestV1 = validRequest();
    const response: RollCaptureResponseV1 = {
      protocol: ROLL_CAPTURE_PROTOCOL_V1,
      requestId: request.requestId,
      status: "taken",
      screenshotPath: request.out,
      responsePath: "/Users/seanyao/Library/Application Support/Roll Capture/responses/response-US-PHYSICAL-001-physical-terminal.json",
      host: {
        appName: "Roll Capture.app",
        bundleId: "com.seanyao.roll.capture",
        version: "0.1.0",
      },
      startedAt: "2026-07-03T11:35:01.100+08:00",
      finishedAt: "2026-07-03T11:35:01.820+08:00",
    };
    const ledger: CaptureLedgerEntry = {
      requestId: request.requestId,
      storyId: request.storyId,
      runId: request.runId,
      kind: request.kind,
      status: "taken",
      screenshotPath: request.out,
      responsePath: response.responsePath,
      reportPath: resolve(projectRoot, ".roll/features/capture-tool/US-PHYSICAL-001/latest/US-PHYSICAL-001-report.html"),
      attachedToReport: true,
      startedAt: response.startedAt,
      finishedAt: response.finishedAt,
    };
    const malformedLedger: CaptureLedgerEntry = {
      requestId: "bad-request",
      status: "failed",
      responsePath: "/Users/seanyao/Library/Application Support/Roll Capture/responses/response-bad-request.json",
      attachedToReport: false,
      reason: "malformed request JSON",
      startedAt: response.startedAt,
      finishedAt: response.finishedAt,
    };

    expect(JSON.parse(JSON.stringify({ request, response, ledger, malformedLedger }))).toEqual({
      request: {
        protocol: "roll.capture.v1",
        requestId: "US-PHYSICAL-001-physical-terminal",
        storyId: "US-PHYSICAL-001",
        runId: "20260703-193533",
        kind: "physical_terminal",
        target: { type: "window", appName: "Terminal", windowTitle: "roll attest US-PHYSICAL-001" },
        out: "/repo/.roll/features/capture-tool/US-PHYSICAL-001/latest/screenshots/terminal.png",
        timeoutMs: 30000,
        createdAt: "2026-07-03T11:35:00.000+08:00",
      },
      response: {
        protocol: "roll.capture.v1",
        requestId: "US-PHYSICAL-001-physical-terminal",
        status: "taken",
        screenshotPath: "/repo/.roll/features/capture-tool/US-PHYSICAL-001/latest/screenshots/terminal.png",
        responsePath: "/Users/seanyao/Library/Application Support/Roll Capture/responses/response-US-PHYSICAL-001-physical-terminal.json",
        host: { appName: "Roll Capture.app", bundleId: "com.seanyao.roll.capture", version: "0.1.0" },
        startedAt: "2026-07-03T11:35:01.100+08:00",
        finishedAt: "2026-07-03T11:35:01.820+08:00",
      },
      ledger: {
        requestId: "US-PHYSICAL-001-physical-terminal",
        storyId: "US-PHYSICAL-001",
        runId: "20260703-193533",
        kind: "physical_terminal",
        status: "taken",
        screenshotPath: "/repo/.roll/features/capture-tool/US-PHYSICAL-001/latest/screenshots/terminal.png",
        responsePath: "/Users/seanyao/Library/Application Support/Roll Capture/responses/response-US-PHYSICAL-001-physical-terminal.json",
        reportPath: "/repo/.roll/features/capture-tool/US-PHYSICAL-001/latest/US-PHYSICAL-001-report.html",
        attachedToReport: true,
        startedAt: "2026-07-03T11:35:01.100+08:00",
        finishedAt: "2026-07-03T11:35:01.820+08:00",
      },
      malformedLedger: {
        requestId: "bad-request",
        status: "failed",
        responsePath: "/Users/seanyao/Library/Application Support/Roll Capture/responses/response-bad-request.json",
        attachedToReport: false,
        reason: "malformed request JSON",
        startedAt: "2026-07-03T11:35:01.100+08:00",
        finishedAt: "2026-07-03T11:35:01.820+08:00",
      },
    });
  });

  it("accepts a valid request whose output stays inside project .roll", () => {
    expect(validateRollCaptureRequestV1(validRequest(), { projectRoot })).toEqual({ ok: true, errors: [] });
  });

  it.each([
    ["wrong protocol", validRequest({ protocol: "roll.capture.v0" as RollCaptureRequestV1["protocol"] }), "unsupported protocol"],
    ["empty requestId", validRequest({ requestId: "" }), "invalid request id: empty"],
    ["unsafe output path", validRequest({ out: resolve(projectRoot, "screenshots/outside.png") }), "unsafe output path"],
    ["traversal output path", validRequest({ out: `${projectRoot}/.roll/features/../outside.png` }), 'must not contain a ".." component'],
    ["bad target dimensions", validRequest({ target: { type: "region", x: 0, y: 0, width: 0, height: 720 } }), "positive width and height"],
    ["fractional region x", validRequest({ target: { type: "region", x: 0.5, y: 0, width: 1280, height: 720 } }), "integer x/y/width/height"],
    ["fractional region y", validRequest({ target: { type: "region", x: 0, y: 0.5, width: 1280, height: 720 } }), "integer x/y/width/height"],
    ["fractional region width", validRequest({ target: { type: "region", x: 0, y: 0, width: 1280.5, height: 720 } }), "integer x/y/width/height"],
    ["fractional region height", validRequest({ target: { type: "region", x: 0, y: 0, width: 1280, height: 720.5 } }), "integer x/y/width/height"],
  ])("rejects %s", (_label, request, reason) => {
    const result = validateRollCaptureRequestV1(request, { projectRoot });

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(reason);
  });

  it("rejects output paths whose parent realpath escapes project .roll through a symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "roll-capture-spec-"));
    try {
      const outside = join(root, "outside");
      const project = join(root, "project");
      mkdirSync(join(project, ".roll"), { recursive: true });
      mkdirSync(outside, { recursive: true });
      symlinkSync(outside, join(project, ".roll", "screenshots"));

      const result = validateRollCaptureRequestV1(validRequest({ out: join(project, ".roll", "screenshots", "terminal.png") }), { projectRoot: project });

      expect(result.ok).toBe(false);
      expect(result.errors.join("\n")).toContain("unsafe output path");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("declares response schema variants that require screenshotPath only for taken and reason for non-taken", () => {
    expect(rollCaptureResponseV1Schema).toMatchObject({
      oneOf: [
        { properties: { status: { const: "taken" } }, required: expect.arrayContaining(["status", "screenshotPath"]) },
        { properties: { status: { const: "skipped" } }, required: expect.arrayContaining(["status", "reason"]) },
        { properties: { status: { const: "failed" } }, required: expect.arrayContaining(["status", "reason"]) },
      ],
    });
  });

  it("validates that taken responses include screenshotPath", () => {
    const req = validRequest();
    const response: RollCaptureResponseV1 = {
      protocol: ROLL_CAPTURE_PROTOCOL_V1,
      requestId: req.requestId,
      status: "taken",
      responsePath: "/Users/seanyao/Library/Application Support/Roll Capture/responses/response-US-PHYSICAL-001-physical-terminal.json",
      host: { appName: "Roll Capture.app", bundleId: "com.seanyao.roll.capture", version: "0.1.0" },
      startedAt: "2026-07-03T11:35:01.100+08:00",
      finishedAt: "2026-07-03T11:35:01.820+08:00",
    };

    const result = validateRollCaptureResponseV1(response, req);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("taken response requires screenshotPath");
  });

  it("validates that skipped and failed responses include reason", () => {
    const req = validRequest();
    const base = {
      protocol: ROLL_CAPTURE_PROTOCOL_V1,
      requestId: req.requestId,
      responsePath: "/Users/seanyao/Library/Application Support/Roll Capture/responses/response-US-PHYSICAL-001-physical-terminal.json",
      host: { appName: "Roll Capture.app", bundleId: "com.seanyao.roll.capture", version: "0.1.0" },
      startedAt: "2026-07-03T11:35:01.100+08:00",
      finishedAt: "2026-07-03T11:35:01.820+08:00",
    };

    expect(validateRollCaptureResponseV1({ ...base, status: "skipped" }, req).errors.join("\n")).toContain("skipped response requires reason");
    expect(validateRollCaptureResponseV1({ ...base, status: "failed" }, req).errors.join("\n")).toContain("failed response requires reason");
  });
});
