export interface AdversarialState {
  round: number;
  dryStreak: number;
}

export interface AdversarialCfg {
  maxRounds: number;
  dryRoundsToStop: number;
  elapsedSec: number;
  totalTimeoutSec: number;
}

export interface AdversarialRole {
  agent: string;
  sessionId: string;
  parentSessionId?: string;
}

export type NextStep =
  | { kind: "attack" }
  | { kind: "fix" }
  | { kind: "stop"; reason: "dry" | "max_rounds" | "timeout" };

export type AdversarialFailure =
  | { kind: "non_hetero"; detail: string }
  | { kind: "agent_unavailable"; role: string }
  | { kind: "round_hang"; round: number }
  | { kind: "total_timeout" };

export function adversarialDegradeDecision(f: AdversarialFailure): {
  degrade: true;
  fallback: "single-builder";
  cause: string;
} {
  switch (f.kind) {
    case "non_hetero":
      return {
        degrade: true,
        fallback: "single-builder",
        cause: `adversarial pairing disabled: roles not heterogenous or independent (${f.detail})`,
      };
    case "agent_unavailable":
      return {
        degrade: true,
        fallback: "single-builder",
        cause: `adversarial pairing degraded: ${f.role} agent unavailable`,
      };
    case "round_hang":
      return {
        degrade: true,
        fallback: "single-builder",
        cause: `adversarial pairing degraded: round ${f.round} hung`,
      };
    case "total_timeout":
      return {
        degrade: true,
        fallback: "single-builder",
        cause: "adversarial pairing degraded: total timeout",
      };
    default: {
      const _exhaustive: never = f;
      void _exhaustive;
      return {
        degrade: true,
        fallback: "single-builder",
        cause: "adversarial pairing degraded: unknown adversarial failure",
      };
    }
  }
}

export function adversarialNextStep(
  state: AdversarialState,
  lastRound: { newHole: boolean } | null,
  cfg: AdversarialCfg,
): NextStep {
  if (cfg.elapsedSec >= cfg.totalTimeoutSec) {
    return { kind: "stop", reason: "timeout" };
  }

  if (state.round >= cfg.maxRounds) {
    return { kind: "stop", reason: "max_rounds" };
  }

  if (lastRound === null) {
    return { kind: "attack" };
  }

  if (lastRound.newHole) {
    return { kind: "fix" };
  }

  const effectiveDry = state.dryStreak + 1;
  if (effectiveDry >= cfg.dryRoundsToStop) {
    return { kind: "stop", reason: "dry" };
  }

  return { kind: "attack" };
}

/**
 * Scope (pi review, US-LOOP-100): catches self-collusion (same session) and DIRECT
 * parent/sub-agent in either direction — the realistic loop spawn scenario. It does
 * NOT walk transitive ancestor chains (grandparent↔grandchild), because an
 * AdversarialRole carries only its immediate parentSessionId; the loop spawns
 * test_author / implementer as fresh top-level sessions, so a transitive chain is
 * not a path the orchestrator produces. Revisit only if roles ever carry a full
 * ancestor list.
 */
export function assertAdversarialIndependence(
  testAuthor: AdversarialRole,
  implementer: AdversarialRole,
): { ok: true } | { ok: false; reason: string } {
  if (testAuthor.sessionId === implementer.sessionId) {
    return { ok: false, reason: "roles must use independent sessions" };
  }

  if (
    testAuthor.parentSessionId === implementer.sessionId ||
    implementer.parentSessionId === testAuthor.sessionId
  ) {
    return { ok: false, reason: "roles must not be parent/sub-agent sessions" };
  }

  return { ok: true };
}
