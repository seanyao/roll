import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWorkspaceBacklogStoryContract } from "../src/issue-story-contract.js";

const sandboxes: string[] = [];
afterEach(() => {
  for (const root of sandboxes.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), "roll-issue-story-contract-"));
  sandboxes.push(root);
  return root;
}

function writeSpec(path: string, storyId: string): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "spec.md"), `---
id: ${storyId}
repositories:
  - alias: sot
    access: write
    required_delivery: true
---

# ${storyId} fixture
`, "utf8");
}

describe("resolveWorkspaceBacklogStoryContract", () => {
  it("resolves a Story Contract found inside the Workspace backlog tree, at any depth", () => {
    const workspaceRoot = sandbox();
    writeSpec(join(workspaceRoot, "backlog", "workspace-orchestration", "US-XX1"), "US-XX1");
    const result = resolveWorkspaceBacklogStoryContract(workspaceRoot, "US-XX1");
    expect(result).toMatchObject({ ok: true, value: { storyId: "US-XX1" } });
  });

  it("does NOT resolve a Story Contract from the caller's cwd .roll/features tree", () => {
    const workspaceRoot = sandbox();
    // Deliberately place the spec OUTSIDE the Workspace backlog tree, in a
    // .roll/features layout — this must be invisible to the Workspace-scoped resolver.
    writeSpec(join(workspaceRoot, ".roll", "features", "workspace-orchestration", "US-XX1"), "US-XX1");
    const result = resolveWorkspaceBacklogStoryContract(workspaceRoot, "US-XX1");
    expect(result).toMatchObject({ ok: false, code: "story_not_found" });
  });

  it("fails loud when a story id resolves to more than one spec in the backlog tree", () => {
    const workspaceRoot = sandbox();
    writeSpec(join(workspaceRoot, "backlog", "epic-a", "US-XX1"), "US-XX1");
    writeSpec(join(workspaceRoot, "backlog", "epic-b", "US-XX1"), "US-XX1");
    const result = resolveWorkspaceBacklogStoryContract(workspaceRoot, "US-XX1");
    expect(result).toMatchObject({ ok: false, code: "duplicate_story" });
    if (result.ok) throw new Error("expected duplicate_story");
    expect(result.matches).toHaveLength(2);
  });

  it("reports story_not_found when no spec exists anywhere in the backlog tree", () => {
    const workspaceRoot = sandbox();
    mkdirSync(join(workspaceRoot, "backlog"), { recursive: true });
    const result = resolveWorkspaceBacklogStoryContract(workspaceRoot, "US-NOPE");
    expect(result).toMatchObject({ ok: false, code: "story_not_found" });
  });

  it("reports story_not_found when the Workspace has no backlog directory at all", () => {
    const workspaceRoot = sandbox();
    const result = resolveWorkspaceBacklogStoryContract(workspaceRoot, "US-XX1");
    expect(result).toMatchObject({ ok: false, code: "story_not_found" });
  });
});
