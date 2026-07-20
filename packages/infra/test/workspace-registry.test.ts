import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  WORKSPACE_REGISTRY_V1,
  WorkspaceRegistry,
  WorkspaceRegistryError,
  parseWorkspaceRegistry,
  serializeWorkspaceRegistry,
  workspaceEventsPath,
  workspaceRegistryPath,
} from "../src/workspace-registry.js";

const homes: string[] = [];

afterEach(() => {
  homes.length = 0;
});

function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), "roll-workspace-registry-"));
  homes.push(root);
  return root;
}

function workspace(root: string, workspaceId: string): string {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "workspace.yaml"), `${JSON.stringify({ workspaceId })}\n`, "utf8");
  return root;
}

describe("Workspace registry v1 persistence", () => {
  it("uses a closed schema and deterministic serialization", () => {
    const snapshot = {
      schema: WORKSPACE_REGISTRY_V1,
      revision: 2,
      entries: [
        { workspaceId: "ws-z", root: "/z", canonicalRoot: "/z", pathState: "valid" as const },
        { workspaceId: "ws-alpha", root: "/alpha", canonicalRoot: "/alpha", pathState: "stale" as const },
      ],
    };
    const text = serializeWorkspaceRegistry(snapshot);
    expect(text).toBe([
      "{",
      '  "schema": "roll.workspace-registry/v1",',
      '  "revision": 2,',
      '  "entries": [',
      "    {",
      '      "workspaceId": "ws-alpha",',
      '      "root": "/alpha",',
      '      "canonicalRoot": "/alpha",',
      '      "pathState": "stale"',
      "    },",
      "    {",
      '      "workspaceId": "ws-z",',
      '      "root": "/z",',
      '      "canonicalRoot": "/z",',
      '      "pathState": "valid"',
      "    }",
      "  ]",
      "}",
      "",
    ].join("\n"));
    expect(parseWorkspaceRegistry(text)).toEqual({
      ...snapshot,
      entries: [snapshot.entries[1], snapshot.entries[0]],
    });
    expect(() => parseWorkspaceRegistry(JSON.stringify({ ...snapshot, activeWorkspaceId: "ws-z" })))
      .toThrowError(WorkspaceRegistryError);
  });

  it("atomically registers and idempotently upserts by immutable Workspace ID", () => {
    const rollHome = sandbox();
    const alpha = workspace(join(rollHome, "roots", "alpha"), "ws-alpha");
    const store = new WorkspaceRegistry({ rollHome, now: () => 100 });

    expect(store.register({ workspaceId: "ws-alpha", root: alpha })).toMatchObject({
      workspaceId: "ws-alpha",
      root: alpha,
      pathState: "valid",
    });
    expect(store.register({ workspaceId: "ws-alpha", root: alpha })).toMatchObject({ workspaceId: "ws-alpha" });

    const snapshot = parseWorkspaceRegistry(readFileSync(workspaceRegistryPath(rollHome), "utf8"));
    expect(snapshot.revision).toBe(1);
    expect(snapshot.entries).toHaveLength(1);
    expect(readFileSync(workspaceEventsPath(rollHome), "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("refuses manifest identity mismatch and a live canonical path collision without losing rows", () => {
    const rollHome = sandbox();
    const shared = workspace(join(rollHome, "roots", "shared"), "ws-alpha");
    const mismatch = workspace(join(rollHome, "roots", "mismatch"), "ws-other");
    const store = new WorkspaceRegistry({ rollHome, now: () => 100 });
    store.register({ workspaceId: "ws-alpha", root: shared });

    expect(() => store.register({ workspaceId: "ws-beta", root: mismatch })).toThrowError(
      expect.objectContaining({ code: "identity_mismatch" }),
    );
    writeFileSync(join(shared, "workspace.yaml"), `${JSON.stringify({ workspaceId: "ws-beta" })}\n`, "utf8");
    expect(() => store.register({ workspaceId: "ws-beta", root: shared })).toThrowError(
      expect.objectContaining({ code: "path_conflict" }),
    );
    expect(store.read().entries.map((entry) => entry.workspaceId)).toEqual(["ws-alpha"]);
  });
});
