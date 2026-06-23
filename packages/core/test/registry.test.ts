/**
 * Unit tests for AgentRegistry pure helpers + injected-port behaviour.
 * (Identity / installed / probe-cache / slot read+write byte shapes.)
 */
import { describe, expect, it } from "vitest";
import {
  AgentRegistry,
  agentAvailable,
  agentBinNames,
  agentDisplayName,
  agentInstalledByName,
  agentIsKnown,
  agentsInstalled,
  canonicalAgentName,
  firstInstalledAgent,
  lineAgentValue,
  lineModelValue,
  parseProbeCache,
  probeTtl,
  readSlotFromText,
  renderProbeCache,
  setSlotInText,
  type AgentEnv,
} from "../src/index.js";

describe("identity helpers", () => {
  it("canonicalAgentName is a no-op (overseas aliases removed from the pool)", () => {
    expect(canonicalAgentName("kimi")).toBe("kimi");
    expect(canonicalAgentName("pi")).toBe("pi");
    expect(canonicalAgentName("reasonix")).toBe("reasonix");
  });

  it("agentDisplayName returns the bare canonical token", () => {
    expect(agentDisplayName("kimi")).toBe("kimi");
    expect(agentDisplayName("pi")).toBe("pi");
    expect(agentDisplayName("reasonix")).toBe("reasonix");
  });

  it("agentBinNames mirrors the pool (kimi/pi/reasonix); deepseek→pi alias (US-AGENT-045)", () => {
    expect(agentBinNames("kimi")).toEqual(["kimi-code", "kimi-cli", "kimi"]);
    expect(agentBinNames("pi")).toEqual(["pi"]);
    expect(agentBinNames("reasonix")).toEqual(["reasonix"]);
    // US-AGENT-045 AC1: deepseek is now a provider alias → pi (silently resolves).
    expect(agentBinNames("deepseek")).toEqual(["pi"]);
    expect(agentBinNames("nope")).toBeNull();
  });

  it("agentIsKnown: deepseek/openai known via provider aliases (US-AGENT-045), removed tokens still unknown", () => {
    expect(agentIsKnown("deepseek")).toBe(true);
    expect(agentIsKnown("openai")).toBe(true);
    expect(agentIsKnown("kimi")).toBe(true);
    expect(agentIsKnown("pi")).toBe(true);
    expect(agentIsKnown("reasonix")).toBe(true);
    expect(agentIsKnown("totally-made-up")).toBe(false);
    // Removed agents (US-AGENT-043) are NOT known.
    expect(agentIsKnown("cursor")).toBe(false);
    expect(agentIsKnown("qwen")).toBe(false);
    expect(agentIsKnown("opencode")).toBe(false);
  });
});

function makeEnv(over: Partial<AgentEnv> = {}): AgentEnv {
  return {
    home: "/home/u",
    commandOnPath: () => false,
    dirExists: () => false,
    fileExecutable: () => false,
    ...over,
  };
}

describe("installed detection", () => {
  it("binary-name agents key on PATH", () => {
    const env = makeEnv({ commandOnPath: (b) => b === "pi" });
    expect(agentInstalledByName(env, "pi")).toBe(true);
    expect(agentInstalledByName(env, "kimi")).toBe(false);
    expect(agentInstalledByName(env, "reasonix")).toBe(false);
  });

  it("kimi matches any of its candidate binaries", () => {
    expect(agentInstalledByName(makeEnv({ commandOnPath: (b) => b === "kimi-code" }), "kimi")).toBe(true);
    expect(agentInstalledByName(makeEnv({ commandOnPath: (b) => b === "kimi" }), "kimi")).toBe(true);
    expect(agentInstalledByName(makeEnv(), "kimi")).toBe(false);
  });

  it("unknown agent falls back to a dir hint", () => {
    const env = makeEnv({ dirExists: (p) => p === "/some/where" });
    expect(agentInstalledByName(env, "weird", "/some/where")).toBe(true);
    expect(agentInstalledByName(env, "weird")).toBe(false);
  });

  it("agentsInstalled keeps registry order; firstInstalled uses its own order", () => {
    // kimi + pi + reasonix installed: agentsInstalled follows AGENT_REGISTRY_NAMES
    // order (kimi, pi, reasonix). firstInstalled scans FIRST_INSTALLED_ORDER and
    // returns the first match (kimi).
    const env = makeEnv({ commandOnPath: (b) => b === "pi" || b === "reasonix" || b === "kimi" });
    expect(agentsInstalled(env)).toEqual(["kimi", "pi", "reasonix"]);
    expect(firstInstalledAgent(env)).toBe("kimi");
  });

  it("firstInstalled never resolves to deepseek (FIX-399: a model, not an agent)", () => {
    // Only the `deepseek` binary present: it is NOT a routable agent, so both the
    // installed list and the fallback scan come back empty rather than naming a
    // phantom agent.
    const env = makeEnv({ commandOnPath: (b) => b === "deepseek" });
    expect(agentsInstalled(env)).toEqual([]);
    expect(firstInstalledAgent(env)).toBeUndefined();
  });
});

describe("probe TTL + cache parse/render", () => {
  it("probeTtl honors numeric override, else default", () => {
    expect(probeTtl(undefined)).toBe(1800);
    expect(probeTtl("")).toBe(1800);
    expect(probeTtl("abc")).toBe(1800);
    expect(probeTtl("60")).toBe(60);
  });

  it("parse/render round-trip", () => {
    const body = renderProbeCache({ checkedAt: 100, status: "online" });
    expect(body).toBe("checked_at=100\nstatus=online\n");
    expect(parseProbeCache(body)).toEqual({ checkedAt: 100, status: "online" });
  });

  it("parse rejects bad/missing fields", () => {
    expect(parseProbeCache("status=online\n")).toBeUndefined();
    expect(parseProbeCache("checked_at=x\nstatus=online\n")).toBeUndefined();
    expect(parseProbeCache("checked_at=10\n")).toBeUndefined();
  });
});

describe("agentAvailable cache/probe decision", () => {
  const deps = (online: boolean, at = 1000) => ({ now: () => at, probe: () => online });

  it("fresh cache hit is trusted (no probe, no write)", () => {
    const r = agentAvailable("claude", { now: () => 1000, probe: () => true }, {
      cacheBody: "checked_at=900\nstatus=offline\n",
      ttl: 1800,
    });
    expect(r).toEqual({ status: "offline", online: false });
  });

  it("expired cache re-probes and emits a write", () => {
    const r = agentAvailable("claude", deps(true, 5000), {
      cacheBody: "checked_at=900\nstatus=offline\n",
      ttl: 1800,
    });
    expect(r.status).toBe("online");
    expect(r.cacheWrite).toEqual({ checkedAt: 5000, status: "online" });
  });

  it("noCache forces a re-probe even within TTL", () => {
    const r = agentAvailable("claude", deps(false, 1000), {
      cacheBody: "checked_at=999\nstatus=online\n",
      ttl: 1800,
      noCache: true,
    });
    expect(r.status).toBe("offline");
    expect(r.cacheWrite).toEqual({ checkedAt: 1000, status: "offline" });
  });

  it("probes the (canonical) name verbatim — no overseas alias collapse remains", () => {
    const seen: string[] = [];
    agentAvailable("kimi", { now: () => 1, probe: (n) => (seen.push(n), true) });
    expect(seen).toEqual(["kimi"]);
  });
});

describe("slot config read", () => {
  it("lineAgentValue token boundary", () => {
    expect(lineAgentValue("agent: kimi")).toBe(" kimi");
    expect(lineAgentValue("easy: { agent: kimi }")).toBe(" kimi }");
    expect(lineAgentValue("no_agent: kimi")).toBeUndefined();
    expect(lineAgentValue("sub_agent: kimi")).toBeUndefined();
  });

  it("lineModelValue token boundary (model may itself carry a `:thinking` suffix)", () => {
    expect(lineModelValue("model: bailian/glm-5.2")).toBe(" bailian/glm-5.2");
    expect(lineModelValue("default: { agent: pi, model: deepseek/deepseek-v4-pro:high }")).toBe(
      " deepseek/deepseek-v4-pro:high }",
    );
    expect(lineModelValue("agent: pi")).toBeUndefined();
    expect(lineModelValue("sub_model: x")).toBeUndefined();
  });

  it("reads inline flow form as { agent } (back-compat: no model)", () => {
    const txt = "schema: v3\neasy: { agent: kimi }\ndefault: { agent: pi }\n";
    expect(readSlotFromText(txt, "easy")).toEqual({ agent: "kimi" });
    expect(readSlotFromText(txt, "default")).toEqual({ agent: "pi" });
    expect(readSlotFromText(txt, "hard")).toBeUndefined();
  });

  it("US-AGENT-045 AC1: reads provider aliases as canonical agents", () => {
    const txt =
      "schema: v3\n" +
      "easy: { agent: openai }\n" +
      "default: { agent: deepseek, model: deepseek/deepseek-v4-pro:high }\n";
    expect(readSlotFromText(txt, "easy")).toEqual({ agent: "codex" });
    expect(readSlotFromText(txt, "default")).toEqual({
      agent: "pi",
      model: "deepseek/deepseek-v4-pro:high",
    });
  });

  it("reads inline flow form WITH a model (effort folded into the model string)", () => {
    const txt =
      "schema: v3\n" +
      "default: { agent: pi, model: deepseek/deepseek-v4-pro:high }\n" +
      "hard: { agent: pi, model: bailian/glm-5.2 }\n";
    expect(readSlotFromText(txt, "default")).toEqual({
      agent: "pi",
      model: "deepseek/deepseek-v4-pro:high",
    });
    expect(readSlotFromText(txt, "hard")).toEqual({ agent: "pi", model: "bailian/glm-5.2" });
  });

  it("reads nested form (agent + model on separate indented lines)", () => {
    const txt = "easy:\n  agent: kimi\nhard:\n  agent: pi\n  model: bailian/glm-5.2\n";
    expect(readSlotFromText(txt, "easy")).toEqual({ agent: "kimi" });
    expect(readSlotFromText(txt, "hard")).toEqual({ agent: "pi", model: "bailian/glm-5.2" });
  });

  it("strips comments / quotes (agent + model)", () => {
    expect(readSlotFromText('easy: { agent: "kimi" } # comment\n', "easy")).toEqual({ agent: "kimi" });
    expect(readSlotFromText('hard: { agent: "pi", model: "bailian/glm-5.2" }\n', "hard")).toEqual({
      agent: "pi",
      model: "bailian/glm-5.2",
    });
  });
});

describe("slot config write", () => {
  it("seeds a fresh file", () => {
    expect(setSlotInText("", "easy", "kimi")).toBe("schema: v3\neasy: { agent: kimi }\n");
  });

  it("seeds a fresh file WITH a model (effort folded into the model string)", () => {
    expect(setSlotInText("", "hard", "pi", "bailian/glm-5.2")).toBe(
      "schema: v3\nhard: { agent: pi, model: bailian/glm-5.2 }\n",
    );
    expect(setSlotInText("", "default", "pi", "deepseek/deepseek-v4-pro:high")).toBe(
      "schema: v3\ndefault: { agent: pi, model: deepseek/deepseek-v4-pro:high }\n",
    );
  });

  it("rewrites an existing inline slot, preserving others + comments", () => {
    const txt = "schema: v3\n# keep me\neasy: { agent: kimi }\ndefault: { agent: pi }\n";
    const out = setSlotInText(txt, "easy", "reasonix");
    expect(out).toBe("schema: v3\n# keep me\neasy: { agent: reasonix }\ndefault: { agent: pi }\n");
  });

  it("rewrites a slot to add a model (and drops it again when omitted)", () => {
    const withModel = setSlotInText("schema: v3\nhard: { agent: pi }\n", "hard", "pi", "bailian/glm-5.2");
    expect(withModel).toBe("schema: v3\nhard: { agent: pi, model: bailian/glm-5.2 }\n");
    // Re-set WITHOUT a model → the canonical inline form drops the model again.
    expect(setSlotInText(withModel, "hard", "pi")).toBe("schema: v3\nhard: { agent: pi }\n");
  });

  it("rewrites a nested slot to inline form, dropping old agent + model lines", () => {
    const txt = "easy:\n  agent: kimi\nhard:\n  agent: pi\n  model: old/model:low\n";
    const out = setSlotInText(txt, "hard", "pi", "bailian/glm-5.2");
    expect(out).toBe("easy:\n  agent: kimi\nhard: { agent: pi, model: bailian/glm-5.2 }\n");
  });

  it("appends an absent slot", () => {
    const txt = "schema: v3\neasy: { agent: kimi }\n";
    expect(setSlotInText(txt, "hard", "reasonix")).toBe(
      "schema: v3\neasy: { agent: kimi }\nhard: { agent: reasonix }\n",
    );
  });

  it("round-trips through the registry FileStore ({ agent } and { agent, model })", () => {
    const files = new Map<string, string>();
    const fs = {
      readText: (p: string) => {
        const v = files.get(p);
        if (v === undefined) throw new Error("ENOENT");
        return v;
      },
      writeFileAtomic: (p: string, d: string) => void files.set(p, d),
    };
    const reg = new AgentRegistry(makeEnv(), fs);
    // back-compat: agent-only.
    reg.setSlot(".roll/agents.yaml", "default", "kimi");
    expect(reg.readSlot(".roll/agents.yaml", "default")).toEqual({ agent: "kimi" });
    // with a model (effort suffix preserved end-to-end).
    reg.setSlot(".roll/agents.yaml", "hard", "pi", "deepseek/deepseek-v4-pro:high");
    expect(reg.readSlot(".roll/agents.yaml", "hard")).toEqual({
      agent: "pi",
      model: "deepseek/deepseek-v4-pro:high",
    });
    // overwrite hard back to model-less.
    reg.setSlot(".roll/agents.yaml", "hard", "pi");
    expect(reg.readSlot(".roll/agents.yaml", "hard")).toEqual({ agent: "pi" });
  });
});
