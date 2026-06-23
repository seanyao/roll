import { describe, expect, it } from "vitest";
import {
  AGENT_REGISTRY_NAMES,
  agentBinNames,
  agentDisplayName,
  agentIsKnown,
  agentsInstalled,
  firstInstalledAgent,
  type AgentEnv,
} from "../src/agent/registry.js";
import { AGENTS, AGENT_SPECS, getAgentIdentitySpec, getAgentSpec } from "../src/agent/specs.js";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

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
  it("US-AGENT-044: registry identity surfaces are derived from AGENTS", () => {
    const agentNames = AGENTS.map((spec) => spec.name);
    expect([...AGENT_REGISTRY_NAMES]).toEqual(agentNames);
    for (const spec of AGENTS) {
      expect(agentDisplayName(spec.name)).toBe(spec.displayName);
      expect(agentBinNames(spec.name)).toEqual([...spec.cliBin]);
      expect(getAgentIdentitySpec(spec.name)).toBe(spec);
    }
  });

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

  it("US-AGENT-045 AC1: provider aliases (openai→codex, deepseek→pi) silently resolve", () => {
    expect(agentIsKnown("openai")).toBe(true);
    expect(agentIsKnown("deepseek")).toBe(true);
    expect(agentBinNames("openai")).toEqual(["codex"]);
    expect(agentBinNames("deepseek")).toEqual(["pi"]);
    expect(agentDisplayName("openai")).toBe("codex");
    expect(agentDisplayName("deepseek")).toBe("pi");
  });

  it("reasonix participates in installed scanning and fallback order", () => {
    const env = envWithBins(["reasonix"]);
    expect(agentsInstalled(env)).toEqual(["reasonix"]);
    expect(firstInstalledAgent(env)).toBe("reasonix");
  });
});

describe("US-AGENT-046 guide/site agent roster", () => {
  const DELETED_AGENTS = [
    "openclaw",
    "cursor",
    "trae",
    "opencode",
  ] as const;

  const CANONICAL_SIX = ["claude", "kimi", "codex", "pi", "agy", "reasonix"] as const;

  it("guide/en/ai-agents.md lists exactly 6 agents and no deleted agents", () => {
    const repoRoot = resolve(import.meta.dirname!, "..", "..", "..");
    const text = readFileSync(join(repoRoot, "guide", "en", "ai-agents.md"), "utf-8");
    for (const name of CANONICAL_SIX) {
      expect(text).toContain(name);
    }
    for (const removed of DELETED_AGENTS) {
      expect(text).not.toContain(removed);
    }
  });
});
