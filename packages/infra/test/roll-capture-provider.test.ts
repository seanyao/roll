import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RollCaptureRequestV1, RollCaptureResponseV1 } from "@roll/spec";
import { ROLL_CAPTURE_PROTOCOL_V1 } from "@roll/spec";
import { classifyRollCaptureResponseReadProblem, RollCaptureProvider } from "../src/index.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "roll-capture-provider-"));
  dirs.push(dir);
  return dir;
}

function request(root: string, id = "US-PHYSICAL-002-physical-terminal"): RollCaptureRequestV1 {
  return {
    protocol: ROLL_CAPTURE_PROTOCOL_V1,
    requestId: id,
    storyId: "US-PHYSICAL-002",
    runId: "20260703-193533",
    kind: "physical_terminal",
    target: { type: "window", appName: "Terminal", windowTitle: "roll attest US-PHYSICAL-002" },
    out: resolve(root, ".roll/features/capture-tool/US-PHYSICAL-002/latest/screenshots/terminal.png"),
    timeoutMs: 30_000,
    createdAt: "2026-07-03T11:35:00.000+08:00",
  };
}

function response(root: string, req: RollCaptureRequestV1, overrides: Partial<RollCaptureResponseV1> = {}): RollCaptureResponseV1 {
  return {
    protocol: ROLL_CAPTURE_PROTOCOL_V1,
    requestId: req.requestId,
    status: "taken",
    screenshotPath: req.out,
    responsePath: join(root, "responses", `response-${req.requestId}.json`),
    host: {
      appName: "Roll Capture.app",
      bundleId: "com.seanyao.roll.capture",
      version: "0.1.0",
    },
    startedAt: "2026-07-03T11:35:01.100+08:00",
    finishedAt: "2026-07-03T11:35:01.820+08:00",
    ...overrides,
  };
}

function writeResponse(root: string, res: RollCaptureResponseV1): void {
  mkdirSync(join(root, "responses"), { recursive: true });
  writeFileSync(join(root, "responses", `response-${res.requestId}.json`), JSON.stringify(res), "utf8");
}

function writeResponseForRequest(root: string, requestId: string, res: RollCaptureResponseV1): void {
  mkdirSync(join(root, "responses"), { recursive: true });
  writeFileSync(join(root, "responses", `response-${requestId}.json`), JSON.stringify(res), "utf8");
}

function writeRawResponseForRequest(root: string, requestId: string, value: unknown): void {
  mkdirSync(join(root, "responses"), { recursive: true });
  writeFileSync(join(root, "responses", `response-${requestId}.json`), typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

describe("US-PHYSICAL-002 RollCaptureProvider", () => {
  it("classifies half-written JSON and ENOENT as transient, but protocol/requestId/status errors as terminal", () => {
    const root = tempRoot();
    const req = request(root);

    expect(classifyRollCaptureResponseReadProblem({ stage: "parse", error: new SyntaxError("Unexpected end of JSON input") })).toMatchObject({
      kind: "transient",
    });
    expect(
      classifyRollCaptureResponseReadProblem({
        stage: "read",
        error: Object.assign(new Error("missing"), { code: "ENOENT" }),
      }),
    ).toMatchObject({ kind: "transient" });
    expect(
      classifyRollCaptureResponseReadProblem({
        stage: "shape",
        request: req,
        value: { ...response(root, req), protocol: "roll.capture.v0" },
      }),
    ).toMatchObject({ kind: "terminal", reason: 'response protocol "roll.capture.v0" does not match request protocol "roll.capture.v1"' });
    expect(
      classifyRollCaptureResponseReadProblem({
        stage: "shape",
        request: req,
        value: { ...response(root, req), requestId: "other-id" },
      }),
    ).toMatchObject({ kind: "terminal", reason: 'response id "other-id" does not match request id "US-PHYSICAL-002-physical-terminal"' });
    expect(
      classifyRollCaptureResponseReadProblem({
        stage: "shape",
        request: req,
        value: { ...response(root, req), status: "bogus" },
      }),
    ).toMatchObject({ kind: "terminal", reason: 'response status "bogus" is not one of taken, skipped, failed' });
  });

  it("writes request JSON via a sibling temp file and atomic rename into inbox", async () => {
    const root = tempRoot();
    const provider = new RollCaptureProvider({ root });
    const req = request(root);

    await provider.writeRequest(req);

    const path = join(root, "inbox", `request-${req.requestId}.json`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(req);
    expect(readdirSync(join(root, "inbox")).filter((name) => name.includes(".tmp"))).toEqual([]);
  });

  it("rejects duplicate request ids when a matching request or response file already exists", async () => {
    const root = tempRoot();
    const provider = new RollCaptureProvider({ root });
    const req = request(root);

    await provider.writeRequest(req);
    await expect(provider.writeRequest(req)).rejects.toThrow("duplicate_request_id");

    const responseOnlyReq = request(root, "US-PHYSICAL-002-response-duplicate");
    writeResponse(root, response(root, responseOnlyReq));
    await expect(provider.writeRequest(responseOnlyReq)).rejects.toThrow("duplicate_request_id");
  });

  it("returns taken(path) after a matching response JSON appears", async () => {
    const root = tempRoot();
    const provider = new RollCaptureProvider({ root, defaultPollIntervalMs: 1 });
    const req = request(root);
    await provider.writeRequest(req);
    writeResponse(root, response(root, req));

    await expect(provider.waitForResponse(req, { timeoutMs: 50 })).resolves.toMatchObject({
      status: "taken",
      path: req.out,
      response: { requestId: req.requestId, status: "taken" },
    });
  });

  it("keeps polling through transient malformed JSON until a complete response appears", async () => {
    const root = tempRoot();
    const req = request(root);
    let now = 0;
    let rewrote = false;
    const provider = new RollCaptureProvider({
      root,
      defaultPollIntervalMs: 10,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
        if (!rewrote) {
          writeResponse(root, response(root, req));
          rewrote = true;
        }
      },
    });
    writeRawResponseForRequest(root, req.requestId, "{");

    await expect(provider.waitForResponse(req, { timeoutMs: 50 })).resolves.toMatchObject({
      status: "taken",
      path: req.out,
    });
  });

  it("keeps polling through ENOENT response races until a response appears", async () => {
    const root = tempRoot();
    const req = request(root);
    let now = 0;
    const provider = new RollCaptureProvider({
      root,
      defaultPollIntervalMs: 10,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
        writeResponse(root, response(root, req));
      },
    });

    await expect(provider.waitForResponse(req, { timeoutMs: 50 })).resolves.toMatchObject({
      status: "taken",
      path: req.out,
    });
  });

  it("returns skipped(reason) for skipped responses", async () => {
    const root = tempRoot();
    const provider = new RollCaptureProvider({ root, defaultPollIntervalMs: 1 });
    const req = request(root);
    writeResponse(root, response(root, req, { status: "skipped", screenshotPath: undefined, reason: "Screen Recording permission missing" }));

    await expect(provider.waitForResponse(req, { timeoutMs: 50 })).resolves.toMatchObject({
      status: "skipped",
      reason: "Screen Recording permission missing",
    });
  });

  it("returns failed(reason) for failed responses and for mismatched protocol or requestId", async () => {
    const root = tempRoot();
    const provider = new RollCaptureProvider({ root, defaultPollIntervalMs: 1 });
    const req = request(root);
    writeResponse(root, response(root, req, { status: "failed", screenshotPath: undefined, reason: "target window unavailable" }));

    await expect(provider.waitForResponse(req, { timeoutMs: 50 })).resolves.toMatchObject({
      status: "failed",
      reason: "target window unavailable",
    });

    const mismatchReq = request(root, "US-PHYSICAL-002-mismatch");
    writeResponseForRequest(root, mismatchReq.requestId, response(root, mismatchReq, { requestId: "other-id" }));
    await expect(provider.waitForResponse(mismatchReq, { timeoutMs: 50 })).resolves.toMatchObject({
      status: "failed",
      reason: 'response id "other-id" does not match request id "US-PHYSICAL-002-mismatch"',
    });

    const protocolReq = request(root, "US-PHYSICAL-002-protocol-mismatch");
    writeResponseForRequest(
      root,
      protocolReq.requestId,
      response(root, protocolReq, { protocol: "roll.capture.v0" as RollCaptureResponseV1["protocol"] }),
    );
    await expect(provider.waitForResponse(protocolReq, { timeoutMs: 50 })).resolves.toMatchObject({
      status: "failed",
      reason: 'response protocol "roll.capture.v0" does not match request protocol "roll.capture.v1"',
    });

    const statusReq = request(root, "US-PHYSICAL-002-status-invalid");
    writeRawResponseForRequest(root, statusReq.requestId, { ...response(root, statusReq), status: "bogus" });
    await expect(provider.waitForResponse(statusReq, { timeoutMs: 50 })).resolves.toMatchObject({
      status: "failed",
      reason: 'response status "bogus" is not one of taken, skipped, failed',
    });
  });

  it("returns timeout with a clear reason and no undefined fields using an injected frozen clock", async () => {
    const root = tempRoot();
    let now = 100;
    const sleeps: number[] = [];
    const provider = new RollCaptureProvider({
      root,
      defaultPollIntervalMs: 10,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });
    const req = request(root);

    const result = await provider.waitForResponse(req, { timeoutMs: 25 });

    expect(result).toEqual({
      status: "timeout",
      reason: `timed out after 25ms waiting for ${join(root, "responses", `response-${req.requestId}.json`)}`,
    });
    expect(sleeps).toEqual([10, 10, 5]);
    expect(existsSync(join(root, "responses", `response-${req.requestId}.json`))).toBe(false);
  });
});
