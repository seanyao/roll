import { describe, expect, it } from "vitest";
import {
  agentDefaultModel,
  agentCanReviewHeadless,
  agentNormalizerKind,
  agentSmokeCommand,
  getAgentSpec,
  withAgentSpecs,
} from "../src/agent/specs.js";

describe("AgentSpec registry — FIX-313", () => {
  it("declares per-agent defaults in one registry", () => {
    expect(getAgentSpec("claude")?.name).toBe("claude");
    expect(agentDefaultModel("claude")).toBe("claude-sonnet-4");
    expect(agentDefaultModel("pi")).toBe("deepseek-v4-pro");
    expect(agentDefaultModel("kimi")).toBe("kimi-k2");
    expect(agentDefaultModel("codex")).toBe("gpt-5.5");
    expect(agentDefaultModel("openai")).toBe("gpt-5.5");
    expect(agentDefaultModel("agy")).toBe("gemini-2.5-pro");
    expect(agentDefaultModel("antigravity")).toBe("gemini-2.5-pro");
    expect(agentDefaultModel("reasonix")).toBe("deepseek-flash");
    expect(agentNormalizerKind("kimi")).toBe("kimi");
    expect(agentNormalizerKind("pi")).toBe("pi");
    expect(agentSmokeCommand("kimi")).toContain("kimi");
  });

  it("FIX-359: kimi smoke uses the real `kimi` binary (not the non-existent `kimi-code`)", () => {
    // The loop spawns `kimi -p` (agent-spawn.ts) but the smoke command was stale
    // (`kimi-code`, which does not exist) — smoke and spawn must use one binary.
    expect(agentSmokeCommand("kimi")).toBe('kimi -p "Reply with a single word: hello"');
    expect(agentSmokeCommand("kimi")).not.toContain("kimi-code");
  });

  it("declares sessionReuse as an agnostic capability — no pool engine resumes (lever-4)", () => {
    // Only codex declares the resume adapter; the rest stay cold by default.
    for (const agent of ["claude", "kimi", "pi", "agy", "reasonix"]) {
      expect(getAgentSpec(agent)?.usage.sessionReuse).toBeUndefined();
    }
    expect(getAgentSpec("codex")?.usage.sessionReuse).toBe("codex-exec-resume");
  });

  it("declares prompt-mode review capability for every supported agent", () => {
    for (const agent of ["claude", "kimi", "codex", "pi", "agy", "reasonix"]) {
      expect(agentCanReviewHeadless(agent)).toBe(true);
    }
  });

  it("US-AGENT-002: declares the complete Reasonix agent spec", () => {
    expect(getAgentSpec("reasonix")).toEqual({
      name: "reasonix",
      displayName: "reasonix",
      defaultModel: "deepseek-flash",
      cliBin: ["reasonix"],
      canReviewHeadless: true,
      normalizer: "generic",
      usage: { stdoutExtractor: "generic" },
      smokeCommand: 'reasonix run --max-steps 1 "Reply with a single word: hello"',
    });
    expect(agentSmokeCommand("reasonix")).toBe('reasonix run --max-steps 1 "Reply with a single word: hello"');
  });

  it("lets downstream support a new agent by registry-only extension", () => {
    const specs = withAgentSpecs([
      {
        name: "fixture-agent",
        providerAliases: ["fixture-provider"],
        displayName: "Fixture Agent",
        defaultModel: "fixture-model-1",
        cliBin: ["fixture-agent"],
        normalizer: "generic",
        canReviewHeadless: true,
        usage: { stdoutExtractor: "generic" },
        smokeCommand: "fixture-agent --smoke",
      },
    ]);

    expect(getAgentSpec("fixture-agent", specs)?.defaultModel).toBe("fixture-model-1");
    expect(getAgentSpec("fixture-provider", specs)?.name).toBe("fixture-agent");
    expect(agentDefaultModel("fixture-agent", specs)).toBe("fixture-model-1");
    expect(agentNormalizerKind("fixture-agent", specs)).toBe("generic");
    expect(agentSmokeCommand("fixture-agent", specs)).toBe("fixture-agent --smoke");
    expect(agentCanReviewHeadless("fixture-agent", specs)).toBe(true);
  });
});
