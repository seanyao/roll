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
    expect(agentDefaultModel("claude")).toBe("claude-sonnet-4");
    expect(getAgentSpec("claude")?.usage.sessionBackfill).toBe("claude-projects");
    expect(agentDefaultModel("pi")).toBe("deepseek-v4-pro");
    expect(agentNormalizerKind("codex")).toBe("codex");
    expect(agentSmokeCommand("kimi")).toContain("kimi");
  });

  it("FIX-359: kimi smoke uses the real `kimi` binary (not the non-existent `kimi-code`)", () => {
    // The loop spawns `kimi -p` (agent-spawn.ts) but the smoke command was stale
    // (`kimi-code`, which does not exist) — smoke and spawn must use one binary.
    expect(agentSmokeCommand("kimi")).toBe('kimi -p "Reply with a single word: hello"');
    expect(agentSmokeCommand("kimi")).not.toContain("kimi-code");
  });

  it("declares sessionReuse as an agnostic capability — only codex resumes (lever-4)", () => {
    // codex is the ONLY engine with warm-context (exec resume).
    expect(getAgentSpec("codex")?.usage.sessionReuse).toBe("codex-exec-resume");
    // openai is a codex alias — same capability resolves through it.
    expect(getAgentSpec("openai")?.usage.sessionReuse).toBe("codex-exec-resume");
    // EVERY other engine is a cold no-op: the field is absent (not 'none' — the
    // adapter treats absent as cold, so we never accidentally widen reuse).
    for (const agent of ["claude", "kimi", "qwen", "agy", "pi", "cursor", "opencode", "trae", "openclaw"]) {
      expect(getAgentSpec(agent)?.usage.sessionReuse).toBeUndefined();
    }
  });

  it("declares headless-review capability only for agents the runner can spawn", () => {
    for (const agent of ["claude", "codex", "openai", "kimi", "qwen", "pi"]) {
      expect(agentCanReviewHeadless(agent)).toBe(true);
    }
    // FIX-360: agy (antigravity/gemini) is NOT a headless reviewer — its headless
    // review triggers an interactive Google OAuth popup, so it is excluded from
    // every reviewer pool (it stays in the registry for manual use only).
    for (const agent of ["cursor", "trae", "opencode", "openclaw", "agy", "gemini", "antigravity"]) {
      expect(agentCanReviewHeadless(agent)).toBe(false);
    }
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
