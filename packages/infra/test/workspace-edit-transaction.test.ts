import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildWorkspaceEditPlan,
  parseWorkspaceEditConfig,
  serializeWorkspaceManifest,
  type WorkspaceMetadataReferenceIndex,
} from "@roll/core";
import { repositoryIdFromRemote, type WorkspaceEditPlan, type WorkspaceManifest } from "@roll/spec";
import {
  applyWorkspaceEditPlan,
  workspaceEditJournalPath,
  WorkspaceEditTransactionError,
} from "../src/workspace-edit-transaction.js";
import { collectWorkspaceMetadataReferenceIndex } from "../src/workspace-reference-index.js";
import { readWorkspace } from "../src/requirement-source-store.js";

const roots: string[] = [];

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function write(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "roll-workspace-edit-transaction-"));
  roots.push(root);
  const rollHome = join(root, ".roll");
  const workspaceRoot = join(root, "workspace");
  const manifestPath = join(workspaceRoot, "workspace.yaml");
  const remote = "https://example.test/owner/product";
  const repoId = repositoryIdFromRemote(remote);
  if (!repoId.ok) throw new Error("fixture repository identity must normalize");
  const manifest: WorkspaceManifest = {
    schema: "roll.workspace/v1",
    workspaceId: "ws-demo",
    displayName: "Demo",
    createdAt: "2026-07-20T00:00:00.000Z",
    requirements: [{ provider: "jira", ref: "SOT-15499" }],
    repositories: [{
      schema: "roll.repository-binding/v1",
      repoId: repoId.value,
      alias: "product",
      remote,
      integrationBranch: "main",
      provider: "github",
      workflow: { branchPattern: "roll/{workspace_id}/{story_id}", requiredChecks: ["test"] },
    }],
  };
  write(manifestPath, manifest);
  const issuePath = join(workspaceRoot, "issues", "US-KEEP", "manifest.json");
  const requirementPath = join(workspaceRoot, "requirements", "keep.txt");
  write(issuePath, {
    schema: "roll.issue/v1",
    workspaceId: "ws-demo",
    storyId: "US-KEEP",
    requirements: [],
    repositories: [{
      repoId: repoId.value,
      alias: "product",
      access: "write",
      requiredDelivery: true,
      noChangePolicy: "changes_required",
    }],
  });
  mkdirSync(dirname(requirementPath), { recursive: true });
  writeFileSync(requirementPath, "requirement-bytes\n", "utf8");
  return { root, rollHome, workspaceRoot, manifestPath, manifest, issuePath, requirementPath, repoId: repoId.value };
}

function referenceIndex(workspaceId = "ws-demo"): WorkspaceMetadataReferenceIndex {
  return {
    schema: "roll.workspace-metadata-reference-index/v1",
    workspaceId,
    issues: [],
    requirementArchives: [],
    additionalFacts: [],
  };
}

function plan(f: ReturnType<typeof fixture>, overrides: Record<string, unknown> = {}): WorkspaceEditPlan {
  const parsed = parseWorkspaceEditConfig(JSON.stringify({
    schema: "roll.workspace-edit/v1",
    workspace_id: "ws-demo",
    expected_manifest_sha256: digest(serializeWorkspaceManifest(f.manifest)),
    display_name: "Renamed Demo",
    requirements: [{ provider: "jira", ref: "SOT-15499" }],
    repositories: [{
      alias: "product",
      remote: "https://example.test/owner/product",
      provider: "github",
      integration_branch: "main",
      branch_pattern: "roll/{workspace_id}/{story_id}",
      required_checks: ["test"],
    }],
    ...overrides,
  }), { workspaceId: "ws-demo" });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return buildWorkspaceEditPlan({
    config: parsed.value,
    current: f.manifest,
    references: referenceIndex(),
    manifestPath: f.manifestPath,
  });
}

function transactionInput(f: ReturnType<typeof fixture>, preview: WorkspaceEditPlan) {
  return {
    rollHome: f.rollHome,
    plan: preview,
    reloadCurrent: () => ({
      manifest: readWorkspace(f.workspaceRoot),
      references: collectWorkspaceMetadataReferenceIndex({ workspaceRoot: f.workspaceRoot }),
    }),
    rebuildPlan: ({ manifest, references }: { readonly manifest: WorkspaceManifest; readonly references: WorkspaceMetadataReferenceIndex }) =>
      buildWorkspaceEditPlan({
        config: {
          schema: "roll.workspace-edit/v1",
          workspaceId: "ws-demo",
          expectedManifestSha256: preview.beforeSha256,
          displayName: preview.afterManifest.displayName,
          requirements: preview.afterManifest.requirements,
          repositories: preview.afterManifest.repositories.map((repository) => ({
            alias: repository.alias,
            remote: repository.remote,
            provider: repository.provider,
            integrationBranch: repository.integrationBranch,
            branchPattern: repository.workflow.branchPattern,
            requiredChecks: repository.workflow.requiredChecks,
          })),
        },
        current: manifest,
        references,
        manifestPath: f.manifestPath,
      }),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("US-WS-026 Workspace edit transaction", () => {
  it("rebuilds the plan under lock, atomically applies only workspace.yaml, and removes the committed journal", async () => {
    const f = fixture();
    const preview = plan(f);
    const issueBefore = readFileSync(f.issuePath);
    const requirementBefore = readFileSync(f.requirementPath);
    const phases: string[] = [];

    const result = await applyWorkspaceEditPlan(transactionInput(f, preview), {
      afterPhase: (phase) => phases.push(phase),
    });

    expect(result).toMatchObject({ outcome: "applied", afterSha256: preview.afterSha256 });
    expect(readWorkspace(f.workspaceRoot).displayName).toBe("Renamed Demo");
    expect(readFileSync(f.issuePath)).toEqual(issueBefore);
    expect(readFileSync(f.requirementPath)).toEqual(requirementBefore);
    expect(existsSync(workspaceEditJournalPath(f.rollHome, "ws-demo"))).toBe(false);
    expect(phases).toEqual([
      "journal_prepared",
      "manifest_temp_fsynced",
      "manifest_renamed",
      "manifest_verified",
      "journal_committed",
      "journal_removed",
    ]);
  });

  it("rejects a new durable reference discovered after preview without touching the manifest", async () => {
    const f = fixture();
    const preview = plan(f, { requirements: [] });
    write(join(f.workspaceRoot, "issues", "US-NEW", "manifest.json"), {
      schema: "roll.issue/v1",
      workspaceId: "ws-demo",
      storyId: "US-NEW",
      requirements: [{ provider: "jira", ref: "SOT-15499" }],
      repositories: [{
        repoId: f.repoId,
        alias: "product",
        access: "write",
        requiredDelivery: true,
        noChangePolicy: "changes_required",
      }],
    });
    const before = readFileSync(f.manifestPath);

    await expect(applyWorkspaceEditPlan(transactionInput(f, preview))).rejects.toEqual(
      expect.objectContaining<Partial<WorkspaceEditTransactionError>>({ code: "metadata_referenced" }),
    );
    expect(readFileSync(f.manifestPath)).toEqual(before);
  });

  it("returns manifest_changed when the preview before digest is stale", async () => {
    const f = fixture();
    const preview = plan(f);
    write(f.manifestPath, { ...f.manifest, displayName: "Concurrent edit" });

    await expect(applyWorkspaceEditPlan(transactionInput(f, preview))).rejects.toEqual(
      expect.objectContaining<Partial<WorkspaceEditTransactionError>>({ code: "manifest_changed" }),
    );
  });

  it("recovers a crash after rename as idempotent success and cleans the journal", async () => {
    const f = fixture();
    const preview = plan(f);
    const input = transactionInput(f, preview);

    await expect(applyWorkspaceEditPlan(input, {
      crashPoint: (phase) => { if (phase === "manifest_renamed") throw new Error("crash"); },
    })).rejects.toEqual(expect.objectContaining<Partial<WorkspaceEditTransactionError>>({ code: "io_failure" }));
    expect(readWorkspace(f.workspaceRoot).displayName).toBe("Renamed Demo");
    expect(existsSync(workspaceEditJournalPath(f.rollHome, "ws-demo"))).toBe(true);

    await expect(applyWorkspaceEditPlan(input)).resolves.toMatchObject({ outcome: "reused" });
    expect(existsSync(workspaceEditJournalPath(f.rollHome, "ws-demo"))).toBe(false);
  });

  it("resumes from a durable prepared journal while the manifest still proves the before state", async () => {
    const f = fixture();
    const preview = plan(f);
    const input = transactionInput(f, preview);

    await expect(applyWorkspaceEditPlan(input, {
      crashPoint: (phase) => { if (phase === "journal_prepared") throw new Error("crash"); },
    })).rejects.toEqual(expect.objectContaining<Partial<WorkspaceEditTransactionError>>({ code: "io_failure" }));
    const journal = JSON.parse(readFileSync(workspaceEditJournalPath(f.rollHome, "ws-demo"), "utf8")) as Record<string, unknown>;
    expect(journal).toMatchObject({
      schema: "roll.workspace-edit-journal/v1",
      status: "prepared",
      beforeSha256: preview.beforeSha256,
      afterSha256: preview.afterSha256,
      referenceIndexSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      afterManifest: preview.afterManifest,
      manifestPath: f.manifestPath,
    });
    expect(readWorkspace(f.workspaceRoot).displayName).toBe("Demo");

    const transactionId = String(journal["transactionId"]);
    writeFileSync(join(f.workspaceRoot, `.workspace.yaml.${transactionId}.tmp`), serializeWorkspaceManifest(preview.afterManifest), "utf8");

    await expect(applyWorkspaceEditPlan(input)).resolves.toMatchObject({ outcome: "applied" });
    expect(readWorkspace(f.workspaceRoot).displayName).toBe("Renamed Demo");
  });

  it("rebuilds from fresh references on a prepared-journal retry and rejects a newly dangerous Issue reference", async () => {
    const f = fixture();
    const preview = plan(f, { requirements: [] });
    const input = transactionInput(f, preview);
    const manifestBefore = readFileSync(f.manifestPath);
    const issueBefore = readFileSync(f.issuePath);
    const requirementBefore = readFileSync(f.requirementPath);

    await expect(applyWorkspaceEditPlan(input, {
      crashPoint: (phase) => { if (phase === "journal_prepared") throw new Error("crash"); },
    })).rejects.toEqual(expect.objectContaining<Partial<WorkspaceEditTransactionError>>({ code: "io_failure" }));
    const journalPath = workspaceEditJournalPath(f.rollHome, "ws-demo");
    expect(existsSync(journalPath)).toBe(true);

    write(join(f.workspaceRoot, "issues", "US-NEW", "manifest.json"), {
      schema: "roll.issue/v1",
      workspaceId: "ws-demo",
      storyId: "US-NEW",
      requirements: [{ provider: "jira", ref: "SOT-15499" }],
      repositories: [{
        repoId: f.repoId,
        alias: "product",
        access: "write",
        requiredDelivery: true,
        noChangePolicy: "changes_required",
      }],
    });

    await expect(applyWorkspaceEditPlan(input)).rejects.toEqual(
      expect.objectContaining<Partial<WorkspaceEditTransactionError>>({ code: "metadata_referenced" }),
    );
    expect(readFileSync(f.manifestPath)).toEqual(manifestBefore);
    expect(readFileSync(f.issuePath)).toEqual(issueBefore);
    expect(readFileSync(f.requirementPath)).toEqual(requirementBefore);
    expect(existsSync(journalPath)).toBe(false);
  });

  it("fails closed when reference authority is corrupt on a prepared-journal retry", async () => {
    const f = fixture();
    const preview = plan(f);
    const input = transactionInput(f, preview);
    const manifestBefore = readFileSync(f.manifestPath);
    const requirementBefore = readFileSync(f.requirementPath);

    await expect(applyWorkspaceEditPlan(input, {
      crashPoint: (phase) => { if (phase === "journal_prepared") throw new Error("crash"); },
    })).rejects.toEqual(expect.objectContaining<Partial<WorkspaceEditTransactionError>>({ code: "io_failure" }));
    const journalPath = workspaceEditJournalPath(f.rollHome, "ws-demo");
    writeFileSync(f.issuePath, "{invalid issue authority\n", "utf8");
    const corruptedIssue = readFileSync(f.issuePath);

    await expect(applyWorkspaceEditPlan(input)).rejects.toEqual(
      expect.objectContaining<Partial<WorkspaceEditTransactionError>>({
        code: "reference_index_invalid",
        action: "roll workspace doctor ws-demo",
      }),
    );
    expect(readFileSync(f.manifestPath)).toEqual(manifestBefore);
    expect(readFileSync(f.issuePath)).toEqual(corruptedIssue);
    expect(readFileSync(f.requirementPath)).toEqual(requirementBefore);
    expect(existsSync(journalPath)).toBe(true);
  });

  it("rejects a lock-time rebuild whose canonical after digest differs from preview", async () => {
    const f = fixture();
    const preview = plan(f);
    const input = transactionInput(f, preview);
    const changed = plan(f, { display_name: "Different result" });

    await expect(applyWorkspaceEditPlan({ ...input, rebuildPlan: () => changed })).rejects.toEqual(
      expect.objectContaining<Partial<WorkspaceEditTransactionError>>({ code: "edit_plan_changed" }),
    );
    expect(readWorkspace(f.workspaceRoot).displayName).toBe("Demo");
  });

  it("fails loud when a pending journal can prove neither before nor after", async () => {
    const f = fixture();
    const preview = plan(f);
    const input = transactionInput(f, preview);
    await expect(applyWorkspaceEditPlan(input, {
      crashPoint: (phase) => { if (phase === "journal_prepared") throw new Error("crash"); },
    })).rejects.toEqual(expect.objectContaining<Partial<WorkspaceEditTransactionError>>({ code: "io_failure" }));
    write(f.manifestPath, { ...f.manifest, displayName: "Unknown partial" });

    await expect(applyWorkspaceEditPlan(input)).rejects.toEqual(
      expect.objectContaining<Partial<WorkspaceEditTransactionError>>({
        code: "partial_apply_recovered",
        action: "roll workspace doctor ws-demo",
      }),
    );
    expect(existsSync(workspaceEditJournalPath(f.rollHome, "ws-demo"))).toBe(true);
  });

  it("fails loud when a committed journal conflicts with an externally restored before manifest", async () => {
    const f = fixture();
    const preview = plan(f);
    const input = transactionInput(f, preview);
    await expect(applyWorkspaceEditPlan(input, {
      crashPoint: (phase) => { if (phase === "journal_committed") throw new Error("crash"); },
    })).rejects.toEqual(expect.objectContaining<Partial<WorkspaceEditTransactionError>>({ code: "io_failure" }));
    writeFileSync(f.manifestPath, serializeWorkspaceManifest(f.manifest), "utf8");

    await expect(applyWorkspaceEditPlan(input)).rejects.toEqual(
      expect.objectContaining<Partial<WorkspaceEditTransactionError>>({ code: "partial_apply_recovered" }),
    );
  });
});
