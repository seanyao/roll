import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  ftruncateSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_REQUIREMENT_BODY_BYTES, MAX_REQUIREMENT_CONTEXT_BYTES, MAX_REQUIREMENT_CONTEXT_FILES } from "@roll/core";
import { acquireLock, releaseLock } from "../src/process.js";
import {
  captureRequirementSource,
  requirementCaptureLockPath,
  resolveRequirementSourcesForStoryOnDisk,
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

  it("strictly parses the full source.yaml on disk after create/link/update and matches it field-for-field against the returned manifest contract", () => {
    const f = fixture();
    const created = captureRequirementSource(request(f));
    const createdOnDisk = JSON.parse(readFileSync(join(created.requirementPath, "source.yaml"), "utf8"));
    expect(createdOnDisk).toEqual(created.manifest);

    const linked = captureRequirementSource(request(f, { storyIds: ["US-WS-009"] }));
    const linkedOnDisk = JSON.parse(readFileSync(join(linked.requirementPath, "source.yaml"), "utf8"));
    expect(linkedOnDisk).toEqual(linked.manifest);

    writeFileSync(f.body, "# Jira requirement\n\nRevision 43.\n", "utf8");
    const updated = captureRequirementSource(request(f, {
      revision: "43",
      capturedAt: "2026-07-20T17:00:00.000Z",
      storyIds: ["US-WS-009"],
      contextPaths: [],
    }));
    const updatedOnDisk = JSON.parse(readFileSync(join(updated.requirementPath, "source.yaml"), "utf8"));
    expect(updatedOnDisk).toEqual(updated.manifest);
    expect(updatedOnDisk.schema).toBe("roll.requirement-source/v1");
    expect(updatedOnDisk.requirementId).toBe(created.manifest.requirementId);
    expect(updatedOnDisk.previousRevisions).toEqual([{ revision: "42", capturedAt: "2026-07-20T16:00:00.000Z" }]);
    expect(updatedOnDisk.attest).toEqual({
      schema: "roll.requirement-attest-projection/v1",
      mode: "generated_aggregate",
      evidenceAuthority: "issue",
    });
  });

  it("rejects a ref not declared in workspace.yaml", () => {
    const f = fixture();
    expect(() => captureRequirementSource(request(f, { ref: "SOT-99999" }))).toThrowError(
      expect.objectContaining({ code: "source_not_declared" }),
    );
  });

  it("rejects a Story ID that does not resolve inside the Workspace backlog", () => {
    const f = fixture();
    expect(() => captureRequirementSource(request(f, { storyIds: ["US-MISSING"] }))).toThrowError(
      expect.objectContaining({ code: "story_not_found" }),
    );
  });

  it("rejects a context path using .. traversal to escape its declared root", () => {
    const f = fixture();
    expect(() => captureRequirementSource(request(f, { contextPaths: ["../requirement.md"] }))).toThrowError(
      expect.objectContaining({ code: "unsafe_context" }),
    );
  });

  it("rejects a context path whose leaf entry is itself a symlink, independent of any ancestor-directory symlink case", () => {
    const f = fixture();
    symlinkSync(join(f.contextRoot, "domain.md"), join(f.contextRoot, "linked.md"));
    expect(() => captureRequirementSource(request(f, { contextPaths: ["linked.md"] }))).toThrowError(
      expect.objectContaining({ code: "unsafe_context" }),
    );
  });

  it("rejects a context path that names a directory instead of a regular file", () => {
    const f = fixture();
    expect(() => captureRequirementSource(request(f, { contextPaths: ["brief"] }))).toThrowError(
      expect.objectContaining({ code: "unsafe_context" }),
    );
  });

  it("rejects an oversized single context file without reading its content past the limit check", () => {
    const f = fixture();
    write(join(f.contextRoot, "huge.bin"), "x".repeat(1024 * 1024 + 1));
    expect(() => captureRequirementSource(request(f, { contextPaths: ["huge.bin"] }))).toThrowError(
      expect.objectContaining({ code: "context_limit" }),
    );
    const reads: string[] = [];
    expect(() => captureRequirementSource(request(f, { contextPaths: ["huge.bin"] }), {
      afterReadFile: (path) => reads.push(path),
    })).toThrowError(expect.objectContaining({ code: "context_limit" }));
    expect(reads).not.toContain(join(f.contextRoot, "huge.bin"));
  });

  it("proves an identical reuse capture makes truly zero filesystem mutations across the whole Workspace tree", () => {
    const f = fixture();
    captureRequirementSource(request(f));

    function snapshotTree(root: string): ReadonlyMap<string, string> {
      const entries = new Map<string, string>();
      const walk = (dir: string, relativeDir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
          const path = join(dir, entry.name);
          const relativePath = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
          const stat = lstatSync(path);
          const digest = stat.isFile() ? createHash("sha256").update(readFileSync(path)).digest("hex") : "";
          entries.set(relativePath, JSON.stringify({
            type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "dir" : "file",
            ino: stat.ino,
            dev: stat.dev,
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            digest,
          }));
          if (stat.isDirectory() && !stat.isSymbolicLink()) walk(path, relativePath);
        }
      };
      walk(root, "");
      return entries;
    }

    const evidenceRoot = join(f.workspace, "requirements");
    const before = snapshotTree(evidenceRoot);
    const reused = captureRequirementSource(request(f, { capturedAt: "2030-01-01T00:00:00.000Z" }));
    expect(reused.outcome).toBe("reused");
    const after = snapshotTree(evidenceRoot);

    expect(before.size).toBeGreaterThan(0);
    expect(Array.from(after.keys()).sort()).toEqual(Array.from(before.keys()).sort());
    for (const [path, beforeEntry] of before) {
      expect(after.get(path), `entry changed at ${path}`).toBe(beforeEntry);
    }
  });

  it("proves identical reuse never invokes mkdir/write/rename/unlink by instrumenting the fs seams", () => {
    const f = fixture();
    captureRequirementSource(request(f));

    const mutations: string[] = [];
    const reused = captureRequirementSource(request(f, { capturedAt: "2030-01-01T00:00:00.000Z" }), {
      renameFile: (from, to) => { mutations.push(`rename:${to}`); renameSync(from, to); },
      afterReadFile: () => { /* reads are expected; only mutation seams are asserted */ },
    });
    expect(reused.outcome).toBe("reused");
    expect(mutations).toEqual([]);
  });

  it("rejects a symlink nested inside a legitimate context subdirectory, not only at the top level", () => {
    const f = fixture();
    const outside = join(f.root, "outside-nested.txt");
    write(outside, "nested escape target\n");
    symlinkSync(outside, join(f.contextRoot, "brief", "nested-link.md"));
    expect(() => captureRequirementSource(request(f, { contextPaths: ["brief/nested-link.md"] }))).toThrowError(
      expect.objectContaining({ code: "unsafe_context" }),
    );
    expect(existsSync(join(f.workspace, "requirements"))).toBe(false);
  });

  it("rejects a context path whose immediate ancestor directory is itself a symlink to an outside real directory", () => {
    const f = fixture();
    const outsideDir = join(f.root, "outside-ancestor-dir");
    mkdirSync(outsideDir);
    write(join(outsideDir, "file.md"), "outside ancestor content\n");
    rmSync(join(f.contextRoot, "brief"), { recursive: true, force: true });
    symlinkSync(outsideDir, join(f.contextRoot, "brief"));

    expect(() => captureRequirementSource(request(f, { contextPaths: ["brief/file.md"] }))).toThrowError(
      expect.objectContaining({ code: "unsafe_context" }),
    );
    expect(existsSync(join(f.workspace, "requirements"))).toBe(false);
  });

  it("rejects a context path whose immediate ancestor directory is itself a symlink to an outside file (not a directory at all)", () => {
    const f = fixture();
    const outsideFile = join(f.root, "outside-ancestor-file.md");
    write(outsideFile, "outside ancestor is actually a file\n");
    rmSync(join(f.contextRoot, "brief"), { recursive: true, force: true });
    symlinkSync(outsideFile, join(f.contextRoot, "brief"));

    expect(() => captureRequirementSource(request(f, { contextPaths: ["brief/file.md"] }))).toThrowError(
      expect.objectContaining({ code: "unsafe_context" }),
    );
    expect(existsSync(join(f.workspace, "requirements"))).toBe(false);
  });

  it("rejects a context path whose grandparent ancestor directory (two levels up) is a symlink, not only the immediate parent", () => {
    const f = fixture();
    const outsideDir = join(f.root, "outside-grandparent-dir");
    mkdirSync(join(outsideDir, "inner"), { recursive: true });
    write(join(outsideDir, "inner", "leaf.md"), "outside grandparent content\n");
    rmSync(join(f.contextRoot, "brief"), { recursive: true, force: true });
    symlinkSync(outsideDir, join(f.contextRoot, "brief"));

    expect(() => captureRequirementSource(request(f, { contextPaths: ["brief/inner/leaf.md"] }))).toThrowError(
      expect.objectContaining({ code: "unsafe_context" }),
    );
    expect(existsSync(join(f.workspace, "requirements"))).toBe(false);
  });

  it("rejects a context path whose sibling-adjacent same-named real directory is bypassed by an ancestor symlink pointing elsewhere", () => {
    const f = fixture();
    write(join(f.contextRoot, "brief", "acceptance.md"), "legit acceptance content\n");
    const decoyDir = join(f.root, "decoy-brief");
    mkdirSync(decoyDir);
    write(join(decoyDir, "acceptance.md"), "decoy acceptance content\n");
    rmSync(join(f.contextRoot, "brief"), { recursive: true, force: true });
    symlinkSync(decoyDir, join(f.contextRoot, "brief"));

    expect(() => captureRequirementSource(request(f, { contextPaths: ["brief/acceptance.md"] }))).toThrowError(
      expect.objectContaining({ code: "unsafe_context" }),
    );
    expect(existsSync(join(f.workspace, "requirements"))).toBe(false);
  });

  it("rejects a context input path deeper than the shared depth cap before writing any immutable revision, journal or projection", () => {
    const f = fixture();
    const segments = Array.from({ length: 40 }, (_, index) => `d${index}`);
    const deepRelative = [...segments, "deep.md"].join("/");
    write(join(f.contextRoot, deepRelative), "too deep\n");

    expect(() => captureRequirementSource(request(f, { contextPaths: [deepRelative] }))).toThrowError(
      expect.objectContaining({ code: "unsafe_context" }),
    );
    expect(existsSync(join(f.workspace, "requirements"))).toBe(false);
  });

  it("accepts exactly MAX_REQUIREMENT_CONTEXT_FILES files and exactly MAX_REQUIREMENT_CONTEXT_BYTES total bytes", () => {
    const f = fixture();
    const perFileBytes = Math.floor(MAX_REQUIREMENT_CONTEXT_BYTES / MAX_REQUIREMENT_CONTEXT_FILES);
    const contextPaths: string[] = [];
    let used = 0;
    for (let index = 0; index < MAX_REQUIREMENT_CONTEXT_FILES; index += 1) {
      const isLast = index === MAX_REQUIREMENT_CONTEXT_FILES - 1;
      const bytes = isLast ? MAX_REQUIREMENT_CONTEXT_BYTES - used : perFileBytes;
      write(join(f.contextRoot, `bulk-${index}.md`), "x".repeat(bytes));
      contextPaths.push(`bulk-${index}.md`);
      used += bytes;
    }
    expect(used).toBe(MAX_REQUIREMENT_CONTEXT_BYTES);

    const result = captureRequirementSource(request(f, { contextPaths }));
    expect(result.contextCount).toBe(MAX_REQUIREMENT_CONTEXT_FILES);
  });

  it("rejects a multi-file context set whose aggregate exceeds the byte limit even though every single file is under it", () => {
    const f = fixture();
    const perFileBytes = Math.floor(MAX_REQUIREMENT_CONTEXT_BYTES / 4);
    const contextPaths: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      write(join(f.contextRoot, `agg-${index}.md`), "x".repeat(perFileBytes));
      contextPaths.push(`agg-${index}.md`);
    }
    expect(() => captureRequirementSource(request(f, { contextPaths }))).toThrowError(
      expect.objectContaining({ code: "context_limit" }),
    );
    expect(existsSync(join(f.workspace, "requirements"))).toBe(false);
  });

  it("rejects an input context set whose files are each nested in a distinct new directory before writing any revision, when the combined directory-entry total exceeds the archive cap", () => {
    const f = fixture();
    const contextPaths: string[] = [];
    for (let index = 0; index < MAX_REQUIREMENT_CONTEXT_FILES; index += 1) {
      const relativePath = `d${index}/file.md`;
      write(join(f.contextRoot, relativePath), "x");
      contextPaths.push(relativePath);
    }
    expect(contextPaths).toHaveLength(MAX_REQUIREMENT_CONTEXT_FILES);

    expect(() => captureRequirementSource(request(f, { contextPaths }))).toThrowError(
      expect.objectContaining({ code: "context_limit" }),
    );
    expect(existsSync(join(f.workspace, "requirements"))).toBe(false);
  });

  it("writes nothing to disk when every declared context path is invalid", () => {
    const f = fixture();
    expect(() => captureRequirementSource(request(f, {
      contextPaths: ["../escape.md", "/etc/passwd", "..\\escape.md", "a/../../escape.md"],
    }))).toThrowError(expect.objectContaining({ code: "unsafe_context" }));
    expect(existsSync(join(f.workspace, "requirements"))).toBe(false);
  });

  it("caps the total directory-entry count in an archived context tree, counting empty directories, not only files", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    const revisionKey = "rev-73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049";
    const contextRoot = join(first.requirementPath, "revisions", revisionKey, "context");
    for (let index = 0; index < MAX_REQUIREMENT_CONTEXT_FILES + 10; index += 1) {
      mkdirSync(join(contextRoot, `empty-dir-${index}`), { recursive: true });
    }

    expect(() => captureRequirementSource(request(f, { capturedAt: "2030-01-01T00:00:00.000Z" }))).toThrowError(
      expect.objectContaining({ code: "revision_conflict" }),
    );
  });

  it("rejects a context root that is itself a symlink to an external location", () => {
    const f = fixture();
    const outsideContext = join(f.root, "outside-context");
    mkdirSync(outsideContext);
    write(join(outsideContext, "domain.md"), "external context\n");
    const linkedRoot = join(f.root, "linked-context-root");
    symlinkSync(outsideContext, linkedRoot);

    expect(() => captureRequirementSource(request(f, { contextRoot: linkedRoot, contextPaths: ["domain.md"] }))).toThrowError(
      expect.objectContaining({ code: "unsafe_context" }),
    );
  });

  it("copies context as independent evidence so later source edits never reach the archived revision", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    const revisionKey = "rev-" + "73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049";
    const archivedContext = join(first.requirementPath, "revisions", revisionKey, "context", "domain.md");
    expect(lstatSync(archivedContext).isSymbolicLink()).toBe(false);
    const before = readFileSync(archivedContext, "utf8");

    writeFileSync(join(f.contextRoot, "domain.md"), "mutated after capture\n", "utf8");
    expect(readFileSync(archivedContext, "utf8")).toBe(before);
    expect(readFileSync(join(first.requirementPath, "context", "domain.md"), "utf8")).toBe(before);
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

  it("re-anchors containment right before the projection write even if the requirement directory is swapped mid-capture", () => {
    const f = fixture();
    const outside = join(f.root, "outside-projection-target");
    mkdirSync(outside);
    const requirementParent = join(f.workspace, "requirements", "jira");
    let swapped = false;
    let thrown: unknown;
    try {
      captureRequirementSource(request(f), {
        beforeProjection: () => {
          if (swapped) return;
          swapped = true;
          rmSync(requirementParent, { recursive: true, force: true });
          symlinkSync(outside, requirementParent);
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const chain = [thrown, (thrown as { cause?: unknown } | undefined)?.cause];
    expect(chain.some((entry) => (entry as { code?: string } | undefined)?.code === "unsafe_context")).toBe(true);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("re-anchors containment right before committing the immutable revision even if swapped after the entry check", () => {
    const f = fixture();
    const outside = join(f.root, "outside-revision-target");
    mkdirSync(outside);
    const requirementParent = join(f.workspace, "requirements", "jira");
    let thrown: unknown;
    try {
      captureRequirementSource(request(f), {
        afterReadFile: (path) => {
          if (path !== f.body) return;
          rmSync(requirementParent, { recursive: true, force: true });
          symlinkSync(outside, requirementParent);
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as { code?: string } | undefined)?.code).not.toBe("io_failure");
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

  it("regenerates a corrupted attest.md from source authority without treating it as evidence", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    writeFileSync(join(first.requirementPath, "attest.md"), "corrupted projection\n", "utf8");

    const repeated = captureRequirementSource(request(f, { capturedAt: "2030-01-01T00:00:00.000Z" }));
    expect(repeated.outcome).toBe("reused");
    expect(readFileSync(join(first.requirementPath, "attest.md"), "utf8")).not.toContain("corrupted projection");
    expect(readFileSync(join(first.requirementPath, "attest.md"), "utf8")).toContain("Generated aggregate projection");
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

  it("fails loudly when an archived context file's content is tampered independently of the body", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    const revision = join(first.requirementPath, "revisions", "rev-73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049");
    writeFileSync(join(revision, "context", "domain.md"), "tampered context content\n", "utf8");
    expect(() => captureRequirementSource(request(f))).toThrowError(
      expect.objectContaining({ code: "revision_conflict" }),
    );
  });

  it("fails loudly when capture.yaml's requirementId is tampered away from the manifest identity", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    const revision = join(first.requirementPath, "revisions", "rev-73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049");
    const capture = JSON.parse(readFileSync(join(revision, "capture.yaml"), "utf8"));
    capture.requirementId = "req-000000000000";
    writeFileSync(join(revision, "capture.yaml"), `${JSON.stringify(capture, null, 2)}\n`, "utf8");
    expect(() => captureRequirementSource(request(f))).toThrowError(
      expect.objectContaining({ code: "revision_conflict" }),
    );
  });

  it("fails loudly when capture.yaml's recorded requirement digest is tampered away from the actual body", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    const revision = join(first.requirementPath, "revisions", "rev-73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049");
    const capture = JSON.parse(readFileSync(join(revision, "capture.yaml"), "utf8"));
    capture.requirement.sha256 = "f".repeat(64);
    writeFileSync(join(revision, "capture.yaml"), `${JSON.stringify(capture, null, 2)}\n`, "utf8");
    expect(() => captureRequirementSource(request(f))).toThrowError(
      expect.objectContaining({ code: "revision_conflict" }),
    );
  });

  it("fails loudly when capture.yaml's recorded context descriptor is tampered away from the actual archived context", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    const revision = join(first.requirementPath, "revisions", "rev-73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049");
    const capture = JSON.parse(readFileSync(join(revision, "capture.yaml"), "utf8"));
    capture.context[0].sha256 = "e".repeat(64);
    writeFileSync(join(revision, "capture.yaml"), `${JSON.stringify(capture, null, 2)}\n`, "utf8");
    expect(() => captureRequirementSource(request(f))).toThrowError(
      expect.objectContaining({ code: "revision_conflict" }),
    );
  });

  it("fails loudly when capture.yaml's capturedAt is tampered on a previousRevisions-linked archive", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    const firstRevisionKey = "rev-73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049";
    writeFileSync(f.body, "# Jira requirement\n\nRevision 43.\n", "utf8");
    captureRequirementSource(request(f, { revision: "43", capturedAt: "2026-07-20T17:00:00.000Z" }));
    const capture = JSON.parse(readFileSync(join(first.requirementPath, "revisions", firstRevisionKey, "capture.yaml"), "utf8"));
    capture.capturedAt = "2099-01-01T00:00:00.000Z";
    writeFileSync(join(first.requirementPath, "revisions", firstRevisionKey, "capture.yaml"), `${JSON.stringify(capture, null, 2)}\n`, "utf8");
    expect(() => captureRequirementSource(request(f, { revision: "43" }))).toThrowError(
      expect.objectContaining({ code: "revision_conflict" }),
    );
  });

  function snapshotRequirementsTree(root: string): ReadonlyMap<string, string> {
    const entries = new Map<string, string>();
    const walk = (dir: string, relativeDir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
        const path = join(dir, entry.name);
        const relativePath = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
        const stat = lstatSync(path);
        const digest = stat.isFile() ? createHash("sha256").update(readFileSync(path)).digest("hex") : "";
        entries.set(relativePath, JSON.stringify({
          type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "dir" : "file",
          ino: stat.ino,
          dev: stat.dev,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          digest,
        }));
        if (stat.isDirectory() && !stat.isSymbolicLink()) walk(path, relativePath);
      }
    };
    if (existsSync(root)) walk(root, "");
    return entries;
  }

  function expectNoTreeChange(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): void {
    expect(Array.from(after.keys()).sort()).toEqual(Array.from(before.keys()).sort());
    for (const [path, beforeEntry] of before) {
      expect(after.get(path), `entry changed at ${path}`).toBe(beforeEntry);
    }
  }

  it("rejects an update when the existing revision's archived context was tampered, leaving zero orphan revision on disk", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    const firstRevisionKey = "rev-73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049";
    writeFileSync(join(first.requirementPath, "revisions", firstRevisionKey, "context", "domain.md"), "tampered\n", "utf8");

    const requirementsRoot = join(f.workspace, "requirements");
    const before = snapshotRequirementsTree(requirementsRoot);
    writeFileSync(f.body, "# Jira requirement\n\nRevision 43.\n", "utf8");
    expect(() => captureRequirementSource(request(f, { revision: "43", capturedAt: "2026-07-20T17:00:00.000Z" }))).toThrowError(
      expect.objectContaining({ code: "revision_conflict" }),
    );
    const after = snapshotRequirementsTree(requirementsRoot);
    expectNoTreeChange(before, after);

    const secondRevisionKey = "rev-" + createHash("sha256").update("43").digest("hex");
    expect(existsSync(join(first.requirementPath, "revisions", secondRevisionKey))).toBe(false);
  });

  it("rejects an update when the existing revision's capture.yaml metadata was tampered, leaving zero orphan revision on disk", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    const firstRevisionKey = "rev-73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049";
    const capture = JSON.parse(readFileSync(join(first.requirementPath, "revisions", firstRevisionKey, "capture.yaml"), "utf8"));
    capture.requirement.sha256 = "f".repeat(64);
    writeFileSync(join(first.requirementPath, "revisions", firstRevisionKey, "capture.yaml"), `${JSON.stringify(capture, null, 2)}\n`, "utf8");

    const requirementsRoot = join(f.workspace, "requirements");
    const before = snapshotRequirementsTree(requirementsRoot);
    writeFileSync(f.body, "# Jira requirement\n\nRevision 43.\n", "utf8");
    expect(() => captureRequirementSource(request(f, { revision: "43", capturedAt: "2026-07-20T17:00:00.000Z" }))).toThrowError(
      expect.objectContaining({ code: "revision_conflict" }),
    );
    const after = snapshotRequirementsTree(requirementsRoot);
    expectNoTreeChange(before, after);

    const secondRevisionKey = "rev-" + createHash("sha256").update("43").digest("hex");
    expect(existsSync(join(first.requirementPath, "revisions", secondRevisionKey))).toBe(false);
  });

  it("rejects an update when the existing source.yaml's previousRevisions history was tampered, leaving zero orphan revision on disk", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    writeFileSync(f.body, "# Jira requirement\n\nRevision 43.\n", "utf8");
    captureRequirementSource(request(f, { revision: "43", capturedAt: "2026-07-20T17:00:00.000Z" }));
    const sourcePath = join(first.requirementPath, "source.yaml");
    const source = JSON.parse(readFileSync(sourcePath, "utf8"));
    source.previousRevisions = [];
    writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`, "utf8");

    const requirementsRoot = join(f.workspace, "requirements");
    const before = snapshotRequirementsTree(requirementsRoot);
    writeFileSync(f.body, "# Jira requirement\n\nRevision 44.\n", "utf8");
    expect(() => captureRequirementSource(request(f, { revision: "44", capturedAt: "2026-07-20T18:00:00.000Z" }))).toThrowError(
      expect.objectContaining({ code: "revision_conflict" }),
    );
    const after = snapshotRequirementsTree(requirementsRoot);
    expectNoTreeChange(before, after);

    const newRevisionKey = "rev-" + createHash("sha256").update("44").digest("hex");
    expect(existsSync(join(first.requirementPath, "revisions", newRevisionKey))).toBe(false);
  });

  it("rejects a source.yaml whose previousRevisions references a revision archive that was never committed", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    writeFileSync(f.body, "# Jira requirement\n\nRevision 43.\n", "utf8");
    captureRequirementSource(request(f, { revision: "43", capturedAt: "2026-07-20T17:00:00.000Z" }));
    const sourcePath = join(first.requirementPath, "source.yaml");
    const source = JSON.parse(readFileSync(sourcePath, "utf8"));
    source.previousRevisions = [...source.previousRevisions, { revision: "99-forged", capturedAt: "2020-01-01T00:00:00.000Z" }];
    writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`, "utf8");

    expect(() => captureRequirementSource(request(f, { revision: "43" }))).toThrowError(
      expect.objectContaining({ code: "revision_conflict" }),
    );
  });

  it("rejects a source.yaml whose previousRevisions dropped a revision that still has a committed archive", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    writeFileSync(f.body, "# Jira requirement\n\nRevision 43.\n", "utf8");
    captureRequirementSource(request(f, { revision: "43", capturedAt: "2026-07-20T17:00:00.000Z" }));
    const sourcePath = join(first.requirementPath, "source.yaml");
    const source = JSON.parse(readFileSync(sourcePath, "utf8"));
    expect(source.previousRevisions).toEqual([{ revision: "42", capturedAt: "2026-07-20T16:00:00.000Z" }]);
    source.previousRevisions = [];
    writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`, "utf8");

    expect(() => captureRequirementSource(request(f, { revision: "43" }))).toThrowError(
      expect.objectContaining({ code: "revision_conflict" }),
    );
  });

  it("rejects a source.yaml whose previousRevisions capturedAt was forged away from its immutable archive", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    writeFileSync(f.body, "# Jira requirement\n\nRevision 43.\n", "utf8");
    captureRequirementSource(request(f, { revision: "43", capturedAt: "2026-07-20T17:00:00.000Z" }));
    const sourcePath = join(first.requirementPath, "source.yaml");
    const source = JSON.parse(readFileSync(sourcePath, "utf8"));
    source.previousRevisions = [{ revision: "42", capturedAt: "2099-01-01T00:00:00.000Z" }];
    writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`, "utf8");

    expect(() => captureRequirementSource(request(f, { revision: "43" }))).toThrowError(
      expect.objectContaining({ code: "revision_conflict" }),
    );
  });

  it("never follows a symlink planted inside the current projection's context/ during self-heal", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    const outside = join(f.root, "outside-secret.txt");
    write(outside, "secret outside projection\n");
    rmSync(join(first.requirementPath, "context", "domain.md"), { force: true });
    symlinkSync(outside, join(first.requirementPath, "context", "domain.md"));

    const repaired = captureRequirementSource(request(f, { capturedAt: "2030-01-01T00:00:00.000Z" }));
    expect(repaired.outcome).toBe("reused");
    const healed = join(first.requirementPath, "context", "domain.md");
    expect(lstatSync(healed).isSymbolicLink()).toBe(false);
    expect(readFileSync(healed, "utf8")).toBe("domain context\n");
  });

  it("treats a projection context/ tree deeper than the revision depth cap as stale rather than recursing unbounded", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    let deep = join(first.requirementPath, "context");
    for (let index = 0; index < 40; index += 1) {
      deep = join(deep, `d${index}`);
    }
    mkdirSync(deep, { recursive: true });
    write(join(deep, "extra.md"), "unexpected deep file\n");

    const repaired = captureRequirementSource(request(f, { capturedAt: "2030-01-01T00:00:00.000Z" }));
    expect(repaired.outcome).toBe("reused");
    expect(existsSync(join(first.requirementPath, "context", "d0"))).toBe(false);
    expect(readFileSync(join(first.requirementPath, "context", "domain.md"), "utf8")).toBe("domain context\n");
  });

  it("rejects an oversized current requirement.md by its pre-read fstat size, proven by a deterministic stat-seam call count", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    const oversizedPath = join(first.requirementPath, "requirement.md");
    const fd = openSync(oversizedPath, "w");
    ftruncateSync(fd, MAX_REQUIREMENT_BODY_BYTES + 4096);
    closeSync(fd);
    expect(statSync(oversizedPath).size).toBeGreaterThan(MAX_REQUIREMENT_BODY_BYTES);

    const statSeenPaths: string[] = [];
    const repaired = captureRequirementSource(request(f, { capturedAt: "2030-01-01T00:00:00.000Z" }), {
      afterProjectionStat: (path) => statSeenPaths.push(path),
    });
    expect(repaired.outcome).toBe("reused");
    expect(statSeenPaths).not.toContain(oversizedPath);
    expect(readFileSync(oversizedPath, "utf8")).toContain("Jira requirement");
  });

  it("treats a current requirement.md that grows past the cap between stat and read completion as stale rather than trusting a stale size check", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    const growingPath = join(first.requirementPath, "requirement.md");
    writeFileSync(growingPath, "small\n", "utf8");
    let grew = false;

    const repaired = captureRequirementSource(request(f, { capturedAt: "2030-01-01T00:00:00.000Z" }), {
      afterProjectionStat: (path) => {
        if (path !== growingPath || grew) return;
        grew = true;
        const fd = openSync(growingPath, "a");
        writeSync(fd, "x".repeat(1024));
        closeSync(fd);
      },
    });
    expect(repaired.outcome).toBe("reused");
    expect(readFileSync(growingPath, "utf8")).toContain("Jira requirement");
  });

  it("rejects an oversized current context/ file by its pre-read fstat size, proven by a deterministic stat-seam call count", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    const oversizedPath = join(first.requirementPath, "context", "domain.md");
    const fd = openSync(oversizedPath, "w");
    ftruncateSync(fd, MAX_REQUIREMENT_CONTEXT_BYTES + 4096);
    closeSync(fd);
    expect(statSync(oversizedPath).size).toBeGreaterThan(MAX_REQUIREMENT_CONTEXT_BYTES);

    const statSeenPaths: string[] = [];
    const repaired = captureRequirementSource(request(f, { capturedAt: "2030-01-01T00:00:00.000Z" }), {
      afterProjectionStat: (path) => statSeenPaths.push(path),
    });
    expect(repaired.outcome).toBe("reused");
    expect(statSeenPaths).not.toContain(oversizedPath);
    expect(readFileSync(oversizedPath, "utf8")).toBe("domain context\n");
  });

  it("resolves a Story back to its Requirement sources by reading source.yaml from disk in a fresh call, not an in-memory cache", () => {
    const f = fixture();
    captureRequirementSource(request(f));
    captureRequirementSource(request(f, { provider: "github-issue", ref: "Owner/Repo#12", storyIds: ["US-WS-009"] }));

    const forWs007 = resolveRequirementSourcesForStoryOnDisk(f.workspace, "US-WS-007");
    expect(forWs007.map((manifest) => manifest.ref)).toEqual(["SOT-15499"]);

    const forWs009 = resolveRequirementSourcesForStoryOnDisk(f.workspace, "US-WS-009");
    expect(forWs009.map((manifest) => manifest.ref)).toEqual(["owner/repo#12"]);

    expect(resolveRequirementSourcesForStoryOnDisk(f.workspace, "US-UNKNOWN")).toEqual([]);
  });

  it("reflects an updated revision in the on-disk Story reverse lookup without any in-process state carried over", () => {
    const f = fixture();
    captureRequirementSource(request(f));
    writeFileSync(f.body, "# Jira requirement\n\nRevision 43.\n", "utf8");
    captureRequirementSource(request(f, { revision: "43", capturedAt: "2026-07-20T17:00:00.000Z" }));

    const resolved = resolveRequirementSourcesForStoryOnDisk(f.workspace, "US-WS-007");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.revision).toBe("43");
  });

  it("excludes a source.yaml whose physical provider directory does not match the manifest's own provider field", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    const misplacedDir = join(f.workspace, "requirements", "github_issue", "req-c78ccf14ea21");
    mkdirSync(misplacedDir, { recursive: true });
    writeFileSync(join(misplacedDir, "source.yaml"), readFileSync(join(first.requirementPath, "source.yaml")));

    const resolved = resolveRequirementSourcesForStoryOnDisk(f.workspace, "US-WS-007");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.ref).toBe("SOT-15499");
  });

  it("excludes a source.yaml whose physical requirementId directory does not match the manifest's derived identity", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    const misplacedDir = join(f.workspace, "requirements", "jira", "req-000000000000");
    mkdirSync(misplacedDir, { recursive: true });
    writeFileSync(join(misplacedDir, "source.yaml"), readFileSync(join(first.requirementPath, "source.yaml")));

    const resolved = resolveRequirementSourcesForStoryOnDisk(f.workspace, "US-WS-007");
    expect(resolved).toHaveLength(1);
  });

  it("excludes a source.yaml whose provider/ref is not declared in workspace.yaml", () => {
    const f = fixture();
    captureRequirementSource(request(f));
    const undeclaredRequirementId = `req-${createHash("sha256").update("user_input\0undeclared-brief").digest("hex").slice(0, 12)}`;
    const undeclaredManifest = {
      schema: "roll.requirement-source/v1",
      requirementId: undeclaredRequirementId,
      provider: "user_input",
      ref: "undeclared-brief",
      revision: "1",
      capturedAt: "2026-07-20T16:00:00.000Z",
      previousRevisions: [],
      requirement: { bytes: 1, sha256: "a".repeat(64) },
      context: [],
      stories: ["US-WS-007"],
      attest: { schema: "roll.requirement-attest-projection/v1", mode: "generated_aggregate", evidenceAuthority: "issue" },
    };
    const undeclaredDir = join(f.workspace, "requirements", "user_input", undeclaredRequirementId);
    mkdirSync(undeclaredDir, { recursive: true });
    writeFileSync(join(undeclaredDir, "source.yaml"), `${JSON.stringify(undeclaredManifest, null, 2)}\n`);

    const resolved = resolveRequirementSourcesForStoryOnDisk(f.workspace, "US-WS-007");
    expect(resolved.map((manifest) => manifest.ref)).toEqual(["SOT-15499"]);
  });

  it("deduplicates when the same requirementId is legitimately reachable more than once", () => {
    const f = fixture();
    captureRequirementSource(request(f));
    const resolved = resolveRequirementSourcesForStoryOnDisk(f.workspace, "US-WS-007");
    const ids = resolved.map((manifest) => manifest.requirementId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never moves, overwrites or duplicates Issue-owned evidence across capture, link, update and repair", () => {
    const f = fixture();
    const evidencePath = join(f.workspace, "issues", "US-WS-007", "evidence", "vitest.txt");
    write(evidencePath, "US-WS-007 issue evidence: 12 passed\n");
    const evidenceBefore = { stat: lstatSync(evidencePath), digest: createHash("sha256").update(readFileSync(evidencePath)).digest("hex") };

    const first = captureRequirementSource(request(f));
    expect(readFileSync(join(first.requirementPath, "attest.md"), "utf8")).toContain("Issue-owned evidence remains authoritative");

    captureRequirementSource(request(f, { storyIds: ["US-WS-009"] }));
    writeFileSync(f.body, "# Jira requirement\n\nRevision 43.\n", "utf8");
    captureRequirementSource(request(f, { revision: "43", capturedAt: "2026-07-20T17:00:00.000Z" }));
    writeFileSync(join(first.requirementPath, "requirement.md"), "corrupted\n", "utf8");
    captureRequirementSource(request(f, { revision: "43", capturedAt: "2030-01-01T00:00:00.000Z" }));

    const evidenceAfter = { stat: lstatSync(evidencePath), digest: createHash("sha256").update(readFileSync(evidencePath)).digest("hex") };
    expect(evidenceAfter.stat.ino).toBe(evidenceBefore.stat.ino);
    expect(evidenceAfter.stat.mtimeMs).toBe(evidenceBefore.stat.mtimeMs);
    expect(evidenceAfter.digest).toBe(evidenceBefore.digest);
    expect(readFileSync(evidencePath, "utf8")).toBe("US-WS-007 issue evidence: 12 passed\n");
    expect(readFileSync(join(first.requirementPath, "attest.md"), "utf8")).not.toContain("12 passed");
  });

  it("aggregates a real reference to each linked Story's Issue evidence directory in attest.md, without embedding evidence content", () => {
    const f = fixture();
    const ws007Evidence = join(f.workspace, "issues", "US-WS-007", "evidence", "vitest.txt");
    write(ws007Evidence, "US-WS-007 issue evidence: 12 passed\n");
    const ws008Evidence = join(f.workspace, "issues", "US-WS-008", "evidence", "vitest.txt");
    write(ws008Evidence, "US-WS-008 issue evidence: 9 passed\n");

    const first = captureRequirementSource(request(f));
    const attest = readFileSync(join(first.requirementPath, "attest.md"), "utf8");
    expect(attest).toContain("issues/US-WS-007/evidence");
    expect(attest).toContain("issues/US-WS-008/evidence");
    expect(attest).not.toContain("12 passed");
    expect(attest).not.toContain("9 passed");
  });

  it("reports a linked Story with no captured Issue evidence yet as pending rather than silently omitting it", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    const attest = readFileSync(join(first.requirementPath, "attest.md"), "utf8");
    expect(attest).toContain("US-WS-007");
    expect(attest).toContain("US-WS-008");
    expect(attest).toMatch(/no evidence captured yet|pending/iu);
  });

  it("reconstructs requirement.md, context/ and attest.md together from the immutable revision when all three are corrupted or missing at once", () => {
    const f = fixture();
    const first = captureRequirementSource(request(f));
    writeFileSync(join(first.requirementPath, "requirement.md"), "corrupted body\n", "utf8");
    rmSync(join(first.requirementPath, "context"), { recursive: true, force: true });
    rmSync(join(first.requirementPath, "attest.md"), { force: true });

    const repaired = captureRequirementSource(request(f, { capturedAt: "2030-01-01T00:00:00.000Z" }));
    expect(repaired.outcome).toBe("reused");
    expect(readFileSync(join(first.requirementPath, "requirement.md"), "utf8")).toContain("Jira requirement");
    expect(readFileSync(join(first.requirementPath, "context", "domain.md"), "utf8")).toBe("domain context\n");
    expect(readFileSync(join(first.requirementPath, "context", "brief", "acceptance.md"), "utf8")).toBe("acceptance context\n");
    expect(readFileSync(join(first.requirementPath, "attest.md"), "utf8")).toContain("Generated aggregate projection");
  });
});
