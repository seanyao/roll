import { describe, expect, it } from "vitest";
import { AGENT_NAMES } from "../src/types/agent.js";
import type { AgentName, Rig } from "../src/types/agent.js";

describe("US-AGENT-047 AC5: Rig lightweight type", () => {
  it("AGENT_NAMES runtime const holds exactly six canonical names", () => {
    expect(AGENT_NAMES).toEqual(["claude", "kimi", "codex", "pi", "agy", "reasonix"]);
    expect(AGENT_NAMES.length).toBe(6);
    // Uniqueness
    expect(new Set(AGENT_NAMES).size).toBe(6);
  });

  it("every AGENT_NAMES entry is a valid AgentName", () => {
    for (const name of AGENT_NAMES) {
      const n: AgentName = name;
      expect(n).toBe(name);
    }
  });

  it("Rig { agent: AgentName; model: string } is constructable", () => {
    const rig: Rig = { agent: "pi", model: "deepseek-v4-pro" };
    expect(rig.agent).toBe("pi");
    expect(rig.model).toBe("deepseek-v4-pro");
  });

  it("Rig model preserves :thinking effort suffixes verbatim", () => {
    const rig: Rig = { agent: "pi", model: "deepseek/deepseek-v4-pro:high" };
    expect(rig.model).toBe("deepseek/deepseek-v4-pro:high");
  });

  it("every canonical name is a valid Rig agent", () => {
    for (const name of AGENT_NAMES) {
      const rig: Rig = { agent: name, model: "any-model" };
      expect(rig.agent).toBe(name);
    }
  });
});
