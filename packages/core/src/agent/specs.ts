// claude is KEPT here (harness): the loop runs inside Claude Code and claude is
// used for harness cost/activity normalization, even though it is NOT a member of
// the orchestrated agent POOL (see registry.ts). So "claude"/"claude-stream"
// remain in these unions as harness kinds.
export type AgentNormalizerKind = "claude" | "generic";
export type UsageExtractorKind = "claude-stream" | "kimi" | "pi" | "generic";
export type SessionRecoveryKind = "pi" | "kimi";
export type SessionBackfillKind = "claude-projects";
/** lever-4: how (if at all) an agent's prior session is REUSED across the next
 *  same-agent card (cross-card warm-context). Agent-AGNOSTIC capability — every
 *  engine declares its kind so the cycle path can resolve one adapter port and
 *  never branch per-agent. `'none'` (or absent) = cold no-op (the universal
 *  default — every current pool agent). */
export type SessionReuseKind = "none";

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

// Owner ruling: the UNATTENDED loop may only spawn 国产/开源 agents —
// kimi / pi / reasonix. The overseas agents (codex/openai, agy/antigravity/gemini,
// qwen) were removed from the pool entirely. claude is SPECIAL: roll runs inside
// Claude Code and claude powers harness cost/activity normalization, so its
// harness machinery is kept (sumClaudeStream, claudeNormalizer, the "claude" /
// "claude-stream" union members), but it is NOT a pool member — it has no
// BASE_AGENT_SPECS entry and is absent from the registry's routable lists.
const BASE_AGENT_SPECS: readonly AgentSpec[] = [
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
    name: "reasonix",
    displayName: "reasonix",
    defaultModel: "deepseek-flash",
    canReviewHeadless: true,
    normalizer: "generic",
    usage: { stdoutExtractor: "generic" },
    smokeCommand: 'reasonix run --max-steps 1 "Reply with a single word: hello"',
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
    name: "cursor",
    displayName: "cursor",
    defaultModel: "cursor",
    normalizer: "generic",
    usage: { stdoutExtractor: "generic" },
    smokeCommand: 'cursor --version',
  },
  {
    name: "opencode",
    displayName: "opencode",
    defaultModel: "opencode",
    normalizer: "generic",
    usage: { stdoutExtractor: "generic" },
    smokeCommand: 'opencode --version',
  },
  {
    name: "trae",
    displayName: "trae",
    defaultModel: "trae",
    normalizer: "generic",
    usage: { stdoutExtractor: "generic" },
    smokeCommand: 'trae --version',
  },
  {
    name: "openclaw",
    displayName: "openclaw",
    defaultModel: "openclaw",
    normalizer: "generic",
    usage: { stdoutExtractor: "generic" },
    smokeCommand: 'openclaw --version',
  },
];

function canonicalSpecKey(name: string): string {
  const raw = name.trim().toLowerCase();
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
