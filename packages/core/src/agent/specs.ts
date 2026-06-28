// claude is KEPT here (harness): the loop runs inside Claude Code and claude is
// used for harness cost/activity normalization, even though it is NOT a member of
// the orchestrated agent POOL (see registry.ts). So "claude"/"claude-stream"
// remain in these unions as harness kinds.
export type AgentNormalizerKind = "claude" | "codex" | "kimi" | "pi" | "generic";
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
  /** Alternate agent names that resolve to this first-class identity. */
  nameAliases?: readonly string[];
  /** Provider/model aliases that resolve for model/spec lookup, not registry identity. */
  providerAliases?: readonly string[];
  /** Legacy extension hook retained for callers that build ad-hoc registries. */
  aliases?: readonly string[];
  displayName: string;
  defaultModel: string;
  /** PATH binary candidates, in probe order. */
  cliBin: readonly string[];
  /** True iff Roll has a prompt-mode spawn profile for this agent. Runtime
   *  auth/VPN/account health is checked at spawn time, not encoded here. */
  canReviewHeadless?: boolean;
  normalizer: AgentNormalizerKind;
  usage: AgentUsageSpec;
  smokeCommand: string;
}

export type AgentSpecRegistry = Readonly<Record<string, AgentSpec>>;

// US-AGENT-043: the supported agent roster is exactly six first-class agents.
// Provider/model aliases stay as aliases only (openai -> codex, deepseek -> pi);
// removed tokens such as qwen/openclaw/opencode/cursor/trae do not get specs.
export const AGENTS: readonly AgentSpec[] = [
  {
    name: "claude",
    displayName: "claude",
    defaultModel: "claude-sonnet-4",
    cliBin: ["claude"],
    canReviewHeadless: true,
    normalizer: "claude",
    usage: { stdoutExtractor: "claude-stream", sessionBackfill: "claude-projects" },
    smokeCommand: 'claude -p "Reply with a single word: hello"',
  },
  {
    name: "kimi",
    displayName: "kimi",
    defaultModel: "kimi-k2",
    cliBin: ["kimi-code", "kimi-cli", "kimi"],
    canReviewHeadless: true,
    normalizer: "kimi",
    usage: { stdoutExtractor: "kimi", sessionRecovery: "kimi" },
    smokeCommand: 'kimi -p "Reply with a single word: hello"',
  },
  {
    name: "codex",
    providerAliases: ["openai"],
    displayName: "codex",
    defaultModel: "gpt-5.5",
    cliBin: ["codex"],
    canReviewHeadless: true,
    normalizer: "codex",
    usage: { stdoutExtractor: "openai", sessionRecovery: "codex", sessionReuse: "codex-exec-resume" },
    smokeCommand: 'codex exec "Reply with a single word: hello"',
  },
  {
    name: "pi",
    providerAliases: ["deepseek"],
    displayName: "pi",
    defaultModel: "deepseek-v4-pro",
    cliBin: ["pi"],
    canReviewHeadless: true,
    normalizer: "pi",
    usage: { stdoutExtractor: "pi", sessionRecovery: "pi" },
    smokeCommand: 'pi -p "Reply with a single word: hello"',
  },
  {
    name: "agy",
    nameAliases: ["antigravity", "gemini"],
    displayName: "antigravity (agy)",
    defaultModel: "gemini-2.5-pro",
    cliBin: ["agy", "gemini"],
    canReviewHeadless: true,
    normalizer: "generic",
    usage: { stdoutExtractor: "gemini" },
    smokeCommand: 'agy -p "Reply with a single word: hello"',
  },
  {
    name: "reasonix",
    displayName: "reasonix",
    defaultModel: "deepseek-flash",
    cliBin: ["reasonix"],
    canReviewHeadless: true,
    normalizer: "generic",
    usage: { stdoutExtractor: "generic" },
    smokeCommand: 'reasonix run --max-steps 1 "Reply with a single word: hello"',
  },
];

function normalizeAgentKey(name: string): string {
  return name.trim().toLowerCase();
}

function canonicalSpecKey(name: string, specs: readonly AgentSpec[] = AGENTS): string {
  const raw = name.trim().toLowerCase();
  for (const spec of specs) {
    const aliases = [...(spec.nameAliases ?? []), ...(spec.providerAliases ?? []), ...(spec.aliases ?? [])];
    if (normalizeAgentKey(spec.name) === raw || aliases.map(normalizeAgentKey).includes(raw)) return normalizeAgentKey(spec.name);
  }
  return raw;
}

export function withAgentSpecs(extra: readonly AgentSpec[] = []): AgentSpecRegistry {
  const out: Record<string, AgentSpec> = {};
  const specs = [...AGENTS, ...extra];
  for (const spec of specs) {
    out[canonicalSpecKey(spec.name, specs)] = spec;
    for (const alias of [...(spec.nameAliases ?? []), ...(spec.providerAliases ?? []), ...(spec.aliases ?? [])]) {
      out[normalizeAgentKey(alias)] = spec;
      out[canonicalSpecKey(alias, specs)] = spec;
    }
  }
  return out;
}

export const AGENT_SPECS = withAgentSpecs();

export function getAgentSpec(name: string, registry: AgentSpecRegistry = AGENT_SPECS): AgentSpec | undefined {
  const raw = normalizeAgentKey(name);
  return registry[raw] ?? registry[canonicalSpecKey(name)];
}

export function canonicalAgentIdentityName(name: string): string {
  const raw = normalizeAgentKey(name);
  for (const spec of AGENTS) {
    if (
      normalizeAgentKey(spec.name) === raw ||
      (spec.nameAliases ?? []).map(normalizeAgentKey).includes(raw) ||
      (spec.providerAliases ?? []).map(normalizeAgentKey).includes(raw)
    )
      return spec.name;
  }
  return raw;
}

// ── Removed agent detection (US-AGENT-045) ───────────────────────────────────

/** Agents removed from the roster in US-AGENT-043. When found in user config
 *  these trigger a fail-loud warning, never a silent fallback. */
export const REMOVED_AGENTS: readonly string[] = ["cursor", "trae", "qwen", "opencode", "openclaw"];

/** True iff NAME is a removed agent token (checked against REMOVED_AGENTS after
 *  normalisation, BEFORE canonicalisation — so `openai` (alias→codex) returns
 *  false while `cursor` returns true). */
export function isRemovedAgentName(name: string): boolean {
  const raw = normalizeAgentKey(name);
  return REMOVED_AGENTS.includes(raw);
}

export function getAgentIdentitySpec(name: string): AgentSpec | undefined {
  const canonical = canonicalAgentIdentityName(name);
  return AGENTS.find((spec) => spec.name === canonical);
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
