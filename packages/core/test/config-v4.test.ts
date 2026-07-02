/**
 * US-V4-003 — pure normalizer for `.roll/agents.yaml` (v3 + v4).
 * Covers: valid v4, v3 compatibility, unknown rig refs, malformed role bindings,
 * customized-route preservation, default fallbacks, and the route-slot ≠ Rig-type
 * invariant.
 */
import { describe, expect, it } from "vitest";
import { normalizeAgentConfig, parseBlockYaml } from "../src/agent/config-v4.js";

const V4 = `schema: v4

rigs:
  codex-default:
    agent: codex
    model: gpt-5-codex
  kimi-strong:
    agent: kimi
  reasonix-eval:
    agent: reasonix

routing:
  easy: codex-default
  default: codex-default
  hard: kimi-strong
  fallback: codex-default

execution_profiles:
  standard:
    roles:
      builder: { routing: default }
  verified:
    roles:
      builder: { routing: default }
      evaluator: { rig: reasonix-eval }
  designed:
    roles:
      designer: { rig: kimi-strong }
      builder: { routing: default }
      evaluator: { rig: reasonix-eval }

execution_policy:
  mode: auto
  default_profile: standard

supervisor:
  enabled: false
  mode: observe
  max_parallel_cycles: 1
  budget_per_day: null
`;

describe("normalizeAgentConfig — valid v4", () => {
  it("parses rigs, routing, execution profiles, policy, and supervisor", () => {
    const { config, errors } = normalizeAgentConfig(V4);
    expect(errors).toEqual([]);
    expect(config.schema).toBe("v4");
    // rigs: agent × optional model (kimi-strong omits its model).
    expect(config.rigs["codex-default"]).toEqual({ agent: "codex", model: "gpt-5-codex" });
    expect(config.rigs["kimi-strong"]).toEqual({ agent: "kimi" });
    // routing: each slot resolves to its rig + records the ref.
    expect(config.routing.easy).toEqual({ rig: { agent: "codex", model: "gpt-5-codex" }, ref: "codex-default" });
    expect(config.routing.hard).toEqual({ rig: { agent: "kimi" }, ref: "kimi-strong" });
    // execution profiles: role bindings.
    expect(config.executionProfiles.verified.roles.evaluator).toEqual({ kind: "rig", rig: "reasonix-eval" });
    expect(config.executionProfiles.verified.roles.builder).toEqual({ kind: "routing", route: "default" });
    expect(config.executionProfiles.designed.roles.designer).toEqual({ kind: "rig", rig: "kimi-strong" });
    expect(config.executionPolicy).toEqual({ mode: "auto", defaultProfile: "standard" });
    expect(config.supervisor).toEqual({ enabled: false, mode: "observe", maxParallelCycles: 1, budgetPerDay: null });
  });

  it("route slots resolve to rigs but never appear as rig/agent identities", () => {
    const { config } = normalizeAgentConfig(V4);
    // rigs are keyed by NAME (agent×model), never by slot name.
    expect(Object.keys(config.rigs).sort()).toEqual(["codex-default", "kimi-strong", "reasonix-eval"]);
    for (const rig of Object.values(config.rigs)) {
      expect(["easy", "default", "hard", "fallback"]).not.toContain(rig.agent);
    }
  });
});

describe("normalizeAgentConfig — v3 compatibility", () => {
  const V3 = `schema: v3
easy: { agent: codex }
default: { agent: codex, model: gpt-5 }
hard: { agent: kimi }
fallback: { agent: codex }
`;
  it("loads v3 inline slots into the same normalized shape", () => {
    const { config, errors } = normalizeAgentConfig(V3);
    expect(errors).toEqual([]);
    expect(config.schema).toBe("v3");
    expect(config.routing.easy).toEqual({ rig: { agent: "codex" } });
    expect(config.routing.default).toEqual({ rig: { agent: "codex", model: "gpt-5" } });
    expect(config.routing.hard).toEqual({ rig: { agent: "kimi" } });
    // missing execution_profiles → standard only.
    expect(Object.keys(config.executionProfiles)).toEqual(["standard"]);
    expect(config.executionProfiles.standard.roles.builder).toEqual({ kind: "routing", route: "default" });
    // missing supervisor → disabled; policy defaults to standard (no regression).
    expect(config.supervisor.enabled).toBe(false);
    expect(config.executionPolicy.mode).toBe("standard");
  });

  it("canonicalizes provider aliases (deepseek → pi)", () => {
    const { config, errors } = normalizeAgentConfig("schema: v3\ndefault: { agent: deepseek }\n");
    expect(errors).toEqual([]);
    expect(config.routing.default?.rig.agent).toBe("pi");
  });

  it("preserves customized v3 routes exactly (no slot is overwritten by a default)", () => {
    const { config } = normalizeAgentConfig("schema: v3\neasy: { agent: kimi }\nhard: { agent: codex, model: gpt-5 }\n");
    expect(config.routing.easy).toEqual({ rig: { agent: "kimi" } });
    expect(config.routing.hard).toEqual({ rig: { agent: "codex", model: "gpt-5" } });
    expect(config.routing.default).toBeUndefined(); // unset stays unset
  });
});

describe("normalizeAgentConfig — fail-loud signals", () => {
  it("reports an unknown rig ref and omits that slot", () => {
    const text = `schema: v4
rigs:
  codex-default: { agent: codex }
routing:
  default: codex-default
  hard: ghost-rig
`;
    const { config, errors } = normalizeAgentConfig(text);
    expect(config.routing.default).toEqual({ rig: { agent: "codex" }, ref: "codex-default" });
    expect(config.routing.hard).toBeUndefined();
    expect(errors.some((e) => e.includes("unknown rig ref 'ghost-rig'"))).toBe(true);
  });

  it("reports an unknown agent in a rig definition", () => {
    const { errors } = normalizeAgentConfig("schema: v4\nrigs:\n  bad: { agent: qwen }\n");
    expect(errors.some((e) => e.includes("unknown agent 'qwen'"))).toBe(true);
  });

  it("reports a malformed role binding", () => {
    const text = `schema: v4
rigs:
  r1: { agent: codex }
execution_profiles:
  verified:
    roles:
      builder: { routing: default }
      evaluator: { bogus: true }
`;
    const { errors } = normalizeAgentConfig(text);
    expect(errors.some((e) => e.includes("malformed role binding"))).toBe(true);
  });

  it("reports an unknown route slot inside a role binding", () => {
    const text = `schema: v4
execution_profiles:
  designed:
    roles:
      builder: { routing: turbo }
`;
    const { errors } = normalizeAgentConfig(text);
    expect(errors.some((e) => e.includes("unknown route slot 'turbo'"))).toBe(true);
  });

  it("rejects legacy planned/planner execution-profile keys instead of aliasing them", () => {
    const text = `schema: v4
execution_profiles:
  planned:
    roles:
      planner: { rig: kimi-strong }
      builder: { routing: default }
execution_policy:
  mode: planned
  default_profile: planned
`;
    const { config, errors } = normalizeAgentConfig(text);
    expect(config.executionProfiles.designed).toBeUndefined();
    expect(config.executionPolicy).toEqual({ mode: "standard", defaultProfile: "standard" });
    expect(errors).toContain("execution_profiles.planned: legacy profile key removed; use execution_profiles.designed");
    expect(errors).toContain("execution_profiles.planned.roles.planner: legacy role key removed; use roles.designer");
    expect(errors).toContain("execution_policy.mode: legacy value 'planned' removed; use 'designed'");
    expect(errors).toContain("execution_policy.default_profile: legacy value 'planned' removed; use 'designed'");
  });
});

describe("normalizeAgentConfig — defaults", () => {
  it("an empty/absent file yields sane defaults (v3, standard-only, supervisor off)", () => {
    const { config, errors } = normalizeAgentConfig("");
    expect(errors).toEqual([]);
    expect(config.schema).toBe("v3");
    expect(config.rigs).toEqual({});
    expect(config.routing).toEqual({});
    expect(Object.keys(config.executionProfiles)).toEqual(["standard"]);
    expect(config.supervisor.enabled).toBe(false);
    expect(config.executionPolicy).toEqual({ mode: "standard", defaultProfile: "standard" });
  });

  it("supervisor block enables observe/advise with bounded parallelism", () => {
    const { config } = normalizeAgentConfig(
      "schema: v4\nsupervisor:\n  enabled: true\n  mode: advise\n  max_parallel_cycles: 3\n  budget_per_day: 50\n",
    );
    expect(config.supervisor).toEqual({ enabled: true, mode: "advise", maxParallelCycles: 3, budgetPerDay: 50 });
  });
});

describe("parseBlockYaml", () => {
  it("parses nested maps, inline flow maps, scalars, and null", () => {
    const y = parseBlockYaml("a:\n  b: { x: 1, y: hi }\nc: null\nd: true\n");
    expect(y["a"]).toEqual({ b: { x: 1, y: "hi" } });
    expect(y["c"]).toBeNull();
    expect(y["d"]).toBe(true);
  });

  it("strips comments outside flow maps but keeps model ids with colons", () => {
    const y = parseBlockYaml("# header\ndefault: { agent: pi, model: deepseek-v4-pro:high }  # routed\n");
    expect(y["default"]).toEqual({ agent: "pi", model: "deepseek-v4-pro:high" });
  });
});
