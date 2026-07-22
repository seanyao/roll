import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveIssueCompletion } from "@roll/core";
import type { IssueIntegrationAcceptanceEvidence, RepositoryMergeEvidence } from "@roll/spec";
import {
  appendIssueIntegrationAcceptanceEvidence,
  appendRepositoryMergeEvidence,
  IssueCompletionEvidenceError,
  readIssueCompletionEvidence,
} from "../src/issue-completion-store.js";

const roots: string[] = [];
const WORKSPACE = "ws-1";
const STORY = "US-WS-013";
const REPO = "repo-aaaaaaaaaaaa";
const MERGE = "a".repeat(40);

function fixture(): string {
  const issueRoot = mkdtempSync(join(tmpdir(), "roll-issue-completion-"));
  roots.push(issueRoot);
  return issueRoot;
}

function mergeEvidence(): RepositoryMergeEvidence {
  return {
    workspaceId: WORKSPACE,
    storyId: STORY,
    repoId: REPO,
    cycleId: "cycle-1",
    authority: "provider",
    prNumber: 101,
    prUrl: "https://example.invalid/pull/101",
    prState: "MERGED",
    ci: "green",
    mergeCommit: MERGE,
    mergedAt: 2,
    recordedAt: 3,
  };
}

function acceptance(): IssueIntegrationAcceptanceEvidence {
  return {
    workspaceId: WORKSPACE,
    storyId: STORY,
    inputMergeCommits: { [REPO]: MERGE },
    verdict: "pass",
    artifactPath: "evidence/integration.txt",
    recordedAt: 4,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("US-WS-013 Issue completion evidence store", () => {
  it("atomically appends Issue-owned facts and rebuilds completion without a delivery sub-aggregate", () => {
    const issueRoot = fixture();
    appendRepositoryMergeEvidence(issueRoot, mergeEvidence());
    appendRepositoryMergeEvidence(issueRoot, mergeEvidence());
    appendIssueIntegrationAcceptanceEvidence(issueRoot, acceptance());

    const lines = readFileSync(join(issueRoot, "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toEqual([
      expect.objectContaining({ type: "issue:repository_merge_evidence_recorded", workspaceId: WORKSPACE, storyId: STORY, repoId: REPO, cycleId: "cycle-1", ts: 3 }),
      expect.objectContaining({ type: "issue:repository_merge_evidence_recorded", workspaceId: WORKSPACE, storyId: STORY, repoId: REPO, cycleId: "cycle-1", ts: 3 }),
      expect.objectContaining({ type: "issue:integration_acceptance_evidence_recorded", workspaceId: WORKSPACE, storyId: STORY, ts: 4 }),
    ]);
    expect(existsSync(join(issueRoot, "delivery"))).toBe(false);

    const evidence = readIssueCompletionEvidence(issueRoot);
    expect(deriveIssueCompletion({
      workspaceId: WORKSPACE,
      storyId: STORY,
      repositories: [{ repoId: REPO, required: true }],
      repositoryFacts: evidence.repositoryFacts,
      integrationAcceptances: evidence.integrationAcceptances,
      backlogDone: false,
    })).toMatchObject({ state: "delivered", mergeCommits: { [REPO]: MERGE } });
  });

  it("fails loud on malformed recognized evidence instead of silently dropping completion truth", () => {
    const issueRoot = fixture();
    writeFileSync(join(issueRoot, "events.jsonl"), `${JSON.stringify({
      type: "issue:repository_merge_evidence_recorded",
      ...mergeEvidence(),
      mergeCommit: "main",
      ts: 3,
    })}\n`, "utf8");

    expect(() => readIssueCompletionEvidence(issueRoot)).toThrow(IssueCompletionEvidenceError);
  });
});
