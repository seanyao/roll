export type FailureClass = "env" | "harness" | "card" | "unknown";

export interface FailureAttributionInput {
  readonly stage:
    | "pre-spawn"
    | "preflight"
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

const ENV_STAGE_ROOT: Partial<Record<FailureAttributionInput["stage"], string>> = {
  "pre-spawn": "env:pre_spawn",
  preflight: "env:preflight",
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
