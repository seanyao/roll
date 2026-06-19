/**
 * lever-4 — warm-context adapter port. Pure, zero-IO, agent-agnostic. Asserts:
 * codex gets the warm (resume) adapter; EVERY other engine gets the cold no-op;
 * matching is NEXT-CARD-ONLY (keyed by storyId, no widening); injection is pure.
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
    agent: "codex",
    sessionId: "uuid-100",
    worktreePath: "/tmp/wt-100",
    capturedAtSec: 1,
    cycleStartSec: 1,
    spawnedWarm: false,
  },
  {
    storyId: "FIX-200",
    cycleId: "cycle-200",
    agent: "codex",
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
  it("codex ⇒ warm adapter (supportsReuse)", () => {
    const a = sessionReuseFor("codex", getAgentSpec("codex")?.usage);
    expect(a.supportsReuse()).toBe(true);
  });

  it("every other engine ⇒ cold no-op adapter (the universal default)", () => {
    for (const agent of ["claude", "kimi", "qwen", "agy", "pi", "cursor", "opencode", "trae", "openclaw"]) {
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

  describe("codex resume adapter", () => {
    const codex = sessionReuseFor("codex", getAgentSpec("codex")?.usage);

    it("resolves the session id keyed by the EXACT prior storyId (next-card-only)", () => {
      expect(codex.resolvePriorSessionId(ledger, "FIX-100")).toBe("uuid-100");
      expect(codex.resolvePriorSessionId(ledger, "FIX-200")).toBe("uuid-200");
    });

    it("no entry for the storyId ⇒ null (cold fallback; no widening to other cards)", () => {
      expect(codex.resolvePriorSessionId(ledger, "FIX-999")).toBeNull();
      expect(codex.resolvePriorSessionId([], "FIX-100")).toBeNull();
      expect(codex.resolvePriorSessionId(ledger, "")).toBeNull();
    });

    it("a re-capture of the same card supersedes the older entry (scan from newest)", () => {
      const dupes: WarmSessionEntry[] = [
        {
          storyId: "FIX-100",
          cycleId: "cycle-old",
          agent: "codex",
          sessionId: "old-uuid",
          worktreePath: "/tmp/wt",
          capturedAtSec: 1,
          cycleStartSec: 1,
          spawnedWarm: false,
        },
        {
          storyId: "FIX-100",
          cycleId: "cycle-new",
          agent: "codex",
          sessionId: "new-uuid",
          worktreePath: "/tmp/wt",
          capturedAtSec: 5,
          cycleStartSec: 5,
          spawnedWarm: false,
        },
      ];
      expect(codex.resolvePriorSessionId(dupes, "FIX-100")).toBe("new-uuid");
    });

    it("ignores an entry with an empty session id", () => {
      const bad: WarmSessionEntry[] = [
        {
          storyId: "FIX-100",
          cycleId: "cycle-bad",
          agent: "codex",
          sessionId: "",
          worktreePath: "/tmp/wt",
          capturedAtSec: 1,
          cycleStartSec: 1,
          spawnedWarm: false,
        },
      ];
      expect(codex.resolvePriorSessionId(bad, "FIX-100")).toBeNull();
    });

    it("injectSessionId sets codexSessionId WITHOUT mutating the input (pure)", () => {
      const opts = { prompt: "hi" } as Record<string, unknown>;
      const out = codex.injectSessionId(opts, "uuid-100");
      expect(out).toEqual({ prompt: "hi", codexSessionId: "uuid-100" });
      expect(opts).toEqual({ prompt: "hi" }); // unchanged
    });

    it("coldFallback returns opts unchanged (no resume injected)", () => {
      const opts = { prompt: "hi" } as Record<string, unknown>;
      expect(codex.coldFallback(opts)).toBe(opts);
    });
  });
});

describe("warm-session provenance decision contract", () => {
  const base: WarmSessionEntry = {
    storyId: "FIX-352",
    cycleId: "20260618-033751",
    agent: "codex",
    sessionId: "019ed717-474b-aaaa-bbbb-000000000001",
    worktreePath: "/tmp/roll-cycle-FIX-352",
    capturedAtSec: 1781760000,
    cycleStartSec: 1781759300,
    rolloutPath: "/codex/rollout-2026-06-18T03-37-51-019ed717-474b-aaaa-bbbb-000000000001.jsonl",
    spawnedWarm: false,
  };

  it("selects the newest valid same-story row and reports provenance", () => {
    const older = { ...base, cycleId: "older", sessionId: "old", capturedAtSec: base.capturedAtSec - 1 };
    expect(
      decideWarmResume({
        agent: "codex",
        storyId: "FIX-352",
        resumeScope: "same-story",
        ledger: [older, base],
        nowSec: 1781760100,
      }),
    ).toEqual({
      mode: "resume",
      reason: "selected",
      sessionId: base.sessionId,
      sourceCycleId: base.cycleId,
      sourceStoryId: base.storyId,
    });
  });

  it("same-story scope selects the current story even when another card has a newer row", () => {
    const otherNewer = {
      ...base,
      storyId: "FIX-999",
      cycleId: "newer-other",
      sessionId: "other",
      capturedAtSec: base.capturedAtSec + 10,
    };
    expect(
      decideWarmResume({
        agent: "codex",
        storyId: "FIX-352",
        resumeScope: "same-story",
        ledger: [base, otherNewer],
        nowSec: 1781760100,
      }),
    ).toEqual({
      mode: "resume",
      reason: "selected",
      sessionId: base.sessionId,
      sourceCycleId: base.cycleId,
      sourceStoryId: base.storyId,
    });
  });

  it("cross-card rows cold-fall back with scope_mismatch and source provenance", () => {
    expect(
      decideWarmResume({
        agent: "codex",
        storyId: "FIX-356",
        resumeScope: "same-story",
        ledger: [base],
        nowSec: 1781760100,
      }),
    ).toEqual({
      mode: "cold",
      reason: "scope_mismatch",
      sourceCycleId: base.cycleId,
      sourceStoryId: base.storyId,
    });
  });

  it("policy off and unsupported agents cold-fall back without selecting a session", () => {
    expect(decideWarmResume({ agent: "codex", storyId: "FIX-352", resumeScope: "off", ledger: [base], nowSec: 1 })).toEqual({
      mode: "cold",
      reason: "policy_off",
    });
    expect(decideWarmResume({ agent: "claude", storyId: "FIX-352", resumeScope: "same-story", ledger: [base], nowSec: 1 })).toEqual({
      mode: "cold",
      reason: "agent_unsupported",
    });
  });

  it("malformed legacy rows degrade to cold fallback instead of throwing", () => {
    expect(
      decideWarmResume({
        agent: "codex",
        storyId: "FIX-352",
        resumeScope: "same-story",
        ledger: [{ storyId: "FIX-352", sessionId: "legacy" } as unknown as WarmSessionEntry],
        nowSec: 1781760100,
      }),
    ).toEqual({ mode: "cold", reason: "no_prior_session" });
  });

  it("capture rejects stale and warm-spawned rollouts, then records full provenance for a valid cold session", () => {
    expect(
      captureWarmSession({
        storyId: "FIX-352",
        cycleId: "cycle-stale",
        agent: "codex",
        sessionId: "stale",
        worktreePath: "/tmp/wt",
        rolloutPath: "/codex/stale.jsonl",
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
        agent: "codex",
        sessionId: "warm",
        worktreePath: "/tmp/wt",
        rolloutPath: "/codex/warm.jsonl",
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
        agent: "codex",
        sessionId: "cold",
        worktreePath: "/tmp/wt",
        rolloutPath: "/codex/cold.jsonl",
        rolloutMtimeSec: 10,
        cycleStartSec: 10,
        capturedAtSec: 11,
        spawnedWarm: false,
      }),
    ).toEqual({
      storyId: "FIX-352",
      cycleId: "cycle-cold",
      agent: "codex",
      sessionId: "cold",
      worktreePath: "/tmp/wt",
      capturedAtSec: 11,
      cycleStartSec: 10,
      rolloutPath: "/codex/cold.jsonl",
      spawnedWarm: false,
    });
  });
});
