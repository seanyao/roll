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
import { adversarialDegradeDecision, adversarialNextStep, assertAdversarialIndependence, type AdversarialFailure } from "../src/loop/adversarial.js";

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
