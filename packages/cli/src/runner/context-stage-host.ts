import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { verifyContextSnapshot } from "@roll/core";
import { readContextSnapshot, readWorkspace } from "@roll/infra";
import {
  WORKSPACE_EXECUTION_CONTEXT_V1,
  type ContextReadResultV1,
  type ContextStage,
  type WorkspaceExecutionContextV1,
} from "@roll/spec";
import { createContextHostAdapter } from "./context-adapter.js";
import {
  createContextStageHandoff,
  invalidContextHandoff,
  type ContextStageReadResultV1,
} from "./context-handoff.js";

export interface ContextStageHostPort {
  readForStage(input: {
    readonly storyId: string;
    readonly stage: ContextStage;
  }): Promise<ContextStageReadResultV1>;
}

function workspaceExecutionContext(workspaceRoot: string): WorkspaceExecutionContextV1 {
  const canonicalRoot = realpathSync(workspaceRoot);
  const manifest = readWorkspace(canonicalRoot);
  const runtime = join(canonicalRoot, "runtime");
  return {
    schema: WORKSPACE_EXECUTION_CONTEXT_V1,
    workspace: {
      workspaceId: manifest.workspaceId,
      root: workspaceRoot,
      canonicalRoot,
      lifecycle: "active",
    },
    resolution: { source: "explicit", evidence: [] },
    bindings: manifest.repositories,
    ...(manifest.contexts === undefined ? {} : { contexts: manifest.contexts }),
    authorities: {
      backlog: join(canonicalRoot, "backlog", "index.md"),
      features: join(canonicalRoot, "features"),
      design: join(canonicalRoot, "design"),
      requirements: join(canonicalRoot, "requirements"),
      policy: join(canonicalRoot, "policy.yaml"),
      evidence: join(canonicalRoot, "evidence"),
      toolDumps: join(canonicalRoot, "artifacts", "tool-dumps"),
      events: join(runtime, "events.ndjson"),
      runtime,
      locks: join(runtime, "locks"),
    },
  };
}

function latestStorySnapshot(
  workspace: WorkspaceExecutionContextV1,
  storyId: string,
): ContextReadResultV1 | undefined {
  const scopeRoot = join(workspace.authorities.runtime, "context", storyId);
  if (!existsSync(scopeRoot)) return undefined;
  const scopeStat = lstatSync(scopeRoot);
  if (!scopeStat.isDirectory() || scopeStat.isSymbolicLink() || realpathSync(scopeRoot) !== scopeRoot) {
    throw new Error("invalid_context_snapshot");
  }
  const snapshots: ContextReadResultV1[] = [];
  for (const entry of readdirSync(scopeRoot, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
      throw new Error("invalid_context_snapshot");
    }
    const artifactPath = join(scopeRoot, entry.name);
    const verification = verifyContextSnapshot(JSON.parse(readFileSync(artifactPath, "utf8")) as unknown);
    if (!verification.valid || verification.reference.artifactPath !== artifactPath) {
      throw new Error("invalid_context_snapshot");
    }
    const snapshot = readContextSnapshot(workspace, verification.reference);
    if (snapshot.requestScope.storyId !== storyId) throw new Error("invalid_context_snapshot");
    snapshots.push(snapshot);
  }
  return snapshots.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || right.snapshotId.localeCompare(left.snapshotId)
  )[0];
}

/**
 * Bind the durable Context Snapshot store to the real Node runner. Context is
 * optional at Workspace level; once enabled, a consuming stage fails closed
 * unless an exact Story Snapshot can be restored and verified.
 */
export function createNodeContextStageHost(workspaceRoot: string): ContextStageHostPort | undefined {
  const workspace = workspaceExecutionContext(workspaceRoot);
  if (workspace.contexts?.enabled !== true || !workspace.contexts.bindings.some((binding) => binding.enabled)) {
    return undefined;
  }
  const host = createContextHostAdapter({
    freshRead: async () => { throw new Error("fresh_context_read_not_available_at_consuming_stage"); },
    writeSnapshot: () => { throw new Error("context_snapshot_write_not_available_at_consuming_stage"); },
    readSnapshot: (_workspace, reference) => readContextSnapshot(workspace, reference),
  });
  return {
    async readForStage(input) {
      try {
        const snapshot = latestStorySnapshot(workspace, input.storyId);
        if (snapshot === undefined) return { status: "blocked", diagnostic: invalidContextHandoff() };
        return host.readForStage({
          workspace,
          storyId: input.storyId,
          stage: input.stage,
          refs: [],
          handoff: createContextStageHandoff(snapshot),
        });
      } catch {
        return { status: "blocked", diagnostic: invalidContextHandoff() };
      }
    },
  };
}
