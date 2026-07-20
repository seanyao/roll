import { describe, expect, it } from "vitest";
import {
  resolveWorkspaceTarget,
  type WorkspaceRegistryCandidate,
  type WorkspaceTargetInput,
  type WorkspaceTargetSelector,
} from "../src/workspace/target.js";

const registry: readonly WorkspaceRegistryCandidate[] = [
  {
    workspaceId: "ws-alpha",
    root: "/workspaces/alpha",
    canonicalRoot: "/real/workspaces/alpha",
    manifestWorkspaceId: "ws-alpha",
    pathState: "valid",
    lifecycle: "active",
  },
  {
    workspaceId: "ws-beta",
    root: "/workspaces/beta",
    canonicalRoot: "/real/workspaces/beta",
    manifestWorkspaceId: "ws-beta",
    pathState: "valid",
    lifecycle: "active",
  },
];

function id(workspaceId: string): WorkspaceTargetSelector {
  return { kind: "id", workspaceId };
}

function path(absolutePath: string, canonicalPath: string = absolutePath): WorkspaceTargetSelector {
  return { kind: "path", absolutePath, canonicalPath };
}

function input(overrides: Partial<WorkspaceTargetInput> = {}): WorkspaceTargetInput {
  return {
    operation: "read",
    registry,
    ...overrides,
  };
}

describe("resolveWorkspaceTarget precedence and registry identity", () => {
  it.each([
    {
      name: "explicit id",
      value: input({
        explicit: id("ws-alpha"),
        environment: id("ws-alpha"),
        context: {
          cwdManifest: {
            workspaceId: "ws-alpha",
            root: "/workspaces/alpha",
            canonicalRoot: "/real/workspaces/alpha",
            containment: "safe",
          },
        },
      }),
      source: "explicit",
    },
    {
      name: "environment id",
      value: input({ environment: id("ws-beta") }),
      source: "environment",
    },
    {
      name: "cwd manifest",
      value: input({
        context: {
          cwdManifest: {
            workspaceId: "ws-alpha",
            root: "/workspaces/alpha",
            canonicalRoot: "/real/workspaces/alpha",
            containment: "safe",
          },
        },
      }),
      source: "cwd_manifest",
    },
    {
      name: "Issue manifest reverse lookup",
      value: input({
        context: {
          issueManifest: {
            workspaceId: "ws-beta",
            root: "/workspaces/beta",
            canonicalRoot: "/real/workspaces/beta",
            containment: "safe",
          },
        },
      }),
      source: "issue_manifest",
    },
  ])("resolves the $name source without selecting an active default", ({ value, source }) => {
    expect(resolveWorkspaceTarget(value)).toEqual({
      ok: true,
      source,
      target: {
        kind: "workspace",
        workspaceId: source === "environment" || source === "issue_manifest" ? "ws-beta" : "ws-alpha",
        root: source === "environment" || source === "issue_manifest" ? "/workspaces/beta" : "/workspaces/alpha",
        canonicalRoot: source === "environment" || source === "issue_manifest" ? "/real/workspaces/beta" : "/real/workspaces/alpha",
      },
    });
  });

  it("resolves registered absolute and canonical paths while preserving workspaceId", () => {
    expect(resolveWorkspaceTarget(input({ explicit: path("/workspaces/alpha", "/real/workspaces/alpha") }))).toMatchObject({
      ok: true,
      target: { kind: "workspace", workspaceId: "ws-alpha" },
    });
    expect(resolveWorkspaceTarget(input({ explicit: path("/real/workspaces/beta") }))).toMatchObject({
      ok: true,
      target: { kind: "workspace", workspaceId: "ws-beta" },
    });
  });

  it("represents --all as a stable read-only aggregate and rejects mutation", () => {
    expect(resolveWorkspaceTarget(input({ all: true }))).toEqual({
      ok: true,
      source: "all",
      target: {
        kind: "all",
        workspaces: [
          { workspaceId: "ws-alpha", root: "/workspaces/alpha", canonicalRoot: "/real/workspaces/alpha", lifecycle: "active" },
          { workspaceId: "ws-beta", root: "/workspaces/beta", canonicalRoot: "/real/workspaces/beta", lifecycle: "active" },
        ],
      },
    });

    expect(resolveWorkspaceTarget(input({ all: true, operation: "mutation" }))).toMatchObject({
      ok: false,
      error: { code: "all_requires_readonly" },
    });
  });
});
