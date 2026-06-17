/**
 * CostTracker — TS port of the v2 `lib/agent_usage/` plugin contract: parse each
 * agent's usage output into tokens + model + list cost, and fold a parsed usage
 * into the per-cycle {@link CycleCost} record budget guardrails gate on (I11).
 *
 * v2 oracle (frozen python, read fully before any change):
 *   - registry contract + `extract_usage` validation
 *       (lib/agent_usage/__init__.py:81-108): each adapter exports
 *       `extract(lines) -> dict | None`; a result missing any required field
 *       (`model`/`input_tokens`/`output_tokens`/`cost_list_usd`) is treated as
 *       None (caller falls back to the null payload). {@link extractUsage}.
 *   - stdout-scrape adapters openai / gemini / kimi / qwen
 *       (lib/agent_usage/{openai,gemini,kimi,qwen}.py): IDENTICAL parsing — only
 *       the default model differs. One generic {@link makeStdoutExtractor} +
 *       a per-agent default mirrors all four. The regexes, the
 *       total-without-split fallback, and the price-table cost fallback are
 *       ported line-for-line.
 *   - pi adapter `extract()` stub (lib/agent_usage/pi.py:27-35): pi `-p` text
 *       mode carries no usage → always None. {@link piExtract}.
 *   - session-file summers `_sum_session_file` (pi.py:53-108) /
 *       `_sum_wire_file` (kimi.py:159-204) + their aggregating
 *       `usage_from_session` (pi.py:132-200, kimi.py:207-278): authoritative
 *       token recovery from persisted NDJSON. {@link sumPiSession} /
 *       {@link sumKimiWire} / {@link aggregateSessions} (pure: lines injected).
 *   - per-cycle record shape: bash folds usage + revert facts into a row per
 *       @roll/spec CycleCost (route/runs wiring at bin/roll _runs_append
 *       ~8538-8664, usage emit at pi_emit.py / kimi_emit.py). {@link toCycleCost}.
 *
 * Purity: no filesystem, no clock, no process spawn. Adapters take the already-
 * read stdout lines / NDJSON lines; cost uses the injected price table
 * (prices.ts). The session GLOB + file read is a caller concern (an injected
 * port), exactly as the bash invokes pi_emit / kimi_emit after the agent phase.
 */
import type { CycleCost } from "@roll/spec";
import { getAgentSpec, type UsageExtractorKind } from "../agent/specs.js";
import { type ListCostTokens, computeListCost, currencyFor } from "./prices.js";

// ── Parsed-usage shape (the adapter contract return) ─────────────────────────

/** The structured usage an adapter returns (mirror the python dict shape). */
export interface AgentUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  /** Present on stdout-scrape adapters (computed list cost). */
  cost_list_usd?: number;
  /** Present on session-file adapters (pi/kimi cache split). */
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  /** pi only: its own per-message `cost.total` summed (USD) — audit only. */
  cost_reported?: number;
  duration_ms?: number | null;
}

/** An adapter: parse stdout lines → usage, or null when unrecognised. */
export type Extractor = (lines: readonly string[]) => AgentUsage | null;

// ── Stdout-scrape adapters (openai / gemini / kimi / qwen) ───────────────────

// Regexes ported verbatim from the four adapter modules. openai's TOTAL regex
// also accepts "tokens used"; gemini/kimi/qwen use a plain "total" anchor. The
// MODEL/INPUT/OUTPUT/COST regexes are identical across all four.
const MODEL_RE = /^\s*model\s*[:=]\s*([A-Za-z0-9][\w.\-]*)/i;
const INPUT_RE = /input(?:\s+tokens)?\s*[:=]\s*([\d,]+)/i;
const OUTPUT_RE = /output(?:\s+tokens)?\s*[:=]\s*([\d,]+)/i;
const COST_RE = /cost\s*[:=]?\s*\$?\s*([\d.]+)\s*(?:usd)?/i;
const TOTAL_RE_OPENAI = /(?:tokens\s+used|total)\s*[:=]\s*([\d,]+)/i;
const TOTAL_RE_GENERIC = /total(?:\s+tokens)?\s*[:=]\s*([\d,]+)/i;

/** Parse a token count tolerating thousands separators (python `_to_int`). */
function toInt(s: string): number {
  return Number.parseInt(s.replace(/,/g, ""), 10);
}

/** Per-agent stdout-scrape config: the default model + which TOTAL regex. */
export interface StdoutAgentSpec {
  defaultModel: string;
  totalKind: "openai" | "generic";
}

/** The default models + total-regex flavour for the four stdout-scrape agents. */
export const STDOUT_AGENTS: Record<string, StdoutAgentSpec> = {
  openai: { defaultModel: "gpt-4o", totalKind: "openai" },
  gemini: { defaultModel: "gemini-2.5-pro", totalKind: "generic" },
  kimi: { defaultModel: "kimi-k2", totalKind: "generic" },
  qwen: { defaultModel: "qwen-coder-plus", totalKind: "generic" },
};

/**
 * Build a stdout-scrape extractor mirroring the openai/gemini/kimi/qwen
 * `extract()` bodies line-for-line: scan every line accumulating the last-seen
 * model / input / output / total / cost; require ≥1 token figure; derive
 * input from a bare total; default the model; and fall back to the price table
 * for cost when no explicit cost line was present.
 */
export function makeStdoutExtractor(spec: StdoutAgentSpec): Extractor {
  const totalRe = spec.totalKind === "openai" ? TOTAL_RE_OPENAI : TOTAL_RE_GENERIC;
  return (lines: readonly string[]): AgentUsage | null => {
    if (lines.length === 0) return null;

    let model: string | null = null;
    let tin: number | null = null;
    let tout: number | null = null;
    let ttotal: number | null = null;
    let cost: number | null = null;

    for (const raw of lines) {
      const line = raw.replace(/\n+$/, "");

      const mm = MODEL_RE.exec(line);
      if (mm && mm[1] !== undefined) model = mm[1];

      const mi = INPUT_RE.exec(line);
      if (mi && mi[1] !== undefined) tin = toInt(mi[1]);

      const mo = OUTPUT_RE.exec(line);
      if (mo && mo[1] !== undefined) tout = toInt(mo[1]);

      const mt = totalRe.exec(line);
      if (mt && mt[1] !== undefined) ttotal = toInt(mt[1]);

      const mc = COST_RE.exec(line);
      if (mc && mc[1] !== undefined) {
        const v = Number.parseFloat(mc[1]);
        if (Number.isFinite(v)) cost = v;
      }
    }

    if (tin === null && tout === null && ttotal === null) return null;
    if (tin === null && tout === null && ttotal !== null) {
      // No split available — attribute the whole total to input.
      tin = ttotal;
      tout = 0;
    } else {
      tin = tin ?? 0;
      tout = tout ?? 0;
      if (ttotal !== null && tin === 0 && tout === 0) tin = ttotal;
    }

    const resolvedModel = model ?? spec.defaultModel;
    const resolvedCost =
      cost ?? computeListCost(resolvedModel, { input_tokens: tin, output_tokens: tout });

    return {
      model: resolvedModel,
      input_tokens: tin,
      output_tokens: tout,
      cost_list_usd: resolvedCost,
      duration_ms: null,
    };
  };
}

export const openaiExtract: Extractor = makeStdoutExtractor(
  STDOUT_AGENTS["openai"] as StdoutAgentSpec,
);
export const geminiExtract: Extractor = makeStdoutExtractor(
  STDOUT_AGENTS["gemini"] as StdoutAgentSpec,
);
export const kimiExtract: Extractor = makeStdoutExtractor(
  STDOUT_AGENTS["kimi"] as StdoutAgentSpec,
);
export const qwenExtract: Extractor = makeStdoutExtractor(
  STDOUT_AGENTS["qwen"] as StdoutAgentSpec,
);

/** pi `extract()` stub: text-mode stdout carries no usage → always null. */
export const piExtract: Extractor = (): AgentUsage | null => null;

/** The stdout-scrape registry (pi maps to its always-null stub). */
export const REGISTRY: Record<string, Extractor> = {
  "claude-stream": sumClaudeStream,
  pi: piExtract,
  openai: openaiExtract,
  gemini: geminiExtract,
  kimi: kimiExtract,
  qwen: qwenExtract,
  generic: makeStdoutExtractor({ defaultModel: "generic", totalKind: "generic" }),
};

/** Required fields the python validator enforces (extract_usage). */
const REQUIRED_FIELDS: readonly (keyof AgentUsage)[] = [
  "model",
  "input_tokens",
  "output_tokens",
  "cost_list_usd",
];

/**
 * Look up an agent in the registry and run its extractor, mirroring
 * `extract_usage` (lib/agent_usage/__init__.py:81-108): unknown agent → null;
 * a result missing any required field → null (the caller's null-payload
 * fallback). A thrown extractor is swallowed to null.
 */
export function extractUsage(agent: string, lines: readonly string[]): AgentUsage | null {
  const key = getAgentSpec(agent)?.usage.stdoutExtractor ?? (agent as UsageExtractorKind);
  const fn = REGISTRY[key];
  if (fn === undefined) return null;
  let result: AgentUsage | null;
  try {
    result = fn(lines);
  } catch {
    return null;
  }
  if (result === null) return null;
  const required =
    key === "claude-stream" ? REQUIRED_FIELDS.filter((field) => field !== "cost_list_usd") : REQUIRED_FIELDS;
  for (const field of required) {
    if (result[field] === undefined || result[field] === null) return null;
  }
  return result;
}

// ── Session-file summers (pi / kimi authoritative recovery) ──────────────────

/** Aggregate token totals across session files (pure accumulator). */
export interface SessionAgg {
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  /** pi only — summed `cost.total` (audit). */
  cost_reported: number;
}

/** FIX-249: exported — the cli session-recovery adapter needs the same default. */
export const PI_DEFAULT_MODEL = "deepseek-v4-pro";
export const KIMI_DEFAULT_MODEL = "kimi-k2";

/**
 * Sum per-message assistant usage in one pi session jsonl, mirroring
 * `_sum_session_file` (pi.py:53-108). `lines` are the file's NDJSON lines
 * (already read). Field mapping: cacheWrite→cache_creation, cacheRead→cache_read.
 * Returns null when no assistant `usage` block was seen.
 */
export function sumPiSession(lines: readonly string[]): SessionAgg | null {
  let tin = 0;
  let tout = 0;
  let tcr = 0;
  let tcw = 0;
  let cost = 0;
  let model: string | null = null;
  let seen = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (o["type"] !== "message") continue;
    const m = (o["message"] ?? {}) as Record<string, unknown>;
    if (m["role"] !== "assistant") continue;
    const u = m["usage"] as Record<string, unknown> | undefined | null;
    if (!u) continue;
    seen = true;
    if (typeof m["model"] === "string" && m["model"]) model = m["model"];
    tin += intOr(u["input"]);
    tout += intOr(u["output"]);
    tcr += intOr(u["cacheRead"]);
    tcw += intOr(u["cacheWrite"]);
    const c = (u["cost"] ?? {}) as Record<string, unknown>;
    cost += floatOr(c["total"]);
  }
  if (!seen) return null;
  return {
    model: model ?? PI_DEFAULT_MODEL,
    input_tokens: tin,
    output_tokens: tout,
    cache_creation_tokens: tcw,
    cache_read_tokens: tcr,
    cost_reported: cost,
  };
}

/**
 * Sum `usage.record` lines in one kimi wire.jsonl, mirroring `_sum_wire_file`
 * (kimi.py:159-204). Field mapping: inputOther→input, output→output,
 * inputCacheRead→cache_read, inputCacheCreation→cache_creation. Returns null
 * when no usage record was seen.
 */
export function sumKimiWire(lines: readonly string[]): SessionAgg | null {
  let tin = 0;
  let tout = 0;
  let tcr = 0;
  let tcw = 0;
  let model: string | null = null;
  let seen = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (o["type"] !== "usage.record") continue;
    const u = (o["usage"] ?? {}) as Record<string, unknown>;
    seen = true;
    if (typeof o["model"] === "string" && o["model"]) model = o["model"];
    tin += intOr(u["inputOther"]);
    tout += intOr(u["output"]);
    tcr += intOr(u["inputCacheRead"]);
    tcw += intOr(u["inputCacheCreation"]);
  }
  if (!seen) return null;
  return {
    model: model ?? KIMI_DEFAULT_MODEL,
    input_tokens: tin,
    output_tokens: tout,
    cache_creation_tokens: tcw,
    cache_read_tokens: tcr,
    cost_reported: 0,
  };
}

/** FIX-303: exported — the cli codex session-recovery adapter needs the same
 *  default when a codex session omits its model id. Tracks the codex CLI's
 *  current default model (gpt-5.5); priced in USD via the openai/gpt snapshot. */
export const CODEX_DEFAULT_MODEL = "gpt-5.5";

/**
 * Sum a codex CLI session `rollout-*.jsonl`, mirroring how pi/kimi recover from
 * their persisted stores (FIX-303 — codex `exec` prints no parseable usage
 * footer, so its stdout-scrape lane is always null; the authoritative usage
 * lives in `~/.codex/sessions/**` + `/rollout-*.jsonl`). Each `event_msg` line
 * whose `payload.type === "token_count"` carries a CUMULATIVE
 * `info.total_token_usage` snapshot, so — unlike pi/kimi per-message lines that
 * SUM — the running total is the LAST snapshot (taking the max guards against an
 * out-of-order tail). Field mapping (OpenAI billing): codex `input_tokens`
 * INCLUDES `cached_input_tokens`, so cache-miss input = input − cached;
 * cache_read = cached_input_tokens; output = output_tokens (reasoning is already
 * counted within the billed output total, not additive); OpenAI levies no
 * cache-write surcharge so cache_creation = 0. The model is the session's
 * `turn_context` / `session_meta` `payload.model`. Returns null when no
 * token_count event was seen ("n/a, never fake zero").
 */
export function sumCodexSession(lines: readonly string[]): SessionAgg | null {
  let inputTotal = 0;
  let cachedTotal = 0;
  let outputTotal = 0;
  let model: string | null = null;
  let seen = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const p = (o["payload"] ?? {}) as Record<string, unknown>;
    const type = o["type"];
    if ((type === "session_meta" || type === "turn_context") && typeof p["model"] === "string" && p["model"]) {
      model = p["model"] as string;
    }
    if (type !== "event_msg" || p["type"] !== "token_count") continue;
    const info = (p["info"] ?? {}) as Record<string, unknown>;
    const total = info["total_token_usage"] as Record<string, unknown> | undefined | null;
    if (!total) continue;
    seen = true;
    // Cumulative snapshots: take the max so an out-of-order tail can't shrink it.
    inputTotal = Math.max(inputTotal, intOr(total["input_tokens"]));
    cachedTotal = Math.max(cachedTotal, intOr(total["cached_input_tokens"]));
    outputTotal = Math.max(outputTotal, intOr(total["output_tokens"]));
  }
  if (!seen) return null;
  const cacheRead = Math.min(cachedTotal, inputTotal);
  return {
    model: model ?? CODEX_DEFAULT_MODEL,
    input_tokens: Math.max(0, inputTotal - cacheRead),
    output_tokens: outputTotal,
    cache_creation_tokens: 0,
    cache_read_tokens: cacheRead,
    cost_reported: 0,
  };
}

const CLAUDE_DEFAULT_MODEL = "claude";

/**
 * Sum claude `--output-format stream-json` usage, mirroring loop-fmt.py
 * `_handle_assistant` + `_handle_result` (lib/loop-fmt.py:171-182, 414-436).
 * `result.usage` carries the LAST turn only, so the cumulative totals come from
 * accumulating each `type:assistant` `message.usage` across every turn; cache
 * fields map cache_creation_input_tokens→cache_creation,
 * cache_read_input_tokens→cache_read. The model is the last assistant turn's
 * (or the `result` event's). claude's self-reported `total_cost_usd` is carried
 * as `cost_reported` for audit only — the authoritative list cost is computed
 * downstream from the price table ({@link toCycleCost}), exactly as loop-fmt
 * freezes cost at the snapshot rather than trusting the wire number. `lines` are
 * the agent's raw stdout lines (one JSON object per line). Returns null when no
 * assistant `usage` block was seen ("n/a, never fake zero").
 */
export function sumClaudeStream(lines: readonly string[]): AgentUsage | null {
  let tin = 0;
  let tout = 0;
  let tcr = 0;
  let tcw = 0;
  let costReported = 0;
  let model: string | null = null;
  let seen = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (o["type"] === "assistant") {
      const m = (o["message"] ?? {}) as Record<string, unknown>;
      const u = m["usage"] as Record<string, unknown> | undefined | null;
      if (u) {
        seen = true;
        tin += intOr(u["input_tokens"]);
        tout += intOr(u["output_tokens"]);
        tcw += intOr(u["cache_creation_input_tokens"]);
        tcr += intOr(u["cache_read_input_tokens"]);
      }
      if (typeof m["model"] === "string" && m["model"]) model = m["model"];
    } else if (o["type"] === "result") {
      costReported += floatOr(o["total_cost_usd"]);
      if (typeof o["model"] === "string" && o["model"]) model = o["model"];
    }
  }
  if (!seen) return null;
  return {
    model: model ?? CLAUDE_DEFAULT_MODEL,
    input_tokens: tin,
    output_tokens: tout,
    cache_creation_tokens: tcw,
    cache_read_tokens: tcr,
    cost_reported: costReported,
  };
}

/**
 * Aggregate several per-file summaries into one, mirroring the SUM loop in
 * `usage_from_session` (pi.py:169-200 / kimi.py:249-278): the first non-null
 * model wins; token fields sum; returns null when nothing summed OR all token
 * fields are zero ("n/a, not fake zero"). `defaultModel` fills a still-null
 * model on success.
 */
export function aggregateSessions(
  summaries: readonly (SessionAgg | null)[],
  defaultModel: string,
): SessionAgg | null {
  const agg: SessionAgg = {
    model: null,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    cost_reported: 0,
  };
  let got = false;
  for (const s of summaries) {
    if (s === null) continue;
    got = true;
    agg.model = agg.model ?? s.model;
    agg.input_tokens += s.input_tokens;
    agg.output_tokens += s.output_tokens;
    agg.cache_creation_tokens += s.cache_creation_tokens;
    agg.cache_read_tokens += s.cache_read_tokens;
    agg.cost_reported += s.cost_reported;
  }
  if (!got) return null;
  const hasTokens =
    agg.input_tokens || agg.output_tokens || agg.cache_creation_tokens || agg.cache_read_tokens;
  if (!hasTokens) return null;
  agg.model = agg.model ?? defaultModel;
  return agg;
}

function intOr(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function floatOr(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
}

// ── Per-cycle CycleCost folding (the I11 record) ─────────────────────────────

/** Facts the loop knows about a finished cycle, beyond its token usage. */
export interface CycleFacts {
  cycleId: string;
  agent: string;
  /** TCR reverts this cycle (drives effectiveCost vs nominal). */
  revertCount: number;
}

/**
 * Fold a parsed {@link AgentUsage} into the per-cycle {@link CycleCost} record
 * budget guardrails gate on (I11 / spec cycle.ts). `estimatedCost` is the
 * nominal list cost of the kept work; `effectiveCost` is the cost INCLUDING the
 * wasted-revert multiplier so a cheap model that reverts a lot is not flattered
 * (C11/I11: "便宜模型反更贵" must surface). With `revertCount` reverts there were
 * `revertCount + 1` total attempts that all cost roughly the nominal estimate,
 * so effective = estimated × (revertCount + 1).
 *
 * Cost is taken from `usage.cost_list_usd` when the adapter computed one
 * (stdout-scrape path); otherwise it is computed from the token split via the
 * price table (session-file path, mirroring pi_emit / kimi_emit which compute
 * `cost_list` from `compute_list_cost`).
 */
export function toCycleCost(usage: AgentUsage, facts: CycleFacts): CycleCost {
  const tokens: ListCostTokens = {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_creation_tokens: usage.cache_creation_tokens ?? 0,
    cache_read_tokens: usage.cache_read_tokens ?? 0,
  };
  const estimatedCost =
    usage.cost_list_usd ?? computeListCost(usage.model, tokens);
  const reverts = Math.max(0, Math.trunc(facts.revertCount));
  const effectiveCost = estimatedCost * (reverts + 1);
  // FIX-361: currency from model's price config (¥ for domestic models, $ for USD-billed).
  const cur = cycleCurrency(usage.model);
  return {
    cycleId: facts.cycleId,
    agent: facts.agent,
    model: usage.model,
    tokensIn: usage.input_tokens,
    tokensOut: usage.output_tokens,
    // FIX-249: keep the cache split when the adapter reported one (absent ≠ 0).
    ...(usage.cache_read_tokens !== undefined ? { cacheRead: usage.cache_read_tokens } : {}),
    ...(usage.cache_creation_tokens !== undefined ? { cacheWrite: usage.cache_creation_tokens } : {}),
    estimatedCost,
    revertCount: reverts,
    effectiveCost,
    currency: cur,
  };
}

/** Native currency for a cycle's model (convenience over prices.currencyFor). */
export function cycleCurrency(model: string): string {
  return currencyFor(model);
}
