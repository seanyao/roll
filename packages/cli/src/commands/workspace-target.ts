import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { WorkspaceRegistryCandidate, WorkspaceTargetSelector } from "@roll/core";
import type { InspectedWorkspace } from "@roll/infra";

export function workspaceRollHome(): string {
  return process.env["ROLL_HOME"] ?? resolve(homedir(), ".roll");
}

export function workspaceRegistryCandidates(entries: readonly InspectedWorkspace[]): readonly WorkspaceRegistryCandidate[] {
  return entries.map((entry) => ({
    workspaceId: entry.workspaceId,
    root: entry.root,
    canonicalRoot: entry.canonicalRoot,
    manifestWorkspaceId: entry.manifestWorkspaceId ?? "<invalid-manifest>",
    pathState: entry.consistency === "stale_path" ? "stale" : "valid",
    lifecycle: entry.lifecycle,
  }));
}

export function workspaceTargetSelector(value: string): WorkspaceTargetSelector {
  if (!isAbsolute(value) && !value.startsWith(".") && !value.includes("/")) {
    return { kind: "id", workspaceId: value };
  }
  const absolutePath = resolve(value);
  let canonicalPath = absolutePath;
  try {
    canonicalPath = realpathSync(absolutePath);
  } catch {
    // The pure target resolver reports an actionable missing or stale target.
  }
  return { kind: "path", absolutePath, canonicalPath };
}
