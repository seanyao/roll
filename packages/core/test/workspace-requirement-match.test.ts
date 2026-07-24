import { describe, expect, it } from "vitest";
import { repositoryIdFromRemote, type RequirementHintV1 } from "@roll/spec";
import {
  MAX_REQUIREMENT_MATCH_EVIDENCE,
  matchWorkspaceRequirement,
  normalizeRequirementHint,
  normalizeRequirementSourceReference,
} from "../src/index.js";

function requirementId(provider: string, ref: string): string {
  const normalized = normalizeRequirementSourceReference(provider, ref);
  if (!normalized.ok) throw new Error("fixture requirement must be valid");
  return normalized.value.requirementId;
}

function repoId(remote: string): string {
  const normalized = repositoryIdFromRemote(remote);
  if (!normalized.ok) throw new Error("fixture repository must be valid");
  return normalized.value;
}

describe("US-WS-027 workspace requirement evidence", () => {
  it("turns only structured exact identities into hard evidence and retains audit detail", () => {
    const hint = normalizeRequirementHint({
      sources: [
        { key: { provider: "jira", ref: "APE-234" }, provenance: "explicit_user" },
        { key: { provider: "local-file", ref: "PRD/Brief.md" }, provenance: "deterministic_extraction" },
      ],
      storyIds: [{ storyId: "US-WS-027", provenance: "issue_manifest" }],
      repositoryRemotes: [{ remote: "https://github.com/Owner/Repo", provenance: "cwd_repository" }],
      paths: [{ path: "/work/ws/issues/US-WS-027", provenance: "cwd_repository" }],
      semanticTerms: ["workspace resolver"],
    });
    if (!hint.ok) throw new Error("fixture hint must be valid");

    const result = matchWorkspaceRequirement({
      requirement: hint.value,
      facts: {
        issues: [{ storyId: "US-WS-027", requirements: [] }],
        requirementSources: [
          { provider: "jira", ref: "APE-234", requirementId: requirementId("jira", "APE-234") },
          { provider: "local_file", ref: "PRD/Brief.md", requirementId: requirementId("local_file", "PRD/Brief.md") },
        ],
        repositories: [{ remote: "https://github.com/Owner/Repo.git", repositoryId: repoId("https://github.com/Owner/Repo") }],
        roots: ["/work/ws"],
        semanticTerms: ["Workspace Resolver", "unrelated"],
      },
    });

    expect(result.hardMatch).toBe(true);
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "issue_exact",
        hard: true,
        provenance: "issue_manifest",
        source: "issue:US-WS-027",
        detail: "Issue manifest storyId matched US-WS-027",
      }),
      expect.objectContaining({
        kind: "requirement_source_exact",
        hard: true,
        value: "jira:APE-234",
        provenance: "explicit_user",
        source: `requirement:jira/${requirementId("jira", "APE-234")}`,
      }),
      expect.objectContaining({ kind: "repository_exact", hard: false, provenance: "cwd_repository" }),
      expect.objectContaining({ kind: "path_contained", hard: false, provenance: "cwd_repository" }),
      expect.objectContaining({ kind: "semantic_supported", hard: false, provenance: "semantic_inference" }),
    ]));
    expect(result.evidence.filter((entry) => entry.hard).every((entry) => (
      entry.kind === "issue_exact" || entry.kind === "requirement_source_exact"
    ))).toBe(true);
  });

  it("never upgrades forged semantic or cwd identities into exact evidence", () => {
    const requirement = {
      schema: "roll.requirement-hint/v1",
      sources: [
        { key: { provider: "jira", ref: "APE-234" }, provenance: "semantic_inference" },
        { key: { provider: "jira", ref: "APE-234" }, provenance: "cwd_repository" },
      ],
      storyIds: [{ storyId: "US-WS-027", provenance: "semantic_inference" }],
      repositoryRemotes: [],
      paths: [],
      semanticTerms: ["APE-234"],
    } as unknown as RequirementHintV1;
    const result = matchWorkspaceRequirement({
      requirement,
      facts: {
        issues: [{ storyId: "US-WS-027", requirements: [] }],
        requirementSources: [{ provider: "jira", ref: "APE-234", requirementId: requirementId("jira", "APE-234") }],
        repositories: [],
        roots: [],
        semanticTerms: ["APE-234"],
      },
    });
    expect(result.hardMatch).toBe(false);
    expect(result.evidence).toEqual([
      expect.objectContaining({ kind: "semantic_supported", hard: false }),
    ]);
  });

  it("preserves persisted identity and emits migration findings instead of rewriting legacy refs", () => {
    const hint = normalizeRequirementHint({
      sources: [{ key: { provider: "jira", ref: "APE-234" }, provenance: "cli_argument" }],
    });
    if (!hint.ok) throw new Error("fixture hint must be valid");
    const valid = { provider: "jira", ref: "APE-234", requirementId: requirementId("jira", "APE-234") };
    const legacy = { provider: "jira", ref: "234", requirementId: "req-legacy000001" };
    const mismatch = { provider: "jira", ref: "APE-999", requirementId: "req-000000000000" };
    const before = structuredClone([valid, legacy, mismatch]);

    const result = matchWorkspaceRequirement({
      requirement: hint.value,
      facts: { issues: [], requirementSources: [mismatch, legacy, valid], repositories: [], roots: [] },
    });

    expect([valid, legacy, mismatch]).toEqual(before);
    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: "requirement_source_exact",
        value: "jira:APE-234",
        source: `requirement:jira/${valid.requirementId}`,
      }),
    ]);
    expect(result.findings).toEqual([
      expect.objectContaining({ code: "requirement_identity_mismatch", source: "requirement:jira/req-000000000000" }),
      expect.objectContaining({ code: "legacy_requirement_ref_requires_migration", source: "requirement:jira/req-legacy000001" }),
    ]);
  });

  it("sorts and deduplicates evidence deterministically and applies a hard limit", () => {
    const semanticTerms = Array.from({ length: MAX_REQUIREMENT_MATCH_EVIDENCE + 8 }, (_, index) => `term-${String(index).padStart(3, "0")}`);
    const requirement = {
      schema: "roll.requirement-hint/v1",
      sources: [],
      storyIds: [],
      repositoryRemotes: [],
      paths: [],
      semanticTerms: [...semanticTerms].reverse(),
    } as const;
    const input = {
      requirement,
      facts: {
        issues: [],
        requirementSources: [],
        repositories: [],
        roots: [],
        semanticTerms: [...semanticTerms, semanticTerms[0] ?? ""],
      },
    };
    const before = structuredClone(input);
    const first = matchWorkspaceRequirement(input);
    const second = matchWorkspaceRequirement({ ...input, facts: { ...input.facts, semanticTerms: [...input.facts.semanticTerms].reverse() } });
    expect(input).toEqual(before);
    expect(first.evidence).toHaveLength(MAX_REQUIREMENT_MATCH_EVIDENCE);
    expect(second.evidence).toEqual(first.evidence);
    expect(new Set(first.evidence.map((entry) => `${entry.kind}:${entry.value}`)).size).toBe(first.evidence.length);
  });

  it("provides a pure normalization-to-match golden path without provider URL or text collection", () => {
    const normalized = normalizeRequirementHint({
      sources: [{ key: { provider: "github_issue", ref: "Owner/Repo#42" }, provenance: "deterministic_extraction" }],
      repositoryRemotes: [{ remote: "https://github.com/Owner/Repo.git", provenance: "cwd_repository" }],
    });
    if (!normalized.ok) throw new Error("fixture hint must be valid");
    const result = matchWorkspaceRequirement({
      requirement: normalized.value,
      facts: {
        issues: [],
        requirementSources: [{
          provider: "github_issue",
          ref: "owner/repo#42",
          requirementId: requirementId("github_issue", "owner/repo#42"),
        }],
        repositories: [{
          remote: "https://github.com/Owner/Repo",
          repositoryId: repoId("https://github.com/Owner/Repo"),
        }],
        roots: [],
      },
    });
    expect(result).toMatchObject({
      hardMatch: true,
      evidence: [
        expect.objectContaining({ kind: "requirement_source_exact", hard: true }),
        expect.objectContaining({ kind: "repository_exact", hard: false }),
      ],
      findings: [],
    });
  });
});
