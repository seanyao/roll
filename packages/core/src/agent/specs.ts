// claude is KEPT here (harness): the loop runs inside Claude Code and claude is
// used for harness cost/activity normalization, even though it is NOT a member of
// the orchestrated agent POOL (see registry.ts). So "claude"/"claude-stream"
// remain in these unions as harness kinds.
export type AgentNormalizerKind = "claude" | "codex" | "generic";
export type UsageExtractorKind = "claude-stream" | "openai" | "gemini" | "kimi" | "qwen" | "pi" | "generic";
export type SessionRecoveryKind = "pi" | "kimi" | "codex";
export type SessionBackfillKind = "claude-projects";
/** lever-4: how (if at all) an agent's prior session is REUSED across the next
 *  same-agent card (cross-card warm-context). Agent-AGNOSTIC capability — every
 *  engine declares its kind so the cycle path can resolve one adapter port and
 *  never branch per-agent. `'none'` (or absent) = cold no-op (the universal
 *  default — every current pool agent). */
export type SessionReuseKind = "codex-exec-resume" | "none";

export interface AgentUsageSpec {
  stdoutExtractor?: UsageExtractorKind;
  sessionRecovery?: SessionRecoveryKind;
  sessionBackfill?: SessionBackfillKind;
  /** lever-4 warm-context capability. Absent ⇒ cold no-op (the universal default
   *  for every current pool agent). */
  sessionReuse?: SessionReuseKind;
}

export interface AgentSpec {
  name: string;
  aliases?: readonly string[];
  displayName: string;
  defaultModel: string;
  /** True iff the runner can spawn this agent as a headless peer reviewer. */
  canReviewHeadless?: boolean;
  normalizer: AgentNormalizerKind;
  usage: AgentUsageSpec;
  smokeCommand: string;
}

export type AgentSpecRegistry = Readonly<Record<string, AgentSpec>>;

// US-AGENT-043: the supported agent roster is exactly six first-class agents.
// Provider/model aliases stay as aliases only (openai -> codex, deepseek -> pi);
// removed tokens such as qwen/openclaw/opencode/cursor/trae do not get specs.
const BASE_AGENT_SPECS: readonly AgentSpec[] = [
  {
    name: "claude",
    displayName: "claude",
    defaultModel: "claude-sonnet-4",
    // claude can be used manually/harness-side, but headless review remains
    // disabled because launchd/headless auth cannot reach its GUI-bound token.
    canReviewHeadless: false,
    normalizer: "claude",
    usage: { stdoutExtractor: "claude-stream", sessionBackfill: "claude-projects" },
    smokeCommand: 'claude -p "Reply with a single word: hello"',
  },
  {
    name: "kimi",
    displayName: "kimi",
    defaultModel: "kimi-k2",
    canReviewHeadless: true,
    normalizer: "generic",
    usage: { stdoutExtractor: "kimi", sessionRecovery: "kimi" },
    smokeCommand: 'kimi -p "Reply with a single word: hello"',
  },
  {
    name: "codex",
    aliases: ["openai"],
    displayName: "codex",
    defaultModel: "gpt-5.5",
    canReviewHeadless: true,
    normalizer: "codex",
    usage: { stdoutExtractor: "openai", sessionRecovery: "codex", sessionReuse: "codex-exec-resume" },
    smokeCommand: 'codex exec "Reply with a single word: hello"',
  },
  {
    name: "pi",
    aliases: ["deepseek"],
    displayName: "pi",
    defaultModel: "deepseek-v4-pro",
    canReviewHeadless: true,
    normalizer: "generic",
    usage: { stdoutExtractor: "pi", sessionRecovery: "pi" },
    smokeCommand: 'pi -p "Reply with a single word: hello"',
  },
  {
    name: "agy",
    aliases: ["antigravity", "gemini"],
    displayName: "antigravity (agy)",
    defaultModel: "gemini-2.5-pro",
    // agy requires interactive Google auth; keep it as a supported manual agent
    // but never place it in unattended headless review pools.
    canReviewHeadless: false,
    normalizer: "generic",
    usage: { stdoutExtractor: "gemini" },
    smokeCommand: 'agy -p "Reply with a single word: hello"',
  },
  {
    name: "reasonix",
    displayName: "reasonix",
    defaultModel: "deepseek-flash",
    canReviewHeadless: true,
    normalizer: "generic",
    usage: { stdoutExtractor: "generic" },
    smokeCommand: 'reasonix run --max-steps 1 "Reply with a single word: hello"',
  },
];

function canonicalSpecKey(name: string): string {
  const raw = name.trim().toLowerCase();
  if (raw === "antigravity" || raw === "gemini") return "agy";
  if (raw === "openai") return "codex";
  if (raw === "deepseek") return "pi";
  return raw;
}

export function withAgentSpecs(extra: readonly AgentSpec[] = []): AgentSpecRegistry {
  const out: Record<string, AgentSpec> = {};
  for (const spec of [...BASE_AGENT_SPECS, ...extra]) {
    out[canonicalSpecKey(spec.name)] = spec;
    for (const alias of spec.aliases ?? []) out[canonicalSpecKey(alias)] = spec;
  }
  return out;
}

export const AGENT_SPECS = withAgentSpecs();

export function getAgentSpec(name: string, registry: AgentSpecRegistry = AGENT_SPECS): AgentSpec | undefined {
  return registry[canonicalSpecKey(name)];
}

export function agentDefaultModel(name: string, registry: AgentSpecRegistry = AGENT_SPECS): string {
  return getAgentSpec(name, registry)?.defaultModel ?? name;
}

export function agentNormalizerKind(name: string, registry: AgentSpecRegistry = AGENT_SPECS): AgentNormalizerKind {
  return getAgentSpec(name, registry)?.normalizer ?? "generic";
}

export function agentSmokeCommand(name: string, registry: AgentSpecRegistry = AGENT_SPECS): string {
  return getAgentSpec(name, registry)?.smokeCommand ?? `${name} --version`;
}

export function agentCanReviewHeadless(name: string, registry: AgentSpecRegistry = AGENT_SPECS): boolean {
  return getAgentSpec(name, registry)?.canReviewHeadless === true;
}
