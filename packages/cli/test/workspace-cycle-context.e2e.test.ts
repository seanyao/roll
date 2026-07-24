import { describe, expect, it } from "vitest";
import {
  REPOSITORY_BINDING_V1,
  WORKSPACE_EXECUTION_CONTEXT_V1,
  type CycleRepositoryExecutionContext,
  type WorkspaceExecutionContextV1,
} from "@roll/spec";
import { cycleStep, initialCycleState } from "@roll/core";
import { workspaceExecutionEnvironment } from "../src/runner/agent-spawn.js";
import { freezeWorkspaceCycleContext } from "../src/runner/scoped-route.js";

function fixture(): {
  readonly workspace: WorkspaceExecutionContextV1;
  readonly execution: CycleRepositoryExecutionContext;
} {
  const root = "/workspace/roll";
  const storyId = "US-WS-033";
  const issueRoot = `${root}/issues/${storyId}`;
  const bindings = [
    {
      schema: REPOSITORY_BINDING_V1,
      repoId: "repo-111111111111",
      alias: "product",
      remote: "git@github.com:seanyao/roll.git",
      integrationBranch: "idea-074-workspace",
      provider: "github",
      workflow: { branchPattern: "roll/{workspaceId}/{storyId}", requiredChecks: [] },
    },
    {
      schema: REPOSITORY_BINDING_V1,
      repoId: "repo-222222222222",
      alias: "skills",
      remote: "git@github.com:seanyao/roll-skills.git",
      integrationBranch: "idea-074-workspace",
      provider: "github",
      workflow: { branchPattern: "roll/{workspaceId}/{storyId}", requiredChecks: [] },
    },
  ] as const;
  const workspace: WorkspaceExecutionContextV1 = {
    schema: WORKSPACE_EXECUTION_CONTEXT_V1,
    workspace: { workspaceId: "roll", root, canonicalRoot: root, lifecycle: "active" },
    resolution: { source: "requirement_discovery", evidence: [] },
    bindings,
    authorities: {
      backlog: `${root}/backlog/index.md`,
      features: `${root}/features`,
      design: `${root}/design`,
      requirements: `${root}/requirements`,
      policy: `${root}/policy.yaml`,
      evidence: `${root}/evidence`,
      toolDumps: `${root}/runtime/tool-dumps`,
      events: `${root}/runtime/events`,
      runtime: `${root}/runtime`,
      locks: `${root}/runtime/locks`,
    },
  };
  const execution: CycleRepositoryExecutionContext = {
    workspaceId: "roll",
    issueRoot,
    repositories: Object.fromEntries(bindings.map((binding, index) => [binding.repoId, {
      repoId: binding.repoId,
      alias: binding.alias,
      access: index === 0 ? "write" : "read",
      requiredDelivery: index === 0,
      ...(index === 0 ? { noChangePolicy: "changes_required" as const } : {}),
      worktreePath: `${issueRoot}/${binding.alias}`,
      baseSha: `${index + 1}`.repeat(40),
      headSha: `${index + 3}`.repeat(40),
      commands: { test: [], integration: [] },
    }])),
  };
  return { workspace, execution };
}

describe("US-WS-033 — Workspace cycle context handoff", () => {
  it("keeps one frozen context through cycle state, agent env, cwd changes, and replay", () => {
    const { workspace, execution } = fixture();
    const frozen = freezeWorkspaceCycleContext({ workspace, storyId: "US-WS-033", execution });
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;

    const initial = initialCycleState({
      cycleId: "cycle-033",
      branch: "loop/cycle-033",
      loop: "ci",
      workspaceExecution: workspace,
    });
    const started = cycleStep(initial, { type: "start", ctx: initial.ctx });
    const preflight = cycleStep(started.state, { type: "preflight_done" });
    const worktree = cycleStep(preflight.state, { type: "worktree_created" });
    const picked = cycleStep(worktree.state, {
      type: "story_picked",
      storyId: "US-WS-033",
      repositoryExecution: execution,
      workspaceExecution: frozen.context,
    });

    expect(picked.state.ctx.workspaceExecution).toBe(frozen.context);
    expect(picked.state.ctx.repositoryExecution).toBe(execution);
    const env = workspaceExecutionEnvironment(picked.state.ctx.workspaceExecution);
    expect(env.ROLL_WORKSPACE).toBe("roll");
    expect(env.ROLL_STORY_ID).toBe("US-WS-033");
    expect(JSON.parse(env.ROLL_WORKSPACE_EXECUTION_CONTEXT ?? "null")).toEqual(frozen.context);
    expect(picked.state.ctx.workspaceExecution?.workspace.root).not.toBe("/tmp");
  });

  it("fails before spawn when the frozen context does not match the picked Story", () => {
    const { workspace, execution } = fixture();
    const mismatch = freezeWorkspaceCycleContext({ workspace, storyId: "US-OTHER-001", execution });
    expect(mismatch).toMatchObject({ ok: false, code: "missing_execution_context" });
  });
});
