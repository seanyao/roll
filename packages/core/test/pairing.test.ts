/**
 * US-PAIR-001 — Cross-Agent Pairing selector + pairing.yaml parser.
 * Pure-function tests: vendor heterogeneity, rational hard filter, seeded
 * round-robin rotation, fail-loud empties, and config parse + cross-check.
 */
import { describe, expect, it } from "vitest";
import {
  agentVendor,
  defaultPairingConfig,
  isHeterogeneous,
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
  it("enables when ≥2 distinct vendors, declares all installed code-capable", () => {
    const c = defaultPairingConfig(["claude", "codex"]);
    expect(c.enabled).toBe(true);
    expect(c.stages).toEqual(["code"]);
    expect(c.capability).toEqual({ claude: ["code"], codex: ["code"] });
  });
  it("disabled when fewer than 2 vendors (alias collapse)", () => {
    expect(defaultPairingConfig(["codex"]).enabled).toBe(false);
    // codex + an openai alias is still one vendor → no heterogeneous peer
    expect(defaultPairingConfig(["codex", "openai"]).enabled).toBe(false);
  });
  it("renders explicit, re-parseable yaml (round-trip)", () => {
    const c = defaultPairingConfig(["claude", "codex", "kimi"]);
    const yaml = renderPairingConfig(c);
    expect(yaml).toContain("enabled: true");
    expect(yaml).toContain("stages: [code]");
    expect(yaml).toContain("# File present = pairing on");
    expect(parsePairingConfig(yaml)).toEqual(c); // explicit defaults survive a round-trip
  });
  it("disabled config carries the reason as a comment", () => {
    expect(renderPairingConfig(defaultPairingConfig(["claude"]))).toContain("# Disabled:");
  });
});
