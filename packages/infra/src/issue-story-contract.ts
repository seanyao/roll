import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseIssueStoryContract, validateStoryId, type IssueStoryContract } from "@roll/core";

export type ResolveStoryContractErrorCode =
  | "invalid_story_id"
  | "story_not_found"
  | "duplicate_story"
  | "invalid_config"
  | "invalid_value"
  | "invalid_type"
  | "unknown_field"
  | "identity_mismatch"
  | "duplicate_identity";

export type ResolveStoryContractResult =
  | { readonly ok: true; readonly value: IssueStoryContract }
  | { readonly ok: false; readonly code: ResolveStoryContractErrorCode; readonly matches?: readonly string[] };

/** Bound recursion depth under a Workspace backlog tree — generous for any
 *  real epic/sub-epic nesting while refusing to walk unbounded structures. */
const MAX_BACKLOG_DEPTH = 8;

/** Every `<story-id>/spec.md` found anywhere under `<workspaceRoot>/backlog`,
 *  at any depth — the Runtime Story Contract's ONLY valid home. A caller cwd's
 *  own `.roll/features` tree is never consulted here. */
function backlogStorySpecMatches(workspaceRoot: string, storyId: string): string[] {
  const backlogRoot = join(workspaceRoot, "backlog");
  const matches: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_BACKLOG_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name);
      if (entry.name === storyId) {
        const spec = join(path, "spec.md");
        if (existsSync(spec)) matches.push(spec);
      }
      walk(path, depth + 1);
    }
  };
  walk(backlogRoot, 0);
  return matches;
}

/** Resolve the Runtime Story Contract from inside the SELECTED Workspace's own
 *  backlog tree (`backlog/**\/<story-id>/spec.md`) — never the caller cwd's
 *  `.roll/features`. Fails loud when a story id resolves to more than one spec. */
export function resolveWorkspaceBacklogStoryContract(
  workspaceRoot: string,
  storyId: string,
): ResolveStoryContractResult {
  const validated = validateStoryId(storyId);
  if (!validated.ok) return { ok: false, code: "invalid_story_id" };
  const matches = backlogStorySpecMatches(workspaceRoot, storyId);
  if (matches.length === 0) return { ok: false, code: "story_not_found" };
  if (matches.length > 1) return { ok: false, code: "duplicate_story", matches };
  let specText: string;
  try {
    specText = readFileSync(matches[0]!, "utf8");
  } catch {
    return { ok: false, code: "story_not_found" };
  }
  const parsed = parseIssueStoryContract(specText, { storyId });
  if (!parsed.ok) return { ok: false, code: (parsed.errors[0]?.code ?? "invalid_config") as ResolveStoryContractErrorCode };
  return { ok: true, value: parsed.value };
}
