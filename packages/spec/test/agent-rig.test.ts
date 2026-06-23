import { describe, expect, it } from "vitest";
import { AGENT_NAMES, isAgentName, rig } from "../src/types/agent.js";

describe("US-AGENT-047 Rig", () => {
  it("declares the supported agent names as the Rig agent universe", () => {
    expect([...AGENT_NAMES]).toEqual(["claude", "kimi", "codex", "pi", "agy", "reasonix"]);
    expect(isAgentName("pi")).toBe(true);
    expect(isAgentName("deepseek")).toBe(false);
  });

  it("keeps deepseek legal as a model string, not as a Rig agent", () => {
    expect(rig("pi", "deepseek-v4-pro")).toEqual({ agent: "pi", model: "deepseek-v4-pro" });
    expect(() => rig("deepseek", "deepseek-v4-pro")).toThrow("invalid agent for Rig: deepseek");
  });
});
