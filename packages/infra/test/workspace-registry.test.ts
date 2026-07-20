import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
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

describe("Workspace lifecycle, moves, and concurrent writers", () => {
  it("derives multiple active Workspaces from events and isolates later transitions", () => {
    const rollHome = sandbox();
    const alpha = workspace(join(rollHome, "roots", "alpha"), "ws-alpha");
    const beta = workspace(join(rollHome, "roots", "beta"), "ws-beta");
    const store = new WorkspaceRegistry({ rollHome, now: (() => {
      let ts = 0;
      return () => ++ts;
    })() });
    store.register({ workspaceId: "ws-alpha", root: alpha });
    store.register({ workspaceId: "ws-beta", root: beta });
    store.activate("ws-alpha");
    store.activate("ws-beta");
    expect(store.list().map(({ workspaceId, lifecycle }) => ({ workspaceId, lifecycle }))).toEqual([
      { workspaceId: "ws-alpha", lifecycle: "active" },
      { workspaceId: "ws-beta", lifecycle: "active" },
    ]);

    store.pause("ws-alpha");
    store.archive("ws-beta");
    expect(existsSync(beta)).toBe(true);
    expect(new WorkspaceRegistry({ rollHome }).list().map(({ workspaceId, lifecycle }) => ({ workspaceId, lifecycle }))).toEqual([
      { workspaceId: "ws-alpha", lifecycle: "paused" },
      { workspaceId: "ws-beta", lifecycle: "archived" },
    ]);
  });

  it("moves only after explicit old/new manifest validation", () => {
    const rollHome = sandbox();
    const oldRoot = workspace(join(rollHome, "roots", "old"), "ws-alpha");
    const newRoot = workspace(join(rollHome, "roots", "new"), "ws-alpha");
    const wrongRoot = workspace(join(rollHome, "roots", "wrong"), "ws-other");
    const store = new WorkspaceRegistry({ rollHome, now: () => 100 });
    store.register({ workspaceId: "ws-alpha", root: oldRoot });

    expect(() => store.move({ workspaceId: "ws-alpha", oldRoot, newRoot: wrongRoot })).toThrowError(
      expect.objectContaining({ code: "identity_mismatch" }),
    );
    expect(store.move({ workspaceId: "ws-alpha", oldRoot, newRoot })).toMatchObject({
      workspaceId: "ws-alpha",
      root: newRoot,
      pathState: "valid",
    });
    expect(store.read().entries).toHaveLength(1);
    expect(store.readEvents().at(-1)).toMatchObject({
      type: "workspace:path_updated",
      oldRoot,
      newRoot,
    });
  });

  it("keeps a missing old path visible as stale until an explicit repair", () => {
    const rollHome = sandbox();
    const oldRoot = workspace(join(rollHome, "roots", "old"), "ws-alpha");
    const recoveredRoot = workspace(join(rollHome, "roots", "recovered"), "ws-alpha");
    const store = new WorkspaceRegistry({ rollHome, now: () => 100 });
    store.register({ workspaceId: "ws-alpha", root: oldRoot });
    rmSync(oldRoot, { recursive: true });

    expect(() => store.move({ workspaceId: "ws-alpha", oldRoot, newRoot: recoveredRoot })).toThrowError(
      expect.objectContaining({ code: "stale_path" }),
    );
    expect(store.read().entries).toEqual([
      expect.objectContaining({ workspaceId: "ws-alpha", root: oldRoot, pathState: "stale" }),
    ]);
    expect(store.repair({ workspaceId: "ws-alpha", oldRoot, newRoot: recoveredRoot })).toMatchObject({
      workspaceId: "ws-alpha",
      root: recoveredRoot,
      pathState: "valid",
    });
  });

  it("detects a concurrent writer fail-loud and preserves every existing row", () => {
    const rollHome = sandbox();
    const alpha = workspace(join(rollHome, "roots", "alpha"), "ws-alpha");
    const beta = workspace(join(rollHome, "roots", "beta"), "ws-beta");
    const store = new WorkspaceRegistry({ rollHome, now: () => 100 });
    store.register({ workspaceId: "ws-alpha", root: alpha });
    mkdirSync(join(rollHome, "locks", "workspace-registry.lock"));

    expect(() => store.register({ workspaceId: "ws-beta", root: beta })).toThrowError(
      expect.objectContaining({ code: "concurrent_write" }),
    );
    expect(store.read().entries.map((entry) => entry.workspaceId)).toEqual(["ws-alpha"]);
  });
});
