import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireLock, releaseLock } from "../src/process.js";
import {
  captureRequirementSource,
  requirementCaptureLockPath,
} from "../src/requirement-source-store.js";

const roots: string[] = [];

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "roll-requirement-store-"));
  roots.push(root);
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  write(join(workspace, "workspace.yaml"), `${JSON.stringify({
    schema: "roll.workspace/v1",
    workspaceId: "ws-demo",
    displayName: "Demo",
    requirements: [
      { provider: "JIRA", ref: "sot-15499" },
      { provider: "github-issue", ref: "Owner/Repo#12" },
    ],
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
  for (const storyId of ["US-WS-007", "US-WS-008", "US-WS-009"]) {
    write(join(workspace, "backlog", "epic", storyId, "spec.md"), `# ${storyId}\n`);
  }
  const body = join(root, "requirement.md");
  write(body, "# Jira requirement\n\nShip the Workspace source archive.\n");
  const contextRoot = join(root, "context-source");
  write(join(contextRoot, "domain.md"), "domain context\n");
  write(join(contextRoot, "brief", "acceptance.md"), "acceptance context\n");
  return { root, workspace, body, contextRoot };
}

function request(f: ReturnType<typeof fixture>, overrides: Record<string, unknown> = {}) {
  return {
    workspaceRoot: f.workspace,
    provider: "jira",
    ref: "SOT-15499",
    revision: "42",
    capturedAt: "2026-07-20T16:00:00.000Z",
    bodyFile: f.body,
    contextRoot: f.contextRoot,
    contextPaths: ["domain.md", "brief/acceptance.md"],
    storyIds: ["US-WS-008", "US-WS-007"],
    ...overrides,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("US-WS-007 RequirementSourceStore", () => {
  it("commits immutable revisions, keeps identical captures at zero writes and extends Story links separately", () => {
    const f = fixture();
    const renames: string[] = [];
    const deps = { renameFile: (from: string, to: string) => { renames.push(to); renameSync(from, to); } };
    const first = captureRequirementSource(request(f), deps);
    expect(first).toMatchObject({
      outcome: "created",
      workspaceId: "ws-demo",
      manifest: { provider: "jira", ref: "SOT-15499", revision: "42", stories: ["US-WS-007", "US-WS-008"] },
      contextCount: 2,
    });
    expect(first.requirementPath).toMatch(/requirements\/jira\/req-c78ccf14ea21$/u);
    const revisionKey = "rev-" + "73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049";
    const revision = join(first.requirementPath, "revisions", revisionKey);
    expect(readFileSync(join(revision, "requirement.md"), "utf8")).toContain("Jira requirement");
    expect(readFileSync(join(revision, "context", "brief", "acceptance.md"), "utf8")).toBe("acceptance context\n");
    expect(readFileSync(join(first.requirementPath, "attest.md"), "utf8")).toContain("Generated aggregate projection");
    expect(lstatSync(revision).isDirectory()).toBe(true);

    const writesAfterFirst = renames.length;
    const reused = captureRequirementSource(request(f, { capturedAt: "2030-01-01T00:00:00.000Z" }), deps);
    expect(reused.outcome).toBe("reused");
    expect(renames).toHaveLength(writesAfterFirst);

    const linked = captureRequirementSource(request(f, { storyIds: ["US-WS-009"] }), deps);
    expect(linked).toMatchObject({ outcome: "linked", manifest: { stories: ["US-WS-007", "US-WS-008", "US-WS-009"] } });
    expect(readdirSync(join(first.requirementPath, "revisions"))).toEqual([revisionKey]);

    writeFileSync(f.body, "# Jira requirement\n\nRevision 43.\n", "utf8");
    const updated = captureRequirementSource(request(f, {
      revision: "43",
      capturedAt: "2026-07-20T17:00:00.000Z",
      storyIds: ["US-WS-009"],
      contextPaths: [],
    }), deps);
    expect(updated).toMatchObject({ outcome: "updated", manifest: { revision: "43", previousRevisions: [{ revision: "42" }] } });
    expect(readFileSync(join(revision, "requirement.md"), "utf8")).toContain("Ship the Workspace source archive");
    expect(readFileSync(join(updated.requirementPath, "requirement.md"), "utf8")).toContain("Revision 43");
    expect(readdirSync(join(updated.requirementPath, "revisions"))).toHaveLength(2);
  });

  it("rejects undeclared sources, dangling Stories, traversal, symlinks, non-regular files and context limits", () => {
    const f = fixture();
    expect(() => captureRequirementSource(request(f, { ref: "SOT-99999" }))).toThrowError(
      expect.objectContaining({ code: "source_not_declared" }),
    );
    expect(() => captureRequirementSource(request(f, { storyIds: ["US-MISSING"] }))).toThrowError(
      expect.objectContaining({ code: "story_not_found" }),
    );
    expect(() => captureRequirementSource(request(f, { contextPaths: ["../requirement.md"] }))).toThrowError(
      expect.objectContaining({ code: "unsafe_context" }),
    );
    symlinkSync(join(f.contextRoot, "domain.md"), join(f.contextRoot, "linked.md"));
    expect(() => captureRequirementSource(request(f, { contextPaths: ["linked.md"] }))).toThrowError(
      expect.objectContaining({ code: "unsafe_context" }),
    );
    expect(() => captureRequirementSource(request(f, { contextPaths: ["brief"] }))).toThrowError(
      expect.objectContaining({ code: "unsafe_context" }),
    );
    write(join(f.contextRoot, "huge.bin"), "x".repeat(1024 * 1024 + 1));
    const reads: string[] = [];
    expect(() => captureRequirementSource(request(f, { contextPaths: ["huge.bin"] }))).toThrowError(
      expect.objectContaining({ code: "context_limit" }),
    );
    expect(() => captureRequirementSource(request(f, { contextPaths: ["huge.bin"] }), {
      afterReadFile: (path) => reads.push(path),
    })).toThrowError(expect.objectContaining({ code: "context_limit" }));
    expect(reads).not.toContain(join(f.contextRoot, "huge.bin"));
  });

  it("rejects Workspace output symlinks before committing any evidence", () => {
    const f = fixture();
    const outside = join(f.root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(f.workspace, "requirements"));

    expect(() => captureRequirementSource(request(f))).toThrowError(
      expect.objectContaining({ code: "unsafe_context" }),
    );
    expect(readdirSync(outside)).toEqual([]);
  });

  it("fails closed on source mutation, revision rename failure and a concurrent writer", () => {
    const f = fixture();
    let mutated = false;
    expect(() => captureRequirementSource(request(f), {
      afterReadFile: (path) => {
        if (!mutated && path === f.body) {
          mutated = true;
          writeFileSync(path, "changed during capture\n", "utf8");
        }
      },
    })).toThrowError(expect.objectContaining({ code: "source_changed" }));

    writeFileSync(f.body, "stable again\n", "utf8");
    expect(() => captureRequirementSource(request(f), {
      renameFile: (from, to) => {
        if (to.includes("/revisions/")) throw new Error("rename failure");
        renameSync(from, to);
      },
    })).toThrowError(expect.objectContaining({ code: "io_failure" }));
    expect(existsSync(join(f.workspace, "requirements", "jira", "req-c78ccf14ea21", "source.yaml"))).toBe(false);

    const lockPath = requirementCaptureLockPath(f.workspace, "req-c78ccf14ea21");
    const lock = acquireLock(lockPath, process.pid, { cycleId: "test-holder", unparseableIsHeld: true });
    expect(lock.acquired).toBe(true);
    try {
      expect(() => captureRequirementSource(request(f))).toThrowError(expect.objectContaining({ code: "concurrent_capture" }));
    } finally {
      releaseLock(lockPath);
    }
  });

  it("commits source authority before projections and repairs an interrupted projection on retry", () => {
    const f = fixture();
    expect(() => captureRequirementSource(request(f), { beforeProjection: () => { throw new Error("projection failed"); } }))
      .toThrowError(expect.objectContaining({ code: "projection_repair_required" }));
    const requirementPath = join(f.workspace, "requirements", "jira", "req-c78ccf14ea21");
    expect(JSON.parse(readFileSync(join(requirementPath, "source.yaml"), "utf8"))).toMatchObject({ revision: "42" });
    expect(existsSync(join(requirementPath, "projection.pending.json"))).toBe(true);

    const repaired = captureRequirementSource(request(f, { capturedAt: "2030-01-01T00:00:00.000Z" }));
    expect(repaired.outcome).toBe("reused");
    expect(existsSync(join(requirementPath, "projection.pending.json"))).toBe(false);
    expect(readFileSync(join(requirementPath, "requirement.md"), "utf8")).toContain("Jira requirement");
  });

  it("does not switch source authority when the projection journal cannot be prepared", () => {
    const f = fixture();
    expect(() => captureRequirementSource(request(f), {
      renameFile: (from, to) => {
        if (to.endsWith("projection.pending.json")) throw new Error("journal unavailable");
        renameSync(from, to);
      },
    })).toThrowError(expect.objectContaining({ code: "projection_repair_required" }));
    const requirementPath = join(f.workspace, "requirements", "jira", "req-c78ccf14ea21");
    expect(existsSync(join(requirementPath, "source.yaml"))).toBe(false);
  });

  it("fails loudly when an immutable revision is missing or tampered before reuse", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    const revision = join(first.requirementPath, "revisions", "rev-73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049");
    writeFileSync(join(revision, "requirement.md"), "tampered evidence\n", "utf8");
    expect(() => captureRequirementSource(request(f))).toThrowError(
      expect.objectContaining({ code: "revision_conflict" }),
    );

    rmSync(revision, { recursive: true });
    expect(() => captureRequirementSource(request(f))).toThrowError(
      expect.objectContaining({ code: "revision_conflict" }),
    );
  });
});
