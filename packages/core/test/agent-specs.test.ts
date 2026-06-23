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
    // The pool is kimi/pi/reasonix. claude is NOT a pool member (no spec entry):
    // its harness machinery lives elsewhere, so getAgentSpec("claude") is absent
    // and the default-model lookup falls back to the bare name.
    expect(getAgentSpec("claude")).toBeUndefined();
    expect(agentDefaultModel("claude")).toBe("claude");
    expect(agentDefaultModel("pi")).toBe("deepseek-v4-pro");
    expect(agentDefaultModel("kimi")).toBe("kimi-k2");
    expect(agentDefaultModel("reasonix")).toBe("deepseek-flash");
    expect(agentNormalizerKind("kimi")).toBe("generic");
    expect(agentSmokeCommand("kimi")).toContain("kimi");
  });

  it("FIX-359: kimi smoke uses the real `kimi` binary (not the non-existent `kimi-code`)", () => {
    // The loop spawns `kimi -p` (agent-spawn.ts) but the smoke command was stale
    // (`kimi-code`, which does not exist) — smoke and spawn must use one binary.
    expect(agentSmokeCommand("kimi")).toBe('kimi -p "Reply with a single word: hello"');
    expect(agentSmokeCommand("kimi")).not.toContain("kimi-code");
  });

  it("declares sessionReuse as an agnostic capability — no pool engine resumes (lever-4)", () => {
    // After the pool was narrowed to 国产/开源 agents (kimi/pi/reasonix), NO engine
    // declares a warm-reuse kind: the field is absent on every spec (the adapter
    // treats absent as cold, so reuse is never accidentally widened).
    for (const agent of ["kimi", "pi", "reasonix"]) {
      expect(getAgentSpec(agent)?.usage.sessionReuse).toBeUndefined();
    }
  });

  it("declares headless-review capability only for agents the runner can spawn", () => {
    // The pool is kimi/pi/reasonix — all headless-review capable.
    for (const agent of ["kimi", "pi", "reasonix"]) {
      expect(agentCanReviewHeadless(agent)).toBe(true);
    }
    // claude is NOT a pool member (no spec) → canReviewHeadless is false.
    for (const agent of ["claude"]) {
      expect(agentCanReviewHeadless(agent)).toBe(false);
    }
  });

  it("US-AGENT-002: declares the complete Reasonix agent spec", () => {
    expect(getAgentSpec("reasonix")).toEqual({
      name: "reasonix",
      displayName: "reasonix",
      defaultModel: "deepseek-flash",
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
        displayName: "Fixture Agent",
        defaultModel: "fixture-model-1",
        normalizer: "generic",
        canReviewHeadless: true,
        usage: { stdoutExtractor: "generic" },
        smokeCommand: "fixture-agent --smoke",
      },
    ]);

    expect(getAgentSpec("fixture-agent", specs)?.defaultModel).toBe("fixture-model-1");
    expect(agentDefaultModel("fixture-agent", specs)).toBe("fixture-model-1");
    expect(agentNormalizerKind("fixture-agent", specs)).toBe("generic");
    expect(agentSmokeCommand("fixture-agent", specs)).toBe("fixture-agent --smoke");
    expect(agentCanReviewHeadless("fixture-agent", specs)).toBe(true);
  });
});
