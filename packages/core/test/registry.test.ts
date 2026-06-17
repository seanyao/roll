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
  parseProbeCache,
  probeTtl,
  readSlotFromText,
  renderProbeCache,
  setSlotInText,
  type AgentEnv,
} from "../src/index.js";

describe("identity helpers", () => {
  it("canonicalAgentName collapses antigravity/gemini → agy", () => {
    expect(canonicalAgentName("antigravity")).toBe("agy");
    expect(canonicalAgentName("gemini")).toBe("agy");
    expect(canonicalAgentName("claude")).toBe("claude");
    expect(canonicalAgentName("agy")).toBe("agy");
  });

  it("agentDisplayName parenthesises agy only", () => {
    expect(agentDisplayName("agy")).toBe("antigravity (agy)");
    expect(agentDisplayName("antigravity")).toBe("antigravity (agy)");
    expect(agentDisplayName("claude")).toBe("claude");
  });

  it("agentBinNames mirrors the bash case arms", () => {
    expect(agentBinNames("claude")).toEqual(["claude"]);
    expect(agentBinNames("openai")).toEqual(["codex"]);
    expect(agentBinNames("gemini")).toEqual(["agy", "gemini"]);
    expect(agentBinNames("kimi")).toEqual(["kimi-code", "kimi-cli", "kimi"]);
    expect(agentBinNames("reasonix")).toEqual(["reasonix"]);
    expect(agentBinNames("nope")).toBeNull();
  });

  it("agentIsKnown: deepseek unknown, special-cased GUI agents known", () => {
    expect(agentIsKnown("deepseek")).toBe(false);
    expect(agentIsKnown("trae")).toBe(true);
    expect(agentIsKnown("cursor")).toBe(true);
    expect(agentIsKnown("gemini")).toBe(true); // canonicalises to agy
    expect(agentIsKnown("claude")).toBe(true);
    expect(agentIsKnown("reasonix")).toBe(true);
    expect(agentIsKnown("totally-made-up")).toBe(false);
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
    const env = makeEnv({ commandOnPath: (b) => b === "codex" });
    expect(agentInstalledByName(env, "codex")).toBe(true);
    expect(agentInstalledByName(env, "openai")).toBe(true);
    expect(agentInstalledByName(env, "claude")).toBe(false);
  });

  it("trae checks Application Support / .config", () => {
    const env = makeEnv({ dirExists: (p) => p === "/home/u/.config/Trae" });
    expect(agentInstalledByName(env, "trae")).toBe(true);
  });

  it("opencode checks an executable file", () => {
    const env = makeEnv({ fileExecutable: (p) => p === "/home/u/.opencode/bin/opencode" });
    expect(agentInstalledByName(env, "opencode")).toBe(true);
  });

  it("cursor accepts CLI OR ~/.cursor dir", () => {
    expect(agentInstalledByName(makeEnv({ commandOnPath: (b) => b === "cursor" }), "cursor")).toBe(true);
    expect(agentInstalledByName(makeEnv({ dirExists: (p) => p === "/home/u/.cursor" }), "cursor")).toBe(true);
    expect(agentInstalledByName(makeEnv(), "cursor")).toBe(false);
  });

  it("unknown agent falls back to a dir hint", () => {
    const env = makeEnv({ dirExists: (p) => p === "/some/where" });
    expect(agentInstalledByName(env, "weird", "/some/where")).toBe(true);
    expect(agentInstalledByName(env, "weird")).toBe(false);
  });

  it("agentsInstalled keeps registry order; firstInstalled uses its own order", () => {
    // pi + codex installed: agentsInstalled order is codex before pi.
    const env = makeEnv({ commandOnPath: (b) => b === "pi" || b === "codex" });
    expect(agentsInstalled(env)).toEqual(["codex", "pi"]);
    expect(firstInstalledAgent(env)).toBe("codex");
  });

  it("firstInstalled scans deepseek (which agentsInstalled excludes)", () => {
    const env = makeEnv({ commandOnPath: (b) => b === "deepseek" });
    expect(agentsInstalled(env)).toEqual([]);
    expect(firstInstalledAgent(env)).toBe("deepseek");
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

  it("canonicalises before probing", () => {
    const seen: string[] = [];
    agentAvailable("gemini", { now: () => 1, probe: (n) => (seen.push(n), true) });
    expect(seen).toEqual(["agy"]);
  });
});

describe("slot config read", () => {
  it("lineAgentValue token boundary", () => {
    expect(lineAgentValue("agent: kimi")).toBe(" kimi");
    expect(lineAgentValue("easy: { agent: kimi }")).toBe(" kimi }");
    expect(lineAgentValue("no_agent: kimi")).toBeUndefined();
    expect(lineAgentValue("sub_agent: kimi")).toBeUndefined();
  });

  it("reads inline flow form", () => {
    const txt = "schema: v3\neasy: { agent: kimi }\ndefault: { agent: claude }\n";
    expect(readSlotFromText(txt, "easy")).toBe("kimi");
    expect(readSlotFromText(txt, "default")).toBe("claude");
    expect(readSlotFromText(txt, "hard")).toBeUndefined();
  });

  it("reads nested form, ends block at next top-level key", () => {
    const txt = "easy:\n  agent: qwen\nhard:\n  agent: claude\n";
    expect(readSlotFromText(txt, "easy")).toBe("qwen");
    expect(readSlotFromText(txt, "hard")).toBe("claude");
  });

  it("strips comments / quotes", () => {
    expect(readSlotFromText('easy: { agent: "kimi" } # comment\n', "easy")).toBe("kimi");
  });
});

describe("slot config write", () => {
  it("seeds a fresh file", () => {
    expect(setSlotInText("", "easy", "kimi")).toBe("schema: v3\neasy: { agent: kimi }\n");
  });

  it("rewrites an existing inline slot, preserving others + comments", () => {
    const txt = "schema: v3\n# keep me\neasy: { agent: kimi }\ndefault: { agent: claude }\n";
    const out = setSlotInText(txt, "easy", "qwen");
    expect(out).toBe("schema: v3\n# keep me\neasy: { agent: qwen }\ndefault: { agent: claude }\n");
  });

  it("rewrites a nested slot to inline form, dropping the old agent line", () => {
    const txt = "easy:\n  agent: kimi\nhard:\n  agent: claude\n";
    const out = setSlotInText(txt, "easy", "qwen");
    expect(out).toBe("easy: { agent: qwen }\nhard:\n  agent: claude\n");
  });

  it("appends an absent slot", () => {
    const txt = "schema: v3\neasy: { agent: kimi }\n";
    expect(setSlotInText(txt, "hard", "claude")).toBe(
      "schema: v3\neasy: { agent: kimi }\nhard: { agent: claude }\n",
    );
  });

  it("round-trips through the registry FileStore", () => {
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
    reg.setSlot(".roll/agents.yaml", "default", "claude");
    expect(reg.readSlot(".roll/agents.yaml", "default")).toBe("claude");
    reg.setSlot(".roll/agents.yaml", "default", "kimi");
    expect(reg.readSlot(".roll/agents.yaml", "default")).toBe("kimi");
  });
});
