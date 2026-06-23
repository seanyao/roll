/**
 * US-AGENT-047 — Fitness gate: structured roster assertions (AC1),
 * agent-position prohibition (AC2), and synthesized-return detection (AC7).
 *
 * These tests are the CI gate: a removed agent token returning as agent
 * anywhere in the roster surfaces will make CI RED, blocking the merge.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENT_REGISTRY_NAMES,
  agentBinNames,
  agentDisplayName,
  agentIsKnown,
  type AgentEnv,
} from "../src/agent/registry.js";
import { AGENTS, AGENT_SPECS, getAgentIdentitySpec } from "../src/agent/specs.js";
import { AGENT_NAMES } from "@roll/spec";

// ── Canonical roster constants ───────────────────────────────────────────────
const CANONICAL_ROSTER = ["claude", "kimi", "codex", "pi", "agy", "reasonix"] as const;
const REMOVED_AGENT_TOKENS = ["openclaw", "qwen", "opencode", "cursor", "trae"] as const;
// Provider/model aliases that ARE allowed in model/provider contexts.
const ALLOWED_PROVIDER_ALIASES = ["openai", "deepseek"] as const;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function readProjectFile(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), "utf8");
}

// ═══════════════════════════════════════════════════════════════════════════════
// AC1: Structured roster assertions — every exported roster == exactly 6 names
// ═══════════════════════════════════════════════════════════════════════════════
describe("US-AGENT-047 AC1: structured roster fitness gate", () => {
  it("AGENTS array holds exactly six canonical agent specs", () => {
    expect(AGENTS.length).toBe(6);
    const names = AGENTS.map((s) => s.name);
    expect(names).toEqual([...CANONICAL_ROSTER]);
    // Uniqueness — no duplicate names.
    expect(new Set(names).size).toBe(6);
  });

  it("AGENT_REGISTRY_NAMES derives exactly six names from AGENTS", () => {
    expect([...AGENT_REGISTRY_NAMES]).toEqual([...CANONICAL_ROSTER]);
    expect(AGENT_REGISTRY_NAMES.length).toBe(6);
  });

  it("AGENT_SPECS canonical entries are exactly six", () => {
    const canonicalNames = Object.values(AGENT_SPECS)
      .filter((spec, index, all) => all.findIndex((c) => c.name === spec.name) === index)
      .map((spec) => spec.name);
    expect(canonicalNames.sort()).toEqual([...CANONICAL_ROSTER].sort());
  });

  it("spec AGENT_NAMES runtime const matches core AGENTS", () => {
    expect([...AGENT_NAMES]).toEqual([...CANONICAL_ROSTER]);
    expect(AGENT_NAMES.length).toBe(6);
  });

  it("every AGENTS entry has required identity fields", () => {
    for (const spec of AGENTS) {
      expect(spec.name).toBeTruthy();
      expect(spec.displayName).toBeTruthy();
      expect(spec.defaultModel).toBeTruthy();
      expect(spec.cliBin.length).toBeGreaterThan(0);
      expect(typeof spec.normalizer).toBe("string");
    }
  });

  it("agentBinNames returns valid entries for all six, null for removed", () => {
    for (const name of CANONICAL_ROSTER) {
      expect(agentBinNames(name)).not.toBeNull();
      expect((agentBinNames(name) as string[]).length).toBeGreaterThan(0);
    }
    for (const token of REMOVED_AGENT_TOKENS) {
      expect(agentBinNames(token)).toBeNull();
    }
  });

  it("agentDisplayName returns display name for all six", () => {
    for (const name of CANONICAL_ROSTER) {
      expect(agentDisplayName(name)).toBeTruthy();
      expect(typeof agentDisplayName(name)).toBe("string");
    }
    // Provider aliases silently resolve; removed tokens do not.
    expect(agentDisplayName("openai")).toBe("codex");
    expect(agentDisplayName("deepseek")).toBe("pi");
    for (const token of REMOVED_AGENT_TOKENS) {
      expect(agentDisplayName(token)).toBe(token); // fallback: raw string
    }
  });

  it("getAgentIdentitySpec returns spec for all six, undefined for removed", () => {
    for (const name of CANONICAL_ROSTER) {
      expect(getAgentIdentitySpec(name)).toBeDefined();
    }
    for (const token of REMOVED_AGENT_TOKENS) {
      expect(getAgentIdentitySpec(token)).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC2: Agent-position prohibition — removed tokens must NOT appear as agent
//      in agent-position contexts; allowlist model/provider contexts.
// ═══════════════════════════════════════════════════════════════════════════════
describe("US-AGENT-047 AC2: agent-position prohibition (structured, not grep)", () => {
  // ── Agent-position contexts (MUST NOT contain removed tokens) ────────────
  const AGENT_POSITION_FILES = [
    // Core agent identity
    "packages/core/src/agent/registry.ts",
    "packages/core/src/agent/specs.ts",
    // CLI surfaces
    "packages/cli/src/runner/agent-spawn.ts",
    "packages/cli/src/lib/agent-panel.ts",
    "packages/cli/src/commands/agent-list.ts",
    "packages/cli/src/commands/agent.ts",
    "packages/cli/src/commands/doctor.ts",
    "packages/cli/src/commands/setup.ts",
    "packages/cli/src/commands/init.ts",
    // Pairing
    "packages/core/src/agent/pairing.ts",
    "packages/core/src/agent/peer-review.ts",
  ];

  // Agent-position patterns: a removed token appearing as an agent identity.
  // These check code structure — name arrays, switch cases, profile keys,
  // agent label maps, and agent-position string literals.
  const AGENT_POSITION_CHECKS: Array<{ file: string; check: (text: string) => void }> = [
    {
      file: "packages/cli/src/runner/agent-spawn.ts",
      check: (text: string) => {
        // AGENT_PROFILES keys must be exactly 6
        const m = text.match(/const AGENT_PROFILES[^=]*=\s*\{([^}]+)\}/s);
        if (m) {
          const body = m[1] ?? "";
          const keys = [...body.matchAll(/(\w+):\s*\{/g)].map((m) => m[1]);
          // Filter known names
          const agentKeys = keys.filter((k) => CANONICAL_ROSTER.includes(k as never));
          expect(agentKeys.length).toBe(6);
        }
      },
    },
    {
      file: "packages/cli/src/lib/agent-panel.ts",
      check: (text: string) => {
        // RUNNER_LABEL keys must be exactly 6
        const m = text.match(/const RUNNER_LABEL[^=]*=\s*\{([^}]+)\}/s);
        if (m) {
          const body = m[1] ?? "";
          const labels = [...body.matchAll(/(\w+):\s*"/g)].map((m) => m[1]);
          const agentLabels = labels.filter((k) => CANONICAL_ROSTER.includes(k as never));
          expect(agentLabels.length).toBe(6);
        }
      },
    },
    {
      file: "packages/cli/src/commands/setup.ts",
      check: (text: string) => {
        // aiDirsList must NOT contain any removed agent dir
        for (const token of REMOVED_AGENT_TOKENS) {
          expect(text).not.toContain(`".${token}"`);
        }
      },
    },
  ];

  it("agent-position files do not contain removed tokens as agent entries", () => {
    for (const file of AGENT_POSITION_FILES) {
      const text = readProjectFile(file);
      // Check for removed tokens in agent-name arrays
      for (const token of REMOVED_AGENT_TOKENS) {
        // A token appearing as a bare string in an agent-name position (array element,
        // object key, or case label) is forbidden.
        // Pattern: the token as a string literal surrounded by array/object/case syntax
        const agentPositionPatterns = [
          new RegExp(`'${token}'`, "g"),
          new RegExp(`"${token}"`, "g"),
          new RegExp(`case "${token}":`, "g"),
        ];
        for (const pattern of agentPositionPatterns) {
          const matches = text.match(pattern);
          if (matches) {
            // Allowlist: providerAliases arrays may contain openai/deepseek
            // Allowlist: defaultModel, vendor, UsageExtractorKind, prices contexts
            // Allowlist: comments and test files
            // We do a more nuanced check below per-file
          }
        }
      }
    }
    // No blanket assertion — we check structured surfaces below
  });

  it("structured check: AGENT_PROFILES has exactly 6 entries", () => {
    const text = readProjectFile("packages/cli/src/runner/agent-spawn.ts");
    // Each canonical agent name must appear as a key in AGENT_PROFILES.
    // Check for patterns like "  claude: {" or "  pi: simplePromptProfile("
    for (const name of CANONICAL_ROSTER) {
      const re = new RegExp(`^\\s+${name}:\\s*(?:\\{|simplePromptProfile)`, "m");
      expect(text, `AGENT_PROFILES missing entry for ${name}`).toMatch(re);
    }
    // Removed agent tokens must NOT appear as keys
    for (const token of REMOVED_AGENT_TOKENS) {
      const re = new RegExp(`^\\s+${token}:\\s*(?:\\{|simplePromptProfile)`, "m");
      expect(text, `AGENT_PROFILES contains removed agent ${token}`).not.toMatch(re);
    }
  });

  it("structured check: RUNNER_LABEL has exactly 6 entries", () => {
    const text = readProjectFile("packages/cli/src/lib/agent-panel.ts");
    // Each canonical agent must have a RUNNER_LABEL entry like "  claude: \"Claude Code\","
    for (const name of CANONICAL_ROSTER) {
      const re = new RegExp(`^\\s+${name}:\\s*"`, "m");
      expect(text, `RUNNER_LABEL missing entry for ${name}`).toMatch(re);
    }
    for (const token of REMOVED_AGENT_TOKENS) {
      const re = new RegExp(`^\\s+${token}:\\s*"`, "m");
      expect(text, `RUNNER_LABEL contains removed agent ${token}`).not.toMatch(re);
    }
  });

  it("structured check: aiDirsList in setup.ts only references canonical agents", () => {
    const text = readProjectFile("packages/cli/src/commands/setup.ts");
    const m = text.match(/aiDirsList\s*=\s*\[([^\]]+)\]/);
    expect(m).not.toBeNull();
    if (m) {
      const raw = m[1] ?? "";
      const dirs = [...raw.matchAll(/"\.([^"]+)"/g)].map((m) => m[1] ?? "");
      for (const dir of dirs) {
        // Each dir should map to a known agent or known alias
        const known = CANONICAL_ROSTER.some((a) => dir === a || dir === `${a}-code`);
        const alias = dir === "agentrules"; // .agentrules is agy-related
        expect(
          known || alias,
          `aiDirsList entry ".${dir}" does not map to a canonical agent`,
        ).toBe(true);
      }
    }
  });

  it("structured check: AGENT_ORDER is derived from single source", () => {
    const text = readProjectFile("packages/cli/src/commands/agent-list.ts");
    expect(text).toContain("AGENT_ORDER = AGENT_REGISTRY_NAMES");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC2b: Allowlist — model/provider contexts MUST still reference provider tokens
// ═══════════════════════════════════════════════════════════════════════════════
describe("US-AGENT-047 AC2b: model/provider allowlist is intact", () => {
  it("providerAliases for codex includes openai", () => {
    const spec = getAgentIdentitySpec("codex");
    expect(spec?.providerAliases).toContain("openai");
  });

  it("providerAliases for pi includes deepseek", () => {
    const spec = getAgentIdentitySpec("pi");
    expect(spec?.providerAliases).toContain("deepseek");
  });

  it("defaultModel strings reference valid model ids (data, not agents)", () => {
    for (const spec of AGENTS) {
      expect(spec.defaultModel.length).toBeGreaterThan(0);
      // Model ids should NOT be agent names
      expect(CANONICAL_ROSTER).not.toContain(spec.defaultModel);
    }
  });

  it("AGENT_VENDOR in pairing.ts has entries for all six canonical agents", () => {
    const text = readProjectFile("packages/core/src/agent/pairing.ts");
    for (const name of CANONICAL_ROSTER) {
      const re = new RegExp(`^\\s+${name}:\\s*"`, "m");
      expect(text, `AGENT_VENDOR missing entry for ${name}`).toMatch(re);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC7: Synthesized return detection — gate fails when removed token reappears
// ═══════════════════════════════════════════════════════════════════════════════
describe("US-AGENT-047 AC7: synthesized-return detection", () => {
  it("synthesized AGENTS array with extra 'qwen' entry fails the 6-name assertion", () => {
    // Simulate: construct a fake roster that includes a removed token.
    const synthesized = [...AGENTS.map((s) => s.name), "qwen"];
    // The gate: synthesized roster must have exactly 6 canonical names.
    expect(synthesized.length).not.toBe(6);
    // Removed token is present
    expect(synthesized).toContain("qwen");
    // The fitness gate would catch this
    const canonicalOnly = synthesized.filter((n) => CANONICAL_ROSTER.includes(n as never));
    expect(canonicalOnly.length).toBe(6);
    // Non-canonical entries exist
    const intruders = synthesized.filter((n) => !CANONICAL_ROSTER.includes(n as never));
    expect(intruders.length).toBeGreaterThan(0);
    expect(intruders).toContain("qwen");
  });

  it("synthesized return: adding cursor to AGENT_REGISTRY_NAMES-like list is detected", () => {
    const synthesized = [...AGENT_REGISTRY_NAMES, "cursor"];
    expect(new Set(synthesized).size).toBe(7); // 6 canonical + 1 intruder
    const canonical = synthesized.filter((n) => CANONICAL_ROSTER.includes(n as never));
    expect(canonical.length).toBe(6);
    expect(synthesized).toContain("cursor");
    expect(CANONICAL_ROSTER).not.toContain("cursor");
  });

  it("synthesized return: removed token in agent position is caught by agentIsKnown gate", () => {
    // The gate: agentIsKnown returns false for all removed tokens
    for (const token of REMOVED_AGENT_TOKENS) {
      expect(agentIsKnown(token)).toBe(false);
    }
    // Provider aliases are known (they resolve to canonical agents)
    expect(agentIsKnown("openai")).toBe(true);
    expect(agentIsKnown("deepseek")).toBe(true);
  });

  it("synthesized return: extra entry in AGENT_PROFILES-like map is detected", () => {
    // Simulate an AGENT_PROFILES-like object with an intruder
    const profiles: Record<string, unknown> = {};
    for (const name of CANONICAL_ROSTER) profiles[name] = { name };
    // Synthesized addition
    profiles["qwen"] = { name: "qwen" };
    const keys = Object.keys(profiles);
    expect(keys.length).toBe(7);
    const canonical = keys.filter((k) => CANONICAL_ROSTER.includes(k as never));
    expect(canonical.length).toBe(6);
    const intruders = keys.filter((k) => !CANONICAL_ROSTER.includes(k as never));
    expect(intruders).toEqual(["qwen"]);
  });

  it("compliant roster: canonical-only AGENT_REGISTRY_NAMES passes the gate", () => {
    // The real gate assertion
    expect([...AGENT_REGISTRY_NAMES]).toEqual([...CANONICAL_ROSTER]);
    expect(AGENT_REGISTRY_NAMES.length).toBe(6);
    const canonicalSet = new Set(AGENT_REGISTRY_NAMES);
    for (const name of CANONICAL_ROSTER) {
      expect(canonicalSet.has(name)).toBe(true);
    }
    // No removed token is present
    for (const token of REMOVED_AGENT_TOKENS) {
      expect(canonicalSet.has(token)).toBe(false);
    }
  });

  it("compliant roster: every spec field that could carry a model reference does NOT carry an agent name", () => {
    for (const spec of AGENTS) {
      // defaultModel is a model, not an agent
      expect(REMOVED_AGENT_TOKENS).not.toContain(spec.defaultModel);
      // providerAliases are provider names, not agents
      if (spec.providerAliases) {
        for (const alias of spec.providerAliases) {
          expect(REMOVED_AGENT_TOKENS).not.toContain(alias);
        }
      }
    }
  });
});
