/**
 * lever-4 — warm-context adapter port. Pure, zero-IO, agent-agnostic. Asserts:
 * codex gets the warm (resume) adapter; EVERY other engine gets the cold no-op;
 * matching is NEXT-CARD-ONLY (keyed by storyId, no widening); injection is pure.
 */
import { describe, expect, it } from "vitest";
import { getAgentSpec } from "../src/agent/specs.js";
import {
  sessionReuseFor,
  shouldCaptureWarmSession,
  type WarmSessionEntry,
} from "../src/agent/session-reuse.js";

const ledger: WarmSessionEntry[] = [
  { storyId: "FIX-100", sessionId: "uuid-100", ts: 1 },
  { storyId: "FIX-200", sessionId: "uuid-200", ts: 2 },
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
        { storyId: "FIX-100", sessionId: "old-uuid", ts: 1 },
        { storyId: "FIX-100", sessionId: "new-uuid", ts: 5 },
      ];
      expect(codex.resolvePriorSessionId(dupes, "FIX-100")).toBe("new-uuid");
    });

    it("ignores an entry with an empty session id", () => {
      const bad: WarmSessionEntry[] = [{ storyId: "FIX-100", sessionId: "", ts: 1 }];
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
