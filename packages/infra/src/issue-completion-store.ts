import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ISSUE_INTEGRATION_ACCEPTANCE_EVIDENCE_RECORDED,
  REPOSITORY_MERGE_EVIDENCE_RECORDED,
  isImmutableGitObjectId,
  type IssueIntegrationAcceptanceEvidence,
  type IssueIntegrationAcceptanceEvidenceRecordedEvent,
  type RepositoryMergeEvidence,
  type RepositoryMergeEvidenceRecordedEvent,
} from "@roll/spec";
import { appendIssueEventAtomically } from "./issue-worktrees.js";

export interface IssueCompletionEvidenceCollection {
  readonly repositoryFacts: readonly RepositoryMergeEvidence[];
  readonly integrationAcceptances: readonly IssueIntegrationAcceptanceEvidence[];
}

export class IssueCompletionEvidenceError extends Error {}

function record(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : undefined;
}

function requireRecord(raw: unknown, label: string): Record<string, unknown> {
  const value = record(raw);
  if (value === undefined) throw new IssueCompletionEvidenceError(`${label} must be an object`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") {
    throw new IssueCompletionEvidenceError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new IssueCompletionEvidenceError(`${label} must be a finite number`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, label);
}

function optionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  return requireFiniteNumber(value, label);
}

function optionalMergeCommit(value: unknown, label: string): string | undefined {
  const mergeCommit = optionalString(value, label);
  if (mergeCommit !== undefined && !isImmutableGitObjectId(mergeCommit)) {
    throw new IssueCompletionEvidenceError(`${label} must be a full lowercase immutable Git object id`);
  }
  return mergeCommit;
}

function assertClosed(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new IssueCompletionEvidenceError(`${label} contains unsupported keys: ${unexpected.sort().join(", ")}`);
  }
}

const REPOSITORY_IDENTITY_KEYS = [
  "type",
  "ts",
  "workspaceId",
  "storyId",
  "repoId",
  "cycleId",
  "authority",
  "recordedAt",
] as const;

function repositoryIdentity(value: Record<string, unknown>): {
  readonly workspaceId: string;
  readonly storyId: string;
  readonly repoId: string;
  readonly cycleId: string;
  readonly recordedAt: number;
  readonly ts: number;
} {
  const recordedAt = requireFiniteNumber(value["recordedAt"], "repository evidence recordedAt");
  const ts = requireFiniteNumber(value["ts"], "repository evidence ts");
  if (ts !== recordedAt) throw new IssueCompletionEvidenceError("repository evidence ts must equal recordedAt");
  return {
    workspaceId: requireString(value["workspaceId"], "repository evidence workspaceId"),
    storyId: requireString(value["storyId"], "repository evidence storyId"),
    repoId: requireString(value["repoId"], "repository evidence repoId"),
    cycleId: requireString(value["cycleId"], "repository evidence cycleId"),
    recordedAt,
    ts,
  };
}

function validateRepositoryEvent(raw: unknown): RepositoryMergeEvidenceRecordedEvent {
  const value = requireRecord(raw, "repository merge evidence event");
  if (value["type"] !== REPOSITORY_MERGE_EVIDENCE_RECORDED) {
    throw new IssueCompletionEvidenceError("repository merge evidence event has an invalid type");
  }
  const identity = repositoryIdentity(value);
  const authority = value["authority"];
  if (authority === "provider") {
    assertClosed(value, new Set([...REPOSITORY_IDENTITY_KEYS, "prNumber", "prUrl", "prState", "ci", "mergeCommit", "mergedAt"]), "provider merge evidence");
    const prNumber = optionalFiniteNumber(value["prNumber"], "provider prNumber");
    if (prNumber !== undefined && (!Number.isInteger(prNumber) || prNumber <= 0)) {
      throw new IssueCompletionEvidenceError("provider prNumber must be a positive integer");
    }
    const prState = value["prState"];
    if (prState !== "OPEN" && prState !== "MERGED" && prState !== "CLOSED" && prState !== "UNKNOWN") {
      throw new IssueCompletionEvidenceError("provider prState is invalid");
    }
    const ci = value["ci"];
    if (ci !== "green" && ci !== "red" && ci !== "pending" && ci !== "unknown") {
      throw new IssueCompletionEvidenceError("provider ci is invalid");
    }
    const prUrl = optionalString(value["prUrl"], "provider prUrl");
    const mergeCommit = optionalMergeCommit(value["mergeCommit"], "provider mergeCommit");
    const mergedAt = optionalFiniteNumber(value["mergedAt"], "provider mergedAt");
    return {
      type: REPOSITORY_MERGE_EVIDENCE_RECORDED,
      ...identity,
      authority,
      ...(prNumber === undefined ? {} : { prNumber }),
      ...(prUrl === undefined ? {} : { prUrl }),
      prState,
      ci,
      ...(mergeCommit === undefined ? {} : { mergeCommit }),
      ...(mergedAt === undefined ? {} : { mergedAt }),
    };
  }
  if (authority === "integration_branch") {
    assertClosed(value, new Set([...REPOSITORY_IDENTITY_KEYS, "reachable", "mergeCommit"]), "integration-branch merge evidence");
    if (typeof value["reachable"] !== "boolean") {
      throw new IssueCompletionEvidenceError("integration-branch reachable must be boolean");
    }
    const mergeCommit = optionalMergeCommit(value["mergeCommit"], "integration-branch mergeCommit");
    return {
      type: REPOSITORY_MERGE_EVIDENCE_RECORDED,
      ...identity,
      authority,
      reachable: value["reachable"],
      ...(mergeCommit === undefined ? {} : { mergeCommit }),
    };
  }
  if (authority === "projection") {
    assertClosed(value, new Set([...REPOSITORY_IDENTITY_KEYS, "state", "mergeCommit"]), "repository projection evidence");
    const state = value["state"];
    if (state !== "building" && state !== "awaiting_merge" && state !== "merged" && state !== "blocked" && state !== "abandoned") {
      throw new IssueCompletionEvidenceError("repository projection state is invalid");
    }
    const mergeCommit = optionalMergeCommit(value["mergeCommit"], "repository projection mergeCommit");
    return {
      type: REPOSITORY_MERGE_EVIDENCE_RECORDED,
      ...identity,
      authority,
      state,
      ...(mergeCommit === undefined ? {} : { mergeCommit }),
    };
  }
  throw new IssueCompletionEvidenceError("repository merge evidence authority is invalid");
}

function validateAcceptanceEvent(raw: unknown): IssueIntegrationAcceptanceEvidenceRecordedEvent {
  const value = requireRecord(raw, "integration acceptance evidence event");
  assertClosed(value, new Set(["type", "ts", "workspaceId", "storyId", "inputMergeCommits", "verdict", "artifactPath", "recordedAt"]), "integration acceptance evidence");
  if (value["type"] !== ISSUE_INTEGRATION_ACCEPTANCE_EVIDENCE_RECORDED) {
    throw new IssueCompletionEvidenceError("integration acceptance evidence event has an invalid type");
  }
  const recordedAt = requireFiniteNumber(value["recordedAt"], "integration acceptance recordedAt");
  const ts = requireFiniteNumber(value["ts"], "integration acceptance ts");
  if (ts !== recordedAt) throw new IssueCompletionEvidenceError("integration acceptance ts must equal recordedAt");
  const rawMergeCommits = requireRecord(value["inputMergeCommits"], "integration acceptance inputMergeCommits");
  const inputMergeCommits: Record<string, string> = {};
  for (const [repoId, rawSha] of Object.entries(rawMergeCommits)) {
    requireString(repoId, "integration acceptance repoId");
    const sha = requireString(rawSha, `integration acceptance merge commit for ${repoId}`);
    if (!isImmutableGitObjectId(sha)) {
      throw new IssueCompletionEvidenceError(`integration acceptance merge commit for ${repoId} must be immutable`);
    }
    inputMergeCommits[repoId] = sha;
  }
  const verdict = value["verdict"];
  if (verdict !== "pass" && verdict !== "fail") {
    throw new IssueCompletionEvidenceError("integration acceptance verdict is invalid");
  }
  return {
    type: ISSUE_INTEGRATION_ACCEPTANCE_EVIDENCE_RECORDED,
    ts,
    workspaceId: requireString(value["workspaceId"], "integration acceptance workspaceId"),
    storyId: requireString(value["storyId"], "integration acceptance storyId"),
    inputMergeCommits,
    verdict,
    artifactPath: requireString(value["artifactPath"], "integration acceptance artifactPath"),
    recordedAt,
  };
}

function repositoryFact(event: RepositoryMergeEvidenceRecordedEvent): RepositoryMergeEvidence {
  const { type: _type, ts: _ts, ...fact } = event;
  return fact;
}

function integrationAcceptance(event: IssueIntegrationAcceptanceEvidenceRecordedEvent): IssueIntegrationAcceptanceEvidence {
  const { type: _type, ts: _ts, ...evidence } = event;
  return evidence;
}

export function appendRepositoryMergeEvidence(
  issueRoot: string,
  evidence: RepositoryMergeEvidence,
): RepositoryMergeEvidenceRecordedEvent {
  const event = validateRepositoryEvent({
    type: REPOSITORY_MERGE_EVIDENCE_RECORDED,
    ...evidence,
    ts: evidence.recordedAt,
  });
  appendIssueEventAtomically(issueRoot, { ...event });
  return event;
}

export function appendIssueIntegrationAcceptanceEvidence(
  issueRoot: string,
  evidence: IssueIntegrationAcceptanceEvidence,
): IssueIntegrationAcceptanceEvidenceRecordedEvent {
  const event = validateAcceptanceEvent({
    type: ISSUE_INTEGRATION_ACCEPTANCE_EVIDENCE_RECORDED,
    ...evidence,
    ts: evidence.recordedAt,
  });
  appendIssueEventAtomically(issueRoot, { ...event });
  return event;
}

export function readIssueCompletionEvidence(issueRoot: string): IssueCompletionEvidenceCollection {
  const path = join(issueRoot, "events.jsonl");
  if (!existsSync(path)) return { repositoryFacts: [], integrationAcceptances: [] };
  const repositoryFacts: RepositoryMergeEvidence[] = [];
  const integrationAcceptances: IssueIntegrationAcceptanceEvidence[] = [];
  for (const [index, line] of readFileSync(path, "utf8").split("\n").entries()) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new IssueCompletionEvidenceError(`events.jsonl line ${index + 1} is corrupted: ${(error as Error).message}`);
    }
    const value = record(raw);
    if (value?.["type"] === REPOSITORY_MERGE_EVIDENCE_RECORDED) {
      repositoryFacts.push(repositoryFact(validateRepositoryEvent(value)));
    } else if (value?.["type"] === ISSUE_INTEGRATION_ACCEPTANCE_EVIDENCE_RECORDED) {
      integrationAcceptances.push(integrationAcceptance(validateAcceptanceEvent(value)));
    }
  }
  return { repositoryFacts, integrationAcceptances };
}
