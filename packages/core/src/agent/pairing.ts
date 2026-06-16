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
import type { RollEvent } from "@roll/spec";
import { extractUsage, sumClaudeStream, toCycleCost } from "../cost/tracker.js";
import { AGENT_REGISTRY_NAMES, agentIsKnown, canonicalAgentName } from "./registry.js";

// US-PAIR-009: `score` — the finished cycle's quality score is produced by the
// heterogeneous paired agent (self-score is the fallback, never the default).
export type PairingStage = "design" | "test" | "code" | "cycle" | "score";
export const PAIRING_STAGES: readonly PairingStage[] = ["design", "test", "code", "cycle", "score"];

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

/**
 * FIX-312 — is a heterogeneous peer GENUINELY available for `workingAgent`?
 *
 * The owner-calibrated line for review routing: "hetero available → must use it;
 * self only when hetero is truly impossible." This is the single predicate that
 * decision drives on — `auto` defaults to hetero-FIRST, and a cycle that
 * self-reviewed while this returns true is a VIOLATION (the peer gate blocks it).
 *
 * Agent-agnostic by construction (roll core thesis): "heterogeneous" = a
 * different VENDOR than the builder, computed uniformly through {@link agentVendor}
 * — NO per-agent hardcoding. Returns true iff ≥1 CONFIGURED/installed agent
 * resolves to a vendor different from the builder's. A single-agent / single-vendor
 * setup → false → self-review is an allowed recorded fallback (never blocked).
 */
export function heteroAvailable(installed: readonly string[], workingAgent: string): boolean {
  const working = agentVendor(workingAgent);
  if (working === "" || canonicalAgentName(workingAgent) === "") {
    // No builder identity → can't reason about heterogeneity; conservatively
    // treat any second distinct vendor in the pool as a heterogeneous option.
    const vendors = new Set(installed.map(agentVendor).filter((v) => v !== ""));
    return vendors.size >= 2;
  }
  return installed.some((a) => {
    const c = canonicalAgentName(a);
    return c !== "" && agentVendor(c) !== working;
  });
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
  // US-PAIR-009: every installed agent is declared score-capable too — scoring a
  // delivery summary needs no special tooling, so the default pool is the same
  // as code review's.
  for (const a of agents) capability[a] = ["code", "score"];
  return { enabled: vendors.size >= 2, stages: ["code", "score"], capability };
}

/** One installed agent's standing in the pairing pool (US-PAIR-002 observability). */
export interface PoolAgentView {
  agent: string;
  vendor: string;
  /** In the pool = declared capable for ≥1 stage AND has a heterogeneous partner. */
  inPool: boolean;
  capability: PairingStage[];
  /** Why it is NOT in the pool (empty when inPool). */
  reason: string;
}

export interface PairingPoolView {
  enabled: boolean;
  stages: PairingStage[];
  agents: PoolAgentView[];
}

/**
 * The observability view (US-PAIR-002): for each installed agent, its vendor,
 * declared capability, and whether it is an eligible pairing candidate — and if
 * not, why. Pure (installed + cfg → view) so it is testable and the CLI just
 * renders it. Observability is a first-class need, not an afterthought.
 */
export function pairingPoolView(installed: string[], cfg: PairingConfig): PairingPoolView {
  const agents = installed.map(canonicalAgentName).filter((a, i, arr) => arr.indexOf(a) === i);
  const vendorCount = new Map<string, number>();
  for (const a of agents) vendorCount.set(agentVendor(a), (vendorCount.get(agentVendor(a)) ?? 0) + 1);
  const distinctVendors = vendorCount.size;

  const rows: PoolAgentView[] = agents.map((agent) => {
    const vendor = agentVendor(agent);
    const capability = cfg.capability[agent] ?? [];
    let reason = "";
    if (capability.length === 0) reason = "no capability declared in pairing.yaml";
    // codex pair-review: capable for SOME stage isn't enough — it must overlap an
    // ENABLED stage, else it's never actually eligible (e.g. design-only while only
    // code is on).
    else if (!capability.some((s) => cfg.stages.includes(s))) reason = "capability does not overlap any enabled stage";
    else if (distinctVendors < 2) reason = "no heterogeneous partner (only one vendor installed)";
    // A same-vendor agent can still pair with a different vendor, so the only
    // pool-blocking heterogeneity case is "everyone is the same vendor".
    return { agent, vendor, capability, inPool: reason === "" && cfg.enabled, reason: cfg.enabled ? reason : "pairing disabled" };
  });
  return { enabled: cfg.enabled, stages: cfg.stages, agents: rows };
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

// ── US-PAIR-006: cost observability ──────────────────────────────────────────

/**
 * Turn a peer agent's raw stdout into a REAL list cost (USD) for the
 * pair:verdict `cost` field — never the 0 placeholder again (owner's top
 * priority: "至少知道花了多少钱"). claude runs with `--output-format stream-json`
 * so its usage is summed via {@link sumClaudeStream}; the four stdout-scrape
 * agents (openai/codex, gemini, kimi, qwen) go through {@link extractUsage};
 * pi/text-mode and unknown agents have no parseable usage and record 0. The peer
 * is canonicalised first (codex → openai) so the alias hits the right extractor.
 *
 * Best-effort by contract: a parse miss or any throw yields 0, NEVER an
 * exception — pairing must stay non-blocking, and cost accounting must not fail
 * the cycle. The returned figure is the kept-work list cost (revertCount 0 — a
 * one-way peer review never reverts).
 */
export function peerReviewCost(peer: string, stdout: string): number {
  try {
    const canon = canonicalAgentName(peer);
    const lines = stdout.split("\n");
    const usage = canon === "claude" ? sumClaudeStream(lines) : extractUsage(canon, lines);
    if (usage === null) return 0;
    // pi pair-review: a parsed-but-empty usage (0 in / 0 out) has no cost to
    // compute — short-circuit so the price table never sees a zero-token split.
    if ((usage.input_tokens ?? 0) === 0 && (usage.output_tokens ?? 0) === 0) return 0;
    const { estimatedCost } = toCycleCost(usage, { cycleId: "pair", agent: canon, revertCount: 0 });
    return Number.isFinite(estimatedCost) && estimatedCost > 0 ? estimatedCost : 0;
  } catch {
    return 0; // cost accounting is best-effort — never throw
  }
}

/** Aggregate pairing activity + spend, rebuilt from the pair:* event stream. */
export interface PairingCostSummary {
  /** pair:verdict events seen (a completed pairing). */
  pairings: number;
  /** count of pairings per peer agent (canonical), e.g. { codex: 2, kimi: 1 }. */
  byPeer: Record<string, number>;
  /** sum of pair:verdict `cost` across all pairings (USD list cost). */
  totalCost: number;
  /** sum of `findings` across all pairings (the real-problem signal). */
  totalFindings: number;
  /** pair:none-available events (fail-loud absences — a pairing that did not happen). */
  noneAvailable: number;
}

/**
 * Fold the pair:* events into an activity/spend summary for `roll pair status`
 * and the dashboard: "pairings to date: N, by peer (codex×K, kimi×J…), total
 * cost $X, M findings". Pure (events → summary) so the CLI is a thin renderer
 * and this is unit-testable. Non-pair events are ignored.
 *
 * `totalCost` is the sum of each pair:verdict's RECORDED `cost` — the real spend
 * captured at write time by {@link peerReviewCost} (pi pair-review): this is NOT
 * recomputed from stdout here, so any legacy event written before US-PAIR-006
 * (with the old `cost: 0` placeholder) contributes 0. Forward-correct, not
 * backfilled — the spend becomes visible from the first PAIR-006 cycle on.
 */
export function aggregatePairingCost(events: readonly RollEvent[]): PairingCostSummary {
  const summary: PairingCostSummary = { pairings: 0, byPeer: {}, totalCost: 0, totalFindings: 0, noneAvailable: 0 };
  for (const e of events) {
    if (e.type === "pair:verdict") {
      summary.pairings += 1;
      const peer = canonicalAgentName(e.peer);
      summary.byPeer[peer] = (summary.byPeer[peer] ?? 0) + 1;
      summary.totalCost += Number.isFinite(e.cost) ? e.cost : 0;
      summary.totalFindings += Number.isFinite(e.findings) ? e.findings : 0;
    } else if (e.type === "pair:score") {
      // US-PAIR-009: a score pairing is pairing activity + spend (no findings axis).
      summary.pairings += 1;
      const peer = canonicalAgentName(e.peer);
      summary.byPeer[peer] = (summary.byPeer[peer] ?? 0) + 1;
      summary.totalCost += Number.isFinite(e.cost) ? e.cost : 0;
    } else if (e.type === "pair:none-available") {
      summary.noneAvailable += 1;
    }
  }
  return summary;
}

// ── US-PAIR-006: hit-rate-driven rotation ────────────────────────────────────

/** One peer's pairing track record: how often it reviewed and how often it hit. */
export interface PeerStat {
  /** pair:verdict events for this peer. */
  count: number;
  /** verdicts that surfaced ≥1 real finding (a "hit"). */
  hits: number;
}

/** Per-peer history (canonical agent → {count, hits}), rebuilt from pair:verdict. */
export type PairingHistory = Record<string, PeerStat>;

/**
 * Rebuild per-peer pairing history from the event stream: a HIT is a
 * pair:verdict that produced ≥1 finding (a real problem caught), regardless of
 * the agree/refine/object label — a zero-finding "agree" counts toward `count`
 * but never toward `hits`. This is the signal the ε-greedy rotation prefers on.
 */
export function pairingHistory(events: readonly RollEvent[]): PairingHistory {
  const hist: PairingHistory = {};
  for (const e of events) {
    if (e.type !== "pair:verdict") continue;
    const peer = canonicalAgentName(e.peer);
    const stat = hist[peer] ?? { count: 0, hits: 0 };
    stat.count += 1;
    // pi pair-review: guard a malformed event's `findings` (negative / NaN) —
    // only a finite, positive count is a real hit; corruption never inflates it.
    if (Number.isFinite(e.findings) && e.findings > 0) stat.hits += 1;
    hist[peer] = stat;
  }
  return hist;
}

/** Default exploration rate: 20% explore / 80% exploit (pi's ε-greedy 80/20). */
export const DEFAULT_PAIRING_EPSILON = 0.2;

/**
 * A peer's hit-rate, Laplace-smoothed so a single lucky hit on one sample does
 * not pin the rate at 1.0 (and an unproven peer starts at the prior, not 0):
 * (hits + 1) / (count + 2). No history → the neutral prior 0.5, so a cold peer
 * is neither favoured nor punished.
 */
function hitRate(stat: PeerStat | undefined): number {
  if (stat === undefined || stat.count <= 0) return 0.5;
  return (stat.hits + 1) / (stat.count + 2);
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
  /**
   * US-PAIR-006 (optional, backward-compatible): per-peer track record from
   * {@link pairingHistory}. Absent / empty → pure seeded round-robin (the
   * US-PAIR-001 behaviour, unchanged). Present → ε-greedy preference for the
   * highest-hit-rate heterogeneous peer.
   */
  history?: PairingHistory;
  /** ε for the ε-greedy rotation (default {@link DEFAULT_PAIRING_EPSILON}). */
  epsilon?: number;
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
  const { installed, isAvailable, workingAgent, stage, cfg, cycleId, history } = input;
  const working = canonicalAgentName(workingAgent);
  const order = new Map(AGENT_REGISTRY_NAMES.map((n, i) => [n as string, i]));

  // FIX-343 (step ⑤, OWNER B-decision): the "score" stage is MANDATORY,
  // stage-aware, and RANKS heterogeneity as a PREFERENCE (not a hard filter):
  //   • NOT gated on cfg.enabled / cfg.stages — a Review Score is owed by every
  //     delivery whether or not pairing.yaml opts in (the executor calls this
  //     unconditionally; an absent config must still yield a scorer).
  //   • PREFER heterogeneous candidates (different vendor = absolute
  //     heterogeneity, the encouraged/best independent signal) FIRST, then FALL
  //     BACK to a SAME-VENDOR fresh session (a fresh instance of the builder's
  //     own type) — NOT "drop the hetero filter". The same-vendor fresh session
  //     is the MINIMUM acceptable independence (a separately-spawned distinct
  //     subprocess via ports.agentSpawn, never a sub-agent sharing the builder's
  //     context); it is the fallback so a single-vendor install is never
  //     deadlocked, while a richer install still reaches for an other-vendor
  //     fresh session first. Capability is not required for scoring (no special
  //     tooling — every installed agent can score).
  // Code review (and every other stage) KEEPS the heterogeneous HARD filter and
  // the enabled/stage/capability gating unchanged (independence by vendor is a
  // HARD requirement there, not merely preferred).
  if (stage === "score") {
    const scorers = installed
      .map(canonicalAgentName)
      .filter((a, i, arr) => arr.indexOf(a) === i) // de-dupe
      .filter((a) => isAvailable(a))
      .sort((x, y) => (order.get(x) ?? 999) - (order.get(y) ?? 999));
    if (scorers.length === 0) return [];
    // Split into heterogeneous (different vendor than the builder) and
    // same-vendor (incl. the builder's own type) pools. A round-robin seed
    // rotates WITHIN each pool so we don't fixate on one peer over time, yet stay
    // replayable. Then concatenate hetero-first, same-vendor-fallback: the set is
    // never trimmed (reachability preserved — a failed hetero scorer still falls
    // back to a same-vendor fresh session), only the head order is ranked.
    const hetero = scorers.filter((a) => working !== "" && isHeterogeneous(a, working));
    const sameVendor = scorers.filter((a) => working === "" || !isHeterogeneous(a, working));
    const rotate = (pool: string[]): string[] => {
      if (pool.length === 0) return pool;
      const start = seedOf(cycleId) % pool.length;
      return [...pool.slice(start), ...pool.slice(0, start)];
    };
    return [...rotate(hetero), ...rotate(sameVendor)];
  }

  if (!cfg.enabled) return [];
  if (!cfg.stages.includes(stage)) return [];

  // Rational hard filter: installed + available + capable-for-stage +
  // heterogeneous from the worker. Order by the registry so the seed maps to a
  // stable index.
  const qualified = installed
    .map(canonicalAgentName)
    .filter((a, i, arr) => arr.indexOf(a) === i) // de-dupe
    .filter((a) => a !== working)
    .filter((a) => isAvailable(a))
    .filter((a) => (cfg.capability[a] ?? []).includes(stage))
    .filter((a) => isHeterogeneous(a, working))
    .sort((x, y) => (order.get(x) ?? 999) - (order.get(y) ?? 999));

  if (qualified.length === 0) return [];

  // Seeded round-robin baseline (US-PAIR-001): rotate the stable list so
  // pairings don't fixate on one agent over time, yet stay replayable. This is
  // the EXPLORE arm — and the whole behaviour when there is no history.
  const seed = seedOf(cycleId);
  const start = seed % qualified.length;
  const explore = [...qualified.slice(start), ...qualified.slice(0, start)];

  // US-PAIR-006: ε-greedy hit-rate preference. With no history we stay on pure
  // round-robin (backward compatible). With history, an (1-ε) fraction of cycles
  // EXPLOIT — lead with the highest-hit-rate heterogeneous peer — while ε of
  // cycles keep exploring via the round-robin above. The explore/exploit coin is
  // itself seeded by cycleId, so selection stays deterministic/replayable, and
  // the ε floor is kimi's guardrail: a high scorer can never monopolise (every
  // peer still leads on some cycles). The peer SET is never trimmed — only the
  // head order changes, so a failed exploit peer falls back to the rest.
  if (history === undefined || Object.keys(history).length === 0) return explore;
  const epsilon = clampEpsilon(input.epsilon ?? DEFAULT_PAIRING_EPSILON);
  // Deterministic coin in [0,1): a second, independent seed dimension so the
  // explore/exploit decision is not correlated with the round-robin offset.
  const coin = (seedOf(`eps:${cycleId}`) % 100_000) / 100_000;
  if (coin < epsilon) return explore; // EXPLORE: keep the round-robin order

  // EXPLOIT: rank the SAME qualified set by descending hit-rate (registry order
  // breaks ties). The set is never trimmed — only re-ordered — so a failed
  // top-ranked peer falls back to the next; reachability is preserved.
  // pi pair-review caveat: with NO hits anywhere, the Laplace prior
  // (hits+1)/(count+2) favours the LEAST-used peer (a peer used once scores
  // 1/3, used ten times scores 1/12) — i.e. exploit degrades to "spread the
  // load" until a real finding lands. That is the intended cold behaviour, not
  // a bug: nothing is yet "proven", so diversification is the rational default.
  const ranked = [...qualified].sort((x, y) => {
    const d = hitRate(history[y]) - hitRate(history[x]);
    return d !== 0 ? d : (order.get(x) ?? 999) - (order.get(y) ?? 999);
  });
  return ranked;
}

/** Clamp ε to [0,1]; a NaN / out-of-range value falls back to the default. */
function clampEpsilon(e: number): number {
  if (!Number.isFinite(e)) return DEFAULT_PAIRING_EPSILON;
  return Math.min(1, Math.max(0, e));
}
