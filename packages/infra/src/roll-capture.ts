import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_POLL_INTERVAL_MS = 250;

export type RollCaptureResponseReadProblem =
  | { stage: "read"; error: unknown }
  | { stage: "parse"; error: unknown }
  | { stage: "shape"; value: unknown; request: RollCaptureRequestV1 };

export type RollCaptureResponseReadProblemClassification = {
  kind: "transient" | "terminal";
  reason: string;
};

export class RollCaptureProvider implements RollCaptureProviderPort {
  readonly root: string;
  readonly inbox: string;
  readonly responses: string;
  private readonly defaultPollIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: RollCaptureProviderOptions = {}) {
    this.root = options.root ?? defaultRollCaptureRoot();
    this.inbox = join(this.root, "inbox");
    this.responses = join(this.root, "responses");
    this.defaultPollIntervalMs = options.defaultPollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? sleep;
  }

  async writeRequest(request: RollCaptureRequestV1): Promise<void> {
    await this.ensureLayout();
    const path = this.requestPath(request.requestId);
    if ((await fileExists(path)) || (await fileExists(this.responsePath(request.requestId)))) {
      throw new Error(`duplicate_request_id: ${request.requestId}`);
    }
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
      throw new RollCaptureResponseReadError(classifyRollCaptureResponseReadProblem({ stage: "parse", error }));
    }
    const response = parseRollCaptureResponseV1(value);
    if (response === null) throw new RollCaptureResponseReadError(classifyRollCaptureResponseReadProblem({ stage: "shape", value, request }));
    const validation = validateRollCaptureResponseV1(response, request);
    if (!validation.ok) throw new RollCaptureResponseReadError({ kind: "terminal", reason: validation.errors.join("; ") });
    return response;
  }

  async waitForResponse(request: RollCaptureRequestV1, options: RollCaptureWaitOptions): Promise<RollCaptureProviderResult> {
    await this.ensureLayout();
    const timeoutMs = Math.max(0, options.timeoutMs);
    const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? this.defaultPollIntervalMs);
    const startedAt = this.now();
    const deadline = startedAt + timeoutMs;

    while (this.now() <= deadline) {
      try {
        const response = await this.readResponse(request);
        if (response !== null) return resultFromResponse(response);
      } catch (error) {
        if (error instanceof RollCaptureResponseReadError && error.classification.kind === "transient") {
          const remainingMs = deadline - this.now();
          if (remainingMs <= 0) break;
          await this.sleep(Math.min(pollIntervalMs, remainingMs));
          continue;
        }
        return { status: "failed", reason: error instanceof Error ? error.message : String(error), response: failedResponse(request, this.responsePath(request.requestId), error) };
      }
      const remainingMs = deadline - this.now();
      if (remainingMs <= 0) break;
      await this.sleep(Math.min(pollIntervalMs, remainingMs));
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

export function classifyRollCaptureResponseReadProblem(problem: RollCaptureResponseReadProblem): RollCaptureResponseReadProblemClassification {
  if (problem.stage === "read") {
    if (isNodeError(problem.error) && problem.error.code === "ENOENT") return { kind: "transient", reason: "response file is not ready yet" };
    return { kind: "terminal", reason: problem.error instanceof Error ? problem.error.message : String(problem.error) };
  }
  if (problem.stage === "parse") {
    return { kind: "transient", reason: `malformed response JSON: ${problem.error instanceof Error ? problem.error.message : String(problem.error)}` };
  }

  const value = problem.value;
  if (!isRecord(value)) return { kind: "terminal", reason: "response JSON must be an object" };
  const protocol = value["protocol"];
  if (protocol !== problem.request.protocol) {
    return { kind: "terminal", reason: `response protocol "${String(protocol)}" does not match request protocol "${problem.request.protocol}"` };
  }
  const requestId = value["requestId"];
  if (requestId !== problem.request.requestId) {
    return { kind: "terminal", reason: `response id "${String(requestId)}" does not match request id "${problem.request.requestId}"` };
  }
  const status = value["status"];
  if (status !== "taken" && status !== "skipped" && status !== "failed") {
    return { kind: "terminal", reason: `response status "${String(status)}" is not one of taken, skipped, failed` };
  }
  return { kind: "terminal", reason: "response JSON does not match roll.capture.v1 schema" };
}

class RollCaptureResponseReadError extends Error {
  readonly classification: RollCaptureResponseReadProblemClassification;

  constructor(classification: RollCaptureResponseReadProblemClassification) {
    super(classification.reason);
    this.name = "RollCaptureResponseReadError";
    this.classification = classification;
  }
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
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
