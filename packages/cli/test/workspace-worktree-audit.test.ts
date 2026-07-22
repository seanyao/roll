import { describe, expect, it } from "vitest";
import {
  auditWorktrees,
  type WorkspaceWorktreeOwnership,
} from "../src/commands/worktree-audit.js";

const HEAD = "a".repeat(40);

describe("US-WS-011a Workspace worktree audit", () => {
  it("projects registry-bound Workspace identity and delivery proof onto an owned worktree", () => {
    const path = "/workspaces/alpha/issues/US-WS-900/primary";
    const ownership: WorkspaceWorktreeOwnership = {
      workspaceId: "ws-alpha",
      storyId: "US-WS-900",
      repoId: "repo-shared",
      repositoryAlias: "primary",
      cachePath: "/roll-home/repos/repo-shared.git",
      expectedBranch: "roll/ws-alpha/US-WS-900",
      active: false,
      deliveryProof: "delivered",
    };

    const output = auditWorktrees({
      repoRoot: ownership.cachePath,
      home: "/home/test",
      integrationBranch: "origin/main",
      workspaceOwnership: new Map([[path, ownership]]),
      git: (args) => {
        const command = args.join(" ");
        if (command === "worktree list --porcelain") {
          return `worktree ${path}\nHEAD ${HEAD}\nbranch refs/heads/${ownership.expectedBranch}\n`;
        }
        if (command.startsWith("status --porcelain")) return "";
        if (command === "rev-parse HEAD" || command === "merge-base HEAD origin/main") return HEAD;
        if (command === "rev-list --count origin/main..HEAD") return "0";
        if (command === "branch --format=%(refname:short)") return "loop/cycle-shared";
        if (command === "branch --merged origin/main") return ownership.expectedBranch;
        return "";
      },
      readDir: () => [],
      nowISO: () => "2026-07-22T00:00:00.000Z",
    });

    expect(output.records).toEqual([
      expect.objectContaining({
        owner: "workspace",
        workspaceId: "ws-alpha",
        storyId: "US-WS-900",
        repoId: "repo-shared",
        repositoryAlias: "primary",
        cachePath: ownership.cachePath,
        path,
        branch: `refs/heads/${ownership.expectedBranch}`,
        head: HEAD,
        active: false,
        deliveryProof: "delivered",
        disposition: "disposable_candidate",
      }),
    ]);
    expect(output.ephemeralBranches).toEqual(["loop/cycle-shared"]);
  });
});
