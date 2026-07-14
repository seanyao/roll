import { describe, expect, it } from "vitest";
import {
  MissingModelConfigError,
  agentRequiresExplicitModel,
  agentScaffoldSeedModel,
  configuredModelForAgent,
  modelConfigGuidance,
  normalizeAgentConfig,
  readRouteSlot,
} from "../src/index.js";

describe("FIX-1249 — agent model is config-driven, not a source-baked runtime default", () => {
  describe("agentRequiresExplicitModel", () => {
    it("reasonix requires an explicit model (no usable native default)", () => {
      expect(agentRequiresExplicitModel("reasonix")).toBe(true);
      expect(agentRequiresExplicitModel("Reasonix")).toBe(true);
    });
    it("agents with a native default do NOT require an explicit model", () => {
      for (const a of ["pi", "kimi", "claude", "codex", "agy", "cursor"]) {
        expect(agentRequiresExplicitModel(a), a).toBe(false);
      }
    });
  });

  describe("configuredModelForAgent — config is the single source of truth", () => {
    const yaml = [
      "schema: roll-agents/v1",
      "rigs:",
      "  reasonix-pro:",
      "    agent: reasonix",
      "    model: deepseek-v4-pro",
      "  pi-pro:",
      "    agent: pi",
      "    model: deepseek-v4-pro",
      "  kimi-strong:",
      "    agent: kimi",
      "routing:",
      "  easy: reasonix-pro",
    ].join("\n");
    const { config } = normalizeAgentConfig(yaml);

    it("resolves an agent's model from a rig that binds it", () => {
      expect(configuredModelForAgent("reasonix", config)).toBe("deepseek-v4-pro");
    });
    it("returns undefined for a rig that binds the agent with NO model", () => {
      expect(configuredModelForAgent("kimi", config)).toBeUndefined();
    });
    it("returns undefined for an agent no rig binds", () => {
      expect(configuredModelForAgent("codex", config)).toBeUndefined();
    });
    it("editing the rig model changes the resolved model — no source edit needed", () => {
      const edited = yaml.replace("deepseek-v4-pro", "deepseek-flash");
      const { config: c2 } = normalizeAgentConfig(edited);
      expect(configuredModelForAgent("reasonix", c2)).toBe("deepseek-flash");
    });
  });

  describe("readRouteSlot — configured model reaches the router (rigs+routing schema)", () => {
    const v1 = [
      "schema: roll-agents/v1",
      "rigs:",
      "  reasonix-pro:",
      "    agent: reasonix",
      "    model: deepseek-v4-pro",
      "  kimi-strong:",
      "    agent: kimi",
      "routing:",
      "  easy: reasonix-pro",
      "  default: reasonix-pro",
      "  fallback: kimi-strong",
    ].join("\n");

    it("resolves a tier slot through the rig ref, carrying the model", () => {
      expect(readRouteSlot(v1, "easy")).toEqual({ agent: "reasonix", model: "deepseek-v4-pro" });
    });
    it("a rig ref with no model yields agent only (spawn omits --model)", () => {
      expect(readRouteSlot(v1, "fallback")).toEqual({ agent: "kimi" });
    });
    it("an unrouted slot returns undefined", () => {
      expect(readRouteSlot(v1, "hard")).toBeUndefined();
    });
    it("still reads the legacy v3 inline slot form", () => {
      const v3 = ["schema: v3", "easy: { agent: reasonix, model: deepseek-flash }"].join("\n");
      expect(readRouteSlot(v3, "easy")).toEqual({ agent: "reasonix", model: "deepseek-flash" });
    });
    it("editing the rig model changes the routed model — no source edit", () => {
      const edited = v1.replace("deepseek-v4-pro", "deepseek-v5-max");
      expect(readRouteSlot(edited, "easy")?.model).toBe("deepseek-v5-max");
    });
  });

  describe("missing-config is surfaced, never silently hardcoded", () => {
    it("MissingModelConfigError carries actionable guidance (file, keys, example)", () => {
      const err = new MissingModelConfigError("reasonix");
      expect(err).toBeInstanceOf(Error);
      expect(err.agent).toBe("reasonix");
      expect(err.message).toContain(".roll/agents.yaml");
      expect(err.message).toContain("rigs:");
      expect(err.message).toContain("routing:");
      expect(err.message).toContain("reasonix");
    });
    it("guidance seeds the example from the scaffold seed, not a runtime default", () => {
      const seed = agentScaffoldSeedModel("reasonix");
      expect(seed).not.toBe("");
      expect(modelConfigGuidance("reasonix")).toContain(seed);
    });
  });
});
