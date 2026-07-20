import { describe, expect, it } from "vitest";
import { parseRequirementSourceManifest, requirementSourceV1Schema } from "@roll/spec";
import {
  planRequirementCapture,
  renderRequirementAttestProjection,
  resolveRequirementSourcesForStory,
  type RequirementCaptureFacts,
} from "../src/index.js";

const digest = (char: string): string => char.repeat(64);

function facts(overrides: Partial<RequirementCaptureFacts> = {}): RequirementCaptureFacts {
  return {
    provider: "jira",
    ref: "SOT-15499",
    revision: "42",
    capturedAt: "2026-07-20T16:00:00.000Z",
    requirement: { bytes: 18, sha256: digest("a") },
    context: [
      { path: "brief/acceptance.md", bytes: 12, sha256: digest("b") },
      { path: "domain.md", bytes: 6, sha256: digest("c") },
    ],
    stories: ["US-WS-008", "US-WS-007"],
    ...overrides,
  };
}

describe("US-WS-007 RequirementSource planning", () => {
  it.each([
    ["jira", "jira", "req-c78ccf14ea21"],
    ["github-issue", "github_issue", "req-3037c032c113"],
    ["local-file", "local_file", "req-b6476e7911bb"],
    ["user-input", "user_input", "req-db77abe09a44"],
  ] as const)("normalizes the %s provider into the closed v1 contract", (provider, expected, requirementId) => {
    const input = facts({ provider });
    const before = structuredClone(input);
    const result = planRequirementCapture(input);
    expect(result).toMatchObject({
      ok: true,
      value: {
        outcome: "created",
        historyRevision: null,
        manifest: {
          schema: "roll.requirement-source/v1",
          requirementId,
          provider: expected,
          ref: "SOT-15499",
          revision: "42",
          stories: ["US-WS-007", "US-WS-008"],
          requirement: { bytes: 18, sha256: digest("a") },
          context: [
            { path: "brief/acceptance.md", bytes: 12, sha256: digest("b") },
            { path: "domain.md", bytes: 6, sha256: digest("c") },
          ],
          attest: {
            schema: "roll.requirement-attest-projection/v1",
            mode: "generated_aggregate",
            evidenceAuthority: "issue",
          },
        },
      },
    });
    expect(input).toEqual(before);
  });

  it("makes an identical capture idempotent and links additional Stories without changing raw evidence", () => {
    const created = planRequirementCapture(facts());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(planRequirementCapture(facts(), created.value.manifest)).toEqual({
      ok: true,
      value: { outcome: "reused", historyRevision: null, manifest: created.value.manifest },
    });

    const linked = planRequirementCapture(facts({ stories: ["US-WS-009"] }), created.value.manifest);
    expect(linked).toMatchObject({
      ok: true,
      value: {
        outcome: "linked",
        historyRevision: null,
        manifest: { stories: ["US-WS-007", "US-WS-008", "US-WS-009"] },
      },
    });
  });

  it("rejects changed evidence under the same revision and preserves the prior revision on update", () => {
    const created = planRequirementCapture(facts());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(planRequirementCapture(facts({ requirement: { bytes: 19, sha256: digest("d") } }), created.value.manifest)).toMatchObject({
      ok: false,
      errors: [{ code: "revision_conflict", path: "revision" }],
    });

    const updated = planRequirementCapture(facts({
      revision: "43",
      capturedAt: "2026-07-20T17:00:00.000Z",
      requirement: { bytes: 19, sha256: digest("d") },
      context: [],
      stories: ["US-WS-010"],
    }), created.value.manifest);
    expect(updated).toMatchObject({
      ok: true,
      value: {
        outcome: "updated",
        historyRevision: "42",
        manifest: {
          revision: "43",
          previousRevisions: [{ revision: "42", capturedAt: "2026-07-20T16:00:00.000Z" }],
          stories: ["US-WS-007", "US-WS-008", "US-WS-010"],
        },
      },
    });
  });

  it("resolves every linked Story back to its Requirement source and declares attest as a projection", () => {
    const first = planRequirementCapture(facts()).value;
    const second = planRequirementCapture(facts({ provider: "user-input", ref: "owner-brief", stories: ["US-WS-008"] })).value;
    if (first === undefined || second === undefined) throw new Error("fixture must be valid");
    expect(resolveRequirementSourcesForStory([second.manifest, first.manifest], "US-WS-008"))
      .toEqual([first.manifest, second.manifest]);
    expect(renderRequirementAttestProjection(first.manifest)).toContain("Generated aggregate projection");
    expect(renderRequirementAttestProjection(first.manifest)).toContain("Issue-owned evidence remains authoritative");
  });

  it("rejects unknown providers, unsafe context paths, malformed digests and credential-shaped refs without echoing secrets", () => {
    const secret = "https://token:credential-sentinel@example.test/issue/1";
    const result = planRequirementCapture(facts({
      provider: "custom-provider",
      ref: secret,
      requirement: { bytes: -1, sha256: "nope" },
      context: [{ path: "../escape.md", bytes: 1, sha256: digest("e") }],
    }));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("credential-sentinel");
    expect(result).toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "invalid_provider", path: "provider" }),
        expect.objectContaining({ code: "unsafe_reference", path: "ref" }),
        expect.objectContaining({ code: "invalid_value", path: "requirement.bytes" }),
        expect.objectContaining({ code: "invalid_value", path: "requirement.sha256" }),
        expect.objectContaining({ code: "unsafe_path", path: "context[0].path" }),
      ]),
    });
  });

  it("publishes and parses a closed versioned source contract without credential fields", () => {
    const created = planRequirementCapture(facts());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(requirementSourceV1Schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        schema: { const: "roll.requirement-source/v1" },
        provider: { enum: ["jira", "github_issue", "local_file", "user_input"] },
      },
    });
    expect(JSON.stringify(requirementSourceV1Schema)).not.toMatch(/credential|password|token|secret/iu);
    expect(parseRequirementSourceManifest(created.value.manifest)).toEqual({ ok: true, value: created.value.manifest });
    expect(parseRequirementSourceManifest({ ...created.value.manifest, schema: "roll.requirement-source/v2" })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "unknown_version", path: "schema" })]),
    });
    expect(parseRequirementSourceManifest({ ...created.value.manifest, token: "credential-sentinel" })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "unknown_field", path: "token" })]),
    });
    const secret = "https://token:credential-sentinel@example.test/issue/1";
    const unsafe = parseRequirementSourceManifest({ ...created.value.manifest, ref: secret });
    expect(unsafe).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "invalid_value", path: "ref" })]),
    });
    expect(JSON.stringify(unsafe)).not.toContain(secret);
    expect(JSON.stringify(unsafe)).not.toContain("credential-sentinel");
  });
});
