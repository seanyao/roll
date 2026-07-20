export const WORKSPACE_EVENT_V1 = "roll.workspace-event/v1" as const;

export type WorkspaceLifecycleStatus = "registered" | "active" | "paused" | "archived";

interface WorkspaceEventBase {
  readonly schema: typeof WORKSPACE_EVENT_V1;
  readonly workspaceId: string;
  readonly ts: number;
}

export type WorkspaceLifecycleEvent =
  | (WorkspaceEventBase & { readonly type: "workspace:registered" })
  | (WorkspaceEventBase & { readonly type: "workspace:activated" })
  | (WorkspaceEventBase & { readonly type: "workspace:paused" })
  | (WorkspaceEventBase & { readonly type: "workspace:archived" })
  | (WorkspaceEventBase & {
      readonly type: "workspace:path_updated";
      readonly oldRoot: string;
      readonly newRoot: string;
    });

export interface WorkspaceLifecycleState {
  readonly workspaceId: string;
  readonly lifecycle: WorkspaceLifecycleStatus;
  readonly lastEventTs: number;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function lifecycleForEvent(event: WorkspaceLifecycleEvent): WorkspaceLifecycleStatus | undefined {
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
      throw new Error(`Workspace ${event.workspaceId} is not registered`);
    }
    states.set(event.workspaceId, {
      workspaceId: event.workspaceId,
      lifecycle,
      lastEventTs: event.ts,
    });
  }
  return [...states.values()].sort((left, right) => compareCodeUnits(left.workspaceId, right.workspaceId));
}
