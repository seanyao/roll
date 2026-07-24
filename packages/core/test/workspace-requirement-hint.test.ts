import { describe, expect, it } from "vitest";
import {
  REQUIREMENT_HINT_PROVENANCES,
  REQUIREMENT_HINT_V1,
  type RequirementHintV1,
} from "@roll/spec";
import {
  MAX_REQUIREMENT_HINT_ITEMS,
  normalizeRequirementHint,
} from "../src/index.js";

describe("US-WS-027 RequirementHintV1 normalization", () => {
  it("exports the closed hint and provenance contract", () => {
    expect(REQUIREMENT_HINT_V1).toBe("roll.requirement-hint/v1");
    expect(REQUIREMENT_HINT_PROVENANCES).toEqual([
      "explicit_user",
      "cli_argument",
      "issue_manifest",
      "cwd_repository",
      "deterministic_extraction",
      "semantic_inference",
    ]);

    const contract: RequirementHintV1 = {
      schema: REQUIREMENT_HINT_V1,
      sources: [],
      storyIds: [],
      repositoryRemotes: [],
      paths: [],
    };
    expect(contract.schema).toBe(REQUIREMENT_HINT_V1);
  });

  it("normalizes structured identities through the existing identity algorithms", () => {
    expect(normalizeRequirementHint({
      sources: [
        { key: { provider: "JIRA", ref: "ape-234" }, provenance: "explicit_user" },
        { key: { provider: "github-issue", ref: "Owner/Repo#12" }, provenance: "cli_argument" },
        { key: { provider: "local-file", ref: "PRD/Brief.md" }, provenance: "issue_manifest" },
      ],
      storyIds: [{ storyId: "US-WS-027", provenance: "deterministic_extraction" }],
      repositoryRemotes: [
        { remote: "git@GitHub.com:Owner/Repo.git", provenance: "cwd_repository" },
        { remote: "https://github.com/Owner/Repo", provenance: "explicit_user" },
      ],
      paths: [
        { path: "/tmp/workspace/../workspace/issues/US-WS-027", provenance: "explicit_user" },
      ],
      semanticTerms: ["  Workspace   Resolver ", "workspace resolver", "Hint"],
    })).toEqual({
      ok: true,
      value: {
        schema: "roll.requirement-hint/v1",
        sources: [
          { key: { provider: "github_issue", ref: "owner/repo#12" }, provenance: "cli_argument" },
          { key: { provider: "jira", ref: "APE-234" }, provenance: "explicit_user" },
          { key: { provider: "local_file", ref: "PRD/Brief.md" }, provenance: "issue_manifest" },
        ],
        storyIds: [{ storyId: "US-WS-027", provenance: "deterministic_extraction" }],
        repositoryRemotes: [
          { remote: "https://github.com/Owner/Repo", provenance: "explicit_user" },
          { remote: "ssh://github.com/Owner/Repo", provenance: "cwd_repository" },
        ],
        paths: [{ path: "/tmp/workspace/issues/US-WS-027", provenance: "explicit_user" }],
        semanticTerms: ["hint", "workspace resolver"],
      },
    });
  });

  it("is deterministic, idempotent and deduplicates exact normalized facts", () => {
    const first = normalizeRequirementHint({
      sources: [
        { key: { provider: "jira", ref: "APE-234" }, provenance: "explicit_user" },
        { key: { provider: "JIRA", ref: "ape-234" }, provenance: "explicit_user" },
      ],
      storyIds: [
        { storyId: "US-WS-027", provenance: "explicit_user" },
        { storyId: "US-WS-027", provenance: "explicit_user" },
      ],
      repositoryRemotes: [],
      paths: [],
      semanticTerms: ["Resolver", "resolver"],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(normalizeRequirementHint(first.value)).toEqual(first);
    expect(first.value.sources).toHaveLength(1);
    expect(first.value.storyIds).toHaveLength(1);
    expect(first.value.semanticTerms).toEqual(["resolver"]);
  });

  it.each([
    ["provider URL", { sources: [{ key: { provider: "jira", ref: "https://example.atlassian.net/browse/APE-234" }, provenance: "explicit_user" }] }],
    ["incomplete Jira number", { sources: [{ key: { provider: "jira", ref: "234" }, provenance: "deterministic_extraction" }] }],
    ["unknown provider", { sources: [{ key: { provider: "linear", ref: "ENG-1" }, provenance: "explicit_user" }] }],
    ["semantic exact source", { sources: [{ key: { provider: "jira", ref: "APE-234" }, provenance: "semantic_inference" }] }],
    ["out-of-bounds local file", { sources: [{ key: { provider: "local_file", ref: "../PRD/Brief.md" }, provenance: "explicit_user" }] }],
    ["relative candidate path", { paths: [{ path: "issues/US-WS-027", provenance: "explicit_user" }] }],
    ["semantic repository", { repositoryRemotes: [{ remote: "https://github.com/Owner/Repo", provenance: "semantic_inference" }] }],
  ] as const)("rejects %s instead of guessing a structured identity", (_name, input) => {
    expect(normalizeRequirementHint(input)).toMatchObject({ ok: false, findings: expect.any(Array) });
  });

  it("fails loudly when raw item counts or string lengths exceed their bounds", () => {
    expect(normalizeRequirementHint({
      semanticTerms: Array.from({ length: MAX_REQUIREMENT_HINT_ITEMS + 1 }, (_, index) => `term-${index}`),
    })).toMatchObject({
      ok: false,
      findings: [expect.objectContaining({ code: "item_limit", path: "semanticTerms" })],
    });
    expect(normalizeRequirementHint({
      semanticTerms: ["x".repeat(129)],
    })).toMatchObject({
      ok: false,
      findings: [expect.objectContaining({ code: "value_too_long", path: "semanticTerms[0]" })],
    });
  });
});
