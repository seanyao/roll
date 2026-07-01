/**
 * US-AGENT-045 AC6 — config migration & compatibility tests.
 *
 * Covers:
 *   AC1: alias silent migration (openai→codex, deepseek→pi)
 *   AC2: removed agent fail-loud detection (cursor/trae/qwen/opencode/openclaw)
 *   AC3: agentIsKnown filtering for doctor/setup
 */

import { describe, expect, it } from "vitest";
import {
  agentIsKnown,
  agentDisplayName,
  agentBinNames,
  canonicalAgentName,
  isRemovedAgentName,
  REMOVED_AGENTS,
  AGENT_REGISTRY_NAMES,
  getAgentIdentitySpec,
} from "../src/index.js";

// ── AC1: alias silent migration ──────────────────────────────────────────────

describe("US-AGENT-045 AC1: alias silent migration", () => {
  it("openai is a provider alias → codex (known, display, bins)", () => {
    expect(agentIsKnown("openai")).toBe(true);
    expect(agentDisplayName("openai")).toBe("codex");
    expect(canonicalAgentName("openai")).toBe("codex");
    expect(agentBinNames("openai")).toEqual(["codex"]);
    expect(getAgentIdentitySpec("openai")?.name).toBe("codex");
  });

  it("deepseek is a provider alias → pi (known, display, bins)", () => {
    expect(agentIsKnown("deepseek")).toBe(true);
    expect(agentDisplayName("deepseek")).toBe("pi");
    expect(canonicalAgentName("deepseek")).toBe("pi");
    expect(agentBinNames("deepseek")).toEqual(["pi"]);
    expect(getAgentIdentitySpec("deepseek")?.name).toBe("pi");
  });

  it("alias resolution is case-insensitive", () => {
    expect(canonicalAgentName("OpenAI")).toBe("codex");
    expect(canonicalAgentName("DEEPSEEK")).toBe("pi");
    expect(agentIsKnown("OpenAI")).toBe(true);
    expect(agentIsKnown("DEEPSEEK")).toBe(true);
  });

  it("aliased agents do NOT appear in the registry roster (only the canonical 6 do)", () => {
    expect(AGENT_REGISTRY_NAMES).not.toContain("openai");
    expect(AGENT_REGISTRY_NAMES).not.toContain("deepseek");
    expect(AGENT_REGISTRY_NAMES).toContain("codex");
    expect(AGENT_REGISTRY_NAMES).toContain("pi");
  });
});

// ── AC2: removed agent fail-loud detection ───────────────────────────────────

describe("US-AGENT-045 AC2: removed agent fail-loud detection", () => {
  const ALL_REMOVED = ["trae", "qwen", "opencode", "openclaw"];

  it("REMOVED_AGENTS list matches the agreed set", () => {
    expect([...REMOVED_AGENTS].sort()).toEqual([...ALL_REMOVED].sort());
  });

  it("every removed agent is detected by isRemovedAgentName", () => {
    for (const token of ALL_REMOVED) {
      expect(isRemovedAgentName(token)).toBe(true);
      // Case-insensitive check
      expect(isRemovedAgentName(token.toUpperCase())).toBe(true);
    }
  });

  it("removed agents are NOT known (not in roster, no bins, no spec)", () => {
    for (const token of ALL_REMOVED) {
      expect(agentIsKnown(token)).toBe(false);
      expect(AGENT_REGISTRY_NAMES).not.toContain(token);
      expect(agentBinNames(token)).toBeNull();
      expect(getAgentIdentitySpec(token)).toBeUndefined();
    }
  });

  it("provider aliases (openai, deepseek) are NOT detected as removed", () => {
    expect(isRemovedAgentName("openai")).toBe(false);
    expect(isRemovedAgentName("deepseek")).toBe(false);
  });

  it("canonical agent names are NOT detected as removed", () => {
    for (const name of AGENT_REGISTRY_NAMES) {
      expect(isRemovedAgentName(name)).toBe(false);
    }
  });

  it("unknown names (foobar, random) are NOT detected as removed", () => {
    expect(isRemovedAgentName("foobar")).toBe(false);
    expect(isRemovedAgentName("random-agent")).toBe(false);
  });
});

// ── AC3: agentIsKnown filtering guarantees ───────────────────────────────────

describe("US-AGENT-045 AC3: agentIsKnown as the single filter for display", () => {
  it("all 6 canonical agents pass agentIsKnown", () => {
    for (const name of AGENT_REGISTRY_NAMES) {
      expect(agentIsKnown(name)).toBe(true);
    }
  });

  it("provider aliases pass agentIsKnown (silent migration)", () => {
    expect(agentIsKnown("openai")).toBe(true);
    expect(agentIsKnown("deepseek")).toBe(true);
  });

  it("removed agents do NOT pass agentIsKnown", () => {
    for (const token of REMOVED_AGENTS) {
      expect(agentIsKnown(token)).toBe(false);
    }
  });

  it("garbage names do NOT pass agentIsKnown", () => {
    expect(agentIsKnown("")).toBe(false);
    expect(agentIsKnown("nope")).toBe(false);
    expect(agentIsKnown("unknown_cli")).toBe(false);
  });
});
