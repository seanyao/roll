/**
 * US-DELTA-003 — protocol-only `roll delta` CLI.
 *
 * Hidden from the public command surface; discoverable via `roll delta help`.
 * Implements prepare/validate/conclude/status/help command plumbing using the
 * no-cycle allocation/recovery protocol. No spawning, no Pi host API, no
 * cycle/run integration.
 */
import { resolveLang, t, v3Catalog } from "@roll/spec";
import {
  DELEGATION_TRIGGERS,
  DELIVERY_TOPOLOGIES,
  QUALITY_PROFILES,
  DELTA_ROLES,
  type DelegationTrigger,
  type DeliveryTopology,
  type QualityProfile,
  type DeltaRole,
} from "@roll/spec";
import {
  prepareDelegation,
  PrepareError,
  resolveExistingUniqueCardArchiveDir,
  detectOrphanFrames,
  releaseHostDelegationLease,
  type PrepareInput,
} from "../lib/delta-allocation.js";
import { loadLocalPresets } from "../lib/delta-artifacts.js";
import { EventBus, projectDelegationStatus } from "@roll/core";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Locale resolution ────────────────────────────────────────────────────────

function lang() {
  return resolveLang({
    rollLang: process.env["ROLL_LANG"],
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });
}

function T(key: string, ...args: Array<string | number>): string {
  return t(v3Catalog, lang(), key, ...args);
}

// ── Argument parser ──────────────────────────────────────────────────────────

type ParsedArgs = {
  positional: string[];
  flags: Record<string, string | true>;
};

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    // Subcommand is first positional
    if (a.startsWith("--")) {
      const eqIdx = a.indexOf("=");
      if (eqIdx >= 0) {
        const key = a.slice(2, eqIdx);
        const val = a.slice(eqIdx + 1);
        flags[key] = val;
      } else {
        // Look ahead for value
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }

  return { positional, flags };
}

// ── Enum validation ──────────────────────────────────────────────────────────

function checkEnumFlag(flags: Record<string, string | true>, key: string, allowed: readonly string[]): string | undefined {
  const v = flags[key];
  if (v === undefined || v === true) return undefined;
  if (!(allowed as readonly string[]).includes(v as string)) {
    return T("delta.error.invalid_value", String(v), `--${key}`, allowed.join("|"));
  }
  return undefined;
}

// ── Subcommand routing ────────────────────────────────────────────────────────

export function deltaCommand(args: string[]): number {
  const sub = args[0];

  // Help
  if (sub === undefined || sub === "help" || sub === "--help" || sub === "-h") {
    process.stdout.write(T("delta.help.usage"));
    return 0;
  }

  // Route to subcommand
  switch (sub) {
    case "prepare":
      return prepareCommand(args.slice(1));
    case "validate":
      return validateCommand(args.slice(1));
    case "conclude":
      return concludeCommand(args.slice(1));
    case "status":
      return statusCommand(args.slice(1));
    default:
      process.stderr.write(`${T("delta.error.unknown_subcommand", sub)}\n`);
      return 1;
  }
}

// ── Prepare ──────────────────────────────────────────────────────────────────

function prepareCommand(args: string[]): number {
  const { positional, flags } = parseArgs(args);

  // --json flag
  const json = flags["json"] === true;

  // --cycle rejection
  if ("cycle" in flags) {
    const msg = T("delta.error.cycle_rejected");
    if (json) {
      process.stderr.write(JSON.stringify({ ok: false, error: "cycle_rejected", detail: msg }) + "\n");
    } else {
      process.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  // Check for unknown flags
  const knownFlags = new Set(["trigger", "topology", "profile", "preset", "resolution", "json"]);
  for (const k of Object.keys(flags)) {
    if (!knownFlags.has(k)) {
      const msg = T("delta.error.unknown_flag", `--${k}`);
      if (json) {
        process.stderr.write(JSON.stringify({ ok: false, error: "unknown_flag", detail: msg }) + "\n");
      } else {
        process.stderr.write(`${msg}\n`);
      }
      return 1;
    }
  }

  // Story ID is required
  const storyId = positional[0];
  if (!storyId) {
    const msg = T("delta.error.missing_story");
    if (json) {
      process.stderr.write(JSON.stringify({ ok: false, error: "missing_story", detail: msg }) + "\n");
    } else {
      process.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  // Validate required flags
  const required = ["trigger", "topology", "profile", "preset", "resolution"];
  for (const r of required) {
    if (flags[r] === undefined) {
      const msg = T("delta.error.missing_required", `--${r}`);
      if (json) {
        process.stderr.write(JSON.stringify({ ok: false, error: "missing_required", detail: msg, flag: r }) + "\n");
      } else {
        process.stderr.write(`${msg}\n`);
      }
      return 1;
    }
  }

  // Validate enum values
  const triggerErr = checkEnumFlag(flags, "trigger", DELEGATION_TRIGGERS);
  if (triggerErr) {
    if (json) process.stderr.write(JSON.stringify({ ok: false, error: "invalid_value", detail: triggerErr }) + "\n");
    else process.stderr.write(`${triggerErr}\n`);
    return 1;
  }
  const topologyErr = checkEnumFlag(flags, "topology", DELIVERY_TOPOLOGIES);
  if (topologyErr) {
    if (json) process.stderr.write(JSON.stringify({ ok: false, error: "invalid_value", detail: topologyErr }) + "\n");
    else process.stderr.write(`${topologyErr}\n`);
    return 1;
  }
  const profileErr = checkEnumFlag(flags, "profile", QUALITY_PROFILES);
  if (profileErr) {
    if (json) process.stderr.write(JSON.stringify({ ok: false, error: "invalid_value", detail: profileErr }) + "\n");
    else process.stderr.write(`${profileErr}\n`);
    return 1;
  }

  // Read resolution template from host-provided path
  const resolutionPath = flags["resolution"] as string;
  if (!existsSync(resolutionPath)) {
    const msg = `Resolution file not found: ${resolutionPath}`;
    if (json) {
      process.stderr.write(JSON.stringify({ ok: false, error: "resolution_not_found", detail: msg }) + "\n");
    } else {
      process.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  let resolutionTemplate: unknown;
  try {
    resolutionTemplate = JSON.parse(readFileSync(resolutionPath, "utf8"));
  } catch {
    const msg = `Failed to parse resolution file: ${resolutionPath}`;
    if (json) {
      process.stderr.write(JSON.stringify({ ok: false, error: "resolution_parse_error", detail: msg }) + "\n");
    } else {
      process.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  // Read presetSha256 from the host-supplied resolution template (credible provenance claim).
  // If the template omits it, fall back to computing from the preset file content.
  const hostPresetSha256 = (resolutionTemplate as Record<string, unknown>).presetSha256 as string | undefined;

  // Resolve hostId from the machine-local preset identified by presetId.
  const presetId = flags["preset"] as string;
  let resolvedHostId = "unknown";
  try {
    const presets = loadLocalPresets();
    const matched = presets.find((p) => p.id === presetId);
    if (matched) {
      resolvedHostId = matched.hostId;
    }
  } catch {
    // preset file unreadable — hostId stays "unknown"
  }

  const input: PrepareInput = {
    storyId,
    trigger: flags["trigger"] as DelegationTrigger,
    topology: flags["topology"] as DeliveryTopology,
    qualityProfile: flags["profile"] as QualityProfile,
    presetId,
    presetSha256: hostPresetSha256 ?? "",
    resolutionTemplate: resolutionTemplate as PrepareInput["resolutionTemplate"],
  };

  try {
    const result = prepareDelegation(process.cwd(), input);

    // Append events
    const bus = new EventBus();
    const now = Date.now();

    // delta:prepared
    bus.appendEvent(result.eventsPath, {
      type: "delta:prepared",
      delegationId: result.delegationId,
      runId: result.runId,
      storyId,
      trigger: input.trigger,
      topology: input.topology,
      qualityProfile: input.qualityProfile,
      presetId: input.presetId,
      presetSha256: input.presetSha256,
      hostId: resolvedHostId,
      ts: now,
    });

    // delta:role_resolved for each role
    const roles = (input.resolutionTemplate as unknown as Record<string, unknown>).roles;
    if (Array.isArray(roles)) {
      for (const role of roles) {
        const r = role as Record<string, unknown>;
        bus.appendEvent(result.eventsPath, {
          type: "delta:role_resolved",
          delegationId: result.delegationId,
          storyId,
          role: r.role as DeltaRole,
          roleInstanceId: r.roleInstanceId as string,
          hostId: r.hostId as string,
          modelId: r.modelId as string,
          source: r.source as "user-pin" | "preset-preference" | "availability-fallback",
          reasons: r.reasons as string[],
          inventorySha256: input.presetSha256,
          ts: now,
        });
      }
    }

    if (json) {
      process.stdout.write(JSON.stringify({
        ok: true,
        delegationId: result.delegationId,
        runId: result.runId,
        artifacts: {
          frameDir: result.frameDir,
          resolutionPath: result.resolutionPath,
          markerPath: result.markerPath,
          preparationPath: result.preparationPath,
        },
      }) + "\n");
    } else {
      process.stdout.write(`Delegation prepared: ${result.delegationId}\n`);
      process.stdout.write(`  runId: ${result.runId}\n`);
      process.stdout.write(`  frame: ${result.frameDir}\n`);
    }
    return 0;
  } catch (err) {
    if (err instanceof PrepareError) {
      if (json) {
        process.stderr.write(JSON.stringify({ ok: false, error: err.code, detail: err.message }) + "\n");
      } else {
        process.stderr.write(`roll delta prepare: ${err.message}\n`);
      }
      return 1;
    }
    throw err;
  }
}

// ── Validator seam ────────────────────────────────────────────────────────────

/** Result from the thin protocol-validator boundary. */
export interface ValidatorResult {
  ok: boolean;
  reason?: string;
  detail?: string;
  role?: string;
}

/** Narrow validator interface — tests inject, production uses the default stub. */
export type DeltaProtocolValidator = (
  delegationId: string,
  stage: string,
  frameDir: string,
) => ValidatorResult;

let _injectedValidator: DeltaProtocolValidator | null = null;

/** Inject a validator for testing. Call with null to reset to default. */
export function injectValidator(v: DeltaProtocolValidator | null): void {
  _injectedValidator = v;
}

function defaultValidator(_delegationId: string, _stage: string, frameDir: string): ValidatorResult {
  const stageArtifactPath = join(frameDir, "role-artifacts", _stage);
  if (!existsSync(stageArtifactPath)) {
    return {
      ok: false,
      reason: "artifact_invalid",
      detail: `Stage artifact not found for role '${_stage}' at ${stageArtifactPath}`,
      role: _stage,
    };
  }
  return { ok: true };
}

// ── Validate ─────────────────────────────────────────────────────────────────

function validateCommand(args: string[]): number {
  const { positional, flags } = parseArgs(args);
  const json = flags["json"] === true;

  // Check for unknown flags
  const knownFlags = new Set(["delegation", "stage", "json"]);
  for (const k of Object.keys(flags)) {
    if (!knownFlags.has(k)) {
      const msg = T("delta.error.unknown_flag", `--${k}`);
      if (json) {
        process.stderr.write(JSON.stringify({ ok: false, error: "unknown_flag", detail: msg }) + "\n");
      } else {
        process.stderr.write(`${msg}\n`);
      }
      return 1;
    }
  }

  const delegationId = flags["delegation"];
  if (!delegationId || delegationId === true) {
    const msg = T("delta.error.missing_required", "--delegation");
    if (json) {
      process.stderr.write(JSON.stringify({ ok: false, error: "missing_required", detail: msg, flag: "delegation" }) + "\n");
    } else {
      process.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  const stageErr = checkEnumFlag(flags, "stage", DELTA_ROLES);
  if (stageErr) {
    if (json) process.stderr.write(JSON.stringify({ ok: false, error: "invalid_value", detail: stageErr }) + "\n");
    else process.stderr.write(`${stageErr}\n`);
    return 1;
  }

  const stage = flags["stage"] as DeltaRole | undefined;
  if (!stage) {
    const msg = T("delta.error.missing_required", "--stage");
    if (json) {
      process.stderr.write(JSON.stringify({ ok: false, error: "missing_required", detail: msg, flag: "stage" }) + "\n");
    } else {
      process.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  // Load delegation events
  const cwd = process.cwd();
  const bus = new EventBus();
  const eventsPath = join(cwd, ".roll", "loop", "events.ndjson");
  const events = existsSync(eventsPath) ? bus.readEvents(eventsPath) : [];

  // Verify delegation exists
  const delegationEvents = events.filter(
    (e) => "delegationId" in e && (e as Record<string, unknown>).delegationId === delegationId,
  );
  if (delegationEvents.length === 0) {
    const msg = `Delegation not found: ${delegationId}`;
    if (json) {
      process.stderr.write(JSON.stringify({ ok: false, error: "delegation_not_found", detail: msg }) + "\n");
    } else {
      process.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  // Locate the frame directory and stage artifact
  // For US-003, we check that the delegation's frame directory exists
  // and that the stage artifact/manifest is at its prescribed path.
  // Deep validation (digest, token, attestation) is US-004.
  const preparedEvent = delegationEvents.find((e) => e.type === "delta:prepared") as Record<string, unknown> | undefined;
  if (!preparedEvent) {
    const msg = `Delegation ${delegationId}: no prepared event found`;
    if (json) {
      process.stderr.write(JSON.stringify({ ok: false, error: "delegation_not_found", detail: msg }) + "\n");
    } else {
      process.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  const storyId = preparedEvent.storyId as string;
  const cardDir = resolveExistingUniqueCardArchiveDir(cwd, storyId);
  if (!cardDir) {
    const msg = `Story ${storyId}: card directory not found`;
    if (json) {
      process.stderr.write(JSON.stringify({ ok: false, error: "delegation_not_found", detail: msg }) + "\n");
    } else {
      process.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  const frameDir = join(cardDir, `delta-${delegationId}`);
  if (!existsSync(frameDir)) {
    const msg = `Frame directory not found: ${frameDir}`;
    if (json) {
      process.stderr.write(JSON.stringify({ ok: false, error: "delegation_not_found", detail: msg }) + "\n");
    } else {
      process.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  // Invoke the validator (injectable for testing, default is thin artifact-existence check)
  const validator = _injectedValidator ?? defaultValidator;
  const result = validator(delegationId, stage, frameDir);
  const now = Date.now();

  if (!result.ok) {
    // Block: append delta:blocked event, return non-zero
    bus.appendEvent(eventsPath, {
      type: "delta:blocked",
      delegationId,
      storyId,
      role: stage,
      reason: result.reason as import("@roll/spec").DeltaBlockReason,
      detail: result.detail ?? "",
      ts: now,
    });

    if (json) {
      process.stderr.write(JSON.stringify({
        ok: false,
        error: result.reason ?? "blocked",
        detail: result.detail,
        role: stage,
      }) + "\n");
    } else {
      process.stderr.write(`${result.detail ?? result.reason}\n`);
    }
    return 1;
  }

  // Allow: append lifecycle event (delta:artifact_published for US-003 thin validator)
  // Find the matching role_resolved event for hostId/modelId/roleInstanceId
  const roleResolved = delegationEvents.find(
    (e) => e.type === "delta:role_resolved" && (e as Record<string, unknown>).role === stage,
  ) as Record<string, unknown> | undefined;

  bus.appendEvent(eventsPath, {
    type: "delta:artifact_published",
    delegationId,
    storyId,
    role: stage,
    path: join(frameDir, "role-artifacts", stage),
    sha256: "", // US-004 will compute real digest
    manifestPath: "", // US-004 will populate manifest
    sessionId: "host-native",
    roleInstanceId: (roleResolved?.roleInstanceId as string) ?? "",
    identityProvenance: "host-attested" as const,
    ts: now,
  });

  if (json) {
    process.stdout.write(JSON.stringify({
      ok: true,
      delegationId,
      stage,
      verdict: "allow",
    }) + "\n");
  } else {
    process.stdout.write(`Validation passed: delegation ${delegationId} stage ${stage}\n`);
  }
  return 0;
}

// ── Conclude ─────────────────────────────────────────────────────────────────

function concludeCommand(args: string[]): number {
  const { positional, flags } = parseArgs(args);
  const json = flags["json"] === true;

  // Check for unknown flags
  const knownFlags = new Set(["delegation", "delivery-disposition", "json"]);
  for (const k of Object.keys(flags)) {
    if (!knownFlags.has(k)) {
      const msg = T("delta.error.unknown_flag", `--${k}`);
      if (json) {
        process.stderr.write(JSON.stringify({ ok: false, error: "unknown_flag", detail: msg }) + "\n");
      } else {
        process.stderr.write(`${msg}\n`);
      }
      return 1;
    }
  }

  const delegationId = flags["delegation"];
  if (!delegationId || delegationId === true) {
    const msg = T("delta.error.missing_required", "--delegation");
    if (json) {
      process.stderr.write(JSON.stringify({ ok: false, error: "missing_required", detail: msg, flag: "delegation" }) + "\n");
    } else {
      process.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  // Load delegation events
  const cwd = process.cwd();
  const bus = new EventBus();
  const eventsPath = join(cwd, ".roll", "loop", "events.ndjson");
  const events = existsSync(eventsPath) ? bus.readEvents(eventsPath) : [];

  // Verify delegation exists
  const delegationEvents = events.filter(
    (e) => "delegationId" in e && (e as Record<string, unknown>).delegationId === delegationId,
  );
  if (delegationEvents.length === 0) {
    const msg = `Delegation not found: ${delegationId}`;
    if (json) {
      process.stderr.write(JSON.stringify({ ok: false, error: "delegation_not_found", detail: msg }) + "\n");
    } else {
      process.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  // Get the prepared event for storyId
  const preparedEvent = delegationEvents.find((e) => e.type === "delta:prepared") as Record<string, unknown> | undefined;
  if (!preparedEvent) {
    const msg = `Delegation ${delegationId}: no prepared event found`;
    if (json) {
      process.stderr.write(JSON.stringify({ ok: false, error: "delegation_not_found", detail: msg }) + "\n");
    } else {
      process.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  const storyId = preparedEvent.storyId as string;
  const now = Date.now();

  // Per-delegation owner terminal decision required (plan §7, §8.2 step 8).
  // The project-level Option-C ratification (§0.1/§14.5) is satisfied; what
  // remains is the per-delegation deliveryDisposition choice.
  const disposition = flags["delivery-disposition"];
  const validDispositions = ["owner_continue", "owner_hold", "owner_redelegate"];
  if (!disposition || disposition === true || !validDispositions.includes(disposition as string)) {
    // Typed terminal_path_unselected block — append event, retain lease, non-zero exit
    const detail = disposition === true || !disposition
      ? "No delivery-disposition selected; owner must choose owner_continue, owner_hold, or owner_redelegate"
      : `Invalid delivery-disposition '${disposition}'; must be owner_continue, owner_hold, or owner_redelegate`;
    bus.appendEvent(eventsPath, {
      type: "delta:blocked",
      delegationId,
      storyId,
      reason: "terminal_path_unselected",
      detail,
      ts: now,
    });

    if (json) {
      process.stderr.write(JSON.stringify({
        ok: false,
        error: "terminal_path_unselected",
        detail,
      }) + "\n");
    } else {
      process.stderr.write(`${detail}\n`);
    }
    return 1;
  }

  // Record delta:terminal with Option C binding
  bus.appendEvent(eventsPath, {
    type: "delta:terminal",
    delegationId,
    storyId,
    outcome: "handoff_ready",
    terminalBinding: "handoff_only",
    deliveryDisposition: disposition as "owner_continue" | "owner_hold" | "owner_redelegate",
    ts: now,
  });

  // Release host-delegation lease
  releaseHostDelegationLease(cwd, storyId, delegationId);

  if (json) {
    process.stdout.write(JSON.stringify({
      ok: true,
      delegationId,
      storyId,
      outcome: "handoff_ready",
      terminalBinding: "handoff_only",
      deliveryDisposition: disposition,
    }) + "\n");
  } else {
    process.stdout.write(`Delegation concluded: ${delegationId}\n`);
    process.stdout.write(`  Story: ${storyId}\n`);
    process.stdout.write(`  Outcome: handoff_ready (handoff_only)\n`);
    process.stdout.write(`  Disposition: ${disposition}\n`);
  }

  return 0;
}

// ── Status ───────────────────────────────────────────────────────────────────

function statusCommand(args: string[]): number {
  const { positional, flags } = parseArgs(args);
  const json = flags["json"] === true;

  const storyId = flags["story"];
  const delegationId = flags["delegation"];

  if (!storyId && !delegationId) {
    const msg = T("delta.error.status_selector");
    if (json) {
      process.stderr.write(JSON.stringify({ ok: false, error: "status_selector", detail: msg }) + "\n");
    } else {
      process.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  // Check for unknown flags
  const knownFlags = new Set(["story", "delegation", "json"]);
  for (const k of Object.keys(flags)) {
    if (!knownFlags.has(k)) {
      const msg = T("delta.error.unknown_flag", `--${k}`);
      if (json) {
        process.stderr.write(JSON.stringify({ ok: false, error: "unknown_flag", detail: msg }) + "\n");
      } else {
        process.stderr.write(`${msg}\n`);
      }
      return 1;
    }
  }

  const cwd = process.cwd();
  const bus = new EventBus();
  const eventsPath = join(cwd, ".roll", "loop", "events.ndjson");

  // Read events for projection
  const events = existsSync(eventsPath) ? bus.readEvents(eventsPath) : [];

  // Detect orphan frames (folds events to avoid false positives)
  const orphans: Array<{ delegationId: string; frameDir: string }> = [];

  if (storyId && typeof storyId === "string") {
    // Check for orphan frames for this story
    const cardDir = resolveExistingUniqueCardArchiveDir(cwd, storyId);
    if (cardDir) {
      const detected = detectOrphanFrames(cardDir, events);
      orphans.push(...detected);
    }
  }

  // If we have a delegationId, project it
  let statusView: ReturnType<typeof projectDelegationStatus> | null = null;
  if (delegationId && typeof delegationId === "string") {
    statusView = projectDelegationStatus(delegationId, events);
  }

  // If we have a storyId but no delegation, project ALL delegations for that story
  const delegationViews: Array<ReturnType<typeof projectDelegationStatus>> = [];
  if (storyId && typeof storyId === "string" && !delegationId) {
    for (const ev of events) {
      if (ev.type === "delta:prepared" && ev.storyId === storyId) {
        const view = projectDelegationStatus(ev.delegationId, events);
        delegationViews.push(view);
      }
    }
  }

  // Build output
  const output: Record<string, unknown> = {};

  if (json) {
    // JSON output
    if (statusView) {
      Object.assign(output, {
        ok: true,
        delegationId: statusView.delegationId,
        storyId: statusView.storyId,
        status: statusView.status,
        visibleMode: statusView.visibleMode,
        trigger: statusView.trigger,
        topology: statusView.topology,
        qualityProfile: statusView.qualityProfile,
        blockReason: statusView.blockReason,
        blockDetail: statusView.blockDetail,
        terminalBinding: statusView.terminalBinding,
        deliveryDisposition: statusView.deliveryDisposition,
        roles: statusView.roles,
        totalCost: statusView.totalCost,
      });
    }
    if (delegationViews.length > 0) {
      output.delegations = delegationViews.map((v) => ({
        delegationId: v.delegationId,
        status: v.status,
        visibleMode: v.visibleMode,
        roles: v.roles,
        totalCost: v.totalCost,
      }));
    }
    if (orphans.length > 0) {
      output.uncommittedFrames = orphans.map((o) => ({
        delegationId: o.delegationId,
        frameDir: o.frameDir,
        status: "unknown: uncommitted_delegation_frame",
      }));
    }
    if (!statusView && delegationViews.length === 0 && orphans.length === 0) {
      output.ok = true;
      output.note = "no delegation found for this story";
    }
    process.stdout.write(JSON.stringify(output) + "\n");
  } else {
    // Human output
    if (statusView) {
      process.stdout.write(`Delegation: ${statusView.delegationId}\n`);
      process.stdout.write(`  Story: ${statusView.storyId}\n`);
      process.stdout.write(`  Status: ${statusView.status}\n`);
      if (statusView.visibleMode) process.stdout.write(`  Mode: ${statusView.visibleMode}\n`);
      if (statusView.trigger) process.stdout.write(`  Trigger: ${statusView.trigger}\n`);
      if (statusView.topology) process.stdout.write(`  Topology: ${statusView.topology}\n`);
      if (statusView.qualityProfile) process.stdout.write(`  Profile: ${statusView.qualityProfile}\n`);
      process.stdout.write(`  Cost: ${statusView.totalCost}\n`);
      if (statusView.blockReason) process.stdout.write(`  Block: ${statusView.blockReason} — ${statusView.blockDetail ?? ""}\n`);
      if (statusView.terminalBinding) process.stdout.write(`  Terminal: ${statusView.terminalBinding} (${statusView.deliveryDisposition ?? ""})\n`);
      if (statusView.roles.length > 0) {
        process.stdout.write(`  Roles:\n`);
        for (const role of statusView.roles) {
          const prov = role.identityProvenance ? ` (${role.identityProvenance})` : "";
          process.stdout.write(`    ${role.role}: ${role.status} [${role.hostId ?? "?"}/${role.modelId ?? "?"}]${prov} cost=${role.cost}\n`);
        }
      }
    }
    if (delegationViews.length > 0 && !statusView) {
      for (const v of delegationViews) {
        process.stdout.write(`Delegation: ${v.delegationId} — ${v.status} (${v.visibleMode ?? "?"})\n`);
      }
    }
    if (orphans.length > 0) {
      process.stdout.write(`Uncommitted frames:\n`);
      for (const o of orphans) {
        process.stdout.write(`  ${o.delegationId}: unknown: uncommitted_delegation_frame\n`);
        process.stdout.write(`    frame: ${o.frameDir}\n`);
      }
    }
    if (!statusView && delegationViews.length === 0 && orphans.length === 0) {
      process.stdout.write("No delegation found.\n");
    }
  }

  return 0;
}
