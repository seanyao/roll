import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
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
  const first = captureRequirementSource({
    workspaceRoot: workspace,
    provider: "jira",
    ref: "SOT-15499",
    revision: "6",
    capturedAt: "2026-07-20T16:00:00.000Z",
    bodyFile: body,
    contextRoot,
    contextPaths: ["api.md"],
    storyIds: ["US-WS-007a"],
  });
  write(body, "revision 7 body\n");
  write(join(contextRoot, "api.md"), "revision 7 context\n");
  const current = captureRequirementSource({
    workspaceRoot: workspace,
    provider: "jira",
    ref: "SOT-15499",
    revision: "7",
    capturedAt: "2026-07-20T17:00:00.000Z",
    bodyFile: body,
    contextRoot,
    contextPaths: ["api.md"],
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
});
