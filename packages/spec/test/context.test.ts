import { describe, expect, it } from "vitest";
import * as publicSpec from "../src/index.js";
import {
  CONTEXT_PROVIDER_REGISTRY_V1,
  CONTEXT_READ_REQUEST_V1,
  CONTEXT_READ_RESULT_V1,
  contextProviderRegistryV1Schema,
  contextReadRequestV1Schema,
  contextReadResultV1Schema,
  parseContextProviderRegistry,
  parseContextRef,
  parseWorkspaceContexts,
  workspaceContextsV1Schema,
} from "../src/types/context.js";

function registry() {
  return {
    schema: CONTEXT_PROVIDER_REGISTRY_V1,
    enabled: true,
    providers: [{
      id: "bipo-enterprise",
      type: "git_llm_wiki",
      enabled: true,
      remote: "git@GitHub.com:Bipo/company-context.git",
      branch: "main",
      fetch_timeout_seconds: 30,
    }],
  };
}

function contexts() {
  return {
    enabled: true,
    bindings: [{
      providerId: "bipo-enterprise",
      enabled: true,
      required: true,
      entrypoints: ["wiki/index.md"],
    }],
  };
}

describe("Context v1 contracts", () => {
  it("exports the complete closed v1 contract from @roll/spec", () => {
    expect(CONTEXT_PROVIDER_REGISTRY_V1).toBe("roll.context-providers/v1");
    expect(CONTEXT_READ_REQUEST_V1).toBe("roll.context-read-request/v1");
    expect(CONTEXT_READ_RESULT_V1).toBe("roll.context-read-result/v1");
    expect(publicSpec).toMatchObject({
      parseContextProviderRegistry: expect.any(Function),
      parseWorkspaceContexts: expect.any(Function),
      parseContextRef: expect.any(Function),
      contextProviderRegistryV1Schema: expect.any(Object),
      workspaceContextsV1Schema: expect.any(Object),
      contextReadRequestV1Schema: expect.any(Object),
      contextReadResultV1Schema: expect.any(Object),
    });
  });

  it("publishes closed schemas and keeps provider type limited to git_llm_wiki", () => {
    expect(contextProviderRegistryV1Schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        providers: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { type: { const: "git_llm_wiki" } },
          },
        },
      },
    });
    expect(workspaceContextsV1Schema).toMatchObject({ type: "object", additionalProperties: false });
    expect(contextReadRequestV1Schema).toMatchObject({ type: "object", additionalProperties: false });
    expect(contextReadResultV1Schema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("parses a registry and normalizes its credential-free remote identity", () => {
    expect(parseContextProviderRegistry(registry())).toEqual({
      ok: true,
      value: {
        ...registry(),
        providers: [{ ...registry().providers[0], remote: "ssh://github.com/Bipo/company-context" }],
      },
    });
  });

  it.each([
    ["provider type", { ...registry().providers[0], type: "mcp" }, "providers[0].type"],
    ["provider id", { ...registry().providers[0], id: "Bipo_Context" }, "providers[0].id"],
    ["short timeout", { ...registry().providers[0], fetch_timeout_seconds: 4 }, "providers[0].fetch_timeout_seconds"],
    ["long timeout", { ...registry().providers[0], fetch_timeout_seconds: 301 }, "providers[0].fetch_timeout_seconds"],
    ["option branch", { ...registry().providers[0], branch: "--upload-pack=evil" }, "providers[0].branch"],
    ["refspec branch", { ...registry().providers[0], branch: "refs/heads/main:refs/heads/x" }, "providers[0].branch"],
  ])("rejects invalid %s", (_label, provider, path) => {
    const parsed = parseContextProviderRegistry({ ...registry(), providers: [provider] });
    expect(parsed).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ path })]),
    });
  });

  it.each([
    "https://token@example.com/Bipo/company-context.git",
    "http://example.com/Bipo/company-context.git",
    "git://example.com/Bipo/company-context.git",
    "file:///tmp/company-context.git",
    "../company-context.git",
    "ext::sh -c evil",
    "helper::company-context",
  ])("rejects unsupported or credential-bearing provider remotes without echoing them: %s", (remote) => {
    const parsed = parseContextProviderRegistry({
      ...registry(),
      providers: [{ ...registry().providers[0], remote }],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_value", path: "providers[0].remote" }),
    ]));
    expect(JSON.stringify(parsed.errors)).not.toContain(remote);
    expect(JSON.stringify(parsed.errors)).not.toContain("token");
  });

  it("rejects duplicate provider ids without merging configs", () => {
    const parsed = parseContextProviderRegistry({
      ...registry(),
      providers: [registry().providers[0], { ...registry().providers[0], branch: "release" }],
    });
    expect(parsed).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "duplicate_identity", path: "providers[1].id" }),
      ]),
    });
  });

  it("parses Workspace bindings without machine credentials or cache paths", () => {
    expect(parseWorkspaceContexts(contexts())).toEqual({ ok: true, value: contexts() });
    expect(parseWorkspaceContexts({ ...contexts(), credential: "secret" })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "unknown_field", path: "contexts.credential" })]),
    });
    expect(parseWorkspaceContexts({
      ...contexts(),
      bindings: [{ ...contexts().bindings[0], cachePath: "/tmp/cache" }],
    })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "unknown_field", path: "contexts.bindings[0].cachePath" }),
      ]),
    });
  });

  it.each([
    ["required disabled", [{ ...contexts().bindings[0], enabled: false }], "contexts.bindings[0]"],
    ["unsafe entrypoint", [{ ...contexts().bindings[0], entrypoints: ["../wiki/index.md"] }], "contexts.bindings[0].entrypoints[0]"],
    ["hidden entrypoint", [{ ...contexts().bindings[0], entrypoints: ["wiki/.private.md"] }], "contexts.bindings[0].entrypoints[0]"],
    ["reserved root", [{ ...contexts().bindings[0], entrypoints: ["purpose.md"] }], "contexts.bindings[0].entrypoints[0]"],
    ["duplicate binding", [contexts().bindings[0], { ...contexts().bindings[0], required: false }], "contexts.bindings[1].providerId"],
  ])("rejects invalid Context binding: %s", (_label, bindings, path) => {
    expect(parseWorkspaceContexts({ enabled: true, bindings })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "invalid_value", path }),
      ]),
    });
  });

  it("deduplicates normalized entrypoints while preserving first occurrence order", () => {
    expect(parseWorkspaceContexts({
      enabled: true,
      bindings: [{
        ...contexts().bindings[0],
        entrypoints: ["wiki/index.md", "wiki/systems/axis.md", "wiki/index.md"],
      }],
    })).toMatchObject({
      ok: true,
      value: {
        bindings: [{ entrypoints: ["wiki/index.md", "wiki/systems/axis.md"] }],
      },
    });
  });
});

describe("Canonical Context refs", () => {
  it.each([
    ["context://bipo-enterprise/wiki/systems/axis.md", "bipo-enterprise", "wiki/systems/axis.md"],
    ["context://bipo-enterprise/purpose.md", "bipo-enterprise", "purpose.md"],
    ["context://bipo-enterprise/schema.md", "bipo-enterprise", "schema.md"],
  ])("parses %s", (ref, providerId, path) => {
    expect(parseContextRef(ref)).toEqual({ ok: true, value: { ref, providerId, path } });
  });

  it.each([
    "ape-context:wiki/index.md",
    "context://Bipo/wiki/index.md",
    "context://bipo-enterprise/../wiki/index.md",
    "context://bipo-enterprise/wiki//index.md",
    "context://bipo-enterprise/wiki/.private.md",
    "context://bipo-enterprise/.git/config",
    "context://bipo-enterprise/.llm-wiki/state.json",
    "context://bipo-enterprise/.obsidian/config",
    "context://bipo-enterprise/raw/sources/source.md",
    "context://bipo-enterprise/-danger",
  ])("rejects unsafe or non-canonical ref %s", (ref) => {
    expect(parseContextRef(ref)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "invalid_value", path: "ref" })]),
    });
  });
});
