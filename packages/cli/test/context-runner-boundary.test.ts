import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTEXT_PAGE_V1,
  CONTEXT_READ_RESULT_V1,
  WORKSPACE_EXECUTION_CONTEXT_V1,
  type ContextReadResultV1,
  type WorkspaceExecutionContextV1,
} from "@roll/spec";
import { computeContextSnapshotDigest, contextSnapshotId, type RouteDeps } from "@roll/core";
import { writeContextSnapshot } from "@roll/infra";
import { describe, expect, it, vi } from "vitest";
import {
  CONTEXT_STAGE_HANDOFF_V1,
  decodeContextAgentEnvelope,
  nodePorts,
  prepareContextBuilderSkillBody,
  type RunnerPaths,
} from "../src/runner/index.js";
import type { AgentSpawn } from "../src/runner/agent-spawn.js";

const STORY_ID = "US-CONTEXT-008";

const routeDeps: RouteDeps = {
  readSlot: () => ({ agent: "claude" }),
  firstInstalled: () => "claude",
};

function fakeSpawn(): AgentSpawn {
  const spawn: AgentSpawn = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false }));
  spawn.supportedPurposes = ["builder"];
  return spawn;
}

function fixture(): { root: string; workspace: WorkspaceExecutionContextV1; paths: RunnerPaths; snapshot: ContextReadResultV1 } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "roll-context-runner-")));
  const runtime = join(root, "runtime");
  writeFileSync(join(root, "workspace.yaml"), `${JSON.stringify({
    schema: "roll.workspace/v1",
    workspaceId: "roll-context-runner",
    displayName: "Context runner fixture",
    requirements: [],
    repositories: [],
    contexts: {
      enabled: true,
      bindings: [{
        providerId: "enterprise-wiki",
        enabled: true,
        required: true,
        entrypoints: ["wiki/index.md"],
      }],
    },
  }, null, 2)}\n`);
  const workspace: WorkspaceExecutionContextV1 = {
    schema: WORKSPACE_EXECUTION_CONTEXT_V1,
    workspace: { workspaceId: "roll-context-runner", root, canonicalRoot: root, lifecycle: "active" },
    resolution: { source: "explicit", evidence: [] },
    bindings: [],
    contexts: {
      enabled: true,
      bindings: [{
        providerId: "enterprise-wiki",
        enabled: true,
        required: true,
        entrypoints: ["wiki/index.md"],
      }],
    },
    authorities: {
      backlog: join(root, "backlog", "index.md"),
      features: join(root, "features"),
      design: join(root, "design"),
      requirements: join(root, "requirements"),
      policy: join(root, "policy.yaml"),
      evidence: join(root, "issues", STORY_ID, "evidence"),
      toolDumps: join(root, "issues", STORY_ID, "artifacts", "tool-dumps"),
      events: join(runtime, "events.ndjson"),
      runtime,
      locks: join(runtime, "locks"),
    },
  };
  const createdAt = "2026-07-24T06:00:00.001Z";
  const initial: ContextReadResultV1 = {
    schema: CONTEXT_READ_RESULT_V1,
    snapshotId: "pending",
    snapshotDigest: "0".repeat(64),
    createdAt,
    artifactPath: "pending",
    outcome: "completed",
    requestScope: {
      workspaceId: workspace.workspace.workspaceId,
      storyId: STORY_ID,
      repositoryIds: [],
      environmentIds: ["sit"],
      stage: "design",
    },
    providers: [{
      providerId: "enterprise-wiki",
      remoteIdentity: "https://example.test/company/context",
      branch: "main",
      fetchedAt: createdAt,
      revision: "a".repeat(40),
      providerConfigDigest: "b".repeat(64),
      bindingDigest: "c".repeat(64),
      files: [{
        ref: "context://enterprise-wiki/wiki/index.md",
        path: "wiki/index.md",
        sha256: "d".repeat(64),
        bytes: 14,
        content: "runner-context",
      }, {
        ref: "context://enterprise-wiki/wiki/systems/axis.md",
        path: "wiki/systems/axis.md",
        sha256: "e".repeat(64),
        bytes: 8,
        page: {
          schema: CONTEXT_PAGE_V1,
          title: "Axis",
          page_type: "system",
          status: "active",
          confidence: "approved",
          updated_at: "2026-07-24",
          scope: {},
          sources: [],
          sensitivity: "internal",
        },
        matchedScope: { environment_ids: ["sit"] },
        content: "axis-sit",
      }],
      warnings: [],
    }],
    gaps: [],
  };
  const snapshotDigest = computeContextSnapshotDigest(initial);
  const snapshotId = contextSnapshotId(createdAt, snapshotDigest);
  if (snapshotId === undefined) throw new Error("invalid fixture timestamp");
  const snapshot = {
    ...initial,
    snapshotId,
    snapshotDigest,
    artifactPath: join(runtime, "context", STORY_ID, `${snapshotId}.json`),
  };
  writeContextSnapshot(workspace, snapshot);
  return {
    root,
    workspace,
    snapshot,
    paths: {
      eventsPath: join(runtime, "events.ndjson"),
      runsPath: join(runtime, "runs.jsonl"),
      alertsPath: join(runtime, "alerts.log"),
      lockPath: join(runtime, "lock"),
      heartbeatPath: join(runtime, "heartbeat"),
      worktreePath: root,
    },
  };
}

describe("Context production runner boundary", () => {
  it("restores the exact Story Snapshot through nodePorts and injects its encoded envelope into the Builder prompt", async () => {
    const f = fixture();
    const ports = nodePorts({
      repoCwd: f.root,
      paths: f.paths,
      skillBody: "BUILD STORY",
      routeDeps,
      agentSpawn: fakeSpawn(),
    });

    expect(ports.contextStage).toBeDefined();
    const prepared = await prepareContextBuilderSkillBody(ports, STORY_ID, "BUILD STORY");

    expect(prepared).toMatchObject({ status: "ready" });
    if (prepared.status !== "ready") throw new Error("expected Context-aware Builder prompt");
    expect(prepared.skillBody).toContain("BUILD STORY\n\nROLL_CONTEXT_DATA_V1 bytes=");
    expect(prepared.handoff).toMatchObject({
      schema: CONTEXT_STAGE_HANDOFF_V1,
      workspaceId: "roll-context-runner",
      storyId: STORY_ID,
      snapshot: {
        snapshotId: f.snapshot.snapshotId,
        snapshotDigest: f.snapshot.snapshotDigest,
        artifactPath: f.snapshot.artifactPath,
      },
    });
    const encoded = prepared.skillBody.slice(prepared.skillBody.indexOf("ROLL_CONTEXT_DATA_V1"));
    expect(decodeContextAgentEnvelope(encoded)).toMatchObject({
      workspaceId: "roll-context-runner",
      storyId: STORY_ID,
      stage: "build",
      snapshot: prepared.handoff.snapshot,
      pages: [
        expect.objectContaining({ ref: "context://enterprise-wiki/wiki/index.md", content: "runner-context" }),
        expect.objectContaining({ ref: "context://enterprise-wiki/wiki/systems/axis.md", content: "axis-sit" }),
      ],
    });
  });
});
