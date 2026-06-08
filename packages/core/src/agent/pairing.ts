/**
 * US-PAIR-001 — Cross-Agent Pairing candidate selection (pure) + pairing.yaml.
 *
 * The primitive of cross-agent collaboration is the PAIR: a working agent gets
 * cross-checked by a DIFFERENT (heterogeneous) agent for perspective diversity.
 * This module is the rational selector — randomness only ever happens INSIDE a
 * qualified candidate set (installed + available + capable + heterogeneous),
 * never on the raw pool. Pure + deterministic (seeded by cycleId) so it is
 * unit-testable and replayable, per roll's determinism discipline.
 *
 * Peer-reviewed plan (pi/kimi/codex, all REFINE): self-declared capability is a
 * HARD filter (cross-checked against the registry); heterogeneity is by vendor
 * (same vendor, different model does NOT count); MVP rotation is pure seeded
 * round-robin (hit-rate bias deferred to US-PAIR-006); fail-loud when no peer.
 */
import { AGENT_REGISTRY_NAMES, agentIsKnown, canonicalAgentName } from "./registry.js";

export type PairingStage = "design" | "test" | "code" | "cycle";
export const PAIRING_STAGES: readonly PairingStage[] = ["design", "test", "code", "cycle"];

function isStage(s: string): s is PairingStage {
  return (PAIRING_STAGES as readonly string[]).includes(s);
}

/**
 * Vendor key for heterogeneity: two agents are heterogeneous iff their vendors
 * differ. Aliases that wrap the same backend collapse to one vendor (codex and
 * openai → "openai"), so they are NOT a valid heterogeneous pair. Unknown
 * agents default to their own canonical name (treated as distinct vendors).
 */
const AGENT_VENDOR: Readonly<Record<string, string>> = {
  claude: "anthropic",
  codex: "openai",
  openai: "openai",
  agy: "google",
  gemini: "google",
  kimi: "moonshot",
  qwen: "alibaba",
  deepseek: "deepseek",
  pi: "pi",
  cursor: "cursor",
  opencode: "opencode",
  trae: "trae",
  openclaw: "openclaw",
};

export function agentVendor(name: string): string {
  const c = canonicalAgentName(name);
  return AGENT_VENDOR[c] ?? c;
}

/** Heterogeneous = different vendor. Same vendor (incl. alias) is NOT a pair. */
export function isHeterogeneous(a: string, b: string): boolean {
  return agentVendor(a) !== agentVendor(b);
}

export interface PairingConfig {
  enabled: boolean;
  stages: PairingStage[];
  /** agent (canonical) → the stages it is declared competent to review. */
  capability: Record<string, PairingStage[]>;
}

/** Thrown by parsePairingConfig on an illegal config (fail-loud, per pi/kimi). */
export class PairingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairingConfigError";
  }
}

// NOTE (kimi pair-review): crude `#` truncation is safe ONLY because the schema's
// values (true/false, stage tokens, agent names) are an `[A-Za-z0-9_-]` whitelist
// that never contains a literal `#`. If a value type ever allows `#`, switch to a
// real YAML parser rather than extending this.
const stripComment = (s: string): string => {
  const i = s.indexOf("#");
  return (i >= 0 ? s.slice(0, i) : s).replace(/\s+$/, "");
};

const TOP_KEYS = new Set(["enabled", "stages", "capability"]);

/** Parse a `[a, b]` flow list (the only list shape pairing.yaml uses). */
function parseStageList(raw: string, ctx: string): PairingStage[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
  if (inner === "") return [];
  const out: PairingStage[] = [];
  for (const tok of inner.split(",")) {
    const v = tok.trim();
    if (v === "") continue;
    if (!isStage(v)) throw new PairingConfigError(`illegal stage "${v}" in ${ctx} (allowed: ${PAIRING_STAGES.join(", ")})`);
    out.push(v);
  }
  return out;
}

/**
 * Parse pairing.yaml (hand-rolled, zero-dep, mirroring policy.ts). Fail-loud on
 * illegal stages or a capability declared for an unknown agent (pi: a registry
 * cross-check so a bogus name can't slip a fake reviewer into the pool).
 * Shape:
 *   enabled: true
 *   stages: [code]
 *   capability:
 *     codex: [code, test]
 *     claude: [code, design, cycle]
 */
export function parsePairingConfig(yaml: string): PairingConfig {
  const cfg: PairingConfig = { enabled: false, stages: [], capability: {} };
  let inCapability = false;
  for (const rawLine of yaml.split("\n")) {
    const line = stripComment(rawLine);
    if (line.trim() === "") continue;
    const indented = /^\s/.test(rawLine);
    if (!indented) {
      inCapability = false;
      const m = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
      if (m === null) throw new PairingConfigError(`malformed line: "${line.trim()}"`);
      const [, key, val] = m;
      // fail-loud on an unknown top-level key (kimi pair-review): silently
      // ignoring it would let a typo'd key (e.g. `stage:` for `stages:`) pass
      // unnoticed and change behaviour.
      if (!TOP_KEYS.has(key as string)) {
        throw new PairingConfigError(`unknown top-level key "${key}" (allowed: ${[...TOP_KEYS].join(", ")})`);
      }
      if (key === "enabled") cfg.enabled = val?.trim() === "true";
      else if (key === "stages") cfg.stages = parseStageList(val ?? "", "stages");
      else if (key === "capability") inCapability = true;
    } else if (inCapability) {
      const m = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (m === null) throw new PairingConfigError(`malformed capability line: "${line.trim()}"`);
      const [, agent, val] = m;
      const canon = canonicalAgentName(agent as string);
      if (!agentIsKnown(canon)) {
        throw new PairingConfigError(`capability declared for unknown agent "${agent}" (registry cross-check failed)`);
      }
      cfg.capability[canon] = parseStageList(val ?? "", `capability.${agent}`);
    } else {
      // indented line outside the only nesting block (capability) — a mis-indent
      // (e.g. an indented `stages:`) would otherwise vanish silently (kimi pair-review).
      throw new PairingConfigError(`unexpected indented line outside capability: "${line.trim()}"`);
    }
  }
  return cfg;
}

/**
 * Build the default config `roll pair init` materialises from the live registry:
 * every installed agent is declared code-capable; pairing is enabled only when
 * ≥2 distinct vendors are present (else there is no heterogeneous peer to pair
 * with, so it lands disabled with the reason left to the renderer). MVP stage is
 * `code` (the proven, lowest-integration path).
 */
export function defaultPairingConfig(installed: string[]): PairingConfig {
  const agents = installed.map(canonicalAgentName).filter((a, i, arr) => arr.indexOf(a) === i);
  const vendors = new Set(agents.map(agentVendor));
  const capability: Record<string, PairingStage[]> = {};
  for (const a of agents) capability[a] = ["code"];
  return { enabled: vendors.size >= 2, stages: ["code"], capability };
}

/**
 * Serialise a config to explicit pairing.yaml text — the scaffold writes every
 * default into the file (never a hidden code default), so the config is auditable
 * and editable. When disabled for lack of a heterogeneous peer, says so in a comment.
 */
export function renderPairingConfig(cfg: PairingConfig): string {
  const lines: string[] = [
    "# .roll/pairing.yaml — Cross-Agent Pairing (US-PAIR-001).",
    "# Generated by `roll pair init` from `roll agents list`. Edit freely.",
    "# File present = pairing on; delete this file = pairing off (never silent).",
  ];
  if (!cfg.enabled) {
    lines.push("# Disabled: fewer than two distinct vendors installed — no heterogeneous peer to pair with.");
  }
  lines.push(`enabled: ${cfg.enabled ? "true" : "false"}`, `stages: [${cfg.stages.join(", ")}]`, "capability:");
  for (const agent of Object.keys(cfg.capability)) {
    lines.push(`  ${agent}: [${(cfg.capability[agent] ?? []).join(", ")}]`);
  }
  return lines.join("\n") + "\n";
}

export interface SelectInput {
  /** Installed agents (canonical), e.g. from agentsInstalled(). */
  installed: string[];
  /** Liveness probe — only available agents survive the filter. Receives a
   *  CANONICAL agent name (kimi pair-review): the caller's probe must speak the
   *  same canonical vocabulary as the registry, not raw CLI binary names. */
  isAvailable: (agent: string) => boolean;
  /** The agent that did the work; its heterogeneous peers are the candidates. */
  workingAgent: string;
  stage: PairingStage;
  cfg: PairingConfig;
  /** Seeds the deterministic round-robin rotation (replayable, not RNG). */
  cycleId: string;
}

/** Stable string hash (FNV-1a-ish) for the rotation seed — deterministic. */
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The rational selector. Returns heterogeneous candidates ranked by a
 * cycleId-seeded round-robin (selected peer first, then alternates), or [] when
 * pairing is off / the stage is not enabled / no qualified heterogeneous peer
 * exists. [] at the call site is the fail-loud signal (emit pair:none-available)
 * — never a silently-skipped pairing.
 */
export function selectPairingCandidates(input: SelectInput): string[] {
  const { installed, isAvailable, workingAgent, stage, cfg, cycleId } = input;
  if (!cfg.enabled) return [];
  if (!cfg.stages.includes(stage)) return [];
  const working = canonicalAgentName(workingAgent);

  // Rational hard filter: installed + available + capable-for-stage +
  // heterogeneous from the worker. Order by the registry so the seed maps to a
  // stable index.
  const order = new Map(AGENT_REGISTRY_NAMES.map((n, i) => [n as string, i]));
  const qualified = installed
    .map(canonicalAgentName)
    .filter((a, i, arr) => arr.indexOf(a) === i) // de-dupe
    .filter((a) => a !== working)
    .filter((a) => isAvailable(a))
    .filter((a) => (cfg.capability[a] ?? []).includes(stage))
    .filter((a) => isHeterogeneous(a, working))
    .sort((x, y) => (order.get(x) ?? 999) - (order.get(y) ?? 999));

  if (qualified.length === 0) return [];
  // Seeded round-robin: rotate the stable list so pairings don't fixate on one
  // agent over time, yet stay replayable for the same cycleId.
  const start = seedOf(cycleId) % qualified.length;
  return [...qualified.slice(start), ...qualified.slice(0, start)];
}
