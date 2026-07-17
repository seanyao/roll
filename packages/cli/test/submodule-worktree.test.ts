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
import {
  gitmodulesPaths,
  inferTargetSubmodule,
} from "../src/lib/target-submodule.js";

/** A repo root with a story spec.md carrying the given frontmatter. */
function repoWithSpec(storyId: string, frontmatter: string, body = ""): string {
  const root = mkdtempSync(join(tmpdir(), "roll-e2-subwt-"));
  const dir = join(root, ".roll", "features", "epic", storyId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.md"), `---\n${frontmatter}\n---\n# ${storyId}\n${body}\n`);
  return root;
}

/** Add a `.gitmodules` at the repo root declaring the given submodule paths. */
function withGitmodules(root: string, paths: string[]): void {
  const text = paths
    .map((p) => `[submodule "${p}"]\n\tpath = ${p}\n\turl = ./${p}\n`)
    .join("");
  writeFileSync(join(root, ".gitmodules"), text);
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

// E6-B: gitmodulesPaths — parse ALL declared submodule paths from .gitmodules.
describe("gitmodulesPaths — E6", () => {
  it("returns every declared path (bare + quoted values)", () => {
    const text =
      `[submodule "dukang-service-online"]\n\tpath = dukang-service-online\n\turl = ../dukang\n` +
      `[submodule "webui"]\n\tpath = "service-online-webui-monorepo"\n\turl = ../webui\n`;
    expect(gitmodulesPaths(text)).toEqual([
      "dukang-service-online",
      "service-online-webui-monorepo",
    ]);
  });
  it("returns [] for empty / pathless text", () => {
    expect(gitmodulesPaths("")).toEqual([]);
    expect(gitmodulesPaths("[submodule \"x\"]\n\turl = ../x\n")).toEqual([]);
  });
});

// E6-B: inferTargetSubmodule — literal submodule-path matching in spec text.
describe("inferTargetSubmodule — E6", () => {
  const subs = ["dukang-service-online", "service-online-webui-monorepo"];
  it("returns the unique submodule referenced by literal path in the spec", () => {
    const spec = "Touch `dukang-service-online/src/main/java/Foo.java` and add a field.";
    expect(inferTargetSubmodule(spec, subs)).toBe("dukang-service-online");
  });
  it("returns undefined when the spec references 2+ different submodules (ambiguous — do not guess)", () => {
    const spec = "Wire dukang-service-online to service-online-webui-monorepo across the seam.";
    expect(inferTargetSubmodule(spec, subs)).toBeUndefined();
  });
  it("returns undefined when the spec references NO submodule path", () => {
    const spec = "A pure superproject doc change under doc/adr.";
    expect(inferTargetSubmodule(spec, subs)).toBeUndefined();
  });
  it("is idempotent across repeated references to the SAME submodule (still unique)", () => {
    const spec = "dukang-service-online here, dukang-service-online there, all in dukang-service-online.";
    expect(inferTargetSubmodule(spec, subs)).toBe("dukang-service-online");
  });
});

// E6-B: resolveStoryTargetSubmodule — inference + default_submodule fallback, and
// the precedence chain tag > frontmatter > inference > default_submodule.
describe("resolveStoryTargetSubmodule — E6 inference + default fallback", () => {
  it("infers the unique submodule when neither tag nor frontmatter declares one", () => {
    const root = repoWithSpec("US-1", "epic: e", "Edit dukang-service-online/build.gradle to add a dep.");
    withGitmodules(root, ["dukang-service-online", "service-online-webui-monorepo"]);
    expect(resolveStoryTargetSubmodule(ports(root).ports, { id: "US-1", desc: "plain" })).toBe(
      "dukang-service-online",
    );
  });

  it("does NOT guess when the spec references two submodules (ambiguous) → undefined", () => {
    const root = repoWithSpec(
      "US-1",
      "epic: e",
      "Connect dukang-service-online with service-online-webui-monorepo.",
    );
    withGitmodules(root, ["dukang-service-online", "service-online-webui-monorepo"]);
    expect(resolveStoryTargetSubmodule(ports(root).ports, { id: "US-1", desc: "plain" })).toBeUndefined();
  });

  it("falls back to default_submodule config when inference finds nothing", () => {
    const root = repoWithSpec("US-1", "epic: e", "A superproject-only doc change.");
    withGitmodules(root, ["dukang-service-online", "service-online-webui-monorepo"]);
    mkdirSync(join(root, ".roll"), { recursive: true });
    writeFileSync(join(root, ".roll", "local.yaml"), "default_submodule: dukang-service-online\n");
    expect(resolveStoryTargetSubmodule(ports(root).ports, { id: "US-1", desc: "plain" })).toBe(
      "dukang-service-online",
    );
  });

  it("explicit backlog tag WINS over inference", () => {
    const root = repoWithSpec("US-1", "epic: e", "Edit dukang-service-online/build.gradle.");
    withGitmodules(root, ["dukang-service-online", "service-online-webui-monorepo"]);
    expect(
      resolveStoryTargetSubmodule(ports(root).ports, {
        id: "US-1",
        desc: "`target-submodule:service-online-webui-monorepo`",
      }),
    ).toBe("service-online-webui-monorepo");
  });

  it("explicit spec frontmatter WINS over inference", () => {
    const root = repoWithSpec(
      "US-1",
      "target_submodule: service-online-webui-monorepo",
      "Edit dukang-service-online/build.gradle.",
    );
    withGitmodules(root, ["dukang-service-online", "service-online-webui-monorepo"]);
    expect(resolveStoryTargetSubmodule(ports(root).ports, { id: "US-1", desc: "plain" })).toBe(
      "service-online-webui-monorepo",
    );
  });

  it("ZERO regression: a repo with NO .gitmodules still resolves undefined (no inference)", () => {
    const root = repoWithSpec("US-1", "epic: e", "Edit dukang-service-online/build.gradle.");
    // No withGitmodules call — a plain (non-submodule) project.
    expect(resolveStoryTargetSubmodule(ports(root).ports, { id: "US-1", desc: "plain" })).toBeUndefined();
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
