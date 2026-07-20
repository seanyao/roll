import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseWorkspaceInitConfig } from "@roll/core";
import {
  applyWorkspaceInitialization,
  inspectWorkspaceInitialization,
  workspaceInitJournalPath,
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
    nowIso: "2026-07-20T00:00:00.000Z",
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

  it("writes the journal first and preserves a transaction-created file that became dirty", async () => {
    const f = fixture();
    await expect(applyWorkspaceInitialization(f.config, {
      inspectCache: async () => "absent",
      ensureCache: async () => ({ action: "created" as const }),
      afterStep: (step) => {
        if (step.target.endsWith("workspace.yaml")) {
          expect(existsSync(workspaceInitJournalPath(f.rollHome, "ws-demo"))).toBe(true);
          writeFileSync(step.target, "operator changed this file\n", "utf8");
          throw new Error("injected failure");
        }
      },
    })).rejects.toThrow("injected failure");

    expect(readFileSync(join(f.root, "workspace.yaml"), "utf8")).toBe("operator changed this file\n");
    expect(existsSync(workspaceRegistryPath(f.rollHome))).toBe(false);
    const journal = JSON.parse(readFileSync(workspaceInitJournalPath(f.rollHome, "ws-demo"), "utf8")) as Record<string, unknown>;
    expect(journal).toMatchObject({
      schema: "roll.workspace-init-journal/v1",
      workspaceId: "ws-demo",
      status: "repair_required",
    });
    expect(journal["preserved"]).toEqual(expect.arrayContaining([expect.stringContaining("workspace.yaml")]));
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
});
