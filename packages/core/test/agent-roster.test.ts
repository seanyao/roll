import { describe, expect, it } from "vitest";
import {
  AGENT_REGISTRY_NAMES,
  agentBinNames,
  agentIsKnown,
  agentsInstalled,
  firstInstalledAgent,
  type AgentEnv,
} from "../src/agent/registry.js";
import { AGENT_SPECS, getAgentSpec } from "../src/agent/specs.js";

const CANONICAL_ROSTER = ["claude", "kimi", "codex", "pi", "agy", "reasonix"] as const;
const REMOVED_AGENT_TOKENS = ["openclaw", "qwen", "opencode", "cursor", "trae"] as const;

function envWithBins(bins: readonly string[]): AgentEnv {
  const onPath = new Set(bins);
  return {
    home: "/home/tester",
    commandOnPath: (bin) => onPath.has(bin),
    dirExists: () => false,
    fileExecutable: () => false,
  };
}

describe("US-AGENT-043 canonical agent roster", () => {
  it("registry scans exactly the six supported agents", () => {
    expect([...AGENT_REGISTRY_NAMES]).toEqual([...CANONICAL_ROSTER]);
    for (const agent of CANONICAL_ROSTER) {
      expect(agentIsKnown(agent)).toBe(true);
      expect(agentBinNames(agent)).not.toBeNull();
    }
});

  it("agent specs expose exactly six canonical entries while preserving provider aliases", () => {
    const canonicalSpecNames = Object.values(AGENT_SPECS)
      .filter((spec, index, all) => all.findIndex((candidate) => candidate.name === spec.name) === index)
      .map((spec) => spec.name);
    expect(canonicalSpecNames).toEqual([...CANONICAL_ROSTER]);
    expect(getAgentSpec("openai")?.name).toBe("codex");
    expect(getAgentSpec("deepseek")?.name).toBe("pi");
  });

  it("removed agent tokens do not survive as first-class agent names", () => {
    for (const token of REMOVED_AGENT_TOKENS) {
      expect(AGENT_REGISTRY_NAMES).not.toContain(token);
      expect(agentIsKnown(token)).toBe(false);
      expect(agentBinNames(token)).toBeNull();
    }
  });

  it("reasonix participates in installed scanning and fallback order", () => {
    const env = envWithBins(["reasonix"]);
    expect(agentsInstalled(env)).toEqual(["reasonix"]);
    expect(firstInstalledAgent(env)).toBe("reasonix");
  });
});
