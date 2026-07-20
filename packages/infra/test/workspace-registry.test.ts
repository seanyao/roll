import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireLock } from "../src/process.js";
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
  writeFileSync(join(root, "workspace.yaml"), `${JSON.stringify({ id: workspaceId })}\n`, "utf8");
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
    expect(() => parseWorkspaceRegistry(JSON.stringify({
      ...snapshot,
      entries: [{ ...snapshot.entries[0], extra: true }],
    }))).toThrowError(expect.objectContaining({ code: "invalid_registry" }));
    expect(() => parseWorkspaceRegistry(JSON.stringify({
      ...snapshot,
      entries: [{ workspaceId: "ws-z", root: "/z", canonicalRoot: "/z" }],
    }))).toThrowError(expect.objectContaining({ code: "invalid_registry" }));
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
    const sharedAlias = join(rollHome, "roots", "shared-alias");
    symlinkSync(shared, sharedAlias, "dir");
    writeFileSync(join(shared, "workspace.yaml"), `${JSON.stringify({ id: "ws-beta" })}\n`, "utf8");
    expect(() => store.register({ workspaceId: "ws-beta", root: sharedAlias })).toThrowError(
      expect.objectContaining({ code: "path_conflict" }),
    );
    expect(store.read().entries.map((entry) => entry.workspaceId)).toEqual(["ws-alpha"]);
  });

  it("requires explicit move when an existing Workspace ID is registered at another root", () => {
    const rollHome = sandbox();
    const alpha = workspace(join(rollHome, "roots", "alpha"), "ws-alpha");
    const moved = workspace(join(rollHome, "roots", "moved"), "ws-alpha");
    const store = new WorkspaceRegistry({ rollHome, now: () => 100 });
    store.register({ workspaceId: "ws-alpha", root: alpha });
    expect(() => store.register({ workspaceId: "ws-alpha", root: moved })).toThrowError(
      expect.objectContaining({ code: "path_change_requires_move" }),
    );
    expect(store.read().entries).toEqual([
      expect.objectContaining({ workspaceId: "ws-alpha", root: alpha }),
    ]);
  });

  it("rejects open or unsafe Workspace event records through the public reader", () => {
    const rollHome = sandbox();
    writeFileSync(workspaceEventsPath(rollHome), `${JSON.stringify({
      schema: "roll.workspace-event/v1",
      type: "workspace:path_updated",
      workspaceId: "ws-alpha",
      ts: 1,
      oldRoot: "relative/old",
      newRoot: "/new",
    })}\n`, "utf8");
    expect(() => new WorkspaceRegistry({ rollHome }).readEvents()).toThrowError(
      expect.objectContaining({ code: "invalid_registry" }),
    );
  });

  it("wraps registry and event filesystem failures in the typed public error model", () => {
    const rollHome = sandbox();
    mkdirSync(workspaceRegistryPath(rollHome));
    expect(() => new WorkspaceRegistry({ rollHome }).read()).toThrowError(
      expect.objectContaining({ code: "io_failure" }),
    );
    rmSync(workspaceRegistryPath(rollHome), { recursive: true });
    mkdirSync(workspaceEventsPath(rollHome));
    expect(() => new WorkspaceRegistry({ rollHome }).readEvents()).toThrowError(
      expect.objectContaining({ code: "io_failure" }),
    );
  });

  it("writes the registration event before the registry projection so retry repairs a failed commit", () => {
    const rollHome = sandbox();
    const alpha = workspace(join(rollHome, "roots", "alpha"), "ws-alpha");
    const registryPath = workspaceRegistryPath(rollHome);
    const blockedTempPath = `${registryPath}.tmp.${process.pid}.0`;
    mkdirSync(blockedTempPath);
    const store = new WorkspaceRegistry({ rollHome, now: () => 100 });

    expect(() => store.register({ workspaceId: "ws-alpha", root: alpha })).toThrowError(
      expect.objectContaining({ code: "io_failure" }),
    );
    expect(store.readEvents()).toEqual([
      { schema: "roll.workspace-event/v1", type: "workspace:registered", workspaceId: "ws-alpha", ts: 100 },
    ]);

    rmSync(blockedTempPath, { recursive: true, force: true });
    store.register({ workspaceId: "ws-alpha", root: alpha });
    expect(store.list()).toEqual([
      expect.objectContaining({ workspaceId: "ws-alpha", lifecycle: "registered" }),
    ]);
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
    expect(store.readEvents().map((event) => event.type)).toEqual([
      "workspace:registered",
      "workspace:registered",
      "workspace:activated",
      "workspace:activated",
      "workspace:paused",
      "workspace:archived",
    ]);
    rmSync(workspaceEventsPath(rollHome));
    expect(() => new WorkspaceRegistry({ rollHome }).list()).toThrowError(
      expect.objectContaining({ code: "invalid_registry" }),
    );
  });

  it("moves only after explicit old/new manifest validation", () => {
    const rollHome = sandbox();
    const oldRoot = workspace(join(rollHome, "roots", "old"), "ws-alpha");
    const newRoot = workspace(join(rollHome, "roots", "new"), "ws-alpha");
    const wrongRoot = workspace(join(rollHome, "roots", "wrong"), "ws-other");
    const unrelatedOld = workspace(join(rollHome, "roots", "unrelated-old"), "ws-alpha");
    const store = new WorkspaceRegistry({ rollHome, now: () => 100 });
    store.register({ workspaceId: "ws-alpha", root: oldRoot });

    expect(() => store.move({ workspaceId: "ws-alpha", oldRoot, newRoot: wrongRoot })).toThrowError(
      expect.objectContaining({ code: "identity_mismatch" }),
    );
    expect(() => store.move({ workspaceId: "ws-alpha", oldRoot: unrelatedOld, newRoot })).toThrowError(
      expect.objectContaining({ code: "identity_mismatch" }),
    );
    writeFileSync(join(oldRoot, "workspace.yaml"), `${JSON.stringify({ id: "ws-other" })}\n`, "utf8");
    expect(() => store.move({ workspaceId: "ws-alpha", oldRoot, newRoot })).toThrowError(
      expect.objectContaining({ code: "identity_mismatch" }),
    );
    writeFileSync(join(oldRoot, "workspace.yaml"), `${JSON.stringify({ id: "ws-alpha" })}\n`, "utf8");
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

  it("reports canonical-path or manifest identity drift as stale", () => {
    const rollHome = sandbox();
    const alphaReal = workspace(join(rollHome, "roots", "alpha-real"), "ws-alpha");
    const foreignReal = workspace(join(rollHome, "roots", "foreign-real"), "ws-foreign");
    const alphaLink = join(rollHome, "roots", "alpha-link");
    symlinkSync(alphaReal, alphaLink, "dir");
    const store = new WorkspaceRegistry({ rollHome, now: () => 100 });
    store.register({ workspaceId: "ws-alpha", root: alphaLink });

    rmSync(alphaLink);
    symlinkSync(foreignReal, alphaLink, "dir");
    expect(store.list()).toEqual([
      expect.objectContaining({ workspaceId: "ws-alpha", root: alphaLink, pathState: "stale" }),
    ]);
  });

  it("detects a concurrent writer fail-loud and preserves every existing row", () => {
    const rollHome = sandbox();
    const alpha = workspace(join(rollHome, "roots", "alpha"), "ws-alpha");
    const beta = workspace(join(rollHome, "roots", "beta"), "ws-beta");
    const store = new WorkspaceRegistry({ rollHome, now: () => 100 });
    store.register({ workspaceId: "ws-alpha", root: alpha });
    const lock = join(rollHome, "locks", "workspace-registry.lock");
    expect(acquireLock(lock, process.pid).acquired).toBe(true);

    expect(() => store.register({ workspaceId: "ws-beta", root: beta })).toThrowError(
      expect.objectContaining({ code: "concurrent_write" }),
    );
    expect(store.read().entries.map((entry) => entry.workspaceId)).toEqual(["ws-alpha"]);
  });

  it("recovers a stale same-host lock instead of permanently blocking the registry", () => {
    const rollHome = sandbox();
    const alpha = workspace(join(rollHome, "roots", "alpha"), "ws-alpha");
    const lock = join(rollHome, "locks", "workspace-registry.lock");
    expect(acquireLock(lock, 999_999_999, { pidAlive: () => true }).acquired).toBe(true);

    const store = new WorkspaceRegistry({ rollHome, now: () => 100 });
    expect(store.register({ workspaceId: "ws-alpha", root: alpha })).toMatchObject({ workspaceId: "ws-alpha" });
  });

  it("serializes or rejects two real writers without losing a successful row", async () => {
    const rollHome = sandbox();
    const alpha = workspace(join(rollHome, "roots", "alpha"), "ws-alpha");
    const beta = workspace(join(rollHome, "roots", "beta"), "ws-beta");
    const moduleUrl = new URL("../dist/workspace-registry.js", import.meta.url).href;
    const script = [
      `import { WorkspaceRegistry } from ${JSON.stringify(moduleUrl)};`,
      "const [rollHome, workspaceId, root] = process.argv.slice(1);",
      "try { new WorkspaceRegistry({ rollHome }).register({ workspaceId, root });",
      "process.stdout.write(JSON.stringify({ ok: true, workspaceId })); }",
      "catch (error) { process.stdout.write(JSON.stringify({ ok: false, workspaceId, code: error.code })); }",
    ].join("\n");
    const run = (workspaceId: string, root: string): Promise<{ ok: boolean; workspaceId: string; code?: string }> =>
      new Promise((resolveResult, rejectResult) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", script, rollHome, workspaceId, root], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
        child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
        child.on("error", rejectResult);
        child.on("close", (code) => {
          if (code !== 0) rejectResult(new Error(stderr));
          else resolveResult(JSON.parse(stdout) as { ok: boolean; workspaceId: string; code?: string });
        });
      });

    const results = await Promise.all([run("ws-alpha", alpha), run("ws-beta", beta)]);
    const succeeded = results.filter((result) => result.ok).map((result) => result.workspaceId).sort();
    const rejected = results.filter((result) => !result.ok);
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    expect(rejected.every((result) => result.code === "concurrent_write")).toBe(true);
    expect(new WorkspaceRegistry({ rollHome }).read().entries.map((entry) => entry.workspaceId).sort()).toEqual(succeeded);
  });
});
