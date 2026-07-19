/**
 * US-EVID-032 — capture-policy readiness (AC4).
 *
 * ONE shared collector that surfaces, with actionable reasons:
 *   - v2 Roll Capture GATEWAY readiness (negotiated from the host advertisement);
 *   - browser RENDERER readiness (Playwright Chromium availability);
 *   - the EFFECTIVE capture policy recorded for this project, plus what
 *     `roll capture migrate` would do next given current capabilities.
 *
 * `roll doctor` and loop status both render this same fact so a reader always
 * sees why a project is (or is not) on best-effort capture — never a guess.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  planCapturePolicyMigration,
  readCaptureMode,
  type CaptureMigrationCapabilities,
} from "@roll/core";
import { chromiumInstalled } from "@roll/infra";
import { negotiateCaptureProtocol, parseCaptureProtocolAdvertisement, ROLL_CAPTURE_PROTOCOL_V2, t, v3Catalog, type Lang } from "@roll/spec";

export interface CapturePolicyReadinessDeps {
  /** Project root whose `.roll/policy.yaml` records the capture policy. */
  projectRoot?: string;
  /** Roll Capture host root holding `capabilities.json`. */
  captureRoot?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** Read a text file, or null when absent/unreadable (injected for tests). */
  readFileText?: (path: string) => string | null;
  /** Renderer capability probe (injected for tests). */
  rendererInstalled?: () => boolean;
}

export interface CapabilityReadiness {
  available: boolean;
  reason: string;
}

export interface EffectiveCapturePolicy {
  /** The recorded capture mode, or null when none is recorded yet. */
  mode: string | null;
  source: "recorded" | "unset";
  reason: string;
}

export interface CapturePolicyReadiness {
  gateway: CapabilityReadiness & { selected: string | null };
  renderer: CapabilityReadiness;
  policy: EffectiveCapturePolicy;
  /** What `roll capture migrate` would do next (from the pure migration planner). */
  migration: { action: string; reasonCode: string; reason: string };
}

function defaultReadFileText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function defaultCaptureRoot(env: NodeJS.ProcessEnv, home: string): string {
  const override = (env["ROLL_CAPTURE_HOME"] ?? "").trim();
  return override !== "" ? override : join(home, "Library", "Application Support", "Roll Capture");
}

export function collectCapturePolicyReadiness(deps: CapturePolicyReadinessDeps = {}): CapturePolicyReadiness {
  const env = deps.env ?? process.env;
  const home = deps.home ?? homedir();
  const readFileText = deps.readFileText ?? defaultReadFileText;
  const rendererInstalled = deps.rendererInstalled ?? (() => chromiumInstalled());
  const projectRoot = deps.projectRoot ?? process.cwd();
  const captureRoot = deps.captureRoot ?? defaultCaptureRoot(env, home);

  // ── Gateway (v2) — negotiated from the host advertisement, never guessed. ──
  const advRaw = readFileText(join(captureRoot, "capabilities.json"));
  let advertisement = null;
  if (advRaw !== null) {
    try {
      advertisement = parseCaptureProtocolAdvertisement(JSON.parse(advRaw));
    } catch {
      advertisement = null;
    }
  }
  const negotiation = negotiateCaptureProtocol(advertisement);
  const gateway = {
    available: negotiation.v2.available,
    reason: negotiation.v2.available
      ? `host advertises ${ROLL_CAPTURE_PROTOCOL_V2}`
      : negotiation.v2.reason,
    selected: negotiation.selected,
  };

  // ── Renderer — Playwright Chromium availability. ──
  const rendererReady = rendererInstalled();
  const renderer: CapabilityReadiness = {
    available: rendererReady,
    reason: rendererReady
      ? "Playwright Chromium is installed"
      : "Playwright Chromium is not installed; run `npx playwright install chromium`",
  };

  // ── Effective recorded policy. ──
  const policyYaml = readFileText(join(projectRoot, ".roll", "policy.yaml")) ?? "";
  const recordedMode = readCaptureMode(policyYaml);
  const policy: EffectiveCapturePolicy =
    recordedMode !== null
      ? { mode: recordedMode, source: "recorded", reason: `capture mode "${recordedMode}" recorded in .roll/policy.yaml` }
      : {
          mode: null,
          source: "unset",
          reason: "no capture mode recorded; project retains legacy behavior until `roll capture migrate` enables best_effort",
        };

  // ── Next-step migration hint (pure planner, no writes). ──
  const capabilities: CaptureMigrationCapabilities = {
    gateway: { available: gateway.available, reason: gateway.reason },
    renderer: { available: renderer.available, reason: renderer.reason },
  };
  const plan = planCapturePolicyMigration({ policyYaml, capabilities });

  return {
    gateway,
    renderer,
    policy,
    migration: { action: plan.action, reasonCode: plan.reasonCode, reason: plan.reason },
  };
}

/**
 * Renders the capture-policy readiness section.
 *
 * When `lang` is provided, renders a single-language section using the i18n
 * catalog (`roll capture status` path). When `lang` is omitted, renders the
 * legacy bilingual EN+ZH section for backward-compatible `roll doctor` output.
 */
export function renderCapturePolicyReadinessDoctorSection(
  readiness: CapturePolicyReadiness,
  opts?: { lang?: Lang },
): string[] {
  const mark = (ok: boolean): string => (ok ? "✓" : "−");
  const lines: string[] = [];

  if (opts?.lang !== undefined) {
    // Single-language path (FIX-1453).
    const lang = opts.lang;
    const m = (key: string, ...args: ReadonlyArray<string | number>): string =>
      t(v3Catalog, lang, key, ...args);
    lines.push("");
    lines.push(m("capture.readiness.title"));
    lines.push("");
    const gwKey = readiness.gateway.available ? "capture.readiness.gateway_ready" : "capture.readiness.gateway_unavailable";
    lines.push(m(gwKey, mark(readiness.gateway.available)));
    lines.push(`    ${readiness.gateway.reason}`);
    const rKey = readiness.renderer.available ? "capture.readiness.renderer_ready" : "capture.readiness.renderer_unavailable";
    lines.push(m(rKey, mark(readiness.renderer.available)));
    lines.push(`    ${readiness.renderer.reason}`);
    lines.push(m("capture.readiness.policy", readiness.policy.mode ?? "unset"));
    lines.push(`    ${readiness.policy.reason}`);
    lines.push(m("capture.readiness.migration", readiness.migration.action, readiness.migration.reasonCode));
    lines.push(`    ${readiness.migration.reason}`);
  } else {
    // Legacy bilingual path (doctor backward compat).
    lines.push("");
    lines.push("Capture policy readiness");
    lines.push("截图策略就绪度");
    lines.push("");
    lines.push(`  ${mark(readiness.gateway.available)} v2 capture gateway — ${readiness.gateway.available ? "ready" : "unavailable"}`);
    lines.push(`    ${readiness.gateway.reason}`);
    lines.push(`  ${mark(readiness.renderer.available)} browser renderer — ${readiness.renderer.available ? "ready" : "unavailable"}`);
    lines.push(`    ${readiness.renderer.reason}`);
    lines.push(`  · effective capture policy — ${readiness.policy.mode ?? "unset"}`);
    lines.push(`    ${readiness.policy.reason}`);
    lines.push(`  · next migration — ${readiness.migration.action} (${readiness.migration.reasonCode})`);
    lines.push(`    ${readiness.migration.reason}`);
  }
  return lines;
}


