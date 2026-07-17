/**
 * E2 — direct unit coverage for the extracted submodule-worktree module:
 * resolveStoryTargetSubmodule's two declaration sites (backlog tag wins over
 * spec frontmatter; spec frontmatter is the fallback), and
 * createSubmoduleWorktreeIfDeclared's success / failure / no-op outcomes.
 */
import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { submoduleWorktreePath } from "@roll/infra";
import type { Ports } from "../src/runner/ports.js";
import {
  createSubmoduleWorktreeIfDeclared,
  resolveExecutionCwd,
  resolveExecutionRepoCwd,
  resolveStoryTargetSubmodule,
} from "../src/runner/submodule-worktree.js";

/** A repo root with a story spec.md carrying the given frontmatter. */
function repoWithSpec(storyId: string, frontmatter: string): string {
  const root = mkdtempSync(join(tmpdir(), "roll-e2-subwt-"));
  const dir = join(root, ".roll", "features", "epic", storyId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.md"), `---\n${frontmatter}\n---\n# ${storyId}\n`);
  return root;
}

function ports(repoCwd: string, over: Partial<Ports["git"]> = {}): { ports: Ports; events: unknown[]; alerts: string[] } {
  const events: unknown[] = [];
  const alerts: string[] = [];
  const p = {
    repoCwd,
    clock: () => 100,
    paths: {
      eventsPath: join(repoCwd, ".roll", "loop", "events.ndjson"),
      alertsPath: join(repoCwd, ".roll", "loop", "ALERT.md"),
      worktreePath: join(repoCwd, ".roll", "loop", "cycle-x"),
    },
    events: {
      appendEvent: (_p: string, e: unknown) => events.push(e),
      appendAlert: (_p: string, m: string) => alerts.push(m),
      ensureEventFiles: vi.fn(),
      upsertRun: vi.fn(),
    },
    git: {
      worktreeAddInSubmodule: vi.fn(async () => ({ code: 0, stderr: "" })),
      ...over,
    },
  } as unknown as Ports;
  return { ports: p, events, alerts };
}

describe("resolveStoryTargetSubmodule", () => {
  it("returns undefined when neither tag nor spec declares one", () => {
    const root = repoWithSpec("US-1", "epic: e");
    expect(resolveStoryTargetSubmodule(ports(root).ports, { id: "US-1", desc: "plain" })).toBeUndefined();
  });

  it("reads the backlog tag when present", () => {
    const root = repoWithSpec("US-1", "epic: e");
    expect(
      resolveStoryTargetSubmodule(ports(root).ports, { id: "US-1", desc: "`target-submodule:dukang-service-online`" }),
    ).toBe("dukang-service-online");
  });

  it("falls back to the spec frontmatter when the tag is absent", () => {
    const root = repoWithSpec("US-1", "target_submodule: from-spec");
    expect(resolveStoryTargetSubmodule(ports(root).ports, { id: "US-1", desc: "no tag here" })).toBe("from-spec");
  });

  it("prefers the backlog tag over the spec frontmatter when both are present", () => {
    const root = repoWithSpec("US-1", "target_submodule: from-spec");
    expect(
      resolveStoryTargetSubmodule(ports(root).ports, { id: "US-1", desc: "`target-submodule:from-tag`" }),
    ).toBe("from-tag");
  });
});

describe("createSubmoduleWorktreeIfDeclared", () => {
  it("is a clean no-op when no submodule is declared", async () => {
    const root = repoWithSpec("US-1", "epic: e");
    const { ports: p, events } = ports(root);
    const r = await createSubmoduleWorktreeIfDeclared(p, { cycleId: "c1" }, { id: "US-1", desc: "plain" });
    expect(r).toEqual({ failed: false });
    expect(p.git.worktreeAddInSubmodule).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it("creates the worktree + emits worktree:submodule on success", async () => {
    const root = repoWithSpec("US-1", "epic: e");
    const { ports: p, events } = ports(root);
    const r = await createSubmoduleWorktreeIfDeclared(
      p,
      { cycleId: "c1" },
      { id: "US-1", desc: "`target-submodule:sub`" },
    );
    expect(r).toEqual({ targetSubmodule: "sub", failed: false });
    expect(p.git.worktreeAddInSubmodule).toHaveBeenCalledWith(root, "sub", p.paths.worktreePath, "origin/main");
    expect(events).toContainEqual(expect.objectContaining({ type: "worktree:submodule", submodule: "sub" }));
  });

  it("reports failed + alerts (no event) when the submodule worktree add fails", async () => {
    const root = repoWithSpec("US-1", "epic: e");
    const { ports: p, events, alerts } = ports(root, {
      worktreeAddInSubmodule: vi.fn(async () => ({ code: 1, stderr: "not initialized" })),
    });
    const r = await createSubmoduleWorktreeIfDeclared(
      p,
      { cycleId: "c1" },
      { id: "US-1", desc: "`target-submodule:sub`" },
    );
    expect(r).toEqual({ targetSubmodule: "sub", failed: true });
    expect(events).toHaveLength(0);
    expect(alerts.join("\n")).toMatch(/submodule worktree add FAILED/);
  });
});

describe("resolveExecutionCwd (E4)", () => {
  it("returns the superproject worktree path when no target submodule is declared", () => {
    const { ports: p } = ports(mkdtempSync(join(tmpdir(), "roll-e4-")));
    expect(resolveExecutionCwd(p, {})).toBe(p.paths.worktreePath);
    expect(resolveExecutionCwd(p, { targetSubmodule: undefined })).toBe(p.paths.worktreePath);
    // An empty string is treated as "no submodule" (byte-identical to today).
    expect(resolveExecutionCwd(p, { targetSubmodule: "" })).toBe(p.paths.worktreePath);
  });

  it("routes into the submodule cycle worktree when a target submodule is declared", () => {
    const { ports: p } = ports(mkdtempSync(join(tmpdir(), "roll-e4-")));
    // E5: the submodule cycle worktree is the SIBLING <cycle>.submodules/<sub>,
    // never <cycle>/<sub> (which is the superproject worktree's own mount point).
    expect(resolveExecutionCwd(p, { targetSubmodule: "dukang-service-online" })).toBe(
      submoduleWorktreePath(p.paths.worktreePath, "dukang-service-online"),
    );
  });
});

describe("resolveExecutionRepoCwd (E4)", () => {
  it("returns the superproject repoCwd when no target submodule is declared", () => {
    const { ports: p } = ports(mkdtempSync(join(tmpdir(), "roll-e4-")));
    expect(resolveExecutionRepoCwd(p, {})).toBe(p.repoCwd);
    expect(resolveExecutionRepoCwd(p, { targetSubmodule: "" })).toBe(p.repoCwd);
  });

  it("routes into the submodule repo root when a target submodule is declared", () => {
    const { ports: p } = ports(mkdtempSync(join(tmpdir(), "roll-e4-")));
    expect(resolveExecutionRepoCwd(p, { targetSubmodule: "dukang-service-online" })).toBe(
      join(p.repoCwd, "dukang-service-online"),
    );
  });
});
