import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
import { evaluateAgentRosterGate, liveAgentRosterGateInput } from "../src/agent/roster-gate.js";
import { AGENTS, AGENT_SPECS, getAgentIdentitySpec, getAgentSpec } from "../src/agent/specs.js";

const CANONICAL_ROSTER = ["claude", "kimi", "codex", "pi", "agy", "reasonix", "cursor"] as const;
const REMOVED_AGENT_TOKENS = ["openclaw", "qwen", "opencode", "trae"] as const;
const GUIDE_ROSTER_COMMANDS = ["claude", "kimi-code", "codex", "agy", "pi", "reasonix", "cursor-agent"] as const;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function readProjectFile(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), "utf8");
}

function markdownTableCommands(path: string): string[] {
  return readProjectFile(path)
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.includes("---"))
    .slice(1)
    .map((line) => line.split("|")[2]?.match(/`([^`]+)`/)?.[1] ?? "");
}

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

  it("registry scans exactly the seven supported agents", () => {
    expect([...AGENT_REGISTRY_NAMES]).toEqual([...CANONICAL_ROSTER]);
    for (const agent of CANONICAL_ROSTER) {
      expect(agentIsKnown(agent)).toBe(true);
      expect(agentBinNames(agent)).not.toBeNull();
    }
  });

  it("agent specs expose exactly seven canonical entries while preserving provider aliases", () => {
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

  it("US-AGENT-046: live agent guides list exactly the seven supported agents", () => {
    expect(markdownTableCommands("guide/en/ai-agents.md")).toEqual([...GUIDE_ROSTER_COMMANDS]);
    expect(markdownTableCommands("guide/zh/ai-agents.md")).toEqual([...GUIDE_ROSTER_COMMANDS]);
  });

  it("US-AGENT-046: live guide/site/skill surfaces drop removed agents as agent entries", () => {
    const surfaces = [
      "guide/en/ai-agents.md",
      "guide/zh/ai-agents.md",
      "guide/en/methodology.md",
      "guide/zh/methodology.md",
      "site/roll-data.js",
      "skills/roll-doctor/SKILL.md",
      "skills/roll-loop/references/full-contract.md",
      "skills/roll-onboard/SKILL.md",
      "skills/roll-peer/references/full-contract.md",
    ];
    const forbiddenAgentEntryPatterns = [
      /\bCursor reads\b/,
      /\bCursor 读\b/,
      /\.cursor-rules\b/,
      /\bopencode scheduled tasks\b/,
      /\bopencode 定时任务\b/,
      /\bKimi or DeepSeek\b/,
      /\bKimi 或 DeepSeek\b/,
      /\bopenclaw\b/i,
      /\bqwen\b/i,
      /\btrae\b/i,
      /\bopencode\b/i,
    ];

    for (const surface of surfaces) {
      const text = readProjectFile(surface);
      for (const pattern of forbiddenAgentEntryPatterns) {
        expect(text, `${surface} should not contain ${pattern}`).not.toMatch(pattern);
      }
    }

    const site = readProjectFile("site/roll-data.js");
    expect(site).toContain("Works with Claude · Antigravity · Codex · Cursor · Kimi · Pi · Reasonix");
    expect(site).toContain("支持 Claude · Antigravity · Codex · Cursor · Kimi · Pi · Reasonix");
  });

  it("US-AGENT-047: structured roster gate passes the live canonical source", () => {
    const live = liveAgentRosterGateInput();
    const result = evaluateAgentRosterGate({
      ...live,
      surfaces: [...live.surfaces, { name: "AGENT_REGISTRY_NAMES", agents: AGENT_REGISTRY_NAMES }],
    });
    expect(result).toEqual({ ok: true, gaps: [] });
  });

  it("US-AGENT-047: structured roster gate fails on synthetic removed-agent reflow", () => {
    const result = evaluateAgentRosterGate({
      surfaces: [{ name: "synthetic AGENT_REGISTRY_NAMES", agents: [...CANONICAL_ROSTER, "qwen"] }],
      agentPositions: [{ surface: "fixture", context: "capability.qwen", value: "qwen", kind: "agent" }],
    });
    expect(result.ok).toBe(false);
    expect(result.gaps.join("\n")).toContain("synthetic AGENT_REGISTRY_NAMES roster drift");
    expect(result.gaps.join("\n")).toContain("forbidden agent-position token qwen");
  });

  it("US-AGENT-047: model/provider contexts are allowlisted but agent contexts are not", () => {
    const result = evaluateAgentRosterGate({
      surfaces: liveAgentRosterGateInput().surfaces,
      agentPositions: [
        { surface: "fixture", context: "defaultModel", value: "deepseek", kind: "model" },
        { surface: "fixture", context: "providerAliases", value: "openai", kind: "provider" },
        { surface: "fixture", context: "agent", value: "deepseek", kind: "agent" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.gaps).toEqual(["fixture has forbidden agent-position token deepseek in agent"]);
  });
});
