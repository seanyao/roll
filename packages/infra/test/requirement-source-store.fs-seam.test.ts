import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const seam: string[] = [];

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    mkdirSync: (...args: Parameters<typeof actual.mkdirSync>) => {
      seam.push(`mkdir:${String(args[0])}`);
      return actual.mkdirSync(...args);
    },
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      seam.push(`write:${String(args[0])}`);
      return actual.writeFileSync(...args);
    },
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      seam.push(`rename:${String(args[0])}->${String(args[1])}`);
      return actual.renameSync(...args);
    },
    rmSync: (...args: Parameters<typeof actual.rmSync>) => {
      seam.push(`rm:${String(args[0])}`);
      return actual.rmSync(...args);
    },
    unlinkSync: (...args: Parameters<typeof actual.unlinkSync>) => {
      seam.push(`unlink:${String(args[0])}`);
      return actual.unlinkSync(...args);
    },
  };
});

const roots: string[] = [];

describe("US-WS-007 RequirementSourceStore fs mutation seam", () => {
  afterEach(async () => {
    const { rmSync } = await vi.importActual<typeof import("node:fs")>("node:fs");
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("proves identical reuse triggers zero mkdir/write/rename/rm/unlink on the evidence tree, allowing only the expected lock create-then-delete pair", async () => {
    const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const os = await import("node:os");
    const { captureRequirementSource } = await import("../src/requirement-source-store.js");

    function write(path: string, text: string): void {
      fs.mkdirSync(dirname(path), { recursive: true });
      fs.writeFileSync(path, text, "utf8");
    }

    const root = fs.mkdtempSync(join(os.tmpdir(), "roll-fs-seam-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    fs.mkdirSync(workspace);
    write(join(workspace, "workspace.yaml"), `${JSON.stringify({
      schema: "roll.workspace/v1",
      workspaceId: "ws-demo",
      displayName: "Demo",
      requirements: [{ provider: "jira", ref: "SOT-15499" }],
      repositories: [{
        schema: "roll.repository-binding/v1",
        repoId: "repo-ff7a87ddbb2b",
        alias: "product",
        remote: "https://example.test/owner/product",
        integrationBranch: "main",
        provider: "generic",
        workflow: { branchPattern: "roll/{workspace_id}/{story_id}", requiredChecks: [] },
      }],
    }, null, 2)}\n`);
    write(join(workspace, "backlog", "epic", "US-WS-007", "spec.md"), "# US-WS-007\n");
    const body = join(root, "requirement.md");
    write(body, "# Jira requirement\n\nShip the Workspace source archive.\n");
    const contextRoot = join(root, "context-source");
    write(join(contextRoot, "domain.md"), "domain context\n");

    const request = {
      workspaceRoot: workspace,
      provider: "jira",
      ref: "SOT-15499",
      revision: "42",
      capturedAt: "2026-07-20T16:00:00.000Z",
      bodyFile: body,
      contextRoot,
      contextPaths: ["domain.md"],
      storyIds: ["US-WS-007"],
    };

    const first = captureRequirementSource(request);
    expect(first.outcome).toBe("created");

    seam.length = 0;
    const reused = captureRequirementSource({ ...request, capturedAt: "2030-01-01T00:00:00.000Z" });
    expect(reused.outcome).toBe("reused");

    const requirementsRoot = join(workspace, "requirements");
    const evidenceMutations = seam.filter((entry) => entry.includes(requirementsRoot));
    expect(evidenceMutations).toEqual([]);

    const lockRoot = join(workspace, "runtime", "locks");
    const nonLockMutations = seam.filter((entry) => !entry.includes(lockRoot));
    expect(nonLockMutations).toEqual([]);

    const lockCreates = seam.filter((entry) => entry.startsWith("mkdir:") || entry.startsWith("write:"));
    const lockDeletes = seam.filter((entry) => entry.startsWith("rm:") || entry.startsWith("unlink:"));
    expect(lockCreates.length).toBeGreaterThan(0);
    expect(lockDeletes.length).toBeGreaterThan(0);
  });
});
