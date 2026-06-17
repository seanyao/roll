/**
 * lever-4 — cross-card WARM-CONTEXT adapter port (agent-AGNOSTIC).
 *
 * Warm-context (reusing a routed agent's prior session on the NEXT same-agent
 * card) is treated as a STANDARD agent capability, NOT a codex special-case. The
 * cycle path resolves ONE adapter via `sessionReuseFor(agent, spec)` and calls
 * its ports — it never branches per-agent. Only the agent whose spec declares
 * `sessionReuse: 'codex-exec-resume'` (codex) gets the warm adapter; every other
 * engine gets the COLD no-op adapter, the universal default.
 *
 * This module is PURE + zero-IO: the ledger is passed IN (the CLI does the file
 * read/write/consume around it), so the matching policy is unit-testable in
 * isolation. Matching is NEXT-CARD-ONLY, SINGLE-USE — keyed by the prior card's
 * storyId, consumed on resume by the caller. The adapter only resolves; it never
 * widens to same-epic / retry.
 */
import type { AgentUsageSpec } from "./specs.js";

/** One captured warm-session, persisted by the CLI to the loop ledger. The
 *  adapter reads these but never writes — it is pure. */
export interface WarmSessionEntry {
  /** The storyId of the card whose session this is — the resume key. */
  storyId: string;
  /** The agent's resumable session id (codex: the `exec resume <id>` UUID). */
  sessionId: string;
  /** Capture timestamp (epoch seconds) — for ledger audit / staleness, not used
   *  by the next-card matcher. */
  ts: number;
}

/**
 * The warm-context port the cycle path drives. Agent-agnostic by construction:
 * the cold adapter satisfies the same shape with no-ops, so downstream code is
 * branch-free.
 */
export interface SessionReuseAdapter {
  /** True only for an engine that can resume a prior session. Cold ⇒ false. */
  supportsReuse(): boolean;
  /**
   * Resolve the session id to resume for `priorStoryId` from the ledger, or null
   * when there is no match (the universal cold path). NEXT-CARD-ONLY: it matches
   * exactly the entry keyed by that storyId — no epic/retry widening. SINGLE-USE
   * is the CALLER's responsibility (consume the entry after a successful resolve).
   */
  resolvePriorSessionId(ledger: readonly WarmSessionEntry[], priorStoryId: string): string | null;
  /**
   * Return the spawn options with the resumable session id injected, without
   * mutating the input (pure). Cold ⇒ returns opts unchanged. Generic over the
   * caller's options shape; the codex adapter sets `codexSessionId`.
   */
  injectSessionId<T extends Record<string, unknown>>(opts: T, sessionId: string): T;
  /**
   * The cold-fallback options: the spawn options as-is, with NO resume injected.
   * The universal default + the silent fail-safe the caller uses on any error.
   * Pure — returns the input unchanged.
   */
  coldFallback<T extends Record<string, unknown>>(opts: T): T;
}

/** The COLD no-op adapter: never resumes, never injects — the universal default
 *  for every engine except codex (and the fail-safe target on any error). */
const COLD_ADAPTER: SessionReuseAdapter = {
  supportsReuse: () => false,
  resolvePriorSessionId: () => null,
  injectSessionId: (opts) => opts,
  coldFallback: (opts) => opts,
};

/** The codex `exec resume` warm adapter: resolves the prior card's session id
 *  and injects it as `codexSessionId` (the Step-7 argv reads this). */
const CODEX_RESUME_ADAPTER: SessionReuseAdapter = {
  supportsReuse: () => true,
  resolvePriorSessionId: (ledger, priorStoryId) => {
    if (!priorStoryId) return null;
    // NEXT-CARD-ONLY: the most recent entry keyed by this exact storyId. Scan
    // from the end so a re-capture of the same card supersedes an older one.
    for (let i = ledger.length - 1; i >= 0; i--) {
      const e = ledger[i];
      if (e && e.storyId === priorStoryId && typeof e.sessionId === "string" && e.sessionId !== "") {
        return e.sessionId;
      }
    }
    return null;
  },
  injectSessionId: (opts, sessionId) => ({ ...opts, codexSessionId: sessionId }),
  coldFallback: (opts) => opts,
};

/**
 * Resolve the warm-context adapter for an agent from its spec capability. Agent
 * name is accepted for symmetry / future engines but the DECISION is the spec's
 * `sessionReuse` kind — so adding a resumable engine is registry-only, no code
 * change here. Absent / 'none' ⇒ the cold no-op adapter.
 */
export function sessionReuseFor(_agent: string, spec: AgentUsageSpec | undefined): SessionReuseAdapter {
  switch (spec?.sessionReuse) {
    case "codex-exec-resume":
      return CODEX_RESUME_ADAPTER;
    default:
      return COLD_ADAPTER;
  }
}

/**
 * lever-4 DEPTH-1 CAP (harness-safety, FIX-355). A warm-session may be captured
 * into the ledger ONLY when the cycle that just ran spawned COLD. A cycle that
 * itself RESUMED a prior session must NOT re-seed: otherwise warm context chains
 * UNBOUNDEDLY across cards (cold A → B resumes A → B re-seeds → C resumes A+B →
 * …), so every later card inherits an ever-growing, anchoring context and
 * eventually ALL cards degrade — the systemic failure mode (a single mis-built
 * harness sinks every future card, not just one). Capturing on COLD origin only
 * bounds every chain to a SINGLE hop: cold seeds → next card resumes once → does
 * NOT re-seed → the following card runs cold again (pattern: cold→warm→cold→warm).
 * `spawnedWarm` = "this cycle injected a resume id". Pure; the CLI passes the
 * fact in. Orthogonal to single-use consume (which only stops re-using ONE entry
 * twice; it does NOT stop the chain from extending — this cap does). */
export function shouldCaptureWarmSession(spawnedWarm: boolean): boolean {
  return !spawnedWarm;
}
