/**
 * US-AGENT-050 — tests for readAgentDisabledFromText / setAgentDisabledInText
 * and scope-resolver disabled-agent exclusion.
 */
import { describe, expect, it } from "vitest";
import {
  readAgentDisabledFromText,
  setAgentDisabledInText,
} from "../src/agent/registry.js";
import { normalizeAgentScopeConfig } from "../src/agent/scope-config.js";
import { resolveAgentScopeRole, type AgentScopeResolveLayer } from "../src/agent/scope-resolver.js";
import type { AgentName, AgentScopeConfig } from "@roll/spec";

// ── readAgentDisabledFromText ──────────────────────────────────────────────

describe("readAgentDisabledFromText", () => {
  it("returns false for empty text", () => {
    expect(readAgentDisabledFromText("", "kimi" as AgentName)).toEqual({ disabled: false });
  });

  it("returns false when agent is not disabled", () => {
    const text = `schema: roll-agents/v1
scope: project
agents:
  kimi:
    adapter: kimi
    capabilities: [build]
`;
    expect(readAgentDisabledFromText(text, "kimi" as AgentName)).toEqual({ disabled: false });
  });

  it("returns true when agent has disabled: true", () => {
    const text = `schema: roll-agents/v1
scope: project
agents:
  kimi:
    adapter: kimi
    capabilities: [build]
    disabled: true
`;
    expect(readAgentDisabledFromText(text, "kimi" as AgentName)).toEqual({ disabled: true });
  });

  it("returns false for a different agent when another is disabled", () => {
    const text = `schema: roll-agents/v1
scope: project
agents:
  kimi:
    adapter: kimi
    capabilities: [build]
    disabled: true
  claude:
    adapter: claude
    capabilities: [review]
`;
    expect(readAgentDisabledFromText(text, "claude" as AgentName)).toEqual({ disabled: false });
  });

  it("returns false when agent is not in the file", () => {
    const text = `schema: roll-agents/v1
scope: project
agents:
  claude:
    adapter: claude
    capabilities: [review]
`;
    expect(readAgentDisabledFromText(text, "kimi" as AgentName)).toEqual({ disabled: false });
  });

  it("handles inline flow form with disabled: true", () => {
    const text = `schema: roll-agents/v1
scope: project
agents:
  kimi: { adapter: kimi, capabilities: [build], disabled: true }
`;
    expect(readAgentDisabledFromText(text, "kimi" as AgentName)).toEqual({ disabled: true });
  });
});

// ── setAgentDisabledInText ─────────────────────────────────────────────────

describe("setAgentDisabledInText", () => {
  it("returns empty text unchanged", () => {
    expect(setAgentDisabledInText("", "kimi" as AgentName, true)).toBe("");
  });

  it("adds disabled: true to an agent block", () => {
    const text = `schema: roll-agents/v1
scope: project
agents:
  kimi:
    adapter: kimi
    capabilities: [build]
`;
    const result = setAgentDisabledInText(text, "kimi" as AgentName, true);
    expect(readAgentDisabledFromText(result, "kimi" as AgentName)).toEqual({ disabled: true });
    // Should still be valid YAML
    const parsed = normalizeAgentScopeConfig(result);
    expect(parsed.config).not.toBeNull();
    expect(parsed.config?.agents["kimi" as AgentName]?.disabled).toBe(true);
  });

  it("removes disabled: true from an agent block", () => {
    const text = `schema: roll-agents/v1
scope: project
agents:
  kimi:
    adapter: kimi
    capabilities: [build]
    disabled: true
`;
    const result = setAgentDisabledInText(text, "kimi" as AgentName, false);
    expect(readAgentDisabledFromText(result, "kimi" as AgentName)).toEqual({ disabled: false });
    const parsed = normalizeAgentScopeConfig(result);
    expect(parsed.config).not.toBeNull();
  });

  it("is idempotent — adding disabled twice is a no-op", () => {
    const text = `schema: roll-agents/v1
scope: project
agents:
  kimi:
    adapter: kimi
    capabilities: [build]
    disabled: true
`;
    const result = setAgentDisabledInText(text, "kimi" as AgentName, true);
    expect(readAgentDisabledFromText(result, "kimi" as AgentName)).toEqual({ disabled: true });
    // Should not duplicate the disabled line
    const disabledCount = result.split("\n").filter((l) => l.trim() === "disabled: true").length;
    expect(disabledCount).toBe(1);
  });

  it("is idempotent — removing disabled when not disabled is a no-op", () => {
    const text = `schema: roll-agents/v1
scope: project
agents:
  kimi:
    adapter: kimi
    capabilities: [build]
`;
    const result = setAgentDisabledInText(text, "kimi" as AgentName, false);
    expect(readAgentDisabledFromText(result, "kimi" as AgentName)).toEqual({ disabled: false });
  });

  it("returns text unchanged when agent is not found", () => {
    const text = `schema: roll-agents/v1
scope: project
agents:
  claude:
    adapter: claude
    capabilities: [review]
`;
    const result = setAgentDisabledInText(text, "kimi" as AgentName, true);
    expect(result).toBe(text);
  });

  it("preserves trailing newline", () => {
    const text = "schema: roll-agents/v1\nscope: project\nagents:\n  kimi:\n    adapter: kimi\n    capabilities: [build]\n";
    const result = setAgentDisabledInText(text, "kimi" as AgentName, true);
    expect(result.endsWith("\n")).toBe(true);
  });

  it("handles multiple agents — only modifies the target", () => {
    const text = `schema: roll-agents/v1
scope: project
agents:
  kimi:
    adapter: kimi
    capabilities: [build]
  claude:
    adapter: claude
    capabilities: [review]
`;
    const result = setAgentDisabledInText(text, "kimi" as AgentName, true);
    expect(readAgentDisabledFromText(result, "kimi" as AgentName)).toEqual({ disabled: true });
    expect(readAgentDisabledFromText(result, "claude" as AgentName)).toEqual({ disabled: false });
  });
});

// ── scope-config.ts — disabled parsing ─────────────────────────────────────

describe("normalizeAgentScopeConfig — disabled parsing", () => {
  it("parses disabled: true from an agent block", () => {
    const text = `schema: roll-agents/v1
scope: project
agents:
  kimi:
    adapter: kimi
    capabilities: [build]
    disabled: true
`;
    const result = normalizeAgentScopeConfig(text);
    expect(result.config).not.toBeNull();
    expect(result.config?.agents["kimi" as AgentName]?.disabled).toBe(true);
  });

  it("defaults disabled to undefined (not disabled) when absent", () => {
    const text = `schema: roll-agents/v1
scope: project
agents:
  kimi:
    adapter: kimi
    capabilities: [build]
`;
    const result = normalizeAgentScopeConfig(text);
    expect(result.config).not.toBeNull();
    expect(result.config?.agents["kimi" as AgentName]?.disabled).toBeUndefined();
  });
});

// ── scope-resolver — disabled exclusion ────────────────────────────────────

describe("resolveAgentScopeRole — disabled agent exclusion", () => {
  function layer(config: AgentScopeConfig, path: string): AgentScopeResolveLayer {
    return { config, path };
  }

  const machineConfig: AgentScopeConfig = {
    schema: "roll-agents/v1",
    scope: "machine",
    agents: {
      kimi: {
        id: "kimi" as AgentName,
        adapter: "kimi" as AgentName,
        capabilities: ["execute" as const],
        disabled: false,
      },
      claude: {
        id: "claude" as AgentName,
        adapter: "claude" as AgentName,
        capabilities: ["execute" as const, "evaluate" as const],
        disabled: false,
      },
      pi: {
        id: "pi" as AgentName,
        adapter: "pi" as AgentName,
        capabilities: ["execute" as const],
        disabled: true,
      },
    },
    models: {},
    roles: {
      execute: {
        kind: "select",
        from: ["kimi" as AgentName, "claude" as AgentName, "pi" as AgentName],
        strategy: "first-available",
      },
    },
    defaults: {},
  };

  const layers = [layer(machineConfig, "~/.roll/agents.yaml")];

  it("skips disabled agents in select pools with reason 'disabled'", () => {
    const result = resolveAgentScopeRole({
      scope: "project",
      role: "execute",
      layers,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    // pi is disabled, so it should be skipped
    const piSkipped = result.resolved.skipped.find((s) => s.agent === "pi");
    expect(piSkipped?.reason).toBe("disabled");
    // The selected agent should be kimi or claude, not pi
    expect(result.resolved.agent).not.toBe("pi");
  });

  it("fails fixed resolution when the fixed agent is disabled", () => {
    const config: AgentScopeConfig = {
      ...machineConfig,
      roles: {
        execute: {
          kind: "fixed",
          agent: "pi" as AgentName,
        },
      },
    };
    const result = resolveAgentScopeRole({
      scope: "machine",
      role: "execute",
      layers: [layer(config, "~/.roll/agents.yaml")],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.failure.errors[0]).toContain("disabled");
  });

  it("select pool works when some but not all agents are disabled", () => {
    const result = resolveAgentScopeRole({
      scope: "project",
      role: "execute",
      layers,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    // pi is disabled, kimi and claude are available
    expect(["kimi", "claude"]).toContain(result.resolved.agent);
  });

  it("select pool fails when ALL agents are disabled (pool empty)", () => {
    const allDisabled: AgentScopeConfig = {
      ...machineConfig,
      agents: {
        kimi: { ...machineConfig.agents["kimi" as AgentName]!, disabled: true },
        claude: { ...machineConfig.agents["claude" as AgentName]!, disabled: true },
        pi: { ...machineConfig.agents["pi" as AgentName]!, disabled: true },
      },
    };
    const result = resolveAgentScopeRole({
      scope: "project",
      role: "execute",
      layers: [layer(allDisabled, "~/.roll/agents.yaml")],
    });
    expect(result.ok).toBe(false);
  });

  it("project-layer disable overrides machine-layer enable", () => {
    const projectConfig: AgentScopeConfig = {
      schema: "roll-agents/v1",
      scope: "project",
      inherits: "machine",
      agents: {
        kimi: {
          id: "kimi" as AgentName,
          adapter: "kimi" as AgentName,
          capabilities: ["execute" as const],
          disabled: true,
        },
      },
      models: {},
      roles: {},
      defaults: {},
    };
    const bothLayers = [
      layer(machineConfig, "~/.roll/agents.yaml"),
      layer(projectConfig, ".roll/agents.yaml"),
    ];
    const result = resolveAgentScopeRole({
      scope: "project",
      role: "execute",
      layers: bothLayers,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    // kimi is disabled in project layer → must be claude
    const kimiSkipped = result.resolved.skipped.find((s) => s.agent === "kimi");
    expect(kimiSkipped?.reason).toBe("disabled");
    expect(result.resolved.agent).toBe("claude");
  });
});
