/**
 * lever-4 — warm-context adapter port. Pure, zero-IO, agent-agnostic. After the
 * pool was narrowed to 国产/开源 agents (kimi/pi/reasonix) NO engine declares a
 * warm-reuse kind, so EVERY engine resolves to the cold no-op adapter and
 * `decideWarmResume` only ever returns `policy_off` (explicit off) or
 * `agent_unsupported` (every cycle runs cold). The port shape is preserved so a
 * future resumable engine is a registry-only addition.
 */
import { describe, expect, it } from "vitest";
import { getAgentSpec } from "../src/agent/specs.js";
import {
  captureWarmSession,
  decideWarmResume,
  sessionReuseFor,
  shouldCaptureWarmSession,
  type WarmSessionEntry,
} from "../src/agent/session-reuse.js";

const ledger: WarmSessionEntry[] = [
  {
    storyId: "FIX-100",
    cycleId: "cycle-100",
    agent: "kimi",
    sessionId: "uuid-100",
    worktreePath: "/tmp/wt-100",
    capturedAtSec: 1,
    cycleStartSec: 1,
    spawnedWarm: false,
  },
  {
    storyId: "FIX-200",
    cycleId: "cycle-200",
    agent: "kimi",
    sessionId: "uuid-200",
    worktreePath: "/tmp/wt-200",
    capturedAtSec: 2,
    cycleStartSec: 2,
    spawnedWarm: false,
  },
];

describe("shouldCaptureWarmSession (lever-4 depth-1 cap, FIX-355)", () => {
  it("a COLD-spawned cycle seeds the ledger (capture)", () => {
    expect(shouldCaptureWarmSession(false)).toBe(true);
  });
  it("a WARM (resumed) cycle does NOT re-seed — bounds the chain to depth-1", () => {
    // The systemic guarantee: a resumed cycle never re-captures, so warm context
    // can never chain A→B→C… and degrade every later card.
    expect(shouldCaptureWarmSession(true)).toBe(false);
  });
});

describe("sessionReuseFor (lever-4 adapter)", () => {
  it("every engine ⇒ cold no-op adapter (the universal default — no pool agent resumes)", () => {
    for (const agent of ["claude", "kimi", "pi", "reasonix", "cursor", "opencode", "trae", "openclaw"]) {
      const a = sessionReuseFor(agent, getAgentSpec(agent)?.usage);
      expect(a.supportsReuse()).toBe(false);
      // cold adapter resolves nothing and injects nothing
      expect(a.resolvePriorSessionId(ledger, "FIX-100")).toBeNull();
      expect(a.injectSessionId({ x: 1 }, "uuid-100")).toEqual({ x: 1 });
    }
  });

  it("unknown agent / absent spec ⇒ cold (fail-safe)", () => {
    expect(sessionReuseFor("nope", undefined).supportsReuse()).toBe(false);
    expect(sessionReuseFor("nope", { stdoutExtractor: "generic" }).supportsReuse()).toBe(false);
  });

  it("the cold adapter's coldFallback returns opts unchanged (no resume injected)", () => {
    const a = sessionReuseFor("kimi", getAgentSpec("kimi")?.usage);
    const opts = { prompt: "hi" } as Record<string, unknown>;
    expect(a.coldFallback(opts)).toBe(opts);
  });
});

describe("warm-session decision contract (cold-only after pool narrowing)", () => {
  const base: WarmSessionEntry = {
    storyId: "FIX-352",
    cycleId: "20260618-033751",
    agent: "kimi",
    sessionId: "019ed717-474b-aaaa-bbbb-000000000001",
    worktreePath: "/tmp/roll-cycle-FIX-352",
    capturedAtSec: 1781760000,
    cycleStartSec: 1781759300,
    rolloutPath: "/sessions/rollout-2026-06-18T03-37-51-019ed717-474b-aaaa-bbbb-000000000001.jsonl",
    spawnedWarm: false,
  };

  it("explicit off scope ⇒ policy_off", () => {
    expect(
      decideWarmResume({ agent: "kimi", storyId: "FIX-352", resumeScope: "off", ledger: [base], nowSec: 1 }),
    ).toEqual({ mode: "cold", reason: "policy_off" });
  });

  it("any non-off scope ⇒ agent_unsupported (no pool engine resumes — every cycle runs cold)", () => {
    for (const agent of ["kimi", "pi", "reasonix", "claude"]) {
      expect(
        decideWarmResume({ agent, storyId: "FIX-352", resumeScope: "same-story", ledger: [base], nowSec: 1781760100 }),
      ).toEqual({ mode: "cold", reason: "agent_unsupported" });
    }
  });

  it("never selects a session even when a valid same-story row exists in the ledger", () => {
    expect(
      decideWarmResume({
        agent: "kimi",
        storyId: "FIX-352",
        resumeScope: "same-story",
        ledger: [base],
        nowSec: 1781760100,
      }),
    ).toEqual({ mode: "cold", reason: "agent_unsupported" });
  });

  it("capture rejects stale and warm-spawned rollouts, then records full provenance for a valid cold session", () => {
    expect(
      captureWarmSession({
        storyId: "FIX-352",
        cycleId: "cycle-stale",
        agent: "kimi",
        sessionId: "stale",
        worktreePath: "/tmp/wt",
        rolloutPath: "/sessions/stale.jsonl",
        rolloutMtimeSec: 9,
        cycleStartSec: 10,
        capturedAtSec: 11,
        spawnedWarm: false,
      }),
    ).toBeNull();

    expect(
      captureWarmSession({
        storyId: "FIX-352",
        cycleId: "cycle-warm",
        agent: "kimi",
        sessionId: "warm",
        worktreePath: "/tmp/wt",
        rolloutPath: "/sessions/warm.jsonl",
        rolloutMtimeSec: 10,
        cycleStartSec: 10,
        capturedAtSec: 11,
        spawnedWarm: true,
      }),
    ).toBeNull();

    expect(
      captureWarmSession({
        storyId: "FIX-352",
        cycleId: "cycle-cold",
        agent: "kimi",
        sessionId: "cold",
        worktreePath: "/tmp/wt",
        rolloutPath: "/sessions/cold.jsonl",
        rolloutMtimeSec: 10,
        cycleStartSec: 10,
        capturedAtSec: 11,
        spawnedWarm: false,
      }),
    ).toEqual({
      storyId: "FIX-352",
      cycleId: "cycle-cold",
      agent: "kimi",
      sessionId: "cold",
      worktreePath: "/tmp/wt",
      capturedAtSec: 11,
      cycleStartSec: 10,
      rolloutPath: "/sessions/cold.jsonl",
      spawnedWarm: false,
    });
  });
});
