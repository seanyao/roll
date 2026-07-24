import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  CONTEXT_PROVIDER_REGISTRY_V1,
  type ContextProviderRegistryV1,
  type WorkspaceContextsV1,
} from "@roll/spec";
import { compileContextProviderExecutionPlans } from "../src/context/execution-plan.js";

function provider(id = "bipo-enterprise") {
  return {
    id,
    type: "git_llm_wiki" as const,
    enabled: true,
    remote: `https://github.com/Bipo/${id}`,
    branch: "main",
    fetch_timeout_seconds: 30,
  };
}

function registry(overrides: Partial<ContextProviderRegistryV1> = {}): ContextProviderRegistryV1 {
  return {
    schema: CONTEXT_PROVIDER_REGISTRY_V1,
    enabled: true,
    providers: [provider()],
    ...overrides,
  };
}

function contexts(overrides: Partial<WorkspaceContextsV1> = {}): WorkspaceContextsV1 {
  return {
    enabled: true,
    bindings: [{
      providerId: "bipo-enterprise",
      enabled: true,
      required: true,
      entrypoints: ["wiki/index.md"],
    }],
    ...overrides,
  };
}

describe("compileContextProviderExecutionPlans", () => {
  it("is synchronous and stays inside the pure core boundary", () => {
    const source = readFileSync(new URL("../src/context/execution-plan.ts", import.meta.url), "utf8");
    expect([...source.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1])).toEqual([
      "node:crypto",
      "@roll/spec",
    ]);
    expect(source).not.toMatch(/(?:node:fs|node:child_process|node:http|node:https|node:net|process\.cwd|\bfetch\s*\(|\bimport\s*\()/u);
    const result = compileContextProviderExecutionPlans({ registry: registry(), contexts: contexts(), refs: [] });
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("blocks invalid and unbound refs synchronously without touching global network effects", () => {
    const fetchCanary = vi.fn(() => {
      throw new Error("network effect must remain unreachable");
    });
    vi.stubGlobal("fetch", fetchCanary);
    try {
      const invalid = compileContextProviderExecutionPlans({
        registry: registry(),
        contexts: contexts(),
        refs: ["not-a-context-ref"],
      });
      const unbound = compileContextProviderExecutionPlans({
        registry: registry(),
        contexts: contexts(),
        refs: ["context://other/wiki/index.md"],
      });
      expect(invalid).toMatchObject({ outcome: "blocked", plans: [] });
      expect(unbound).toMatchObject({ outcome: "blocked", plans: [] });
      expect(invalid).not.toBeInstanceOf(Promise);
      expect(unbound).not.toBeInstanceOf(Promise);
      expect(fetchCanary).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ["missing registry", undefined, contexts()],
    ["registry disabled", registry({ enabled: false }), contexts()],
    ["missing Workspace contexts", registry(), undefined],
    ["Workspace contexts disabled", registry(), contexts({ enabled: false })],
    ["all bindings disabled", registry(), contexts({ bindings: [{ ...contexts().bindings[0]!, enabled: false, required: false }] })],
  ])("returns an explicit disabled plan for %s", (_label, providerRegistry, workspaceContexts) => {
    expect(compileContextProviderExecutionPlans({
      registry: providerRegistry,
      contexts: workspaceContexts,
      refs: [],
    })).toEqual({
      outcome: "disabled",
      plans: [],
      diagnostics: [expect.objectContaining({ code: "context_disabled", severity: "warning" })],
    });
  });

  it("lets the explicit global disabled state dominate malformed dormant bindings and refs", () => {
    expect(compileContextProviderExecutionPlans({
      registry: registry({ enabled: false }),
      contexts: contexts({
        bindings: [{ ...contexts().bindings[0]!, enabled: false, required: true }],
      }),
      refs: ["not-a-context-ref"],
    })).toEqual({
      outcome: "disabled",
      plans: [],
      diagnostics: [expect.objectContaining({ code: "context_disabled" })],
    });
  });

  it("blocks a required missing Provider and degrades an optional missing Provider without a plan", () => {
    const required = compileContextProviderExecutionPlans({ registry: registry({ providers: [] }), contexts: contexts(), refs: [] });
    expect(required).toMatchObject({
      outcome: "blocked",
      plans: [],
      diagnostics: [expect.objectContaining({ code: "provider_not_found", severity: "blocking", providerId: "bipo-enterprise" })],
    });

    const optional = compileContextProviderExecutionPlans({
      registry: registry({ providers: [] }),
      contexts: contexts({ bindings: [{ ...contexts().bindings[0]!, required: false }] }),
      refs: [],
    });
    expect(optional).toMatchObject({
      outcome: "ready",
      plans: [],
      diagnostics: [expect.objectContaining({ code: "provider_not_found", severity: "gap" })],
    });
  });

  it("blocks a required disabled Provider and skips an optional disabled Provider", () => {
    const disabledRegistry = registry({ providers: [{ ...provider(), enabled: false }] });
    expect(compileContextProviderExecutionPlans({ registry: disabledRegistry, contexts: contexts(), refs: [] })).toMatchObject({
      outcome: "blocked",
      plans: [],
      diagnostics: [expect.objectContaining({ code: "provider_disabled", severity: "blocking" })],
    });
    expect(compileContextProviderExecutionPlans({
      registry: disabledRegistry,
      contexts: contexts({ bindings: [{ ...contexts().bindings[0]!, required: false }] }),
      refs: [],
    })).toMatchObject({
      outcome: "ready",
      plans: [],
      diagnostics: [expect.objectContaining({ code: "provider_disabled", severity: "gap" })],
    });
  });

  it("blocks invalid and unbound explicit refs before producing any executable plan", () => {
    expect(compileContextProviderExecutionPlans({
      registry: registry(),
      contexts: contexts(),
      refs: ["context://other/wiki/index.md"],
    })).toMatchObject({
      outcome: "blocked",
      plans: [],
      diagnostics: [expect.objectContaining({ code: "provider_not_bound", severity: "blocking" })],
    });
    expect(compileContextProviderExecutionPlans({
      registry: registry(),
      contexts: contexts(),
      refs: ["context://bipo-enterprise/../wiki/index.md"],
    })).toMatchObject({
      outcome: "blocked",
      plans: [],
      diagnostics: [expect.objectContaining({ code: "invalid_context_ref", severity: "blocking" })],
    });
  });

  it("treats an explicit ref to a disabled binding as not bound", () => {
    expect(compileContextProviderExecutionPlans({
      registry: registry(),
      contexts: contexts({ bindings: [{ ...contexts().bindings[0]!, enabled: false, required: false }] }),
      refs: ["context://bipo-enterprise/wiki/systems/axis.md"],
    })).toMatchObject({
      outcome: "blocked",
      plans: [],
      diagnostics: [expect.objectContaining({ code: "provider_not_bound", severity: "blocking" })],
    });
  });

  it("defensively blocks duplicate or contradictory bindings instead of merging them", () => {
    const duplicate = contexts({
      bindings: [contexts().bindings[0]!, { ...contexts().bindings[0]!, required: false }],
    });
    expect(compileContextProviderExecutionPlans({ registry: registry(), contexts: duplicate, refs: [] })).toMatchObject({
      outcome: "blocked",
      plans: [],
      diagnostics: [expect.objectContaining({ code: "invalid_context_binding", severity: "blocking" })],
    });
    const contradictory = contexts({
      bindings: [{ ...contexts().bindings[0]!, enabled: false, required: true }],
    });
    expect(compileContextProviderExecutionPlans({ registry: registry(), contexts: contradictory, refs: [] })).toMatchObject({
      outcome: "blocked",
      plans: [],
      diagnostics: [expect.objectContaining({ code: "invalid_context_binding", severity: "blocking" })],
    });
    const unsafeEntrypoint = contexts({
      bindings: [{ ...contexts().bindings[0]!, entrypoints: ["../wiki/index.md"] }],
    });
    expect(compileContextProviderExecutionPlans({ registry: registry(), contexts: unsafeEntrypoint, refs: [] })).toMatchObject({
      outcome: "blocked",
      plans: [],
      diagnostics: [expect.objectContaining({ code: "invalid_context_binding", severity: "blocking" })],
    });
  });

  it("builds one plan per Provider in binding order with reserved and requested paths stably deduplicated", () => {
    const second = provider("platform-handbook");
    const result = compileContextProviderExecutionPlans({
      registry: registry({ providers: [second, provider()] }),
      contexts: contexts({
        bindings: [
          {
            ...contexts().bindings[0]!,
            entrypoints: ["wiki/index.md", "wiki/systems/axis.md", "wiki/index.md"],
          },
          {
            providerId: "platform-handbook",
            enabled: true,
            required: false,
            entrypoints: ["wiki/index.md"],
          },
        ],
      }),
      refs: [
        "context://bipo-enterprise/wiki/systems/axis.md",
        "context://platform-handbook/wiki/workflows/release.md",
        "context://bipo-enterprise/wiki/data-surfaces/reporting.md",
        "context://bipo-enterprise/wiki/systems/axis.md",
      ],
    });
    expect(result).toMatchObject({ outcome: "ready", diagnostics: [] });
    expect(result.plans.map((plan) => plan.provider.id)).toEqual(["bipo-enterprise", "platform-handbook"]);
    expect(result.plans[0]?.paths).toEqual([
      "purpose.md",
      "schema.md",
      "wiki/index.md",
      "wiki/systems/axis.md",
      "wiki/data-surfaces/reporting.md",
    ]);
    expect(result.plans[1]?.paths).toEqual([
      "purpose.md",
      "schema.md",
      "wiki/index.md",
      "wiki/workflows/release.md",
    ]);
  });

  it("pins lowercase SHA-256 digests to canonical provider and binding content", () => {
    const first = compileContextProviderExecutionPlans({ registry: registry(), contexts: contexts(), refs: [] });
    const same = compileContextProviderExecutionPlans({
      registry: structuredClone(registry()),
      contexts: structuredClone(contexts()),
      refs: [],
    });
    expect(first).toEqual(same);
    expect(first.plans).toHaveLength(1);
    expect(first.plans[0]?.providerConfigDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.plans[0]?.bindingDigest).toMatch(/^[0-9a-f]{64}$/u);

    const changedProvider = compileContextProviderExecutionPlans({
      registry: registry({ providers: [{ ...provider(), branch: "release" }] }),
      contexts: contexts(),
      refs: [],
    });
    const changedBinding = compileContextProviderExecutionPlans({
      registry: registry(),
      contexts: contexts({ bindings: [{ ...contexts().bindings[0]!, required: false }] }),
      refs: [],
    });
    expect(changedProvider.plans[0]?.providerConfigDigest).not.toBe(first.plans[0]?.providerConfigDigest);
    expect(changedBinding.plans[0]?.bindingDigest).not.toBe(first.plans[0]?.bindingDigest);
  });

  it("normalizes equivalent Provider remotes before planning and digesting", () => {
    const https = compileContextProviderExecutionPlans({ registry: registry(), contexts: contexts(), refs: [] });
    const scp = compileContextProviderExecutionPlans({
      registry: registry({ providers: [{ ...provider(), remote: "git@GitHub.com:Bipo/bipo-enterprise.git" }] }),
      contexts: contexts(),
      refs: [],
    });
    const ssh = compileContextProviderExecutionPlans({
      registry: registry({ providers: [{ ...provider(), remote: "ssh://deploy@github.com:22/Bipo/bipo-enterprise" }] }),
      contexts: contexts(),
      refs: [],
    });
    expect(scp.plans[0]?.provider.remote).toBe("ssh://github.com/Bipo/bipo-enterprise");
    expect(ssh.plans[0]?.providerConfigDigest).toBe(scp.plans[0]?.providerConfigDigest);
    expect(https.plans[0]?.providerConfigDigest).not.toBe(scp.plans[0]?.providerConfigDigest);
  });

  it("canonicalizes digests independently of environment, time, key order and requested refs without mutating inputs", () => {
    const providerInput = provider();
    const registryInput = registry({ providers: [providerInput] });
    const bindingInput = {
      providerId: "bipo-enterprise",
      enabled: true,
      required: true,
      entrypoints: ["wiki/index.md", "wiki/systems/axis.md", "wiki/index.md"],
    } as const;
    const contextsInput = contexts({ bindings: [bindingInput] });
    const before = structuredClone({ registryInput, contextsInput });
    const oldWorkspace = process.env["ROLL_WORKSPACE"];
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      process.env["ROLL_WORKSPACE"] = "one";
      const first = compileContextProviderExecutionPlans({
        registry: registryInput,
        contexts: contextsInput,
        refs: ["context://bipo-enterprise/wiki/workflows/release.md"],
      });
      vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
      process.env["ROLL_WORKSPACE"] = "two";
      const reorderedProvider = {
        fetch_timeout_seconds: providerInput.fetch_timeout_seconds,
        branch: providerInput.branch,
        remote: providerInput.remote,
        enabled: providerInput.enabled,
        type: providerInput.type,
        id: providerInput.id,
      };
      const second = compileContextProviderExecutionPlans({
        registry: registry({ providers: [reorderedProvider] }),
        contexts: contexts({
          bindings: [{ ...bindingInput, entrypoints: ["wiki/index.md", "wiki/systems/axis.md"] }],
        }),
        refs: [],
      });
      expect(second.plans[0]?.providerConfigDigest).toBe(first.plans[0]?.providerConfigDigest);
      expect(second.plans[0]?.bindingDigest).toBe(first.plans[0]?.bindingDigest);
      expect({ registryInput, contextsInput }).toEqual(before);
    } finally {
      vi.useRealTimers();
      if (oldWorkspace === undefined) delete process.env["ROLL_WORKSPACE"];
      else process.env["ROLL_WORKSPACE"] = oldWorkspace;
    }
  });

  it("changes only the digest owned by changed Provider or binding content", () => {
    const base = compileContextProviderExecutionPlans({ registry: registry(), contexts: contexts(), refs: [] }).plans[0]!;
    for (const changed of [
      { ...provider(), fetch_timeout_seconds: 60 },
      { ...provider(), remote: "https://github.com/Bipo/other-context" },
      { ...provider(), branch: "release" },
    ]) {
      const plan = compileContextProviderExecutionPlans({
        registry: registry({ providers: [changed] }),
        contexts: contexts(),
        refs: [],
      }).plans[0]!;
      expect(plan.providerConfigDigest).not.toBe(base.providerConfigDigest);
      expect(plan.bindingDigest).toBe(base.bindingDigest);
    }
    for (const changed of [
      { ...contexts().bindings[0]!, required: false },
      { ...contexts().bindings[0]!, entrypoints: ["wiki/overview.md"] },
      { ...contexts().bindings[0]!, entrypoints: ["wiki/overview.md", "wiki/index.md"] },
    ]) {
      const plan = compileContextProviderExecutionPlans({
        registry: registry(),
        contexts: contexts({ bindings: [changed] }),
        refs: [],
      }).plans[0]!;
      expect(plan.providerConfigDigest).toBe(base.providerConfigDigest);
      expect(plan.bindingDigest).not.toBe(base.bindingDigest);
    }

    const ordered = compileContextProviderExecutionPlans({
      registry: registry(),
      contexts: contexts({
        bindings: [{ ...contexts().bindings[0]!, entrypoints: ["wiki/index.md", "wiki/overview.md"] }],
      }),
      refs: [],
    }).plans[0]!;
    const reordered = compileContextProviderExecutionPlans({
      registry: registry(),
      contexts: contexts({
        bindings: [{ ...contexts().bindings[0]!, entrypoints: ["wiki/overview.md", "wiki/index.md"] }],
      }),
      refs: [],
    }).plans[0]!;
    expect(reordered.providerConfigDigest).toBe(ordered.providerConfigDigest);
    expect(reordered.bindingDigest).not.toBe(ordered.bindingDigest);
  });
});
