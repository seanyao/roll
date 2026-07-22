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
  unknownFlags: string[];
};

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  const unknownFlags: string[] = [];

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

  return { positional, flags, unknownFlags };
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

  // TODO: full implementation with delegation allocation
  const msg = "TODO: prepare not yet implemented";
  if (json) {
    process.stderr.write(JSON.stringify({ ok: false, error: "not_implemented", detail: msg }) + "\n");
  } else {
    process.stderr.write(`${msg}\n`);
  }
  return 1;
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

  // TODO: full implementation with validator invocation
  const msg = "TODO: validate not yet implemented";
  if (json) {
    process.stderr.write(JSON.stringify({ ok: false, error: "not_implemented", detail: msg }) + "\n");
  } else {
    process.stderr.write(`${msg}\n`);
  }
  return 1;
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

  const disposition = flags["delivery-disposition"];
  const validDispositions = ["owner_continue", "owner_hold", "owner_redelegate"];
  if (!disposition || disposition === true || !validDispositions.includes(disposition as string)) {
    const msg = T("delta.error.invalid_value", disposition === true ? "(empty)" : String(disposition ?? ""), "--delivery-disposition", validDispositions.join("|"));
    if (json) {
      process.stderr.write(JSON.stringify({ ok: false, error: "invalid_value", detail: msg }) + "\n");
    } else {
      process.stderr.write(`${msg}\n`);
    }
    return 1;
  }

  // TODO: full implementation with terminal event + lease release
  const msg2 = "TODO: conclude not yet implemented";
  if (json) {
    process.stderr.write(JSON.stringify({ ok: false, error: "not_implemented", detail: msg2 }) + "\n");
  } else {
    process.stderr.write(`${msg2}\n`);
  }
  return 1;
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

  // TODO: full implementation with event projection
  const msg2 = "TODO: status not yet implemented";
  if (json) {
    process.stderr.write(JSON.stringify({ ok: false, error: "not_implemented", detail: msg2 }) + "\n");
  } else {
    process.stderr.write(`${msg2}\n`);
  }
  return 1;
}
