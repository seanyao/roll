import { join } from "node:path";
import {
  detectLegacyProject,
  resolveWorkspaceTarget,
  type WorkspaceContextCandidate,
  type WorkspaceRegistryCandidate,
  type WorkspaceTargetFailureCode,
} from "@roll/core";
import { workspaceTargetSelector, type LegacyWorkspaceProject } from "./workspace-target.js";

export type BacklogOperation = "read" | "mutation";

export interface BacklogTargetInput {
  readonly operation: BacklogOperation;
  readonly registry: readonly WorkspaceRegistryCandidate[];
  readonly all?: boolean;
  readonly explicitWorkspace?: string;
  readonly environmentWorkspace?: string;
  readonly cwdManifest?: WorkspaceContextCandidate;
  readonly legacyProject?: LegacyWorkspaceProject;
  readonly hasReachableWorkspaceManifest?: boolean;
}

export interface BacklogAggregateEntry {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly canonicalRoot: string;
  readonly backlogPath: string;
}

export interface ResolvedBacklogTarget {
  readonly ok: true;
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly canonicalRoot: string;
  readonly backlogPath: string;
  readonly storyRoot: string;
  readonly runtimeRoot: string;
  readonly configPath: string;
}

export type BacklogTargetDecision =
  | ResolvedBacklogTarget
  | { readonly ok: true; readonly aggregate: readonly BacklogAggregateEntry[] }
  | { readonly ok: false; readonly code: "migration_required"; readonly migrationCheckCommand: string }
  | { readonly ok: false; readonly code: WorkspaceTargetFailureCode };

function resolvedTarget(workspaceId: string, workspaceRoot: string, canonicalRoot: string): ResolvedBacklogTarget {
  return {
    ok: true,
    workspaceId,
    workspaceRoot,
    canonicalRoot,
    backlogPath: join(workspaceRoot, "backlog", "index.md"),
    storyRoot: join(workspaceRoot, "backlog"),
    runtimeRoot: join(workspaceRoot, "runtime"),
    configPath: join(workspaceRoot, "runtime", "backlog-sync.yaml"),
  };
}

export function resolveBacklogTarget(input: BacklogTargetInput): BacklogTargetDecision {
  const decision = resolveWorkspaceTarget({
    operation: input.operation,
    registry: input.registry,
    ...(input.all === undefined ? {} : { all: input.all }),
    ...(input.explicitWorkspace === undefined ? {} : { explicit: workspaceTargetSelector(input.explicitWorkspace) }),
    ...(input.environmentWorkspace === undefined ? {} : { environment: workspaceTargetSelector(input.environmentWorkspace) }),
    context: { ...(input.cwdManifest === undefined ? {} : { cwdManifest: input.cwdManifest }) },
  });

  if (!decision.ok && decision.error.code === "target_missing" && input.legacyProject !== undefined) {
    const legacy = detectLegacyProject({
      hasBacklogMd: true,
      hasWorkspaceManifest: input.hasReachableWorkspaceManifest === true,
      repositoryRoot: input.legacyProject.repositoryRoot,
    });
    if (legacy.legacy) {
      return { ok: false, code: "migration_required", migrationCheckCommand: legacy.migrationCheckCommand };
    }
  }

  if (!decision.ok) return { ok: false, code: decision.error.code };
  if (decision.target.kind === "all") {
    return {
      ok: true,
      aggregate: decision.target.workspaces.map((workspace) => ({
        workspaceId: workspace.workspaceId,
        workspaceRoot: workspace.root,
        canonicalRoot: workspace.canonicalRoot,
        backlogPath: join(workspace.root, "backlog", "index.md"),
      })),
    };
  }
  return resolvedTarget(decision.target.workspaceId, decision.target.root, decision.target.canonicalRoot);
}
