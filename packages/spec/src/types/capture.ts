import { isAbsolute, resolve, sep } from "node:path";
import type { JsonSchema } from "./json-schema.js";
import type { ToolDeclaration } from "./tool.js";

export const ROLL_CAPTURE_PROTOCOL_V1 = "roll.capture.v1";
export const ROLL_CAPTURE_PROVIDER = "roll-capture";
export const ROLL_CAPTURE_PLATFORM = "darwin";
export const ROLL_CAPTURE_HOST_APP_NAME = "Roll Capture.app";
export const ROLL_CAPTURE_HOST_BUNDLE_ID = "com.seanyao.roll.capture";

export type CaptureKind = "web" | "terminal" | "physical_terminal" | "region" | "display";
export type CaptureStatus = "taken" | "skipped" | "failed";

export type CaptureTarget =
  | { type: "window"; appName: string; windowTitle?: string }
  | { type: "region"; x: number; y: number; width: number; height: number }
  | { type: "display"; displayId?: string };

export type RollCaptureRequestV1 = {
  protocol: typeof ROLL_CAPTURE_PROTOCOL_V1;
  requestId: string;
  storyId?: string;
  runId?: string;
  kind: CaptureKind;
  target: CaptureTarget;
  out: string;
  timeoutMs: number;
  createdAt: string;
};

export type CaptureHost = {
  appName: typeof ROLL_CAPTURE_HOST_APP_NAME;
  bundleId: typeof ROLL_CAPTURE_HOST_BUNDLE_ID;
  version: string;
};

export type RollCaptureResponseV1 = {
  protocol: typeof ROLL_CAPTURE_PROTOCOL_V1;
  requestId: string;
  status: CaptureStatus;
  screenshotPath?: string;
  responsePath: string;
  reason?: string;
  host: CaptureHost;
  startedAt: string;
  finishedAt: string;
};

export type CaptureLedgerEntry = {
  requestId: string;
  storyId?: string;
  runId?: string;
  kind?: CaptureKind;
  status: CaptureStatus;
  screenshotPath?: string;
  responsePath: string;
  reportPath?: string;
  attachedToReport: boolean;
  reason?: string;
  startedAt: string;
  finishedAt: string;
};

export type RollCaptureValidationResult =
  | { ok: true; errors: [] }
  | { ok: false; errors: readonly string[] };

export type RollCaptureRequestValidationOptions = {
  projectRoot: string;
  expectedRequestId?: string;
};

const stringSchema: JsonSchema = { type: "string" };
const nonEmptyStringSchema: JsonSchema = { type: "string", minLength: 1 };
const integerSchema: JsonSchema = { type: "integer" };
const booleanSchema: JsonSchema = { type: "boolean" };
const numberSchema: JsonSchema = { type: "number" };

function objectSchema(properties: Readonly<Record<string, JsonSchema>>, required: readonly string[] = []): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

const captureKindSchema: JsonSchema = { type: "string", enum: ["web", "terminal", "physical_terminal", "region", "display"] };
const captureStatusSchema: JsonSchema = { type: "string", enum: ["taken", "skipped", "failed"] };
const captureTargetSchema: JsonSchema = {
  oneOf: [
    objectSchema({ type: { const: "window" }, appName: nonEmptyStringSchema, windowTitle: stringSchema }, ["type", "appName"]),
    objectSchema({ type: { const: "region" }, x: integerSchema, y: integerSchema, width: integerSchema, height: integerSchema }, ["type", "x", "y", "width", "height"]),
    objectSchema({ type: { const: "display" }, displayId: stringSchema }, ["type"]),
  ],
};
const captureHostSchema = objectSchema(
  {
    appName: { const: ROLL_CAPTURE_HOST_APP_NAME },
    bundleId: { const: ROLL_CAPTURE_HOST_BUNDLE_ID },
    version: nonEmptyStringSchema,
  },
  ["appName", "bundleId", "version"],
);

export const rollCaptureRequestV1Schema: JsonSchema = objectSchema(
  {
    protocol: { const: ROLL_CAPTURE_PROTOCOL_V1 },
    requestId: nonEmptyStringSchema,
    storyId: stringSchema,
    runId: stringSchema,
    kind: captureKindSchema,
    target: captureTargetSchema,
    out: nonEmptyStringSchema,
    timeoutMs: integerSchema,
    createdAt: nonEmptyStringSchema,
  },
  ["protocol", "requestId", "kind", "target", "out", "timeoutMs", "createdAt"],
);

export const rollCaptureResponseV1Schema: JsonSchema = objectSchema(
  {
    protocol: { const: ROLL_CAPTURE_PROTOCOL_V1 },
    requestId: nonEmptyStringSchema,
    status: captureStatusSchema,
    screenshotPath: stringSchema,
    responsePath: nonEmptyStringSchema,
    reason: stringSchema,
    host: captureHostSchema,
    startedAt: nonEmptyStringSchema,
    finishedAt: nonEmptyStringSchema,
  },
  ["protocol", "requestId", "status", "responsePath", "host", "startedAt", "finishedAt"],
);

export const captureLedgerEntrySchema: JsonSchema = objectSchema(
  {
    requestId: nonEmptyStringSchema,
    storyId: stringSchema,
    runId: stringSchema,
    kind: captureKindSchema,
    status: captureStatusSchema,
    screenshotPath: stringSchema,
    responsePath: nonEmptyStringSchema,
    reportPath: stringSchema,
    attachedToReport: booleanSchema,
    reason: stringSchema,
    startedAt: nonEmptyStringSchema,
    finishedAt: nonEmptyStringSchema,
  },
  ["requestId", "status", "responsePath", "attachedToReport", "startedAt", "finishedAt"],
);

export const rollCaptureToolOutputSchema: JsonSchema = toolResultSchema(
  objectSchema(
    {
      status: { type: "string", enum: ["taken", "skipped", "failed", "timeout"] },
      path: stringSchema,
      reason: stringSchema,
      response: rollCaptureResponseV1Schema,
    },
    ["status"],
  ),
);

export const physicalScreenshotToolInputSchema: JsonSchema = {
  title: "Roll Capture request",
  oneOf: [rollCaptureRequestV1Schema],
};

export const PHYSICAL_SCREENSHOT_TOOL_CONTRACT: ToolDeclaration = {
  id: "physical.screenshot" as ToolDeclaration["id"],
  kind: "browser",
  title: "Physical Screenshot",
  description: "Request real physical screen pixels through Roll Capture.app.",
  provider: ROLL_CAPTURE_PROVIDER,
  protocol: ROLL_CAPTURE_PROTOCOL_V1,
  platform: ROLL_CAPTURE_PLATFORM,
  defaults: {
    enabled: true,
    timeoutMs: 60_000,
    sandbox: { maxOutputBytes: 2 * 1024 * 1024 },
  },
  requirements: [{ kind: "service", name: "roll-capture-app", optional: false }],
  inputSchema: physicalScreenshotToolInputSchema,
  outputSchema: rollCaptureToolOutputSchema,
};

export function parseRollCaptureRequestV1(value: unknown): RollCaptureRequestV1 | null {
  if (!isRecord(value)) return null;
  if (value["protocol"] !== ROLL_CAPTURE_PROTOCOL_V1) return null;
  if (typeof value["requestId"] !== "string") return null;
  if (!isCaptureKind(value["kind"])) return null;
  const target = parseCaptureTarget(value["target"]);
  if (target === null) return null;
  if (typeof value["out"] !== "string") return null;
  if (typeof value["timeoutMs"] !== "number") return null;
  if (typeof value["createdAt"] !== "string") return null;
  return {
    protocol: ROLL_CAPTURE_PROTOCOL_V1,
    requestId: value["requestId"],
    ...(typeof value["storyId"] === "string" ? { storyId: value["storyId"] } : {}),
    ...(typeof value["runId"] === "string" ? { runId: value["runId"] } : {}),
    kind: value["kind"],
    target,
    out: value["out"],
    timeoutMs: value["timeoutMs"],
    createdAt: value["createdAt"],
  };
}

export function parseRollCaptureResponseV1(value: unknown): RollCaptureResponseV1 | null {
  if (!isRecord(value)) return null;
  if (value["protocol"] !== ROLL_CAPTURE_PROTOCOL_V1) return null;
  if (typeof value["requestId"] !== "string") return null;
  if (!isCaptureStatus(value["status"])) return null;
  if (typeof value["responsePath"] !== "string") return null;
  const host = parseCaptureHost(value["host"]);
  if (host === null) return null;
  if (typeof value["startedAt"] !== "string" || typeof value["finishedAt"] !== "string") return null;
  return {
    protocol: ROLL_CAPTURE_PROTOCOL_V1,
    requestId: value["requestId"],
    status: value["status"],
    ...(typeof value["screenshotPath"] === "string" ? { screenshotPath: value["screenshotPath"] } : {}),
    responsePath: value["responsePath"],
    ...(typeof value["reason"] === "string" ? { reason: value["reason"] } : {}),
    host,
    startedAt: value["startedAt"],
    finishedAt: value["finishedAt"],
  };
}

export function validateRollCaptureRequestV1(
  request: RollCaptureRequestV1,
  options: RollCaptureRequestValidationOptions,
): RollCaptureValidationResult {
  const errors: string[] = [];
  if (request.protocol !== ROLL_CAPTURE_PROTOCOL_V1) {
    errors.push(`unsupported protocol "${request.protocol}", expected ${ROLL_CAPTURE_PROTOCOL_V1}`);
  }
  errors.push(...validateRequestId(request.requestId, options.expectedRequestId));
  errors.push(...validateTarget(request.target));
  errors.push(...validateOutputPath(request.out, options.projectRoot));
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs <= 0 || request.timeoutMs > 600_000) {
    errors.push(`invalid timeout: ${request.timeoutMs}ms outside 1...600000`);
  }
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

export function validateRollCaptureResponseV1(
  response: RollCaptureResponseV1,
  request: RollCaptureRequestV1,
): RollCaptureValidationResult {
  const errors: string[] = [];
  if (response.protocol !== request.protocol) {
    errors.push(`response protocol "${response.protocol}" does not match request protocol "${request.protocol}"`);
  }
  if (response.requestId !== request.requestId) {
    errors.push(`response id "${response.requestId}" does not match request id "${request.requestId}"`);
  }
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

function validateRequestId(requestId: string, expectedRequestId: string | undefined): string[] {
  const errors: string[] = [];
  if (requestId.length === 0) errors.push("invalid request id: empty");
  if (/[^A-Za-z0-9._-]/u.test(requestId)) errors.push("invalid request id: contains illegal characters (allowed: A-Z a-z 0-9 . _ -)");
  if (requestId.includes("..")) errors.push('invalid request id: contains ".."');
  if (expectedRequestId !== undefined && requestId !== expectedRequestId) {
    errors.push(`invalid request id: body id "${requestId}" does not match request file id "${expectedRequestId}"`);
  }
  return errors;
}

function validateTarget(target: CaptureTarget): string[] {
  if (target.type === "window" && target.appName.trim().length === 0) {
    return ["unsupported target: window target requires a non-empty appName"];
  }
  if (target.type === "region" && (target.width <= 0 || target.height <= 0)) {
    return [`unsupported target: region target requires positive width and height, got ${target.width}x${target.height}`];
  }
  return [];
}

function validateOutputPath(out: string, projectRoot: string): string[] {
  if (out.length === 0) return ["unsafe output path: empty"];
  if (!isAbsolute(out)) return [`unsafe output path: must be an absolute path, got "${out}"`];
  if (out.split(/[\\/]+/u).includes("..")) return ['unsafe output path: must not contain a ".." component'];
  const rollRoot = withTrailingSeparator(resolve(projectRoot, ".roll"));
  const candidate = withTrailingSeparator(resolve(out));
  if (candidate !== rollRoot && !candidate.startsWith(rollRoot)) {
    return [`unsafe output path: must be inside project .roll (${resolve(projectRoot, ".roll")})`];
  }
  return [];
}

function parseCaptureTarget(value: unknown): CaptureTarget | null {
  if (!isRecord(value) || typeof value["type"] !== "string") return null;
  if (value["type"] === "window") {
    if (typeof value["appName"] !== "string") return null;
    return { type: "window", appName: value["appName"], ...(typeof value["windowTitle"] === "string" ? { windowTitle: value["windowTitle"] } : {}) };
  }
  if (value["type"] === "region") {
    if (typeof value["x"] !== "number" || typeof value["y"] !== "number" || typeof value["width"] !== "number" || typeof value["height"] !== "number") return null;
    return { type: "region", x: value["x"], y: value["y"], width: value["width"], height: value["height"] };
  }
  if (value["type"] === "display") {
    return { type: "display", ...(typeof value["displayId"] === "string" ? { displayId: value["displayId"] } : {}) };
  }
  return null;
}

function parseCaptureHost(value: unknown): CaptureHost | null {
  if (!isRecord(value)) return null;
  if (value["appName"] !== ROLL_CAPTURE_HOST_APP_NAME || value["bundleId"] !== ROLL_CAPTURE_HOST_BUNDLE_ID) return null;
  if (typeof value["version"] !== "string") return null;
  return { appName: ROLL_CAPTURE_HOST_APP_NAME, bundleId: ROLL_CAPTURE_HOST_BUNDLE_ID, version: value["version"] };
}

function isCaptureKind(value: unknown): value is CaptureKind {
  return value === "web" || value === "terminal" || value === "physical_terminal" || value === "region" || value === "display";
}

function isCaptureStatus(value: unknown): value is CaptureStatus {
  return value === "taken" || value === "skipped" || value === "failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withTrailingSeparator(path: string): string {
  return path.endsWith(sep) ? path : `${path}${sep}`;
}

function toolResultSchema(output: JsonSchema): JsonSchema {
  const meta = objectSchema(
    {
      invocationId: stringSchema,
      toolId: stringSchema,
      caller: { type: "object", additionalProperties: true },
      startedAt: numberSchema,
      endedAt: numberSchema,
      durationMs: numberSchema,
      attempt: integerSchema,
    },
    ["invocationId", "toolId", "caller", "startedAt", "endedAt", "durationMs"],
  );
  const error = objectSchema(
    {
      code: { type: "string", enum: ["not_found", "init_failed", "policy_denied", "budget_exhausted", "sandbox_denied", "timeout", "adapter_error", "invalid_input", "unknown"] },
      message: stringSchema,
      retryable: booleanSchema,
      detail: true,
    },
    ["code", "message", "retryable"],
  );
  return {
    oneOf: [
      objectSchema({ ok: { const: true }, output, meta, warnings: { type: "array", items: stringSchema } }, ["ok", "output", "meta"]),
      objectSchema({ ok: { const: false }, error, meta, warnings: { type: "array", items: stringSchema } }, ["ok", "error", "meta"]),
    ],
  };
}
