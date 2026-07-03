import type { FailureClass } from "@roll/spec";
import { parseEventLine, type RollEvent } from "@roll/spec";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type { FailureClass };

export interface FailureAttributionInput {
  readonly stage:
    | "pre-spawn"
    | "post-spawn"
    | "post-cycle"
    | "preflight"
    | "capture"
    | "worktree"
    | "auth"
    | "network"
    | "agent-spawn"
    | "build"
    | "score"
    | "attest"
    | "publish"
    | "rescue"
    | "terminal";
  readonly source: string;
  readonly exitCode?: number;
  readonly stderr?: string;
  readonly sawAgentOutput?: boolean;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly tcrCount?: number;
}

export interface FailureAttribution {
  readonly failureClass: FailureClass;
  readonly rootCauseKey: string;
  readonly confidence: "envelope" | "corroborated" | "unknown";
}

export interface CycleFailureAttributionInput {
  readonly cycleId: string;
  readonly terminal: string | undefined;
  readonly tcrCount?: number;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly agentExecuted?: boolean;
  readonly mainDirty?: boolean;
  readonly agentInternalFailure?: boolean;
  readonly events?: readonly RollEvent[];
}

interface RootCauseState {
  readonly causes: Record<string, { count: number; lastCycleId: string; failureClass: FailureClass }>;
}

export interface RootCauseFailureResult {
  readonly count: number;
  readonly paused: boolean;
  readonly rootCauseKey: string;
  readonly snapshotPath?: string;
}

const ENV_STAGE_ROOT: Partial<Record<FailureAttributionInput["stage"], string>> = {
  "pre-spawn": "env:pre_spawn",
  "post-spawn": "env:sandbox",
  "post-cycle": "env:sandbox",
  preflight: "env:preflight",
  capture: "env:sandbox",
  worktree: "env:worktree",
  auth: "env:auth",
  network: "env:network",
};

const HARNESS_STAGE_ROOT: Partial<Record<FailureAttributionInput["stage"], string>> = {
  score: "harness:score_parse",
  attest: "harness:attest_render",
  publish: "harness:publish",
  rescue: "harness:rescue",
};

function normalizedSource(input: string): string {
  return input.trim().toLowerCase();
}

function hasUsage(input: FailureAttributionInput): boolean {
  return (input.tokensIn ?? 0) > 0 || (input.tokensOut ?? 0) > 0;
}

function rootForEnvSource(source: string): string | null {
  if (source.includes("sandbox:main_dirty")) return "env:main_dirty";
  if (source.includes("sandbox:quarantined") || source.includes("sandbox:write_protected")) return "env:sandbox";
  if (source.includes("worktree")) return "env:worktree";
  if (source.includes("auth") || source.includes("credential")) return "env:auth";
  if (source.includes("network") || source.includes("vendor") || source.includes("provider")) return "env:network";
  return null;
}

function rootForHarnessSource(source: string): string | null {
  if (source.includes("pair:score-failure") || source.includes("score")) return "harness:score_parse";
  if (source.includes("attest")) return "harness:attest_render";
  if (source.includes("publish") || source.includes("pr:") || source.includes("gh ")) return "harness:publish";
  if (source.includes("rescue") || source.includes("quarantine")) return "harness:rescue";
  if (source.includes("roll-component") || source.includes("harness-component")) return "harness:component";
  return null;
}

function isAgentCliSpawnFailure(input: FailureAttributionInput, source: string): boolean {
  if (input.stage !== "agent-spawn") return false;
  if (input.exitCode === undefined || input.exitCode === 0) return false;
  if (input.sawAgentOutput === true) return false;
  const stderr = normalizedSource(input.stderr ?? "");
  return (
    source.includes("agent-cli") ||
    stderr.includes("command not found") ||
    stderr.includes("no such file") ||
    stderr.includes("permission denied") ||
    stderr.includes("spawn")
  );
}

export function classifyFailure(input: FailureAttributionInput): FailureAttribution {
  const source = normalizedSource(input.source);
  const envSourceRoot = rootForEnvSource(source);
  if (envSourceRoot !== null) {
    return { failureClass: "env", rootCauseKey: envSourceRoot, confidence: "envelope" };
  }

  const envStageRoot = ENV_STAGE_ROOT[input.stage];
  if (envStageRoot !== undefined) {
    return { failureClass: "env", rootCauseKey: envStageRoot, confidence: hasUsage(input) ? "corroborated" : "envelope" };
  }

  if (isAgentCliSpawnFailure(input, source)) {
    return { failureClass: "env", rootCauseKey: "env:agent_cli_spawn", confidence: "envelope" };
  }

  const harnessSourceRoot = rootForHarnessSource(source);
  if (harnessSourceRoot !== null) {
    return { failureClass: "harness", rootCauseKey: harnessSourceRoot, confidence: "envelope" };
  }

  const harnessStageRoot = HARNESS_STAGE_ROOT[input.stage];
  if (harnessStageRoot !== undefined) {
    return { failureClass: "harness", rootCauseKey: harnessStageRoot, confidence: "envelope" };
  }

  if (input.stage === "build" && (hasUsage(input) || (input.tcrCount ?? 0) > 0)) {
    return { failureClass: "card", rootCauseKey: "card:agent_after_build", confidence: "corroborated" };
  }

  return { failureClass: "unknown", rootCauseKey: "unknown:unclassified", confidence: "unknown" };
}

function sameCycle(cycleId: string): (event: RollEvent) => boolean {
  return (event) => {
    const rec = event as unknown as Record<string, unknown>;
    return rec["cycleId"] === cycleId;
  };
}

export function readCycleEvents(eventsPath: string, cycleId: string): RollEvent[] {
  try {
    if (!existsSync(eventsPath)) return [];
    return readFileSync(eventsPath, "utf8")
      .split("\n")
      .map(parseEventLine)
      .filter((event): event is RollEvent => event !== null)
      .filter(sameCycle(cycleId));
  } catch {
    return [];
  }
}

export function classifyCycleFailure(input: CycleFailureAttributionInput): FailureAttribution {
  const events = input.events ?? [];
  const recorded = events.find((event) => {
    const rec = event as unknown as Record<string, unknown>;
    return event.type === "cycle:end" && typeof rec["failure_class"] === "string";
  });
  if (recorded !== undefined) {
    const rec = recorded as unknown as Record<string, unknown>;
    const cls = rec["failure_class"];
    const root = rec["root_cause_key"];
    if ((cls === "env" || cls === "harness" || cls === "card" || cls === "unknown") && typeof root === "string") {
      return { failureClass: cls, rootCauseKey: root, confidence: cls === "unknown" ? "unknown" : "envelope" };
    }
  }
  const sandboxDirty = events.find((event) => event.type === "sandbox:main_dirty");
  if (sandboxDirty !== undefined) {
    return classifyFailure({ stage: sandboxDirty.phase, source: "sandbox:main_dirty", tcrCount: input.tcrCount });
  }
  const sandboxQuarantine = events.find((event) => event.type === "sandbox:quarantined");
  if (sandboxQuarantine !== undefined) {
    return classifyFailure({ stage: sandboxQuarantine.phase, source: "sandbox:quarantined", tcrCount: input.tcrCount });
  }
  const blocked = events.find((event) => event.type === "agent:blocked");
  if (blocked !== undefined) {
    return classifyFailure({ stage: blocked.cause, source: `agent:${blocked.cause}`, tcrCount: input.tcrCount });
  }
  if (events.some((event) => event.type === "pair:score-failure")) {
    return classifyFailure({ stage: "score", source: "pair:score-failure", tcrCount: input.tcrCount });
  }
  if (events.some((event) => event.type === "cycle:rescue")) {
    return classifyFailure({ stage: "rescue", source: "cycle:rescue", tcrCount: input.tcrCount });
  }
  if (input.mainDirty === true) {
    return classifyFailure({ stage: "preflight", source: "sandbox:main_dirty", tcrCount: input.tcrCount });
  }
  if (input.agentInternalFailure === true) {
    return classifyFailure({ stage: "build", source: "harness-component:agent_internal", tcrCount: input.tcrCount });
  }
  if ((input.tcrCount ?? 0) > 0 || (input.tokensIn ?? 0) > 0 || (input.tokensOut ?? 0) > 0) {
    return classifyFailure({
      stage: "build",
      source: "agent",
      tcrCount: input.tcrCount,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
    });
  }
  if (input.terminal === "failed" || input.terminal === "blocked" || input.terminal === "gave_up") {
    return classifyFailure({ stage: "terminal", source: "terminal" });
  }
  return classifyFailure({ stage: "terminal", source: "terminal" });
}

function statePath(runtimeDir: string): string {
  return join(runtimeDir, "failure-attribution.json");
}

function diagnosticsDir(runtimeDir: string): string {
  return join(runtimeDir, "diagnostics");
}

function readRootCauseState(runtimeDir: string): RootCauseState {
  try {
    if (!existsSync(statePath(runtimeDir))) return { causes: {} };
    const parsed = JSON.parse(readFileSync(statePath(runtimeDir), "utf8")) as Partial<RootCauseState>;
    return { causes: parsed.causes !== undefined && typeof parsed.causes === "object" ? parsed.causes : {} };
  } catch {
    return { causes: {} };
  }
}

function writeRootCauseState(runtimeDir: string, state: RootCauseState): void {
  try {
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(statePath(runtimeDir), JSON.stringify(state, null, 2), "utf8");
  } catch {
    /* best-effort; a missed counter just retries next cycle */
  }
}

export function playbookForFailure(failureClass: FailureClass, rootCauseKey: string): string {
  if (failureClass === "env") {
    if (rootCauseKey === "env:main_dirty") {
      return "Environment repair: inspect the shared main checkout, preserve/quarantine leaked files, restore it to origin/main, then run roll loop resume.";
    }
    if (rootCauseKey.startsWith("env:auth")) return "Environment repair: refresh agent credentials or provider login, then run roll loop resume.";
    if (rootCauseKey.startsWith("env:network")) return "Environment repair: restore network/VPN/proxy or provider reachability; the card should not be split.";
    return "Environment repair: fix the harness runtime or worktree environment, then resume dispatch.";
  }
  if (failureClass === "harness") {
    return "Harness repair: inspect the named Roll component, open a focused FIX if needed, then resume dispatch after the component is healthy.";
  }
  if (failureClass === "card") {
    return "Card repair: this was a real card attempt; investigate the story, split it, or change agent only after reviewing evidence.";
  }
  return "Unknown failure: add a deterministic failure envelope before charging any card.";
}

function writeDiagnosticSnapshot(
  runtimeDir: string,
  cycleId: string,
  attribution: FailureAttribution,
  events: readonly RollEvent[],
): string | undefined {
  try {
    const dir = diagnosticsDir(runtimeDir);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${attribution.rootCauseKey.replace(/[^a-zA-Z0-9_.-]+/g, "_")}.json`);
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          cycleId,
          failureClass: attribution.failureClass,
          rootCauseKey: attribution.rootCauseKey,
          playbook: playbookForFailure(attribution.failureClass, attribution.rootCauseKey),
          recentEvents: events.slice(-20),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return file;
  } catch {
    return undefined;
  }
}

export function recordRootCauseFailure(
  runtimeDir: string,
  cycleId: string,
  attribution: FailureAttribution,
  events: readonly RollEvent[],
  threshold = 3,
): RootCauseFailureResult {
  if (attribution.failureClass === "card") {
    return { count: 0, paused: false, rootCauseKey: attribution.rootCauseKey };
  }
  const state = readRootCauseState(runtimeDir);
  const prior = state.causes[attribution.rootCauseKey];
  const count = (prior?.count ?? 0) + 1;
  state.causes[attribution.rootCauseKey] = { count, lastCycleId: cycleId, failureClass: attribution.failureClass };
  writeRootCauseState(runtimeDir, state);
  const paused = count >= threshold;
  const snapshotPath = paused ? writeDiagnosticSnapshot(runtimeDir, cycleId, attribution, events) : undefined;
  return { count, paused, rootCauseKey: attribution.rootCauseKey, ...(snapshotPath !== undefined ? { snapshotPath } : {}) };
}
