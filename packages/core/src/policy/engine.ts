/**
 * PolicyEngine — parse + enforce `.roll/policy.yaml` (US-CORE-010).
 *
 * v2 reality vs v3 spec
 * ─────────────────────
 * v2 has NO `policy.yaml`. After FIX-172~175 the operative config is
 * `.roll/local.yaml` (loop_schedule / loop_gc / `agent:` default slot) plus the
 * agents-routes template; routing in bin/roll resolves a single default slot
 * (`_project_agent`, `_loop_resolve_agent` ~bin/roll:384-438) — there is no
 * level/type rule table, no `max_consecutive_failures` knob, no budget block.
 * The only consecutive-failure counter in v2 is the roll-meta sync one
 * (US-LOOP-057, bin/roll:11202-11211: 3 strikes → ALERT), and the only
 * "fail-loud pause" channel is the PAUSE sentinel file (bin/roll:9412-9416).
 *
 * The v3 spec (.roll/v3/specs/architecture.md §5.1 routing, §6.1 loop_safety +
 * budget) defines the RICHER `policy.yaml`. This module implements the PARSER for
 * that v3 shape while preserving v2 semantics where they exist:
 *   - first-match, deterministic, NO history (D1/I10) — exactly v2's
 *     "same input → same route", just generalised from one slot to a rule table.
 *   - `max_consecutive_failures` default 3 mirrors the only v2 strike count.
 *   - `action_on_breach: pause_and_notify` is v2's PAUSE-sentinel channel.
 *   - budget gate (§6) lives in cost/budget.ts (BudgetPolicy); this parser only
 *     reads its shape so the whole `policy.yaml` round-trips through one loader.
 *
 * NEW v3 AC (B-group) — 防误伤非本项目仓: refuse to run in a non-compliant repo.
 * v2's structural guard is the FIX-065 tripwire (bin/roll:7917-7934): before any
 * loop write it refuses when the target lands under prod `~/.shared/roll` from a
 * test/temp context. The capability-map indexes this as 结构护栏 (~13700). We
 * mirror the INTENT — "only operate on a real roll project, never a stray repo" —
 * as {@link repoComplianceVerdict}: a structural check that the cwd is a git repo
 * carrying the roll markers (`.roll/` dir + `.roll/backlog.md`), declining
 * otherwise so the loop never mutates an unrelated checkout.
 *
 * Purity: the parser is a pure string→struct function; rule matching and the
 * compliance verdict are pure. Filesystem probes for compliance are injected as
 * boolean facts ({@link RepoMarkers}); core reads no files itself.
 */
import type { BudgetPolicy } from "@roll/spec";

// ── policy.yaml shape (architecture §5.1 + §6.1) ─────────────────────────────

/** A routing rule's match clause — level and/or a type glob. */
export interface PolicyMatch {
  /** `epic` | `feature` | `story` | `action`, or a `|`-alternation, or `*`. */
  level?: string;
  /** `US-*` | `FIX-*|REFACTOR-*` | `*`, etc. — a `|`-alternation of globs. */
  type?: string;
}

/** One `model_routing` rule (architecture §5.1). */
export interface PolicyRoutingRule {
  match: PolicyMatch;
  agent: string;
  model: string;
  /** Availability fallback slot — pre-spawn only, NOT a failure-retry chain (I6). */
  fallback?: { agent: string; model: string };
  rationale?: string;
}

/** `loop_safety` block (architecture §6.1) — fail-loud + cost ceiling together. */
export interface LoopSafetyConfig {
  /** Consecutive failures before pause+notify (default 3; v2 strike count). */
  maxConsecutiveFailures: number;
  /** Action when the consecutive-failure ceiling trips. */
  actionOnBreach: string;
  /** Same-story failures before permanent hold (C5; default 3). */
  maxStoryFailures: number;
  /** Action when the per-story ceiling trips. */
  actionOnStoryBreach: string;
  /** Cost ceiling (§6.1 budget) — shape mirrors @roll/spec BudgetPolicy + hints. */
  budget?: PolicyBudget;
}

/** Budget block under loop_safety — superset of @roll/spec {@link BudgetPolicy}
 *  carrying the upgrade-hint trigger (architecture §6.1). */
export interface PolicyBudget extends Partial<BudgetPolicy> {
  dailyUsd: number;
  weeklyUsd: number;
  metric: "effective_cost";
  onApproach: "downgrade";
  onBreach: "pause_and_notify";
  /** Cheap-model revert-rate trigger → suggest_upgrade (never auto-changes). */
  upgradeHint?: { revertRateGt: number; action: "suggest_upgrade" };
}

/** The whole parsed policy.yaml. */
export interface Policy {
  modelRouting: PolicyRoutingRule[];
  loopSafety: LoopSafetyConfig;
}

/** Defaults mirroring the only v2 numbers (US-LOOP-057 strike count = 3). */
export const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;
export const DEFAULT_MAX_STORY_FAILURES = 3;
export const DEFAULT_ACTION_ON_BREACH = "pause_and_notify";
export const DEFAULT_ACTION_ON_STORY_BREACH = "hold";

// ── Minimal YAML parser for the policy.yaml shape ────────────────────────────
//
// Dependency-free, like the rest of the codebase (cli config-get hand-rolls its
// readers). Handles exactly the documented shape: a top-level `model_routing:`
// list of `- ` items whose fields may be inline-flow maps (`match: { … }`,
// `fallback: { … }`) or scalars, plus a `loop_safety:` mapping with a nested
// `budget:` mapping with a nested `upgrade_hint:` mapping. Comments (`# …`) and
// blank lines are ignored. Not a general YAML engine — it rejects nothing it
// doesn't understand, it simply ignores unknown keys (forward-compatible).

/** Strip a trailing ` # comment` (only when the `#` is preceded by whitespace or
 *  is the line start, so `#` inside a value like a url fragment survives). */
function stripComment(s: string): string {
  // Find a `#` that begins a comment: at start, or preceded by whitespace.
  const m = /(^|\s)#/.exec(s);
  if (m === null) return s;
  // m.index points at the leading whitespace (or 0); the `#` is after group 1.
  return s.slice(0, m.index + (m[1]?.length ?? 0));
}

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Parse an inline-flow map `{ a: x, b: { c: y } }` → record of string values.
 *  Only one level of nesting is needed for our shape, but we parse generically
 *  enough by tracking brace depth for the top-level comma split. */
function parseFlowMap(body: string): Record<string, string> {
  const inner = body.trim().replace(/^\{/, "").replace(/\}$/, "");
  const out: Record<string, string> = {};
  // Split on top-level commas (none of our values contain nested braces).
  for (const pair of splitTopLevel(inner, ",")) {
    const idx = pair.indexOf(":");
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = unquote(pair.slice(idx + 1).trim());
    if (key !== "") out[key] = val;
  }
  return out;
}

/** Split `s` on `sep` at brace depth 0 (so flow-map commas inside `{ }` don't
 *  split). Quotes are not nested in our shape, so depth tracking is enough. */
function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== "") parts.push(cur);
  return parts;
}

function indentOf(line: string): number {
  const m = /^(\s*)/.exec(line);
  return m?.[1]?.length ?? 0;
}

interface PreLine {
  indent: number;
  text: string;
}

/** Pre-tokenise: drop blank/comment lines, capture indent + de-commented text. */
function preprocess(yaml: string): PreLine[] {
  const out: PreLine[] = [];
  for (const raw of yaml.split("\n")) {
    const noComment = stripComment(raw.replace(/\r$/, ""));
    if (noComment.trim() === "") continue;
    out.push({ indent: indentOf(noComment), text: noComment.trimEnd() });
  }
  return out;
}

function numOr(v: string | undefined, dflt: number): number {
  if (v === undefined) return dflt;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : dflt;
}

/**
 * Parse policy.yaml text into a {@link Policy}. Forward-compatible: unknown keys
 * are ignored, missing blocks fall back to the v2-aligned defaults. Mirrors the
 * architecture §5.1/§6.1 shape exactly.
 */
export function parsePolicy(yaml: string): Policy {
  const lines = preprocess(yaml);
  const modelRouting: PolicyRoutingRule[] = [];
  let loopSafety: LoopSafetyConfig = {
    maxConsecutiveFailures: DEFAULT_MAX_CONSECUTIVE_FAILURES,
    actionOnBreach: DEFAULT_ACTION_ON_BREACH,
    maxStoryFailures: DEFAULT_MAX_STORY_FAILURES,
    actionOnStoryBreach: DEFAULT_ACTION_ON_STORY_BREACH,
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln === undefined || ln.indent !== 0) continue;
    if (ln.text.startsWith("model_routing:")) {
      i = parseModelRouting(lines, i + 1, modelRouting);
      i -= 1; // parseModelRouting returns the next-unconsumed index.
    } else if (ln.text.startsWith("loop_safety:")) {
      const [next, safety] = parseLoopSafety(lines, i + 1);
      loopSafety = safety;
      i = next - 1;
    }
  }
  return { modelRouting, loopSafety };
}

/** Parse the `model_routing:` list starting at `start`; append rules; return the
 *  index of the first line at indent 0 (block end). */
function parseModelRouting(lines: PreLine[], start: number, out: PolicyRoutingRule[]): number {
  let i = start;
  let cur: Partial<PolicyRoutingRule> & { match: PolicyMatch } = { match: {} };
  let inItem = false;
  const flush = (): void => {
    if (inItem && cur.agent !== undefined && cur.model !== undefined) {
      out.push({ match: cur.match, agent: cur.agent, model: cur.model, ...(cur.fallback ? { fallback: cur.fallback } : {}), ...(cur.rationale !== undefined ? { rationale: cur.rationale } : {}) });
    }
  };
  for (; i < lines.length; i++) {
    const ln = lines[i];
    if (ln === undefined) break;
    if (ln.indent === 0) break; // back to top level → block done.
    const isItemStart = ln.text.trimStart().startsWith("- ");
    if (isItemStart) {
      flush();
      cur = { match: {} };
      inItem = true;
    }
    // Normalise: an item-start line carries its first key after "- ".
    const body = ln.text.trimStart().replace(/^-\s+/, "");
    assignRuleField(cur, body);
  }
  flush();
  return i;
}

/** Assign one `key: value` (or inline-flow `key: { … }`) onto the current rule. */
function assignRuleField(cur: Partial<PolicyRoutingRule> & { match: PolicyMatch }, body: string): void {
  const idx = body.indexOf(":");
  if (idx < 0) return;
  const key = body.slice(0, idx).trim();
  const rest = body.slice(idx + 1).trim();
  switch (key) {
    case "match": {
      const m = parseFlowMap(rest);
      cur.match = {
        ...(m["level"] !== undefined ? { level: m["level"] } : {}),
        ...(m["type"] !== undefined ? { type: m["type"] } : {}),
      };
      break;
    }
    case "agent":
      cur.agent = unquote(rest);
      break;
    case "model":
      cur.model = unquote(rest);
      break;
    case "fallback": {
      const f = parseFlowMap(rest);
      if (f["agent"] !== undefined && f["model"] !== undefined) {
        cur.fallback = { agent: f["agent"], model: f["model"] };
      }
      break;
    }
    case "rationale":
      cur.rationale = unquote(rest);
      break;
    default:
      break;
  }
}

/** Parse the `loop_safety:` mapping (+ nested budget) from `start`; return
 *  [nextTopLevelIndex, config]. */
function parseLoopSafety(lines: PreLine[], start: number): [number, LoopSafetyConfig] {
  const flat: Record<string, string> = {};
  let budget: PolicyBudget | undefined;
  let i = start;
  for (; i < lines.length; i++) {
    const ln = lines[i];
    if (ln === undefined) break;
    if (ln.indent === 0) break;
    const text = ln.text.trim();
    if (text.startsWith("budget:")) {
      const [next, b] = parseBudget(lines, i + 1, ln.indent);
      budget = b;
      i = next - 1;
      continue;
    }
    const idx = text.indexOf(":");
    if (idx < 0) continue;
    const key = text.slice(0, idx).trim();
    const val = text.slice(idx + 1).trim();
    if (val !== "") flat[key] = unquote(val);
  }
  const cfg: LoopSafetyConfig = {
    maxConsecutiveFailures: numOr(flat["max_consecutive_failures"], DEFAULT_MAX_CONSECUTIVE_FAILURES),
    actionOnBreach: flat["action_on_breach"] ?? DEFAULT_ACTION_ON_BREACH,
    maxStoryFailures: numOr(flat["max_story_failures"], DEFAULT_MAX_STORY_FAILURES),
    actionOnStoryBreach: flat["action_on_story_breach"] ?? DEFAULT_ACTION_ON_STORY_BREACH,
    ...(budget ? { budget } : {}),
  };
  return [i, cfg];
}

/** Parse the nested `budget:` mapping (+ nested on_approach/on_breach/
 *  upgrade_hint) starting at `start`; return [nextIndex, budget]. Anything at or
 *  below `parentIndent` ends the block. */
function parseBudget(lines: PreLine[], start: number, parentIndent: number): [number, PolicyBudget] {
  const flat: Record<string, string> = {};
  let onApproach = "downgrade";
  let onBreach = "pause_and_notify";
  let upgradeHint: PolicyBudget["upgradeHint"];
  let i = start;
  for (; i < lines.length; i++) {
    const ln = lines[i];
    if (ln === undefined) break;
    if (ln.indent <= parentIndent) break;
    const text = ln.text.trim();
    const idx = text.indexOf(":");
    if (idx < 0) continue;
    const key = text.slice(0, idx).trim();
    const val = text.slice(idx + 1).trim();
    if (key === "on_approach" || key === "on_breach") {
      // Either inline `{ action: x }` or a nested `action:` on the next lines.
      let action = "";
      if (val.startsWith("{")) action = parseFlowMap(val)["action"] ?? "";
      else action = readNestedAction(lines, i + 1, ln.indent);
      if (key === "on_approach" && action !== "") onApproach = action;
      if (key === "on_breach" && action !== "") onBreach = action;
      continue;
    }
    if (key === "upgrade_hint") {
      upgradeHint = readUpgradeHint(lines, i + 1, ln.indent, val);
      continue;
    }
    if (val !== "") flat[key] = unquote(val);
  }
  const budget: PolicyBudget = {
    dailyUsd: numOr(flat["daily_usd"], 0),
    weeklyUsd: numOr(flat["weekly_usd"], 0),
    metric: "effective_cost",
    onApproach: onApproach as "downgrade",
    onBreach: onBreach as "pause_and_notify",
    ...(upgradeHint ? { upgradeHint } : {}),
  };
  return [i, budget];
}

/** Read an `action:` value nested under on_approach/on_breach (one level in). */
function readNestedAction(lines: PreLine[], start: number, parentIndent: number): string {
  for (let i = start; i < lines.length; i++) {
    const ln = lines[i];
    if (ln === undefined || ln.indent <= parentIndent) break;
    const text = ln.text.trim();
    if (text.startsWith("action:")) return unquote(text.slice("action:".length).trim());
  }
  return "";
}

/** Read the upgrade_hint block (`when: { revert_rate_gt: N }` + `action:`). */
function readUpgradeHint(
  lines: PreLine[],
  start: number,
  parentIndent: number,
  inlineVal: string,
): PolicyBudget["upgradeHint"] {
  let revertRateGt = 0;
  let action = "suggest_upgrade";
  if (inlineVal.startsWith("{")) {
    const m = parseFlowMap(inlineVal);
    revertRateGt = numOr(m["revert_rate_gt"], 0);
    if (m["action"] !== undefined) action = m["action"];
  }
  for (let i = start; i < lines.length; i++) {
    const ln = lines[i];
    if (ln === undefined || ln.indent <= parentIndent) break;
    const text = ln.text.trim();
    if (text.startsWith("when:")) {
      const rest = text.slice("when:".length).trim();
      if (rest.startsWith("{")) revertRateGt = numOr(parseFlowMap(rest)["revert_rate_gt"], revertRateGt);
    } else if (text.startsWith("revert_rate_gt:")) {
      revertRateGt = numOr(text.slice("revert_rate_gt:".length).trim(), revertRateGt);
    } else if (text.startsWith("action:")) {
      action = unquote(text.slice("action:".length).trim());
    }
  }
  return { revertRateGt, action: action as "suggest_upgrade" };
}

// ── Rule matching (first-match, deterministic — D1/I10) ──────────────────────

/** Compile a `|`-alternation of globs (`US-*|FIX-*`) to a test. `*` matches any.
 *  Empty / undefined pattern matches everything (an absent dimension). */
function matchesPattern(value: string, pattern: string | undefined): boolean {
  if (pattern === undefined || pattern.trim() === "" || pattern.trim() === "*") return true;
  const alts = pattern.split("|").map((a) => a.trim()).filter((a) => a !== "");
  if (alts.length === 0) return true;
  return alts.some((alt) => {
    if (alt === "*") return true;
    // Glob: escape regex specials, then turn `*` into `.*`. Anchored, case-sensitive.
    const re = new RegExp(`^${alt.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    return re.test(value);
  });
}

/** The query a route resolution runs against the rule table. */
export interface RouteQuery {
  level: string;
  /** Story type token (e.g. `US-AUTH-001`) or bare type (`US`). Matched against
   *  the rule's `type` glob; we test the full id so `US-*` matches `US-AUTH-1`. */
  type: string;
}

/** A resolved route — agent/model + the matched rule index (audit anchor, I10). */
export interface ResolvedRoute {
  agent: string;
  model: string;
  fallback?: { agent: string; model: string };
  /** 0-based index of the matched rule (auditability). */
  ruleIndex: number;
  rationale?: string;
}

/**
 * Resolve a route by FIRST-MATCH over `modelRouting`, mirroring v2's
 * deterministic "same input → same route" (D1/I10) generalised to a rule table.
 * A rule matches iff BOTH its `match.level` and `match.type` globs match (an
 * absent dimension is a wildcard). Returns the first matching rule's
 * agent/model/fallback + its index, or `null` when nothing matches.
 */
export function resolvePolicyRoute(policy: Policy, query: RouteQuery): ResolvedRoute | null {
  for (let i = 0; i < policy.modelRouting.length; i++) {
    const rule = policy.modelRouting[i];
    if (rule === undefined) continue;
    if (!matchesPattern(query.level, rule.match.level)) continue;
    if (!matchesPattern(query.type, rule.match.type)) continue;
    return {
      agent: rule.agent,
      model: rule.model,
      ...(rule.fallback ? { fallback: rule.fallback } : {}),
      ruleIndex: i,
      ...(rule.rationale !== undefined ? { rationale: rule.rationale } : {}),
    };
  }
  return null;
}

// ── Safety thresholds ────────────────────────────────────────────────────────

/** A safety-gate decision off the consecutive-failure counter (C6). */
export type SafetyVerdict =
  | { action: "continue" }
  | { action: string; reason: string; count: number; threshold: number };

/**
 * Decide whether the consecutive-failure ceiling tripped. `count` is the current
 * run of consecutive failures (the caller maintains it; v2's only such counter
 * is US-LOOP-057's 3-strike meta-sync count). `count >= maxConsecutiveFailures`
 * → the configured breach action (default pause_and_notify); else continue.
 */
export function consecutiveFailureVerdict(safety: LoopSafetyConfig, count: number): SafetyVerdict {
  if (count >= safety.maxConsecutiveFailures) {
    return {
      action: safety.actionOnBreach,
      reason: `consecutive failures ${count} >= ${safety.maxConsecutiveFailures}`,
      count,
      threshold: safety.maxConsecutiveFailures,
    };
  }
  return { action: "continue" };
}

/**
 * Decide whether a single story's failure ceiling tripped (C5 permanent hold).
 * `storyFailures >= maxStoryFailures` → the configured story-breach action
 * (default hold); else continue. This is the v3 strengthening so a failing story
 * is HELD rather than retried forever by the unstick TTL revert.
 */
export function storyFailureVerdict(safety: LoopSafetyConfig, storyFailures: number): SafetyVerdict {
  if (storyFailures >= safety.maxStoryFailures) {
    return {
      action: safety.actionOnStoryBreach,
      reason: `story failures ${storyFailures} >= ${safety.maxStoryFailures}`,
      count: storyFailures,
      threshold: safety.maxStoryFailures,
    };
  }
  return { action: "continue" };
}

// ── Repo compliance verdict (NEW v3 AC — 防误伤非本项目仓) ─────────────────────

/** Structural markers of a real roll project, probed by the caller (injected). */
export interface RepoMarkers {
  /** Is the cwd inside a git work tree? */
  isGitRepo: boolean;
  /** Does `.roll/` exist as a directory at the project root? */
  hasRollDir: boolean;
  /** Does `.roll/backlog.md` exist? */
  hasBacklog: boolean;
}

/** The compliance decision: run only on a structurally-compliant roll repo. */
export type ComplianceVerdict =
  | { compliant: true }
  | { compliant: false; reason: string; missing: string[] };

/**
 * Decide whether the loop may operate on this repo (防误伤非本项目仓). Mirrors the
 * INTENT of v2's structural guard (FIX-065 tripwire, bin/roll:7917-7934; indexed
 * 结构护栏 ~13700): never mutate a checkout that isn't a real roll project.
 * Compliant iff ALL markers are present: it is a git repo, has a `.roll/`
 * directory, and a `.roll/backlog.md`. Any missing marker → decline with the
 * list of what's absent, so the caller refuses to run rather than risk writing
 * into an unrelated repo.
 */
export function repoComplianceVerdict(markers: RepoMarkers): ComplianceVerdict {
  const missing: string[] = [];
  if (!markers.isGitRepo) missing.push("git-repo");
  if (!markers.hasRollDir) missing.push(".roll/");
  if (!markers.hasBacklog) missing.push(".roll/backlog.md");
  if (missing.length === 0) return { compliant: true };
  return {
    compliant: false,
    reason: `not a compliant roll project (missing: ${missing.join(", ")})`,
    missing,
  };
}
