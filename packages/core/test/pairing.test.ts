/**
 * US-PAIR-001 — Cross-Agent Pairing selector + pairing.yaml parser.
 * Pure-function tests: vendor heterogeneity, rational hard filter, seeded
 * round-robin rotation, fail-loud empties, and config parse + cross-check.
 */
import { describe, expect, it } from "vitest";
import {
  agentVendor,
  defaultPairingConfig,
  heteroAvailable,
  isHeterogeneous,
  pairingPoolView,
  parsePairingConfig,
  PairingConfigError,
  renderPairingConfig,
  selectPairingCandidates,
  type PairingConfig,
} from "../src/index.js";

const cfg = (over: Partial<PairingConfig> = {}): PairingConfig => ({
  enabled: true,
  stages: ["code"],
  capability: { kimi: ["code"], pi: ["code"], reasonix: ["code"] },
  ...over,
});
const always = (): boolean => true;

describe("agentVendor + isHeterogeneous", () => {
  it("maps known pool agents to distinct vendors", () => {
    expect(agentVendor("kimi")).toBe("moonshot");
    expect(agentVendor("pi")).toBe("pi");
    expect(agentVendor("reasonix")).toBe("reasonix");
    // US-AGENT-045: deepseek is now a provider alias → pi, so its vendor is pi's.
    expect(agentVendor("deepseek")).toBe("pi");
  });
  it("different vendor is heterogeneous; same vendor is NOT", () => {
    expect(isHeterogeneous("kimi", "pi")).toBe(true);
    expect(isHeterogeneous("kimi", "reasonix")).toBe(true);
    expect(isHeterogeneous("pi", "reasonix")).toBe(true);
    expect(isHeterogeneous("kimi", "kimi")).toBe(false);
  });
});

describe("heteroAvailable (FIX-312 — the review-routing switch)", () => {
  it("multi-vendor pool → true (a different-vendor peer exists for the builder)", () => {
    expect(heteroAvailable(["kimi", "pi", "reasonix"], "kimi")).toBe(true);
    expect(heteroAvailable(["kimi", "pi"], "kimi")).toBe(true);
  });
  it("single-agent / single-vendor pool → false (self-review fallback allowed)", () => {
    expect(heteroAvailable(["kimi"], "kimi")).toBe(false);
    expect(heteroAvailable([], "kimi")).toBe(false);
  });
  it("a non-headless-reviewer pool offers no heterogeneous option", () => {
    // claude + unknown/profile-less agents are NOT headless reviewers → none count.
    expect(heteroAvailable(["claude", "made-up-a", "made-up-b"], "kimi")).toBe(false);
  });
  it("builder absent from the pool still counts other vendors", () => {
    // builder is reasonix (not installed locally) but a pi peer is available.
    expect(heteroAvailable(["pi"], "reasonix")).toBe(true);
  });
  it("unknown agents are not treated as headless reviewers without a profile", () => {
    expect(heteroAvailable(["kimi", "made-up-agent"], "kimi")).toBe(false);
  });
});

describe("selectPairingCandidates — rational hard filter", () => {
  it("returns only installed + available + capable + heterogeneous peers", () => {
    const got = selectPairingCandidates({
      installed: ["kimi", "pi", "reasonix"],
      isAvailable: always,
      workingAgent: "kimi",
      stage: "code",
      cfg: cfg(),
      cycleId: "c1",
    });
    expect(got).not.toContain("kimi"); // never the worker itself
    expect(got.sort()).toEqual(["pi", "reasonix"]);
  });

  it("excludes unavailable agents", () => {
    const got = selectPairingCandidates({
      installed: ["kimi", "pi", "reasonix"],
      isAvailable: (a) => a !== "pi",
      workingAgent: "kimi",
      stage: "code",
      cfg: cfg(),
      cycleId: "c1",
    });
    expect(got).toEqual(["reasonix"]);
  });

  it("excludes agents not declared capable for the stage", () => {
    const got = selectPairingCandidates({
      installed: ["kimi", "pi", "reasonix"],
      isAvailable: always,
      workingAgent: "kimi",
      stage: "design", // only set up for code in cfg
      cfg: cfg({ stages: ["design"], capability: { pi: ["code"], reasonix: ["design"] } }),
      cycleId: "c1",
    });
    expect(got).toEqual(["reasonix"]); // pi not capable for design
  });

  it("never pairs same-vendor (a fresh same-type peer is excluded from the hetero code stage)", () => {
    const got = selectPairingCandidates({
      installed: ["pi", "kimi"],
      isAvailable: always,
      workingAgent: "pi",
      stage: "code",
      cfg: cfg({ capability: { kimi: ["code"], pi: ["code"] } }),
      cycleId: "c1",
    });
    expect(got).toEqual(["kimi"]); // heterogeneous only
  });
});

describe("selectPairingCandidates — fail-loud empties", () => {
  it("empty when pairing disabled", () => {
    expect(selectPairingCandidates({ installed: ["claude", "codex"], isAvailable: always, workingAgent: "claude", stage: "code", cfg: cfg({ enabled: false }), cycleId: "c1" })).toEqual([]);
  });
  it("empty when stage not enabled", () => {
    expect(selectPairingCandidates({ installed: ["claude", "codex"], isAvailable: always, workingAgent: "claude", stage: "test", cfg: cfg(), cycleId: "c1" })).toEqual([]);
  });
  it("empty when no heterogeneous qualified peer (sole agent)", () => {
    expect(selectPairingCandidates({ installed: ["claude"], isAvailable: always, workingAgent: "claude", stage: "code", cfg: cfg(), cycleId: "c1" })).toEqual([]);
  });
});

describe("selectPairingCandidates — seeded round-robin rotation", () => {
  it("same cycleId is replayable; different cycleIds rotate the head", () => {
    const base = { installed: ["kimi", "pi", "reasonix"], isAvailable: always, workingAgent: "kimi", stage: "code" as const, cfg: cfg() };
    const a1 = selectPairingCandidates({ ...base, cycleId: "alpha" });
    const a2 = selectPairingCandidates({ ...base, cycleId: "alpha" });
    expect(a1).toEqual(a2); // deterministic
    // all candidates always present (rotation, not truncation)
    expect([...a1].sort()).toEqual(["pi", "reasonix"]);
    // at least one cycleId rotates to a different head across a few seeds
    const heads = ["alpha", "beta", "gamma", "delta", "eps"].map((c) => selectPairingCandidates({ ...base, cycleId: c })[0]);
    expect(new Set(heads).size).toBeGreaterThan(1);
  });
});

describe("parsePairingConfig", () => {
  it("parses enabled/stages/capability", () => {
    const c = parsePairingConfig(`enabled: true\nstages: [code, design]\ncapability:\n  pi: [code, test]\n  kimi: [code, design, cycle]\n`);
    expect(c.enabled).toBe(true);
    expect(c.stages).toEqual(["code", "design"]);
    expect(c.capability.pi).toEqual(["code", "test"]);
    expect(c.capability.kimi).toEqual(["code", "design", "cycle"]);
  });
  it("ignores comments and blank lines", () => {
    const c = parsePairingConfig(`# pairing\nenabled: true  # on\n\nstages: [code]\n`);
    expect(c.enabled).toBe(true);
    expect(c.stages).toEqual(["code"]);
  });
  it("fail-loud on an illegal stage", () => {
    expect(() => parsePairingConfig(`enabled: true\nstages: [bogus]\n`)).toThrow(PairingConfigError);
  });
  it("fail-loud on capability for an unknown agent (registry cross-check)", () => {
    expect(() => parsePairingConfig(`enabled: true\ncapability:\n  notanagent: [code]\n`)).toThrow(PairingConfigError);
  });
  it("FIX-328: fail-loud on capability for a non-headless reviewer", () => {
    expect(() => parsePairingConfig(`enabled: true\ncapability:\n  cursor: [code]\n`)).toThrow(PairingConfigError);
  });
  it("absent/empty config is disabled (file-absent = off)", () => {
    expect(parsePairingConfig("").enabled).toBe(false);
  });
  // fail-loud fixes from kimi pair-review:
  it("fail-loud on an unknown top-level key (typo'd stages)", () => {
    expect(() => parsePairingConfig(`enabled: true\nstage: [code]\n`)).toThrow(PairingConfigError);
  });
  it("fail-loud on an indented line outside the capability block", () => {
    expect(() => parsePairingConfig(`enabled: true\n  stages: [code]\n`)).toThrow(PairingConfigError);
  });
  it("fail-loud on a malformed non-key line", () => {
    expect(() => parsePairingConfig(`enabled: true\ngarbage line\n`)).toThrow(PairingConfigError);
  });
});

describe("defaultPairingConfig + renderPairingConfig (roll pair init scaffold)", () => {
  it("enables when ≥2 distinct vendors, declares all installed code+score-capable", () => {
    // kimi + pi are two headless-reviewable vendors.
    const c = defaultPairingConfig(["kimi", "pi"]);
    expect(c.enabled).toBe(true);
    expect(c.stages).toEqual(["code", "score"]);
    expect(c.capability).toEqual({ kimi: ["code", "score"], pi: ["code", "score"] });
  });
  it("disabled when fewer than 2 vendors", () => {
    expect(defaultPairingConfig(["kimi"]).enabled).toBe(false);
  });
  it("US-PAIR-009: score is a legal stage and ships in the generated default", () => {
    const c = parsePairingConfig("enabled: true\nstages: [code, score]\ncapability:\n  pi: [score]\n");
    expect(c.stages).toEqual(["code", "score"]);
    expect(c.capability).toEqual({ pi: ["score"] });
    const d = defaultPairingConfig(["kimi", "pi"]);
    expect(d.stages).toEqual(["code", "score"]);
    expect(d.capability["kimi"]).toEqual(["code", "score"]);
  });
  it("FIX-360: default config excludes claude (non-headless reviewer) from the pool", () => {
    // claude's OAuth/keychain login token is unreachable from a launchd headless
    // daemon (401) — it is NOT a headless reviewer (it has no spec at all now) and
    // must never land in a reviewer pool, even when installed alongside
    // heterogeneous peers. kimi + pi remain as two headless-reviewable vendors.
    const d = defaultPairingConfig(["claude", "kimi", "pi"]);
    expect(d.enabled).toBe(true); // kimi + pi are still ≥2 headless-reviewable vendors
    expect(d.capability).toEqual({ kimi: ["code", "score"], pi: ["code", "score"] });
    expect(d.capability["claude"]).toBeUndefined();
    expect(renderPairingConfig(d)).not.toContain("claude:");
    // and the live score-stage selector never picks claude even when installed
    const picked = selectPairingCandidates({
      installed: ["claude", "kimi", "pi"],
      isAvailable: () => true,
      workingAgent: "kimi",
      stage: "score",
      cfg: cfg({ enabled: false, stages: [], capability: {} }),
      cycleId: "c1",
    });
    expect(picked).not.toContain("claude");
  });
  it("FIX-328: default config excludes profile-less agents from review pools", () => {
    // kimi + pi are the headless-reviewable vendors; profile-less agents
    // (no spec, canReviewHeadless=false) are excluded.
    const d = defaultPairingConfig(["kimi", "made-up-a", "made-up-b", "pi"]);
    expect(d.enabled).toBe(true);
    expect(d.capability).toEqual({ kimi: ["code", "score"], pi: ["code", "score"] });
    expect(renderPairingConfig(d)).not.toContain("made-up-a:");
    expect(renderPairingConfig(d)).not.toContain("made-up-b:");
  });
  it("FIX-328: score candidates exclude installed profile-less agents", () => {
    // Worker is kimi (a headless reviewer). Profile-less agents are excluded
    // from the score pool.
    const picked = selectPairingCandidates({
      installed: ["kimi", "made-up-a", "made-up-b", "pi"],
      isAvailable: () => true,
      workingAgent: "kimi",
      stage: "score",
      cfg: cfg({ enabled: false, stages: [], capability: {} }),
      cycleId: "c1",
    });
    expect(picked).toContain("kimi");
    expect(picked).toContain("pi");
    expect(picked).not.toContain("made-up-a");
    expect(picked).not.toContain("made-up-b");
  });
  it("FIX-328: heteroAvailable ignores profile-less agents", () => {
    expect(heteroAvailable(["kimi", "made-up-a", "made-up-b"], "kimi")).toBe(false);
    expect(heteroAvailable(["kimi", "made-up-a", "pi"], "kimi")).toBe(true);
  });
  it("FIX-343: the score stage is same-vendor-friendly — a fresh instance of the BUILDER'S OWN type qualifies", () => {
    // Independence = another assigned fresh session, NOT vendor heterogeneity:
    // the score stage drops the isHeterogeneous filter and INCLUDES the builder's
    // own canonical type (spawned as a fresh subprocess). The builder must itself
    // be a headless reviewer for its own type to qualify — kimi is the builder here.
    const picked = selectPairingCandidates({
      installed: ["kimi", "pi", "reasonix"],
      isAvailable: () => true,
      workingAgent: "kimi",
      stage: "score",
      cfg: cfg({ stages: ["score"], capability: { pi: ["score"], reasonix: ["score"] } }),
      cycleId: "c1",
    });
    expect(picked.length).toBe(3);
    expect(picked).toContain("kimi"); // builder's own type — a fresh session is independent
    expect(picked).toContain("pi");
    expect(picked).toContain("reasonix");
  });

  it("FIX-343: the score stage is MANDATORY — qualifies even when pairing is disabled / no score stage / no capability", () => {
    // A repo with NO pairing.yaml (cfg.enabled=false, empty stages/capability)
    // still owes a Review Score: the selector must yield the installed agents that
    // CAN headless-review. A single-agent env of a headless-reviewable agent (kimi)
    // still yields that agent (a fresh same-type session is the minimum independence).
    const picked = selectPairingCandidates({
      installed: ["kimi"],
      isAvailable: () => true,
      workingAgent: "kimi",
      stage: "score",
      cfg: cfg({ enabled: false, stages: [], capability: {} }),
      cycleId: "c1",
    });
    expect(picked).toEqual(["kimi"]); // single-agent env: a fresh same-type session

    // But a single-agent env of CLAUDE alone now yields an EMPTY pool: claude is
    // no longer a headless reviewer (canReviewHeadless=false — its OAuth/keychain
    // login is unreachable from a launchd headless daemon, 401), so there is no
    // headless scorer available and the selector fails loud with [].
    const claudeOnly = selectPairingCandidates({
      installed: ["claude"],
      isAvailable: () => true,
      workingAgent: "claude",
      stage: "score",
      cfg: cfg({ enabled: false, stages: [], capability: {} }),
      cycleId: "c1",
    });
    expect(claudeOnly).toEqual([]); // no headless-reviewable scorer in a claude-only env
  });
  it("renders explicit, re-parseable yaml (round-trip)", () => {
    const c = defaultPairingConfig(["kimi", "pi", "reasonix"]);
    const yaml = renderPairingConfig(c);
    expect(yaml).toContain("enabled: true");
    expect(yaml).toContain("stages: [code, score]");
    expect(yaml).toContain("# File present = pairing on");
    expect(parsePairingConfig(yaml)).toEqual(c); // explicit defaults survive a round-trip
  });
  it("disabled config carries the reason as a comment", () => {
    expect(renderPairingConfig(defaultPairingConfig(["kimi"]))).toContain("# Disabled:");
  });
});

describe("pairingPoolView (US-PAIR-002 observability)", () => {
  const cfg2 = { enabled: true, stages: ["code"] as const, capability: { claude: ["code"], codex: ["code"] } } as any;
  it("marks capable heterogeneous agents in-pool, others excluded with a reason", () => {
    const v = pairingPoolView(["claude", "codex", "kimi"], cfg2);
    const byName = Object.fromEntries(v.agents.map((a) => [a.agent, a]));
    expect(byName["claude"].inPool).toBe(true);
    expect(byName["claude"].vendor).toBe("anthropic");
    expect(byName["codex"].inPool).toBe(true);
    // kimi has no capability entry → excluded with a reason
    expect(byName["kimi"].inPool).toBe(false);
    expect(byName["kimi"].reason).toContain("no capability");
  });
  it("when disabled, nobody is in-pool and reason says disabled", () => {
    const v = pairingPoolView(["claude", "codex"], { ...cfg2, enabled: false });
    expect(v.enabled).toBe(false);
    expect(v.agents.every((a) => !a.inPool)).toBe(true);
    expect(v.agents[0].reason).toContain("disabled");
  });
  it("single vendor → heterogeneity reason", () => {
    const v = pairingPoolView(["codex"], { enabled: true, stages: ["code"], capability: { codex: ["code"] } } as any);
    expect(v.agents[0].inPool).toBe(false);
    expect(v.agents[0].reason).toContain("heterogeneous");
  });
});

describe("pairingPoolView — capability must overlap an enabled stage (codex pair-review)", () => {
  it("excludes an agent capable only for a non-enabled stage", () => {
    const v = pairingPoolView(["claude", "codex"], {
      enabled: true,
      stages: ["code"],
      capability: { claude: ["code"], codex: ["design"] }, // codex only design, code enabled
    } as any);
    const codex = v.agents.find((a) => a.agent === "codex")!;
    expect(codex.inPool).toBe(false);
    expect(codex.reason).toContain("enabled stage");
  });
});

// ── FIX-346: auth-failure pool exclusion ─────────────────────────────────────
import {
  excludedPeers,
  peerAuthStates,
  DEFAULT_AUTH_EXCLUDE_THRESHOLD,
  aggregatePairingCost,
} from "../src/index.js";

const blocked = (agent: string, cause: "auth" | "network" = "auth"): any => ({
  type: "agent:blocked",
  cycleId: "c",
  agent,
  cause,
  stage: "review",
  detail: "",
  ts: 1,
});
const verdict = (peer: string): any => ({
  type: "pair:verdict",
  cycleId: "c",
  peer,
  verdict: "agree",
  findings: 0,
  cost: 0,
  stage: "code",
  ts: 1,
});

describe("peerAuthStates / excludedPeers (FIX-346)", () => {
  it("default threshold is two strikes", () => {
    expect(DEFAULT_AUTH_EXCLUDE_THRESHOLD).toBe(2);
  });

  it("a single auth failure does NOT exclude (transient blip tolerated)", () => {
    const ex = excludedPeers([blocked("claude")]);
    expect(ex.has("claude")).toBe(false);
    expect(peerAuthStates([blocked("claude")]).claude).toEqual({
      consecutiveAuthFailures: 1,
      excluded: false,
    });
  });

  it("two consecutive auth failures exclude the peer", () => {
    const ex = excludedPeers([blocked("claude"), blocked("claude")]);
    expect(ex.has("claude")).toBe(true);
    expect(peerAuthStates([blocked("claude"), blocked("claude")]).claude.excluded).toBe(true);
  });

  it("a successful verdict RESETS the streak (re-login recovers the peer)", () => {
    const ex = excludedPeers([blocked("claude"), verdict("claude"), blocked("claude")]);
    expect(ex.has("claude")).toBe(false);
    expect(peerAuthStates([blocked("claude"), verdict("claude"), blocked("claude")]).claude.consecutiveAuthFailures).toBe(1);
  });

  it("network blocks NEVER exclude (transient connectivity, not bad creds)", () => {
    const ex = excludedPeers([blocked("kimi", "network"), blocked("kimi", "network"), blocked("kimi", "network")]);
    expect(ex.has("kimi")).toBe(false);
  });

  it("excludes one auth-failing peer while leaving a healthy peer in the pool (swap)", () => {
    const ex = excludedPeers([blocked("claude"), blocked("claude"), verdict("codex")]);
    expect(ex.has("claude")).toBe(true);
    expect(ex.has("codex")).toBe(false);
  });

  it("keys the agent name verbatim (no overseas alias collapse remains)", () => {
    const ex = excludedPeers([blocked("kimi"), blocked("kimi")]);
    expect(ex.has("kimi")).toBe(true);
  });
});

describe("aggregatePairingCost — pair:excluded (FIX-346)", () => {
  it("surfaces the most-recent exclusion failure count per peer", () => {
    const s = aggregatePairingCost([
      { type: "pair:excluded", cycleId: "c1", agent: "claude", cause: "auth", failures: 2, ts: 1 },
      { type: "pair:excluded", cycleId: "c2", agent: "claude", cause: "auth", failures: 5, ts: 2 },
    ] as any[]);
    expect(s.excludedPeers).toEqual({ claude: 5 });
  });

  it("empty stream → no excluded peers", () => {
    expect(aggregatePairingCost([]).excludedPeers).toEqual({});
  });
});
