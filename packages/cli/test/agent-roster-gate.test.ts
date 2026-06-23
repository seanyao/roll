import { describe, expect, it } from "vitest";
import { evaluateAgentRosterGate } from "../../core/src/agent/roster-gate.js";
import { AGENT_ORDER } from "../src/commands/agent-list.js";
import { agentRunnerLabelNames } from "../src/lib/agent-panel.js";
import { agentProfileNames } from "../src/runner/agent-spawn.js";

describe("US-AGENT-047 CLI roster surfaces", () => {
  it("keeps CLI order, spawn profiles, and runner labels on the six-agent roster", () => {
    const result = evaluateAgentRosterGate({
      surfaces: [
        { name: "AGENT_ORDER", agents: AGENT_ORDER },
        { name: "AGENT_PROFILES", agents: agentProfileNames() },
        { name: "RUNNER_LABEL", agents: agentRunnerLabelNames() },
      ],
      agentPositions: [
        ...AGENT_ORDER.map((value) => ({ surface: "agent-list", context: "AGENT_ORDER", value, kind: "agent" as const })),
        ...agentProfileNames().map((value) => ({ surface: "agent-spawn", context: "AGENT_PROFILES", value, kind: "agent" as const })),
        ...agentRunnerLabelNames().map((value) => ({ surface: "agent-panel", context: "RUNNER_LABEL", value, kind: "agent" as const })),
      ],
    });
    expect(result).toEqual({ ok: true, gaps: [] });
  });
});
