import { createHash } from "node:crypto";
import {
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
import { requirementRevisionKey } from "@roll/core";
import { auditRequirementArchive } from "../src/requirement-archive-audit.js";
import { captureRequirementSource } from "../src/requirement-source-store.js";

const roots: string[] = [];

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "roll-requirement-audit-"));
  roots.push(root);
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  write(join(workspace, "workspace.yaml"), `${JSON.stringify({
    schema: "roll.workspace/v1",
    workspaceId: "ws-audit",
    displayName: "Audit",
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
  write(join(workspace, "backlog", "epic", "US-WS-007a", "spec.md"), "# US-WS-007a\n");
  const body = join(root, "requirement.md");
  const contextRoot = join(root, "context-source");
  write(body, "revision 6 body\n");
  write(join(contextRoot, "api.md"), "revision 6 context\n");
  write(join(contextRoot, "brief", "nested", "rules.md"), "revision 6 rules\n");
  const first = captureRequirementSource({
    workspaceRoot: workspace,
    provider: "jira",
    ref: "SOT-15499",
    revision: "6",
    capturedAt: "2026-07-20T16:00:00.000Z",
    bodyFile: body,
    contextRoot,
    contextPaths: ["api.md", "brief/nested/rules.md"],
    storyIds: ["US-WS-007a"],
  });
  write(body, "revision 7 body\n");
  write(join(contextRoot, "api.md"), "revision 7 context\n");
  write(join(contextRoot, "brief", "nested", "rules.md"), "revision 7 rules\n");
  const current = captureRequirementSource({
    workspaceRoot: workspace,
    provider: "jira",
    ref: "SOT-15499",
    revision: "7",
    capturedAt: "2026-07-20T17:00:00.000Z",
    bodyFile: body,
    contextRoot,
    contextPaths: ["api.md", "brief/nested/rules.md"],
    storyIds: ["US-WS-007a"],
  });
  return {
    root,
    workspace,
    requirementPath: current.requirementPath,
    auditInput: { workspaceRoot: workspace, provider: "jira", requirementId: current.manifest.requirementId },
  };
}

function snapshotTree(root: string): ReadonlyMap<string, string> {
  const snapshot = new Map<string, string>();
  const walk = (directory: string, relativeDirectory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      const relativePath = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
      const stat = lstatSync(path);
      const digest = stat.isFile() ? createHash("sha256").update(readFileSync(path)).digest("hex") : "";
      snapshot.set(relativePath, JSON.stringify({
        type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file",
        dev: stat.dev,
        ino: stat.ino,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        digest,
      }));
      if (stat.isDirectory() && !stat.isSymbolicLink()) walk(path, relativePath);
    }
  };
  walk(root, "");
  return snapshot;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("US-WS-007a Requirement archive audit", () => {
  it("validates the complete immutable revision graph without reading projections or Issue evidence", () => {
    const f = fixture();
    writeFileSync(join(f.requirementPath, "requirement.md"), "drifted projection\n", "utf8");
    write(join(f.workspace, "issues", "US-WS-007a", "evidence", "repositories", "secret.txt"), "not archive authority\n");
    const before = snapshotTree(f.workspace);

    const first = auditRequirementArchive(f.auditInput);
    const second = auditRequirementArchive(f.auditInput);

    expect(first).toEqual({
      schema: "roll.requirement-archive-audit/v1",
      requirementId: "req-c78ccf14ea21",
      status: "healthy",
      checkedRevisions: ["7", "6"],
      findings: [],
    });
    expect(second).toEqual(first);
    expect(snapshotTree(f.workspace)).toEqual(before);
  });

  it.each([
    {
      name: "missing revision directory",
      mutate: (f: ReturnType<typeof fixture>) => rmSync(join(f.requirementPath, "revisions", requirementRevisionKey("6")), { recursive: true }),
      expected: { code: "revision_missing", revision: "6", suffix: `revisions/${requirementRevisionKey("6")}` },
    },
    {
      name: "body digest tamper",
      mutate: (f: ReturnType<typeof fixture>) => writeFileSync(join(f.requirementPath, "revisions", requirementRevisionKey("6"), "requirement.md"), "tampered body\n"),
      expected: { code: "content_digest_mismatch", revision: "6", suffix: `revisions/${requirementRevisionKey("6")}/requirement.md` },
    },
    {
      name: "context digest tamper",
      mutate: (f: ReturnType<typeof fixture>) => writeFileSync(join(f.requirementPath, "revisions", requirementRevisionKey("6"), "context", "api.md"), "tampered context\n"),
      expected: { code: "context_digest_mismatch", revision: "6", suffix: `revisions/${requirementRevisionKey("6")}/context/api.md` },
    },
    {
      name: "capture metadata tamper",
      mutate: (f: ReturnType<typeof fixture>) => {
        const path = join(f.requirementPath, "revisions", requirementRevisionKey("6"), "capture.yaml");
        const capture = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
        capture["capturedAt"] = "2099-01-01T00:00:00.000Z";
        writeFileSync(path, `${JSON.stringify(capture, null, 2)}\n`);
      },
      expected: { code: "revision_metadata_mismatch", revision: "6", suffix: `revisions/${requirementRevisionKey("6")}/capture.yaml` },
    },
  ])("reports $name with its revision and relative evidence path", ({ mutate, expected }) => {
    const f = fixture();
    mutate(f);

    const result = auditRequirementArchive(f.auditInput);

    expect(result.status).toBe("corrupt");
    expect(result.checkedRevisions).toEqual(["7", "6"]);
    expect(result.findings).toContainEqual({
      code: expected.code,
      revision: expected.revision,
      evidencePath: expected.suffix,
    });
  });

  it.each([
    {
      name: "Requirement root",
      plant: (f: ReturnType<typeof fixture>, outside: string) => {
        const parked = `${f.requirementPath}.parked`;
        renameSync(f.requirementPath, parked);
        symlinkSync(outside, f.requirementPath);
      },
      evidencePath: ".",
    },
    {
      name: "revision directory",
      plant: (f: ReturnType<typeof fixture>, outside: string) => {
        const revision = join(f.requirementPath, "revisions", requirementRevisionKey("6"));
        rmSync(revision, { recursive: true });
        symlinkSync(outside, revision);
      },
      evidencePath: `revisions/${requirementRevisionKey("6")}`,
    },
    {
      name: "nested context entry",
      plant: (f: ReturnType<typeof fixture>, outside: string) => {
        const target = join(f.requirementPath, "revisions", requirementRevisionKey("6"), "context", "api.md");
        rmSync(target);
        symlinkSync(join(outside, "secret.md"), target);
      },
      evidencePath: `revisions/${requirementRevisionKey("6")}/context/api.md`,
    },
  ])("never follows a symlink planted at the $name", ({ plant, evidencePath }) => {
    const f = fixture();
    const outside = join(f.root, "outside");
    write(join(outside, "secret.md"), "outside secret\n");
    plant(f, outside);

    const result = auditRequirementArchive(f.auditInput);

    expect(result.status).toBe("untrusted");
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "unsafe_archive_path",
      evidencePath,
    }));
  });

  it.each([
    ["revision count", { maxRevisions: 1 }, "source.yaml"],
    ["revision directory entries", { maxRevisionEntries: 1 }, "revisions"],
    ["context file count", { maxContextFiles: 1 }, expect.stringContaining("/context")],
    ["context directory entries", { maxContextEntries: 1 }, expect.stringContaining("/context")],
    ["context bytes", { maxContextBytes: 5 }, expect.stringContaining("/context/")],
    ["body bytes", { maxBodyBytes: 5 }, expect.stringContaining("/requirement.md")],
    ["context depth", { maxDepth: 1 }, expect.stringContaining("/context/brief/nested")],
  ])("stops at the declared %s bound", (_name, limits, evidencePath) => {
    const f = fixture();

    const result = auditRequirementArchive({ ...f.auditInput, limits });

    expect(result.status).toBe("untrusted");
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "unsafe_archive_path",
      evidencePath,
    }));
  });

  it("rejects an in-place same-size archive overwrite during a no-follow read", () => {
    const f = fixture();
    const target = join(f.requirementPath, "revisions", requirementRevisionKey("6"), "context", "api.md");
    const size = readFileSync(target).byteLength;
    let raced = false;

    const result = auditRequirementArchive(f.auditInput, {
      afterReadFile: (path) => {
        if (path !== target || raced) return;
        raced = true;
        writeFileSync(path, `${"x".repeat(size - 1)}\n`);
      },
    });

    expect(raced).toBe(true);
    expect(result.status).toBe("untrusted");
    expect(result.findings).toContainEqual({
      code: "archive_changed_during_read",
      revision: "6",
      evidencePath: `revisions/${requirementRevisionKey("6")}/context/api.md`,
    });
  });

  it("rejects a stale fd when its pathname is swapped for an outside symlink", () => {
    const f = fixture();
    const target = join(f.requirementPath, "revisions", requirementRevisionKey("6"), "requirement.md");
    const outside = join(f.root, "outside-body.md");
    write(outside, "outside secret\n");
    let swapped = false;

    const result = auditRequirementArchive(f.auditInput, {
      afterReadFile: (path) => {
        if (path !== target || swapped) return;
        swapped = true;
        renameSync(target, `${target}.parked`);
        symlinkSync(outside, target);
      },
    });

    expect(swapped).toBe(true);
    expect(result.status).toBe("untrusted");
    expect(result.findings).toContainEqual({
      code: "archive_changed_during_read",
      revision: "6",
      evidencePath: `revisions/${requirementRevisionKey("6")}/requirement.md`,
    });
  });

  it("rejects source.yaml changing after the revision scan starts", () => {
    const f = fixture();
    const sourcePath = join(f.requirementPath, "source.yaml");
    const trigger = join(f.requirementPath, "revisions", requirementRevisionKey("7"), "requirement.md");
    let changed = false;

    const result = auditRequirementArchive(f.auditInput, {
      afterReadFile: (path) => {
        if (path !== trigger || changed) return;
        changed = true;
        const source = JSON.parse(readFileSync(sourcePath, "utf8")) as Record<string, unknown>;
        source["stories"] = ["US-WS-007a", "US-WS-RACE"];
        writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`);
      },
    });

    expect(changed).toBe(true);
    expect(result.status).toBe("untrusted");
    expect(result.findings).toContainEqual({
      code: "archive_changed_during_read",
      evidencePath: "source.yaml",
    });
  });

  it.each([
    ["unsupported schema", (source: Record<string, unknown>) => { source["schema"] = "roll.requirement-source/v2"; }],
    ["identity mismatch", (source: Record<string, unknown>) => { source["requirementId"] = "req-000000000000"; }],
  ])("treats %s as an untrusted manifest", (_name, mutate) => {
    const f = fixture();
    const sourcePath = join(f.requirementPath, "source.yaml");
    const source = JSON.parse(readFileSync(sourcePath, "utf8")) as Record<string, unknown>;
    mutate(source);
    writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`);

    expect(auditRequirementArchive(f.auditInput)).toMatchObject({
      status: "untrusted",
      checkedRevisions: [],
      findings: [{ code: "manifest_invalid", evidencePath: "source.yaml" }],
    });
  });

  it("fails closed on invalid bounds instead of silently replacing caller policy with defaults", () => {
    const f = fixture();

    expect(auditRequirementArchive({ ...f.auditInput, limits: { maxDepth: 0 } })).toMatchObject({
      status: "untrusted",
      findings: [{ code: "unsafe_archive_path", evidencePath: "." }],
    });
  });

  it("returns a typed untrusted audit when the Workspace root cannot be anchored", () => {
    const f = fixture();
    const missingWorkspace = join(f.root, "missing-workspace");

    expect(auditRequirementArchive({ ...f.auditInput, workspaceRoot: missingWorkspace })).toMatchObject({
      status: "untrusted",
      findings: [{ code: "unsafe_archive_path", evidencePath: "." }],
    });
  });
});
