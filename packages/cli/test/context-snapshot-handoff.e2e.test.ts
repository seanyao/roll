import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTEXT_READ_RESULT_V1,
  WORKSPACE_EXECUTION_CONTEXT_V1,
  type ContextReadResultV1,
  type WorkspaceExecutionContextV1,
} from "@roll/spec";
import {
  computeContextSnapshotDigest,
  contextSnapshotReference,
  verifyContextSnapshot,
  type ContextSnapshotReferenceV1,
} from "@roll/core";
import { readCapturedContextFile, readContextSnapshot, writeContextSnapshot } from "@roll/infra";
import { describe, expect, it, vi } from "vitest";

function fixture(): { workspace: WorkspaceExecutionContextV1; snapshot: ContextReadResultV1 } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "roll-context-handoff-")));
  const runtime = join(root, "runtime");
  const workspace: WorkspaceExecutionContextV1 = {
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
  };
  const snapshotId = "ctx_20260724T060000000Z_aaaaaaaaaaaa";
  const initial: ContextReadResultV1 = {
    schema: CONTEXT_READ_RESULT_V1,
    snapshotId,
    snapshotDigest: "0".repeat(64),
    createdAt: "2026-07-24T06:00:00.000Z",
    artifactPath: join(runtime, "context", "US-CONTEXT-006", `${snapshotId}.json`),
    outcome: "completed",
    requestScope: { workspaceId: "roll", storyId: "US-CONTEXT-006", repositoryIds: [], environmentIds: [], stage: "design" },
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
  return { workspace, snapshot: { ...initial, snapshotDigest: computeContextSnapshotDigest(initial) } };
}

describe("Context Snapshot stage handoff", () => {
  it("serializes design reference and lets build/QA verify and reuse the same captured bytes without fetch", () => {
    const fetchCanary = vi.fn();
    const { workspace, snapshot } = fixture();
    writeContextSnapshot(workspace, snapshot);

    const wire = JSON.stringify(contextSnapshotReference(snapshot));
    const buildReference = JSON.parse(wire) as ContextSnapshotReferenceV1;
    const buildSnapshot = readContextSnapshot(workspace, buildReference.artifactPath);
    expect(verifyContextSnapshot(buildSnapshot)).toMatchObject({
      valid: true,
      reference: buildReference,
    });

    const qaReference = JSON.parse(JSON.stringify(contextSnapshotReference(buildSnapshot))) as ContextSnapshotReferenceV1;
    const qaSnapshot = readContextSnapshot(workspace, qaReference.artifactPath);
    expect(readCapturedContextFile(qaSnapshot, "context://wiki/wiki/index.md").content).toBe("# Index\n");
    expect(qaSnapshot.snapshotDigest).toBe(snapshot.snapshotDigest);
    expect(existsSync(snapshot.artifactPath)).toBe(true);
    expect(fetchCanary).not.toHaveBeenCalled();
  });
});
