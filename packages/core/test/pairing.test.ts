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
  capability: { claude: ["code"], codex: ["code"], kimi: ["code"], qwen: ["code"] },
  ...over,
});
const always = (): boolean => true;

describe("agentVendor + isHeterogeneous", () => {
  it("maps known agents to vendors; codex/openai collapse", () => {
    expect(agentVendor("codex")).toBe("openai");
    expect(agentVendor("openai")).toBe("openai");
    expect(agentVendor("claude")).toBe("anthropic");
    expect(agentVendor("agy")).toBe("google");
    expect(agentVendor("gemini")).toBe("google");
  });
  it("different vendor is heterogeneous; same-vendor alias is NOT", () => {
    expect(isHeterogeneous("claude", "codex")).toBe(true);
    expect(isHeterogeneous("codex", "openai")).toBe(false); // alias, same backend
    expect(isHeterogeneous("agy", "gemini")).toBe(false);
  });
});

describe("heteroAvailable (FIX-312 — the review-routing switch)", () => {
  it("multi-vendor pool → true (a different-vendor peer exists for the builder)", () => {
    expect(heteroAvailable(["claude", "codex", "kimi"], "claude")).toBe(true);
    expect(heteroAvailable(["claude", "pi"], "claude")).toBe(true);
  });
  it("single-agent / single-vendor pool → false (self-review fallback allowed)", () => {
    expect(heteroAvailable(["claude"], "claude")).toBe(false);
    expect(heteroAvailable([], "claude")).toBe(false);
  });
  it("same vendor by alias is NOT heterogeneous (agent-agnostic, vendor-based)", () => {
    // codex and openai collapse to one vendor → no heterogeneous option.
    expect(heteroAvailable(["codex", "openai"], "codex")).toBe(false);
    expect(heteroAvailable(["agy", "gemini"], "agy")).toBe(false);
  });
  it("builder absent from the pool still counts other vendors", () => {
    // builder is kimi (not installed locally) but a claude peer is available.
    expect(heteroAvailable(["claude"], "kimi")).toBe(true);
  });
  it("unknown agents are not treated as headless reviewers without a profile", () => {
    expect(heteroAvailable(["claude", "made-up-agent"], "claude")).toBe(false);
  });
});

describe("selectPairingCandidates — rational hard filter", () => {
  it("returns only installed + available + capable + heterogeneous peers", () => {
    const got = selectPairingCandidates({
      installed: ["claude", "codex", "kimi"],
      isAvailable: always,
      workingAgent: "claude",
      stage: "code",
      cfg: cfg(),
      cycleId: "c1",
    });
    expect(got).not.toContain("claude"); // never the worker itself
    expect(got.sort()).toEqual(["codex", "kimi"]);
  });

  it("excludes unavailable agents", () => {
    const got = selectPairingCandidates({
      installed: ["claude", "codex", "kimi"],
      isAvailable: (a) => a !== "codex",
      workingAgent: "claude",
      stage: "code",
      cfg: cfg(),
      cycleId: "c1",
    });
    expect(got).toEqual(["kimi"]);
  });

  it("excludes agents not declared capable for the stage", () => {
    const got = selectPairingCandidates({
      installed: ["claude", "codex", "kimi"],
      isAvailable: always,
      workingAgent: "claude",
      stage: "design", // only set up for code in cfg
      cfg: cfg({ stages: ["design"], capability: { codex: ["code"], kimi: ["design"] } }),
      cycleId: "c1",
    });
    expect(got).toEqual(["kimi"]); // codex not capable for design
  });

  it("never pairs same-vendor (codex worker, openai-alias excluded)", () => {
    const got = selectPairingCandidates({
      installed: ["codex", "claude"],
      isAvailable: always,
      workingAgent: "codex",
      stage: "code",
      cfg: cfg({ capability: { claude: ["code"], codex: ["code"] } }),
      cycleId: "c1",
    });
    expect(got).toEqual(["claude"]); // heterogeneous only
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
    const base = { installed: ["claude", "codex", "kimi", "qwen"], isAvailable: always, workingAgent: "claude", stage: "code" as const, cfg: cfg() };
    const a1 = selectPairingCandidates({ ...base, cycleId: "alpha" });
    const a2 = selectPairingCandidates({ ...base, cycleId: "alpha" });
    expect(a1).toEqual(a2); // deterministic
    // all candidates always present (rotation, not truncation)
    expect([...a1].sort()).toEqual(["codex", "kimi", "qwen"]);
    // at least one cycleId rotates to a different head across a few seeds
    const heads = ["alpha", "beta", "gamma", "delta", "eps"].map((c) => selectPairingCandidates({ ...base, cycleId: c })[0]);
    expect(new Set(heads).size).toBeGreaterThan(1);
  });
});

describe("parsePairingConfig", () => {
  it("parses enabled/stages/capability", () => {
    const c = parsePairingConfig(`enabled: true\nstages: [code, design]\ncapability:\n  codex: [code, test]\n  claude: [code, design, cycle]\n`);
    expect(c.enabled).toBe(true);
    expect(c.stages).toEqual(["code", "design"]);
    expect(c.capability.codex).toEqual(["code", "test"]);
    expect(c.capability.claude).toEqual(["code", "design", "cycle"]);
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
    const c = defaultPairingConfig(["claude", "codex"]);
    expect(c.enabled).toBe(true);
    expect(c.stages).toEqual(["code", "score"]);
    expect(c.capability).toEqual({ claude: ["code", "score"], codex: ["code", "score"] });
  });
  it("disabled when fewer than 2 vendors (alias collapse)", () => {
    expect(defaultPairingConfig(["codex"]).enabled).toBe(false);
    // codex + an openai alias is still one vendor → no heterogeneous peer
    expect(defaultPairingConfig(["codex", "openai"]).enabled).toBe(false);
  });
  it("US-PAIR-009: score is a legal stage and ships in the generated default", () => {
    const c = parsePairingConfig("enabled: true\nstages: [code, score]\ncapability:\n  codex: [score]\n");
    expect(c.stages).toEqual(["code", "score"]);
    expect(c.capability).toEqual({ codex: ["score"] });
    const d = defaultPairingConfig(["claude", "codex"]);
    expect(d.stages).toEqual(["code", "score"]);
    expect(d.capability["claude"]).toEqual(["code", "score"]);
  });
  it("FIX-328: default config excludes IDE/config-only agents from review pools", () => {
    const d = defaultPairingConfig(["claude", "cursor", "trae", "codex"]);
    expect(d.enabled).toBe(true);
    expect(d.capability).toEqual({ claude: ["code", "score"], codex: ["code", "score"] });
    expect(renderPairingConfig(d)).not.toContain("cursor:");
    expect(renderPairingConfig(d)).not.toContain("trae:");
  });
  it("FIX-328: score candidates exclude installed IDE/config-only agents", () => {
    const picked = selectPairingCandidates({
      installed: ["claude", "cursor", "trae", "codex"],
      isAvailable: () => true,
      workingAgent: "claude",
      stage: "score",
      cfg: cfg({ enabled: false, stages: [], capability: {} }),
      cycleId: "c1",
    });
    expect(picked).toContain("claude");
    expect(picked).toContain("codex");
    expect(picked).not.toContain("cursor");
    expect(picked).not.toContain("trae");
  });
  it("FIX-328: heteroAvailable ignores IDE/config-only agents", () => {
    expect(heteroAvailable(["claude", "cursor", "trae"], "claude")).toBe(false);
    expect(heteroAvailable(["claude", "cursor", "codex"], "claude")).toBe(true);
  });
  it("FIX-343: the score stage is same-vendor-friendly — a fresh instance of the BUILDER'S OWN type qualifies", () => {
    // Independence = another assigned fresh session, NOT vendor heterogeneity:
    // the score stage drops the isHeterogeneous filter and INCLUDES the builder's
    // own canonical type (spawned as a fresh subprocess).
    const picked = selectPairingCandidates({
      installed: ["claude", "codex", "kimi"],
      isAvailable: () => true,
      workingAgent: "claude",
      stage: "score",
      cfg: cfg({ stages: ["score"], capability: { codex: ["score"], kimi: ["score"] } }),
      cycleId: "c1",
    });
    expect(picked.length).toBe(3);
    expect(picked).toContain("claude"); // builder's own type — a fresh session is independent
    expect(picked).toContain("codex");
    expect(picked).toContain("kimi");
  });

  it("FIX-343: the score stage is MANDATORY — qualifies even when pairing is disabled / no score stage / no capability", () => {
    // A repo with NO pairing.yaml (cfg.enabled=false, empty stages/capability)
    // still owes a Review Score: the selector must yield the installed agents.
    const picked = selectPairingCandidates({
      installed: ["claude"],
      isAvailable: () => true,
      workingAgent: "claude",
      stage: "score",
      cfg: cfg({ enabled: false, stages: [], capability: {} }),
      cycleId: "c1",
    });
    expect(picked).toEqual(["claude"]); // single-agent env: a fresh same-type session
  });
  it("renders explicit, re-parseable yaml (round-trip)", () => {
    const c = defaultPairingConfig(["claude", "codex", "kimi"]);
    const yaml = renderPairingConfig(c);
    expect(yaml).toContain("enabled: true");
    expect(yaml).toContain("stages: [code, score]");
    expect(yaml).toContain("# File present = pairing on");
    expect(parsePairingConfig(yaml)).toEqual(c); // explicit defaults survive a round-trip
  });
  it("disabled config carries the reason as a comment", () => {
    expect(renderPairingConfig(defaultPairingConfig(["claude"]))).toContain("# Disabled:");
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
