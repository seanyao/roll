import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTEXT_READ_RESULT_V1,
  WORKSPACE_EXECUTION_CONTEXT_V1,
  type ContextReadResultV1,
  type WorkspaceExecutionContextV1,
} from "@roll/spec";
import { computeContextSnapshotDigest } from "@roll/core";
import { describe, expect, it, vi } from "vitest";
import {
  readCapturedContextFile,
  readContextSnapshot,
  writeContextSnapshot,
} from "../../src/context/snapshot-store.js";

function fixture(): { workspace: WorkspaceExecutionContextV1; runtime: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "roll-context-snapshot-")));
  const runtime = join(root, "runtime");
  return {
    runtime,
    workspace: {
      schema: WORKSPACE_EXECUTION_CONTEXT_V1,
      workspace: { workspaceId: "roll", root, canonicalRoot: root, lifecycle: "active" },
      resolution: { source: "explicit", evidence: [] },
      bindings: [],
      authorities: {
        backlog: join(root, "backlog"),
        features: join(root, "features"),
        design: join(root, "design"),
        requirements: join(root, "requirements"),
        policy: join(root, "policy"),
        evidence: join(root, "evidence"),
        toolDumps: join(root, "tool-dumps"),
        events: join(root, "events"),
        runtime,
        locks: join(runtime, "locks"),
      },
    },
  };
}

function snapshot(runtime: string, storyId?: string): ContextReadResultV1 {
  const snapshotId = "ctx_20260724T060000000Z_aaaaaaaaaaaa";
  const artifactPath = join(runtime, "context", storyId ?? "_workspace", `${snapshotId}.json`);
  const initial: ContextReadResultV1 = {
    schema: CONTEXT_READ_RESULT_V1,
    snapshotId,
    snapshotDigest: "0".repeat(64),
    createdAt: "2026-07-24T06:00:00.000Z",
    artifactPath,
    outcome: "completed",
    requestScope: {
      workspaceId: "roll",
      ...(storyId === undefined ? {} : { storyId }),
      repositoryIds: [],
      environmentIds: [],
      stage: "qa",
    },
    providers: [{
      providerId: "wiki",
      remoteIdentity: "https://github.com/example/wiki",
      branch: "main",
      fetchedAt: "2026-07-24T05:59:59.000Z",
      revision: "a".repeat(40),
      providerConfigDigest: "b".repeat(64),
      bindingDigest: "c".repeat(64),
      files: [{
        ref: "context://wiki/wiki/index.md",
        path: "wiki/index.md",
        sha256: "d".repeat(64),
        bytes: 8,
        content: "# Index\n",
      }],
      warnings: [],
    }],
    gaps: [],
  };
  return { ...initial, snapshotDigest: computeContextSnapshotDigest(initial) };
}

describe("Context Snapshot store", () => {
  it("writes Story and Workspace snapshots create-exclusively and reads verified content", () => {
    for (const storyId of ["US-CONTEXT-006", undefined]) {
      const { workspace, runtime } = fixture();
      const value = snapshot(runtime, storyId);
      expect(writeContextSnapshot(workspace, value)).toBe(value.artifactPath);
      expect(readContextSnapshot(workspace, value.artifactPath)).toEqual(value);
      expect(readCapturedContextFile(value, "context://wiki/wiki/index.md").content).toBe("# Index\n");
      expect(() => writeContextSnapshot(workspace, value)).toThrowError();
      expect(readFileSync(value.artifactPath, "utf8")).toContain(value.snapshotDigest);
    }
  });

  it("persists blocked audit facts but rejects disabled results", () => {
    const { workspace, runtime } = fixture();
    const base = snapshot(runtime, "US-CONTEXT-006");
    const blockedInitial = { ...base, outcome: "blocked" as const, providers: [], gaps: [{ code: "fetch_failed" as const, severity: "blocking" as const, message: "fetch failed" }] };
    const blocked = { ...blockedInitial, snapshotDigest: computeContextSnapshotDigest(blockedInitial) };
    expect(writeContextSnapshot(workspace, blocked)).toBe(blocked.artifactPath);

    const disabledInitial = { ...snapshot(runtime), outcome: "disabled" as const, providers: [] };
    const disabled = { ...disabledInitial, snapshotDigest: computeContextSnapshotDigest(disabledInitial) };
    expect(() => writeContextSnapshot(workspace, disabled)).toThrowError();
  });

  it("rejects tampering, moved artifacts, symlinks and authority escape", () => {
    const { workspace, runtime } = fixture();
    const value = snapshot(runtime, "US-CONTEXT-006");
    writeContextSnapshot(workspace, value);
    writeFileSync(value.artifactPath, readFileSync(value.artifactPath, "utf8").replace("# Index", "# Tampered"));
    expect(() => readContextSnapshot(workspace, value.artifactPath)).toThrowError();

    const outside = join(realpathSync(mkdtempSync(join(tmpdir(), "roll-context-outside-"))), "snapshot.json");
    writeFileSync(outside, JSON.stringify(value));
    expect(() => readContextSnapshot(workspace, outside)).toThrowError();

    const link = join(runtime, "linked.json");
    symlinkSync(outside, link);
    expect(() => readContextSnapshot(workspace, link)).toThrowError();
    expect(() => writeContextSnapshot(workspace, { ...value, artifactPath: outside })).toThrowError();
  });

  it("never fetches or backfills a ref missing from the captured Snapshot", () => {
    const fetchCanary = vi.fn();
    const { runtime } = fixture();
    expect(() => readCapturedContextFile(snapshot(runtime), "context://wiki/wiki/new-page.md")).toThrowError();
    expect(fetchCanary).not.toHaveBeenCalled();
  });

  it("fails a concurrent snapshotId collision without publishing or removing the other writer lock", () => {
    const { workspace, runtime } = fixture();
    const value = snapshot(runtime, "US-CONTEXT-006");
    const lock = `${value.artifactPath}.write-lock`;
    mkdirSync(lock, { recursive: true });
    expect(() => writeContextSnapshot(workspace, value)).toThrowError();
    expect(() => readFileSync(value.artifactPath, "utf8")).toThrowError();
    expect(realpathSync(lock)).toBe(lock);
  });
});
