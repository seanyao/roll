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
import { adversarialNextStep, assertAdversarialIndependence } from "../src/loop/adversarial.js";

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
