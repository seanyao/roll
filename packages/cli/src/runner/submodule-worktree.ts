/**
 * E2 — submodule-aware worktree creation, split out of setup-handlers.ts
 * (REFACTOR-060 module-size guard) so the submodule delivery ladder has its own
 * testable home (mirrors how E3 extracted local-publish.ts).
 *
 * Exports:
 *   - {@link resolveStoryTargetSubmodule}: read the picked story's target
 *     submodule from EITHER declaration site (backlog tag `target-submodule:` OR
 *     spec frontmatter `target_submodule:`).
 *   - {@link createSubmoduleWorktreeIfDeclared}: when a target submodule is
 *     present, create the cycle worktree INSIDE that submodule (decision #1:
 *     shared object store) on the submodule's own integration branch, and emit
 *     the `worktree:submodule` observability event. Fail-loud on a creation
 *     error (never a silent superproject fallback).
 *   - {@link resolveExecutionCwd} / {@link resolveExecutionRepoCwd} (E4): the
 *     EXECUTION-side counterpart of E2's `resolveLandingTarget`. When the cycle
 *     context carries a `targetSubmodule`, route the agent process, the TCR/commit
 *     observation and the take/attest git calls INTO the submodule cycle worktree
 *     (and its repo root) so the agent's build/test/edit and the runner's
 *     observation of it happen where the delivery actually lands. Absent ⇒ the
 *     superproject worktree/repo, byte-identical to today (zero regression).
 */
import { parseTargetSubmodule } from "@roll/core";
import { resolveIntegrationBranch, submoduleWorktreePath } from "@roll/infra";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { storySpecPath } from "./attest-gate.js";
import { targetSubmoduleFromSpecText } from "../lib/target-submodule.js";
import { eventTs } from "./runner-time.js";
import type { Ports } from "./ports.js";

/**
 * E4 — the EXECUTION-side cwd. A submodule cycle runs the agent (and observes it)
 * inside the SUBMODULE cycle worktree — `submoduleWorktreePath(<canonical cycle
 * path>, <submodule>)`, the SAME sibling `*.submodules/` location E2's
 * `resolveLandingTarget` lands from — so the code the agent edits, builds, tests
 * and commits, and the TCR/diff the runner observes, all live where the delivery
 * ultimately lands. Without a target submodule this is exactly
 * `ports.paths.worktreePath`, so the existing superproject path is unchanged
 * (byte-identical). An empty-string submodule is treated as "none" (mirrors
 * `resolveLandingTarget`'s `sub === ""` guard).
 *
 * NOTE the deliberate split from the persistent-`.roll` reads: the loop's `.roll`
 * (backlog/specs/evidence/attest) is symlinked ONLY into the canonical
 * superproject cycle worktree (`linkRollIntoWorktree`), never the submodule
 * worktree (E5: a sibling dir outside the superproject worktree tree) — so
 * spec/evidence/attest reads keep using `ports.paths.worktreePath`, while ONLY
 * the agent-execution + git-observation sites route here.
 */
export function resolveExecutionCwd(ports: Ports, ctx: { targetSubmodule?: string }): string {
  const sub = ctx.targetSubmodule;
  return sub !== undefined && sub !== ""
    ? submoduleWorktreePath(ports.paths.worktreePath, sub)
    : ports.paths.worktreePath;
}

/**
 * E4 — the EXECUTION-side repo root (the git repo whose object store the agent's
 * commits land in). Some observation needs the repo ROOT rather than the worktree
 * (e.g. resolving the submodule's integration branch, or granting the agent write
 * access to the correct git-common-dir). A submodule cycle's repo root is
 * `<superproject>/<submodule>` — the SAME repoCwd E2's `resolveLandingTarget`
 * derives. Absent ⇒ `ports.repoCwd`, unchanged.
 */
export function resolveExecutionRepoCwd(ports: Ports, ctx: { targetSubmodule?: string }): string {
  const sub = ctx.targetSubmodule;
  return sub !== undefined && sub !== "" ? join(ports.repoCwd, sub) : ports.repoCwd;
}

/**
 * Resolve the picked story's target submodule, consulting BOTH declaration sites
 * (either may be present):
 *   1. the backlog row tag `target-submodule:<path>` (core `parseTargetSubmodule`);
 *   2. the spec.md frontmatter `target_submodule: <path>` (read from DESIGN
 *      TRUTH — `ports.repoCwd`, the persistent `.roll`, not the mutable worktree).
 * The backlog tag wins when both are present (it is the pick-time source). Spec
 * reads are best-effort: an unreadable/missing spec never fails the resolve — it
 * falls through to "no submodule".
 */
export function resolveStoryTargetSubmodule(
  ports: Ports,
  story: { id: string; desc?: string },
): string | undefined {
  const fromTag = parseTargetSubmodule(story.desc ?? "");
  if (fromTag !== undefined) return fromTag;
  try {
    const spec = storySpecPath(ports.repoCwd, story.id);
    if (spec !== null) return targetSubmoduleFromSpecText(readFileSync(spec, "utf8"));
  } catch {
    /* best-effort: an unreadable spec is treated as "no submodule declared" */
  }
  return undefined;
}

/** Outcome of {@link createSubmoduleWorktreeIfDeclared}. */
export interface SubmoduleWorktreeResult {
  /** The resolved target submodule, or `undefined` when the story declared none. */
  targetSubmodule?: string;
  /** True iff a declared submodule worktree FAILED to create (→ worktree_failed). */
  failed: boolean;
}

/**
 * When the picked story declares a target submodule, create the cycle worktree
 * INSIDE that submodule (on the submodule's own integration branch, E1
 * `resolveIntegrationBranch(<submodule path>)`) so its detached HEAD is where the
 * cycle commits and the local-delivery landing lands (the user's real submodule
 * checkout then sees the branch advance). Emits `worktree:submodule` on success;
 * ALERTs + reports `failed:true` on a creation error (the handler turns that into
 * `worktree_failed` — never a silent superproject fallback). No target submodule
 * ⇒ a clean no-op (`targetSubmodule:undefined, failed:false`).
 */
export async function createSubmoduleWorktreeIfDeclared(
  ports: Ports,
  ctx: { cycleId: string },
  story: { id: string; desc?: string },
): Promise<SubmoduleWorktreeResult> {
  const targetSubmodule = resolveStoryTargetSubmodule(ports, story);
  if (targetSubmodule === undefined) return { failed: false };

  const base = resolveIntegrationBranch(join(ports.repoCwd, targetSubmodule));
  const sub = await ports.git.worktreeAddInSubmodule(
    ports.repoCwd,
    targetSubmodule,
    ports.paths.worktreePath,
    base,
  );
  if (sub.code !== 0) {
    ports.events.appendAlert(
      ports.paths.alertsPath,
      `E2: submodule worktree add FAILED for ${story.id} (submodule ${targetSubmodule}, cycle ${ctx.cycleId}) — ${sub.stderr.trim()} — cycle cannot deliver into the submodule`,
    );
    return { targetSubmodule, failed: true };
  }
  ports.events.appendEvent(ports.paths.eventsPath, {
    type: "worktree:submodule",
    cycleId: ctx.cycleId,
    storyId: story.id,
    submodule: targetSubmodule,
    base,
    ts: eventTs(ports),
  });
  return { targetSubmodule, failed: false };
}
