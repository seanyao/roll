import { describe, expect, it } from "vitest";
import {
  AGENT_SCOPE_ROLES,
  AGENT_SCOPE_SCHEMA,
  type AgentScopeConfigParse,
  type AgentScopeResolvedRole,
  type AgentScopeRoleBinding,
} from "../src/index.js";
import { AGENT_NAMES, isAgentName, rig } from "../src/types/agent.js";

describe("US-AGENT-047 Rig", () => {
  it("declares the supported agent names as the Rig agent universe", () => {
    expect([...AGENT_NAMES]).toEqual(["claude", "kimi", "codex", "pi", "agy", "reasonix", "cursor"]);
    expect(isAgentName("pi")).toBe(true);
    expect(isAgentName("deepseek")).toBe(false);
  });

  it("keeps deepseek legal as a model string, not as a Rig agent", () => {
    expect(rig("pi", "deepseek-v4-pro")).toEqual({ agent: "pi", model: "deepseek-v4-pro" });
    expect(() => rig("deepseek", "deepseek-v4-pro")).toThrow("invalid agent for Rig: deepseek");
  });
});

describe("US-V4-015 Agent Scope contracts", () => {
  it("exports roll-agents/v1 contracts through the public spec entrypoint", () => {
    const binding: AgentScopeRoleBinding = { kind: "fixed", agent: "codex", model: "gpt-5.5" };
    const resolved: AgentScopeResolvedRole = {
      scope: "project",
      role: "execute",
      agent: "codex",
      model: "gpt-5.5",
      binding,
      source: ".roll/agents.yaml:roles.execute",
      selectedStrategy: "fixed",
      candidates: ["codex"],
      skipped: [],
      trace: [{ source: ".roll/agents.yaml:roles.execute", bindingKind: "fixed", action: "resolve" }],
    };
    const parsed: AgentScopeConfigParse = {
      config: {
        schema: AGENT_SCOPE_SCHEMA,
        scope: "project",
        agents: {},
        models: {},
        roles: { execute: binding },
        defaults: {},
      },
      errors: [],
    };

    expect(AGENT_SCOPE_ROLES).toEqual(["supervise", "design", "execute", "evaluate"]);
    expect(parsed.config?.roles.execute).toEqual(binding);
    expect(resolved).toEqual({
      scope: "project",
      role: "execute",
      agent: "codex",
      model: "gpt-5.5",
      binding,
      source: ".roll/agents.yaml:roles.execute",
      selectedStrategy: "fixed",
      candidates: ["codex"],
      skipped: [],
      trace: [{ source: ".roll/agents.yaml:roles.execute", bindingKind: "fixed", action: "resolve" }],
    });
  });
});
