/**
 * US-LOOP-100 — adversarial-pairing safety foundation (pure functions).
 *
 * adversarialNextStep is the "never hangs unattended" core: three independent
 * terminations (total timeout > max rounds > dry streak) plus fix/attack routing,
 * all deterministic and exhaustively testable — no agent judgment in the loop.
 * assertAdversarialIndependence is the "never colludes" check: the test author
 * and the implementer must not share a session / be a sub-agent of each other
 * (FIX-343 independence — by session/context, not vendor).
 */
import { describe, expect, it } from "vitest";
import { adversarialDegradeDecision, adversarialNextStep, aggregateAdversarial, assertAdversarialIndependence, foldCycleAdversarial, type AdversarialFailure, type AdversarialRunSummary } from "../src/loop/adversarial.js";

const cfg = { maxRounds: 4, dryRoundsToStop: 2, elapsedSec: 0, totalTimeoutSec: 2700 };

describe("adversarialNextStep — deterministic termination + routing", () => {
  it("initial (no attack round yet) ⇒ attack", () => {
    expect(adversarialNextStep({ round: 0, dryStreak: 0 }, null, cfg)).toEqual({ kind: "attack" });
  });

  it("last round found a hole ⇒ fix (and dry streak resets in caller state next call)", () => {
    expect(adversarialNextStep({ round: 1, dryStreak: 0 }, { newHole: true }, cfg)).toEqual({ kind: "fix" });
  });

  it("no hole but dry streak still below threshold ⇒ keep attacking", () => {
    // dryStreak 0 → this no-hole makes it 1, < 2 ⇒ attack again
    expect(adversarialNextStep({ round: 1, dryStreak: 0 }, { newHole: false }, cfg)).toEqual({ kind: "attack" });
  });

  it("no hole reaching the dry threshold ⇒ stop(dry)", () => {
    // dryStreak 1 → this no-hole makes it 2, >= 2 ⇒ stop
    expect(adversarialNextStep({ round: 2, dryStreak: 1 }, { newHole: false }, cfg)).toEqual({ kind: "stop", reason: "dry" });
  });

  it("round cap reached ⇒ stop(max_rounds), even if the last round found a hole", () => {
    expect(adversarialNextStep({ round: 4, dryStreak: 0 }, { newHole: true }, cfg)).toEqual({ kind: "stop", reason: "max_rounds" });
  });

  it("total timeout ⇒ stop(timeout), highest precedence over max_rounds and dry", () => {
    const timedOut = { ...cfg, elapsedSec: 2700 };
    expect(adversarialNextStep({ round: 4, dryStreak: 5 }, { newHole: false }, timedOut)).toEqual({ kind: "stop", reason: "timeout" });
  });

  it("precedence: timeout beats max_rounds", () => {
    const timedOut = { ...cfg, elapsedSec: 3000 };
    expect(adversarialNextStep({ round: 10, dryStreak: 0 }, { newHole: true }, timedOut)).toEqual({ kind: "stop", reason: "timeout" });
  });

  it("precedence: max_rounds beats dry when BOTH would fire this round", () => {
    // round 4 hits the cap AND a no-hole here would push dryStreak 1→2 (dry threshold).
    // Both terminate; the reason must be max_rounds (higher precedence), not dry.
    expect(adversarialNextStep({ round: 4, dryStreak: 1 }, { newHole: false }, cfg)).toEqual({ kind: "stop", reason: "max_rounds" });
  });

  it("dryRoundsToStop=1 ⇒ a single no-hole round stops immediately", () => {
    expect(adversarialNextStep({ round: 1, dryStreak: 0 }, { newHole: false }, { ...cfg, dryRoundsToStop: 1 })).toEqual({ kind: "stop", reason: "dry" });
  });
});

describe("assertAdversarialIndependence — non-collusion (FIX-343 by session, not vendor)", () => {
  it("different sessions (different agents) ⇒ ok", () => {
    expect(
      assertAdversarialIndependence({ agent: "claude", sessionId: "s1" }, { agent: "codex", sessionId: "s2" }),
    ).toEqual({ ok: true });
  });

  it("same session ⇒ NOT independent (self-collusion)", () => {
    const r = assertAdversarialIndependence({ agent: "claude", sessionId: "s1" }, { agent: "claude", sessionId: "s1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/session/i);
  });

  it("a sub-agent of the other ⇒ NOT independent", () => {
    const r = assertAdversarialIndependence(
      { agent: "claude", sessionId: "s1" },
      { agent: "codex", sessionId: "s2", parentSessionId: "s1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/sub-agent|parent/i);
  });

  it("same vendor but different fresh sessions ⇒ ok (vendor is not a hard condition)", () => {
    expect(
      assertAdversarialIndependence({ agent: "claude", sessionId: "s1" }, { agent: "claude", sessionId: "s2" }),
    ).toEqual({ ok: true });
  });

  it("sub-agent in the REVERSE direction (test author is a sub-agent of the implementer) ⇒ NOT independent", () => {
    const r = assertAdversarialIndependence(
      { agent: "claude", sessionId: "s2", parentSessionId: "s1" },
      { agent: "codex", sessionId: "s1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/sub-agent|parent/i);
  });
});

describe("US-LOOP-103 — adversarialDegradeDecision: every failure degrades to standard, never deadlocks", () => {
  it("non-hetero config ⇒ degrade to single-builder, cause names the config problem", () => {
    const d = adversarialDegradeDecision({ kind: "non_hetero", detail: "same session s1" });
    expect(d.degrade).toBe(true);
    expect(d.fallback).toBe("single-builder");
    expect(d.cause).toMatch(/hetero|session|independen/i);
  });

  it("implementer/attacker agent unavailable ⇒ degrade, cause names the role", () => {
    const d = adversarialDegradeDecision({ kind: "agent_unavailable", role: "implementer" });
    expect(d.degrade).toBe(true);
    expect(d.fallback).toBe("single-builder");
    expect(d.cause).toMatch(/implementer|unavailable/i);
  });

  it("a round hangs ⇒ degrade, cause names the round", () => {
    const d = adversarialDegradeDecision({ kind: "round_hang", round: 2 });
    expect(d.degrade).toBe(true);
    expect(d.fallback).toBe("single-builder");
    expect(d.cause).toMatch(/hang|round|2/i);
  });

  it("total timeout ⇒ degrade", () => {
    const d = adversarialDegradeDecision({ kind: "total_timeout" });
    expect(d.degrade).toBe(true);
    expect(d.fallback).toBe("single-builder");
  });

  it("TOTALITY invariant: EVERY failure kind has a degrade path (none deadlocks, none throws)", () => {
    const failures: AdversarialFailure[] = [
      { kind: "non_hetero", detail: "x" },
      { kind: "agent_unavailable", role: "attacker" },
      { kind: "round_hang", round: 1 },
      { kind: "total_timeout" },
    ];
    for (const f of failures) {
      const d = adversarialDegradeDecision(f);
      expect(d.degrade).toBe(true);
      expect(d.fallback).toBe("single-builder");
      expect(typeof d.cause).toBe("string");
      expect(d.cause).not.toBe("");
    }
  });
});

describe("US-LOOP-103 attack — no input can deadlock, even malformed", () => {
  it("an unknown/malformed failure at runtime still degrades (default path), never throws", () => {
    const d = adversarialDegradeDecision({ kind: "totally-unexpected" } as unknown as AdversarialFailure);
    expect(d.degrade).toBe(true);
    expect(d.fallback).toBe("single-builder");
    expect(typeof d.cause).toBe("string");
  });
});

describe("US-LOOP-104 — foldCycleAdversarial: per-cycle summary from the event stream", () => {
  const ev = (type: string, extra: Record<string, unknown> = {}) => ({ type, cycleId: "C1", ts: 0, ...extra });

  it("returns null for a cycle with NO adversarial events (a standard cycle)", () => {
    expect(foldCycleAdversarial([ev("cycle:start"), ev("cycle:end")], "C1")).toBeNull();
    expect(foldCycleAdversarial([], "C1")).toBeNull();
  });

  it("folds a clean terminated cycle (rounds/holes/reason, not degraded)", () => {
    const events = [
      ev("adversarial:test-authored"),
      ev("adversarial:implemented", { round: 0 }),
      ev("adversarial:attack-round", { round: 1, newHole: true }),
      ev("adversarial:attack-round", { round: 2, newHole: false }),
      ev("adversarial:attack-round", { round: 3, newHole: false }),
      ev("adversarial:terminated", { reason: "dry", rounds: 3, holesFound: 1 }),
    ];
    expect(foldCycleAdversarial(events, "C1")).toEqual({
      rounds: 3,
      holesFound: 1,
      terminationReason: "dry",
      degraded: false,
    });
  });

  it("marks a degraded cycle (adversarial:degraded present)", () => {
    const events = [
      ev("adversarial:test-authored"),
      ev("adversarial:degraded", { from: "verified", to: "single-builder", cause: "non-hetero" }),
    ];
    expect(foldCycleAdversarial(events, "C1")).toEqual({
      rounds: 0,
      holesFound: 0,
      terminationReason: "degraded",
      degraded: true,
    });
  });

  it("only folds events for the requested cycle id (isolates concurrent cycles)", () => {
    const events = [
      { type: "adversarial:terminated", cycleId: "C1", reason: "dry", rounds: 2, holesFound: 1, ts: 0 },
      { type: "adversarial:terminated", cycleId: "C2", reason: "max_rounds", rounds: 4, holesFound: 3, ts: 0 },
    ];
    expect(foldCycleAdversarial(events, "C2")).toMatchObject({ rounds: 4, holesFound: 3, terminationReason: "max_rounds" });
  });

  it("interrupted cycle (adversarial events but no terminal) → counts rounds, marks degraded", () => {
    const events = [
      ev("adversarial:attack-round", { round: 1, newHole: true }),
      ev("adversarial:attack-round", { round: 2, newHole: false }),
    ];
    expect(foldCycleAdversarial(events, "C1")).toEqual({
      rounds: 2,
      holesFound: 1,
      terminationReason: "degraded",
      degraded: true,
    });
  });
});

describe("US-LOOP-104 — aggregateAdversarial: shadow-run cohort metrics", () => {
  it("empty cohort → all zero (never NaN)", () => {
    expect(aggregateAdversarial([])).toEqual({ cards: 0, avgHoles: 0, avgRounds: 0, degradeRate: 0 });
  });

  it("averages holes/rounds and computes the degrade rate", () => {
    const s: AdversarialRunSummary[] = [
      { rounds: 3, holesFound: 1, terminationReason: "dry", degraded: false },
      { rounds: 4, holesFound: 3, terminationReason: "max_rounds", degraded: false },
      { rounds: 0, holesFound: 0, terminationReason: "degraded", degraded: true },
    ];
    const agg = aggregateAdversarial(s);
    expect(agg.cards).toBe(3);
    expect(agg.avgHoles).toBeCloseTo(4 / 3);
    expect(agg.avgRounds).toBeCloseTo(7 / 3);
    expect(agg.degradeRate).toBeCloseTo(1 / 3);
  });
});
