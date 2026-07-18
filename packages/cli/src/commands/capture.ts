/**
 * `roll capture` — US-EVID-032 capture policy migration, evidence-only repair,
 * and readiness status.
 *
 *   roll capture status  [--project <path>] [--json]
 *     Show v2 gateway + renderer readiness and the effective capture policy,
 *     each with an actionable reason (AC4).
 *
 *   roll capture migrate [--project <path>] [--revert] [--dry-run] [--json]
 *     Enable best_effort ONLY when the v2 gateway AND renderer are both ready;
 *     otherwise retain the existing policy with an explicit reason. Idempotent
 *     and reversible (`--revert`). Writes .roll/policy.yaml unless --dry-run (AC1).
 *
 *   roll capture repair <story-id> [--project <path>] [--health <path>] [--json]
 *     Evidence-only repair for a `degraded-infrastructure` record: re-run the
 *     capture lanes and re-resolve evidence health WITHOUT reopening the
 *     completed build. Refuses (never rebuilds) for a failed delivery or any
 *     non-degraded state (AC2).
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  isEvidenceOnlyRepairable,
  planCapturePolicyMigration,
  repairDegradedEvidence,
  revertCapturePolicyMigration,
  type CaptureLanePort,
  type CaptureMigrationCapabilities,
  type CaptureReceiptStorePort,
  type DeclaredSurface,
  type EvidenceHealthFact,
} from "@roll/core";
import {
  RollCaptureReceiptStore,
  captureControlledLocalPage,
  isLoopbackCaptureUrl,
  type ControlledLocalPageCaptureInput,
  type ControlledLocalWindowCaptureResult,
  type ControlledPrepareAction,
} from "@roll/infra";
import { collectCapturePolicyReadiness, renderCapturePolicyReadinessDoctorSection, type CapturePolicyReadiness } from "../lib/capture-policy-readiness.js";

export const CAPTURE_USAGE =
  "Usage: roll capture <status|migrate|repair|local-window>\n" +
  "  status  [--project <path>] [--json]                 gateway/renderer readiness + effective capture policy\n" +
  "  migrate [--project <path>] [--revert] [--dry-run] [--json]  enable best_effort when capabilities are ready; reversible\n" +
  "  repair  <story-id> [--project <path>] [--health <path>] [--json]  evidence-only repair; never reopens the build\n" +
  "  local-window --story <ID> --url <loopback-url> [--prepare <json>] [--run <id>] [--project <path>] [--json]  isolated local synthetic page only\n" +
  "截图策略迁移、仅证据修复与就绪度：migrate 仅在网关+渲染器就绪时启用 best_effort（可回退）；repair 只重跑截图、绝不重建交付；local-window 仅捕获隔离的本地合成页面。\n";

export interface CaptureCommandDeps {
  /** Read a text file; null when absent/unreadable. */
  readFileText?: (path: string) => string | null;
  /** Atomically write policy / health text. */
  writeFileText?: (path: string, text: string) => void;
  /** Readiness collector (injected for tests). */
  readiness?: (projectRoot: string) => CapturePolicyReadiness;
  /** Prior evidence-health fact reader for `repair` (injected for tests). */
  readHealthFact?: (path: string) => EvidenceHealthFact | null;
  /** Capture lanes for a real re-capture during `repair` (default: none wired). */
  lanes?: readonly CaptureLanePort[];
  /** Receipt store for `repair` (default: real RollCaptureReceiptStore). */
  store?: CaptureReceiptStorePort;
  /** Declared surface resolver for `repair` (from the story spec). */
  resolveSurface?: (storyId: string, projectRoot: string) => DeclaredSurface | null;
  /** FIX-005: isolated, loopback-only visible Chrome + Roll Capture lane. */
  captureLocalWindow?: (input: ControlledLocalPageCaptureInput) => Promise<ControlledLocalWindowCaptureResult>;
  now?: () => Date;
}

function defaultReadFileText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function defaultWriteFileText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function flagValue(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return undefined;
}

export async function captureCommand(args: string[], deps: CaptureCommandDeps = {}): Promise<number> {
  const sub = args[0] ?? "";
  if (sub === "" || sub === "help" || sub === "--help" || sub === "-h") {
    process.stdout.write(CAPTURE_USAGE);
    return 0;
  }
  const rest = args.slice(1);
  if (sub === "status") return captureStatus(rest, deps);
  if (sub === "migrate") return captureMigrate(rest, deps);
  if (sub === "repair") return captureRepair(rest, deps);
  if (sub === "local-window") return captureLocalWindow(rest, deps);
  process.stderr.write(`[roll] unknown 'roll capture' subcommand: ${sub}\n`);
  process.stderr.write(CAPTURE_USAGE);
  return 1;
}

// ── local-window (FIX-005) ──────────────────────────────────────────────────

async function captureLocalWindow(args: string[], deps: CaptureCommandDeps): Promise<number> {
  const storyId = flagValue(args, "--story");
  const url = flagValue(args, "--url");
  const projectRoot = flagValue(args, "--project") ?? process.cwd();
  const runId = flagValue(args, "--run") ?? `local-${(deps.now ?? (() => new Date()))().toISOString().replace(/[^0-9]/gu, "")}`;
  const rawPrepare = flagValue(args, "--prepare");
  const json = args.includes("--json");
  if (storyId === undefined || url === undefined) {
    process.stdout.write("Usage: roll capture local-window --story <ID> --url <loopback-url> [--run <id>] [--project <path>] [--json]\n");
    return 1;
  }
  if (!safeSegment(storyId) || !safeSegment(runId)) {
    process.stdout.write("local-window requires safe story and run identifiers (letters, digits, dot, underscore, hyphen only).\n");
    return 1;
  }
  if (!isLoopbackCaptureUrl(url)) {
    process.stdout.write("local-window only permits loopback HTTP(S) pages; no owner Chrome or remote URL was opened.\n");
    return 1;
  }
  const prepare = parseControlledPrepare(rawPrepare);
  if (typeof prepare === "string") {
    process.stdout.write(`local-window ${prepare}\n`);
    return 1;
  }

  const now = (deps.now ?? (() => new Date()))();
  const captureId = randomUUID();
  const result = await (deps.captureLocalWindow ?? captureControlledLocalPage)({
    projectRoot,
    url,
    prepare,
    request: {
      protocol: "roll.capture.v1",
      requestId: `controlled-${storyId}-${captureId}`,
      storyId,
      runId,
      kind: "web",
      out: join(projectRoot, ".roll", "captures", "controlled-local", storyId, runId, `controlled-window-${captureId}.png`),
      timeoutMs: 60_000,
      createdAt: now.toISOString(),
    },
  });
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write([
      `local-window capture: ${result.status}`,
      "  browser extension: not used",
      "  privacy: loopback-only synthetic target in a temporary profile",
      ...(result.selector === undefined ? [] : [`  selector: ${result.selector.appName} · ${result.selector.windowTitle}`]),
      ...(result.path === undefined ? [] : [`  screenshot: ${result.path}`]),
      ...(result.response?.responsePath === undefined ? [] : [`  receipt: ${result.response.responsePath}`]),
      ...(result.reason === undefined ? [] : [`  reason: ${result.reason}`]),
    ].join("\n") + "\n");
  }
  return result.status === "taken" ? 0 : 1;
}

function parseControlledPrepare(raw: string | undefined): readonly ControlledPrepareAction[] | undefined | string {
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "prepare must be a JSON action list";
  }
  if (!Array.isArray(parsed)) return "prepare must be a JSON action list";
  if (parsed.length > 16) return "prepare allows at most 16 actions";
  let totalWaitMs = 0;
  const actions: ControlledPrepareAction[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return "prepare action must be an object";
    const action = item as Record<string, unknown>;
    const kind = action.kind;
    if (kind === "wait") {
      if (!hasOnly(action, ["kind", "ms"]) || typeof action.ms !== "number" || !Number.isInteger(action.ms) || action.ms < 0 || action.ms > 5_000) {
        return "prepare wait requires only kind and an integer ms from 0 to 5000";
      }
      totalWaitMs += action.ms;
      if (totalWaitMs > 15_000) return "prepare waits may total at most 15000ms";
      actions.push({ kind, ms: action.ms });
      continue;
    }
    if (kind === "click" || kind === "scroll") {
      if (!hasOnly(action, ["kind", "selector"]) || !validPrepareSelector(action.selector)) {
        return `prepare ${kind} requires only kind and a non-empty selector`;
      }
      actions.push({ kind, selector: action.selector });
      continue;
    }
    if (kind === "fill") {
      if (!hasOnly(action, ["kind", "selector", "value"]) || !validPrepareSelector(action.selector) || typeof action.value !== "string" || action.value.length > 1_000) {
        return "prepare fill requires only kind, a non-empty selector, and a value of at most 1000 characters";
      }
      actions.push({ kind, selector: action.selector, value: action.value });
      continue;
    }
    return "prepare only permits click, fill, wait, and scroll actions";
  }
  return actions;
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function validPrepareSelector(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= 500;
}

function safeSegment(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(value) && !value.includes("..");
}

// ── status (AC4) ──────────────────────────────────────────────────────────────

function captureStatus(args: string[], deps: CaptureCommandDeps): number {
  const projectRoot = flagValue(args, "--project") ?? process.cwd();
  const readiness = (deps.readiness ?? ((root: string) => collectCapturePolicyReadiness({ projectRoot: root })))(projectRoot);
  if (args.includes("--json")) {
    process.stdout.write(JSON.stringify(readiness, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(renderCapturePolicyReadinessDoctorSection(readiness).join("\n") + "\n");
  return 0;
}

// ── migrate (AC1) ─────────────────────────────────────────────────────────────

function captureMigrate(args: string[], deps: CaptureCommandDeps): number {
  const projectRoot = flagValue(args, "--project") ?? process.cwd();
  const dryRun = args.includes("--dry-run");
  const revert = args.includes("--revert");
  const json = args.includes("--json");
  const readFileText = deps.readFileText ?? defaultReadFileText;
  const writeFileText = deps.writeFileText ?? defaultWriteFileText;
  const policyPath = join(projectRoot, ".roll", "policy.yaml");
  const policyYaml = readFileText(policyPath) ?? "";

  if (revert) {
    const result = revertCapturePolicyMigration(policyYaml);
    if (result.changed && !dryRun) writeFileText(policyPath, result.nextYaml);
    if (json) {
      process.stdout.write(JSON.stringify({ mode: "revert", ...result, dryRun }, null, 2) + "\n");
    } else {
      process.stdout.write(`capture migrate --revert: ${result.reason}${dryRun ? " (dry-run; not written)" : result.changed ? " (written)" : " (no change)"}\n`);
    }
    return 0;
  }

  const readiness = (deps.readiness ?? ((root: string) => collectCapturePolicyReadiness({ projectRoot: root })))(projectRoot);
  const capabilities: CaptureMigrationCapabilities = {
    gateway: { available: readiness.gateway.available, reason: readiness.gateway.reason },
    renderer: { available: readiness.renderer.available, reason: readiness.renderer.reason },
  };
  const plan = planCapturePolicyMigration({ policyYaml, capabilities });
  if (plan.changed && !dryRun) writeFileText(policyPath, plan.nextYaml);
  if (json) {
    process.stdout.write(JSON.stringify({ mode: "migrate", ...plan, dryRun }, null, 2) + "\n");
  } else {
    const suffix = dryRun ? " (dry-run; not written)" : plan.changed ? " (written)" : " (no change)";
    process.stdout.write(`capture migrate: ${plan.action} (${plan.reasonCode})\n  ${plan.reason}${suffix}\n`);
  }
  return 0;
}

// ── repair (AC2) ──────────────────────────────────────────────────────────────

/** Default location of the durable evidence-health fact for a story's latest run. */
export function evidenceHealthFactPath(projectRoot: string, storyId: string): string {
  return join(projectRoot, ".roll", "features", "_evidence-health", `${storyId}.json`);
}

function defaultReadHealthFact(path: string): EvidenceHealthFact | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as EvidenceHealthFact;
  } catch {
    return null;
  }
}

async function captureRepair(args: string[], deps: CaptureCommandDeps): Promise<number> {
  const storyId = args.find((a) => !a.startsWith("--") && a !== flagValue(args, "--project") && a !== flagValue(args, "--health"));
  if (storyId === undefined || storyId === "") {
    process.stderr.write("Usage: roll capture repair <story-id> [--project <path>] [--health <path>] [--json]\n");
    return 1;
  }
  const projectRoot = flagValue(args, "--project") ?? process.cwd();
  const json = args.includes("--json");
  const healthPath = flagValue(args, "--health") ?? evidenceHealthFactPath(projectRoot, storyId);
  const readHealthFact = deps.readHealthFact ?? defaultReadHealthFact;
  const writeFileText = deps.writeFileText ?? defaultWriteFileText;

  const prior = readHealthFact(healthPath);
  if (prior === null) {
    emitRepair(json, { repaired: false, reopenedBuild: false, buildUntouched: true, reason: `no evidence-health record at ${healthPath}; nothing to repair` });
    return 1;
  }

  // Guard FIRST — never rebuild a failed or non-degraded delivery.
  if (!isEvidenceOnlyRepairable(prior)) {
    const reason =
      prior.delivery === "failed"
        ? "delivery failed: normal failure handling, not an evidence repair; build not reopened"
        : `visual state is "${prior.visual}", not degraded-infrastructure; not evidence-only repairable; build not reopened`;
    emitRepair(json, { repaired: false, reopenedBuild: false, buildUntouched: true, priorHealth: prior, reason });
    return 1;
  }

  const store = deps.store ?? new RollCaptureReceiptStore();
  const lanes = deps.lanes ?? [];
  const surface =
    deps.resolveSurface?.(storyId, projectRoot) ?? {
      declaredUrl: prior.surfaceId ?? "",
      expectedAcIds: [],
    };
  const runId = `repair-${(deps.now ?? (() => new Date()))().toISOString().replace(/[^0-9]/gu, "")}`;
  const runDir = join(projectRoot, ".roll", "features", "_evidence-health", "repairs", `${storyId}-${runId}`);

  const outcome = await repairDegradedEvidence(
    prior,
    { storyId, runId, runDir, projectRoot, surface },
    lanes,
    store,
  );
  if (outcome.newHealth !== undefined) {
    writeFileText(healthPath, JSON.stringify(outcome.newHealth, null, 2) + "\n");
  }
  emitRepair(json, outcome);
  return 0;
}

function emitRepair(
  json: boolean,
  outcome: {
    repaired: boolean;
    reopenedBuild: boolean;
    buildUntouched: boolean;
    priorHealth?: EvidenceHealthFact;
    newHealth?: EvidenceHealthFact;
    reason: string;
  },
): void {
  if (json) {
    process.stdout.write(JSON.stringify(outcome, null, 2) + "\n");
    return;
  }
  process.stdout.write(
    `capture repair: ${outcome.repaired ? "re-ran capture (evidence-only)" : "no repair"}\n` +
      `  reopenedBuild=${outcome.reopenedBuild} buildUntouched=${outcome.buildUntouched}\n` +
      (outcome.newHealth !== undefined ? `  visual: ${outcome.priorHealth?.visual ?? "?"} -> ${outcome.newHealth.visual}\n` : "") +
      `  ${outcome.reason}\n`,
  );
}
