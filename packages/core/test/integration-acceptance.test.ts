import { describe, expect, it, vi } from "vitest";
import {
  runIntegrationAcceptance,
  type IntegrationAcceptanceInput,
} from "../src/delivery/integration-acceptance.js";

const WORKSPACE = "ws-1";
const STORY = "US-WS-014";
const API = "repo-aaaaaaaaaaaa";
const WEB = "repo-bbbbbbbbbbbb";
const API_MERGE = "a".repeat(40);
const WEB_MERGE = "b".repeat(40);

function input(overrides: Partial<IntegrationAcceptanceInput> = {}): IntegrationAcceptanceInput {
  return {
    workspaceId: WORKSPACE,
    storyId: STORY,
    repositories: [
      {
        repoId: API,
        repositoryPath: "/workspace/issues/US-WS-014/api",
        integrationBranch: "main",
        authority: "provider",
        status: "merged",
        mergeCommit: API_MERGE,
      },
      {
        repoId: WEB,
        repositoryPath: "/workspace/issues/US-WS-014/web",
        integrationBranch: "release",
        authority: "integration_branch",
        status: "merged",
        mergeCommit: WEB_MERGE,
      },
    ],
    command: ["pnpm", "test:integration"],
    profile: "workspace-integration/v1",
    artifactPath: "evidence/integration/result.txt",
    recordedAt: 100,
    ...overrides,
  };
}

describe("US-WS-014 exact-SHA integration acceptance", () => {
  it("does not execute before every required repository has a strong immutable merge", async () => {
    const isReachable = vi.fn();
    const execute = vi.fn();

    const result = await runIntegrationAcceptance(input({
      repositories: [
        input().repositories[0]!,
        { ...input().repositories[1]!, status: "awaiting_merge", mergeCommit: undefined },
      ],
    }), { isReachable, execute });

    expect(result).toEqual({
      status: "pending",
      message: `integration acceptance pending: ${WEB} has no strongly proven merge commit`,
    });
    expect(isReachable).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("records a failed exact-SHA verdict and names the repository mismatch without running the command", async () => {
    const isReachable = vi.fn(async (repository: { readonly repoId: string }) => repository.repoId === API);
    const execute = vi.fn();

    const result = await runIntegrationAcceptance(input(), { isReachable, execute });

    expect(result.status).toBe("recorded");
    if (result.status !== "recorded") return;
    expect(result.evidence).toMatchObject({
      inputMergeCommits: { [API]: API_MERGE, [WEB]: WEB_MERGE },
      verdict: "fail",
      profile: "workspace-integration/v1",
      artifactPath: "evidence/integration/result.txt",
    });
    expect(result.evidence.commandDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.message).toBe(
      `integration acceptance blocked: ${WEB}@${WEB_MERGE} is not reachable from integration branch release`,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes once with the exact merge map and persists command/profile identity", async () => {
    const execute = vi.fn(async () => ({ exitCode: 0 }));

    const result = await runIntegrationAcceptance(input(), {
      isReachable: vi.fn(async () => true),
      execute,
    });

    expect(result.status).toBe("recorded");
    if (result.status !== "recorded") return;
    expect(result.evidence).toEqual({
      workspaceId: WORKSPACE,
      storyId: STORY,
      inputMergeCommits: { [API]: API_MERGE, [WEB]: WEB_MERGE },
      commandDigest: result.evidence.commandDigest,
      profile: "workspace-integration/v1",
      verdict: "pass",
      artifactPath: "evidence/integration/result.txt",
      recordedAt: 100,
    });
    expect(execute).toHaveBeenCalledWith({
      command: ["pnpm", "test:integration"],
      commandDigest: result.evidence.commandDigest,
      profile: "workspace-integration/v1",
      inputMergeCommits: { [API]: API_MERGE, [WEB]: WEB_MERGE },
      artifactPath: "evidence/integration/result.txt",
    });
  });

  it("records command failure against the same exact merge inputs", async () => {
    const result = await runIntegrationAcceptance(input(), {
      isReachable: vi.fn(async () => true),
      execute: vi.fn(async () => ({ exitCode: 7 })),
    });

    expect(result).toMatchObject({
      status: "recorded",
      evidence: { verdict: "fail", inputMergeCommits: { [API]: API_MERGE, [WEB]: WEB_MERGE } },
      message: "integration acceptance command failed with exit code 7",
    });
  });
});
