import {
  WORKSPACE_EVENT_V1,
  type WorkspaceLifecycle,
  type WorkspaceLifecycleEvent,
} from "@roll/spec";

export { WORKSPACE_EVENT_V1 } from "@roll/spec";
export type { WorkspaceLifecycleEvent } from "@roll/spec";

export class WorkspaceLifecycleError extends Error {
  readonly code = "transition_before_registration" as const;

  constructor(readonly workspaceId: string) {
    super(`Workspace ${workspaceId} is not registered`);
    this.name = "WorkspaceLifecycleError";
  }
}

export interface WorkspaceLifecycleState {
  readonly workspaceId: string;
  readonly lifecycle: WorkspaceLifecycle;
  readonly lastEventTs: number;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function lifecycleForEvent(event: WorkspaceLifecycleEvent): WorkspaceLifecycle | undefined {
  switch (event.type) {
    case "workspace:registered": return "registered";
    case "workspace:activated": return "active";
    case "workspace:paused": return "paused";
    case "workspace:archived": return "archived";
    case "workspace:path_updated": return undefined;
  }
}

/** Rebuild Workspace lifecycle exclusively from the append-only event stream. */
export function foldWorkspaceLifecycles(
  events: readonly WorkspaceLifecycleEvent[],
): readonly WorkspaceLifecycleState[] {
  const states = new Map<string, WorkspaceLifecycleState>();
  for (const event of events) {
    const lifecycle = lifecycleForEvent(event);
    if (lifecycle === undefined) continue;
    if (event.type !== "workspace:registered" && !states.has(event.workspaceId)) {
      throw new WorkspaceLifecycleError(event.workspaceId);
    }
    states.set(event.workspaceId, {
      workspaceId: event.workspaceId,
      lifecycle,
      lastEventTs: event.ts,
    });
  }
  return [...states.values()].sort((left, right) => compareCodeUnits(left.workspaceId, right.workspaceId));
}
