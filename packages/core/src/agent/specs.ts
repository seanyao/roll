export type AgentNormalizerKind = "claude" | "codex" | "generic";
export type UsageExtractorKind = "claude-stream" | "openai" | "gemini" | "kimi" | "qwen" | "pi" | "generic";
export type SessionRecoveryKind = "pi" | "kimi" | "codex";
export type SessionBackfillKind = "claude-projects";

export interface AgentUsageSpec {
  stdoutExtractor?: UsageExtractorKind;
  sessionRecovery?: SessionRecoveryKind;
  sessionBackfill?: SessionBackfillKind;
}

export interface AgentSpec {
  name: string;
  aliases?: readonly string[];
  displayName: string;
  defaultModel: string;
  normalizer: AgentNormalizerKind;
  usage: AgentUsageSpec;
  smokeCommand: string;
}

export type AgentSpecRegistry = Readonly<Record<string, AgentSpec>>;

const BASE_AGENT_SPECS: readonly AgentSpec[] = [
  {
    name: "claude",
    displayName: "claude",
    defaultModel: "claude-sonnet-4",
    normalizer: "claude",
    usage: { stdoutExtractor: "claude-stream", sessionBackfill: "claude-projects" },
    smokeCommand: 'claude -p "Reply with a single word: hello"',
  },
  {
    name: "codex",
    aliases: ["openai"],
    displayName: "codex",
    defaultModel: "gpt-5.5",
    normalizer: "codex",
    usage: { stdoutExtractor: "openai", sessionRecovery: "codex" },
    smokeCommand: 'codex exec "Reply with a single word: hello"',
  },
  {
    name: "kimi",
    displayName: "kimi",
    defaultModel: "kimi-k2",
    normalizer: "generic",
    usage: { stdoutExtractor: "kimi", sessionRecovery: "kimi" },
    smokeCommand: 'kimi-code -p "Reply with a single word: hello"',
  },
  {
    name: "qwen",
    displayName: "qwen",
    defaultModel: "qwen-coder-plus",
    normalizer: "generic",
    usage: { stdoutExtractor: "qwen" },
    smokeCommand: 'qwen -p "Reply with a single word: hello"',
  },
  {
    name: "agy",
    aliases: ["antigravity", "gemini"],
    displayName: "antigravity (agy)",
    defaultModel: "gemini-2.5-pro",
    normalizer: "generic",
    usage: { stdoutExtractor: "gemini" },
    smokeCommand: 'agy -p "Reply with a single word: hello"',
  },
  {
    name: "pi",
    aliases: ["deepseek"],
    displayName: "pi",
    defaultModel: "deepseek-v4-pro",
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
