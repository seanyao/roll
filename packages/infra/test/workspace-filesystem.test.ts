import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseWorkspaceInitConfig } from "@roll/core";
import {
  applyWorkspaceInitialization,
  inspectWorkspaceInitialization,
  workspaceInitJournalPath,
  workspaceInitLockPath,
  workspaceRegistryTransactionPath,
  workspaceRegistryPath,
} from "../src/index.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "roll-workspace-init-fs-"));
  roots.push(home);
  const rollHome = join(home, ".roll");
  const root = join(rollHome, "workspaces", "ws-demo");
  const parsed = parseWorkspaceInitConfig(`
schema: roll.workspace-init/v1
id: ws-demo
root: ${root}
display_name: Demo
repositories:
  - alias: primary
    source: file:///tmp/remotes/product.git
    integration_branch: main
`, {
    workspaceId: "ws-demo",
    configPath: join(home, "workspace-init.yaml"),
    homeDir: home,
    rollHome,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return { home, rollHome, root, config: parsed.value };
}

function tree(root: string): readonly string[] {
  if (!existsSync(root)) return [];
  const rows: string[] = [];
  const visit = (path: string): void => {
    for (const name of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const target = join(path, name.name);
      const rel = relative(root, target);
      if (name.isDirectory()) {
        rows.push(`d:${rel}`);
        visit(target);
      } else {
        const digest = createHash("sha256").update(readFileSync(target)).digest("hex");
        rows.push(`f:${rel}:${digest}`);
      }
    }
  };
  visit(root);
  return rows;
}

describe("Workspace filesystem transaction", () => {
  it("keeps read-only inspection byte-for-byte side-effect free", async () => {
    const f = fixture();
    const beforeHome = tree(f.home);
    const beforeRoot = tree(f.root);
    const plan = await inspectWorkspaceInitialization(f.config, {
      inspectCache: async () => "absent",
    });
    expect(plan.outcome).toBe("created");
    expect(tree(f.home)).toEqual(beforeHome);
    expect(tree(f.root)).toEqual(beforeRoot);
  });

  it("creates the complete layout, registers last, and reuses an identical config", async () => {
    const f = fixture();
    const ensureCache = vi.fn(async () => ({ action: "created" as const }));
    const first = await applyWorkspaceInitialization(f.config, {
      inspectCache: async () => "absent",
      ensureCache,
    });
    expect(first.outcome).toBe("created");
    expect(first.plan.steps.at(-1)).toMatchObject({ kind: "registry", target: "ws-demo" });
    expect(JSON.parse(readFileSync(join(f.root, "workspace.yaml"), "utf8"))).toMatchObject({ workspaceId: "ws-demo" });
    expect(tree(f.root).map((row) => row.split(":").slice(0, 2).join(":"))).toEqual(expect.arrayContaining([
      "f:agents.yaml",
      "f:backlog/index.md",
      "f:charter.md",
      "d:design",
      "d:issues",
      "f:policy.yaml",
      "d:requirements",
      "d:runtime",
      "f:workspace.yaml",
    ]));
    expect(tree(f.root).some((row) => row.includes(".git"))).toBe(false);
    expect(JSON.parse(readFileSync(workspaceRegistryPath(f.rollHome), "utf8"))).toMatchObject({
      entries: [{ workspaceId: "ws-demo", root: f.root }],
    });
    expect(existsSync(workspaceInitJournalPath(f.rollHome, "ws-demo"))).toBe(false);

    ensureCache.mockResolvedValue({ action: "reused" as const });
    const second = await applyWorkspaceInitialization(f.config, {
      inspectCache: async () => "compatible",
      ensureCache,
    });
    expect(second.outcome).toBe("reused");
    expect(ensureCache).toHaveBeenCalledTimes(2);
  });

  it("rolls back clean transaction artifacts after several steps while preserving pre-existing and dirty content", async () => {
    const f = fixture();
    mkdirSync(f.rollHome, { recursive: true });
    const preExisting = join(f.rollHome, "operator-owned.txt");
    writeFileSync(preExisting, "keep\n", "utf8");
    await expect(applyWorkspaceInitialization(f.config, {
      inspectCache: async () => "absent",
      ensureCache: async () => ({ action: "created" as const }),
      afterStep: (step) => {
        if (step.target.endsWith("workspace.yaml")) {
          expect(existsSync(workspaceInitJournalPath(f.rollHome, "ws-demo"))).toBe(true);
          writeFileSync(step.target, "operator changed this file\n", "utf8");
        }
        if (step.target.endsWith(join("backlog", "index.md"))) {
          throw new Error("injected failure");
        }
      },
    })).rejects.toThrow("injected failure");

    expect(readFileSync(preExisting, "utf8")).toBe("keep\n");
    expect(readFileSync(join(f.root, "workspace.yaml"), "utf8")).toBe("operator changed this file\n");
    for (const clean of ["charter.md", "agents.yaml", "policy.yaml", join("backlog", "index.md")]) {
      expect(existsSync(join(f.root, clean)), clean).toBe(false);
    }
    for (const cleanDirectory of ["requirements", "design", "backlog"]) {
      expect(existsSync(join(f.root, cleanDirectory)), cleanDirectory).toBe(false);
    }
    expect(existsSync(workspaceRegistryPath(f.rollHome))).toBe(false);
    const journal = JSON.parse(readFileSync(workspaceInitJournalPath(f.rollHome, "ws-demo"), "utf8")) as Record<string, unknown>;
    expect(journal).toMatchObject({
      schema: "roll.workspace-init-journal/v1",
      workspaceId: "ws-demo",
      status: "repair_required",
    });
    expect(journal["preserved"]).toEqual(expect.arrayContaining([expect.stringContaining("workspace.yaml")]));
  });

  it("removes a failed atomic write temporary without exposing partial target content", async () => {
    const f = fixture();
    await expect(applyWorkspaceInitialization(f.config, {
      inspectCache: async () => "absent",
      ensureCache: async () => ({ action: "created" as const }),
      renameFile: (from, to) => {
        if (to.endsWith("charter.md")) throw new Error("atomic rename failure");
        renameSync(from, to);
      },
    })).rejects.toThrow("atomic rename failure");

    expect(existsSync(join(f.root, "charter.md"))).toBe(false);
    expect(tree(f.home).filter((row) => row.includes(".tmp."))).toEqual([]);
    expect(JSON.parse(readFileSync(workspaceInitJournalPath(f.rollHome, "ws-demo"), "utf8")))
      .toMatchObject({ status: "repair_required" });
  });

  it("rejects incompatible pre-existing content without creating registry, cache or journal state", async () => {
    const f = fixture();
    mkdirSync(f.root, { recursive: true });
    writeFileSync(join(f.root, "workspace.yaml"), "not the requested manifest\n", "utf8");
    const ensureCache = vi.fn(async () => ({ action: "created" as const }));
    await expect(applyWorkspaceInitialization(f.config, {
      inspectCache: async () => "absent",
      ensureCache,
    })).rejects.toMatchObject({ code: "rejected" });
    expect(ensureCache).not.toHaveBeenCalled();
    expect(existsSync(workspaceRegistryPath(f.rollHome))).toBe(false);
    expect(existsSync(workspaceInitJournalPath(f.rollHome, "ws-demo"))).toBe(false);
  });

  it("rejects a root that aliases the machine cache through a symbolic link without writing state", async () => {
    const f = fixture();
    const repos = join(f.rollHome, "repos");
    const linked = join(f.home, "linked");
    mkdirSync(repos, { recursive: true });
    symlinkSync(repos, linked, "dir");
    const config = { ...f.config, root: join(linked, "ws-demo") };
    const before = tree(f.rollHome);

    const plan = await inspectWorkspaceInitialization(config, { inspectCache: async () => "absent" });

    expect(plan.outcome).toBe("rejected");
    expect(tree(f.rollHome)).toEqual(before);
  });

  it("fails closed when another process holds the Workspace init lock", async () => {
    const f = fixture();
    const lock = workspaceInitLockPath(f.rollHome, "ws-other");
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "meta.json"), `${JSON.stringify({
      pid: process.pid,
      hostname: hostname(),
      startedAt: Math.floor(Date.now() / 1000),
      cycleId: "other-init",
    })}\n`, "utf8");

    await expect(applyWorkspaceInitialization(f.config, {
      inspectCache: async () => "absent",
      ensureCache: async () => ({ action: "created" as const }),
    })).rejects.toMatchObject({ code: "concurrent_init" });
    expect(existsSync(lock)).toBe(true);
    expect(existsSync(workspaceInitJournalPath(f.rollHome, "ws-demo"))).toBe(false);
  });

  it("rejects a second lexical root for an already registered canonical Workspace", async () => {
    const f = fixture();
    await applyWorkspaceInitialization(f.config, {
      inspectCache: async () => "absent",
      ensureCache: async () => ({ action: "created" as const }),
    });
    const alias = join(f.home, "workspace-alias");
    symlinkSync(dirname(f.root), alias, "dir");
    const aliased = { ...f.config, root: join(alias, "ws-demo") };
    const before = tree(f.rollHome);

    await expect(applyWorkspaceInitialization(aliased, {
      inspectCache: async () => "compatible",
      ensureCache: async () => ({ action: "reused" as const }),
    })).rejects.toMatchObject({ code: "rejected" });
    expect(tree(f.rollHome)).toEqual(before);
  });

  it("keeps the winner when another Workspace ID targets the same canonical root", async () => {
    const f = fixture();
    await applyWorkspaceInitialization(f.config, {
      inspectCache: async () => "absent",
      ensureCache: async () => ({ action: "created" as const }),
    });
    const winner = tree(f.rollHome);
    const loser = {
      ...f.config,
      workspaceId: "ws-other",
      manifest: { ...f.config.manifest, workspaceId: "ws-other" },
    };

    await expect(applyWorkspaceInitialization(loser, {
      inspectCache: async () => "compatible",
      ensureCache: async () => ({ action: "reused" as const }),
    })).rejects.toMatchObject({ code: "rejected" });

    expect(tree(f.rollHome)).toEqual(winner);
    expect(JSON.parse(readFileSync(join(f.root, "workspace.yaml"), "utf8"))).toMatchObject({ workspaceId: "ws-demo" });
    expect(JSON.parse(readFileSync(workspaceRegistryPath(f.rollHome), "utf8"))).toMatchObject({
      entries: [{ workspaceId: "ws-demo", root: f.root }],
    });
    expect(existsSync(workspaceInitJournalPath(f.rollHome, "ws-other"))).toBe(false);
  });

  it("rejects a pending registry transaction before creating init state", async () => {
    const f = fixture();
    mkdirSync(f.rollHome, { recursive: true });
    writeFileSync(workspaceRegistryTransactionPath(f.rollHome), "{}\n", "utf8");
    const before = tree(f.rollHome);

    await expect(applyWorkspaceInitialization(f.config, {
      inspectCache: async () => "absent",
      ensureCache: async () => ({ action: "created" as const }),
    })).rejects.toMatchObject({ code: "rejected" });
    expect(tree(f.rollHome)).toEqual(before);
  });

  it("preserves committed Workspace state when cleanup fails after registry commit", async () => {
    const f = fixture();
    await expect(applyWorkspaceInitialization(f.config, {
      inspectCache: async () => "absent",
      ensureCache: async () => ({ action: "created" as const }),
      afterStep: (step) => {
        if (step.kind === "registry") throw new Error("post-registry cleanup failure");
      },
    })).rejects.toThrow("post-registry cleanup failure");

    expect(existsSync(join(f.root, "workspace.yaml"))).toBe(true);
    expect(existsSync(workspaceRegistryPath(f.rollHome))).toBe(true);
    expect(JSON.parse(readFileSync(workspaceInitJournalPath(f.rollHome, "ws-demo"), "utf8")))
      .toMatchObject({ status: "repair_required" });
  });
});
