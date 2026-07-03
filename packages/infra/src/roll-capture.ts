import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { RollCaptureRequestV1, RollCaptureResponseV1 } from "@roll/spec";
import { parseRollCaptureResponseV1, validateRollCaptureResponseV1 } from "@roll/spec";

export type RollCaptureProviderResult =
  | { status: "taken"; path: string; response: RollCaptureResponseV1 }
  | { status: "skipped"; reason: string; response: RollCaptureResponseV1 }
  | { status: "failed"; reason: string; response: RollCaptureResponseV1 }
  | { status: "timeout"; reason: string };

export type RollCaptureWaitOptions = {
  timeoutMs: number;
  pollIntervalMs?: number;
};

export interface RollCaptureProviderPort {
  writeRequest(request: RollCaptureRequestV1): Promise<void>;
  readResponse(request: RollCaptureRequestV1): Promise<RollCaptureResponseV1 | null>;
  waitForResponse(request: RollCaptureRequestV1, options: RollCaptureWaitOptions): Promise<RollCaptureProviderResult>;
}

export type RollCaptureProviderOptions = {
  root?: string;
  defaultPollIntervalMs?: number;
};

const DEFAULT_POLL_INTERVAL_MS = 250;

export class RollCaptureProvider implements RollCaptureProviderPort {
  readonly root: string;
  readonly inbox: string;
  readonly responses: string;
  private readonly defaultPollIntervalMs: number;

  constructor(options: RollCaptureProviderOptions = {}) {
    this.root = options.root ?? defaultRollCaptureRoot();
    this.inbox = join(this.root, "inbox");
    this.responses = join(this.root, "responses");
    this.defaultPollIntervalMs = options.defaultPollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  async writeRequest(request: RollCaptureRequestV1): Promise<void> {
    await this.ensureLayout();
    const path = this.requestPath(request.requestId);
    await writeAtomically(JSON.stringify(request, null, 2) + "\n", path);
  }

  async readResponse(request: RollCaptureRequestV1): Promise<RollCaptureResponseV1 | null> {
    const path = this.responsePath(request.requestId);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null;
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new Error(`malformed response JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const response = parseRollCaptureResponseV1(value);
    if (response === null) throw new Error(responseShapeReason(value, request));
    const validation = validateRollCaptureResponseV1(response, request);
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    return response;
  }

  async waitForResponse(request: RollCaptureRequestV1, options: RollCaptureWaitOptions): Promise<RollCaptureProviderResult> {
    await this.ensureLayout();
    const timeoutMs = Math.max(0, options.timeoutMs);
    const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? this.defaultPollIntervalMs);
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;

    while (Date.now() <= deadline) {
      try {
        const response = await this.readResponse(request);
        if (response !== null) return resultFromResponse(response);
      } catch (error) {
        return { status: "failed", reason: error instanceof Error ? error.message : String(error), response: failedResponse(request, this.responsePath(request.requestId), error) };
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      await sleep(Math.min(pollIntervalMs, remainingMs));
    }

    return {
      status: "timeout",
      reason: `timed out after ${timeoutMs}ms waiting for ${this.responsePath(request.requestId)}`,
    };
  }

  requestPath(requestId: string): string {
    return join(this.inbox, `request-${requestId}.json`);
  }

  responsePath(requestId: string): string {
    return join(this.responses, `response-${requestId}.json`);
  }

  private async ensureLayout(): Promise<void> {
    await mkdir(this.inbox, { recursive: true });
    await mkdir(this.responses, { recursive: true });
  }
}

export function defaultRollCaptureRoot(home = homedir()): string {
  return join(home, "Library", "Application Support", "Roll Capture");
}

async function writeAtomically(data: string, path: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const tempPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, data, "utf8");
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

function resultFromResponse(response: RollCaptureResponseV1): RollCaptureProviderResult {
  if (response.status === "taken") {
    if (response.screenshotPath === undefined || response.screenshotPath.length === 0) {
      return { status: "failed", reason: "taken response did not include screenshotPath", response };
    }
    return { status: "taken", path: response.screenshotPath, response };
  }
  if (response.status === "skipped") {
    return { status: "skipped", reason: response.reason ?? "Roll Capture skipped without a reason", response };
  }
  return { status: "failed", reason: response.reason ?? "Roll Capture failed without a reason", response };
}

function responseShapeReason(value: unknown, request: RollCaptureRequestV1): string {
  if (!isRecord(value)) return "response JSON must be an object";
  const protocol = value["protocol"];
  if (protocol !== request.protocol) return `response protocol "${String(protocol)}" does not match request protocol "${request.protocol}"`;
  const requestId = value["requestId"];
  if (requestId !== request.requestId) return `response id "${String(requestId)}" does not match request id "${request.requestId}"`;
  return "response JSON does not match roll.capture.v1 schema";
}

function failedResponse(request: RollCaptureRequestV1, responsePath: string, error: unknown): RollCaptureResponseV1 {
  const now = new Date().toISOString();
  return {
    protocol: request.protocol,
    requestId: request.requestId,
    status: "failed",
    responsePath,
    reason: error instanceof Error ? error.message : String(error),
    host: {
      appName: "Roll Capture.app",
      bundleId: "com.seanyao.roll.capture",
      version: "unknown",
    },
    startedAt: now,
    finishedAt: now,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
