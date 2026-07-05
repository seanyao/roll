/**
 * FIX-1214 — publish-segment resilience tests for transient GitHub API faults.
 */
import { describe, expect, it } from "vitest";
import {
  runPublishPlan,
  type GhResult,
  type PublishStepLike,
  type RunStep,
} from "../src/github.js";

function pubPlan(mergeKind: "gh-pr-merge-auto" | "gh-pr-merge-admin"): PublishStepLike[] {
  return [
    { tool: "git", kind: "git-push", argv: ["push", "origin", "loop/cycle-x"] },
    { tool: "gh", kind: "gh-pr-view", argv: ["-R", "o/r", "pr", "view", "loop/cycle-x", "--json", "url", "-q", ".url"] },
    { tool: "gh", kind: "gh-pr-create", argv: ["-R", "o/r", "pr", "create", "--base", "main", "--head", "loop/cycle-x", "--title", "t", "--body", "b"] },
    { tool: "gh", kind: mergeKind, argv: ["-R", "o/r", "pr", "merge", "loop/cycle-x", mergeKind === "gh-pr-merge-auto" ? "--auto" : "--admin", "--squash", "--delete-branch"] },
  ];
}

function indexByArgv(plan: PublishStepLike[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of plan) m.set(s.argv.join("^@"), s.kind);
  return m;
}

function fakeRun(
  results: Partial<Record<string, GhResult>>,
  log: { tool: string; argv: string[]; kind?: string }[],
  planByArgv: Map<string, string>,
): RunStep {
  return async (tool, argv) => {
    const key = planByArgv.get(argv.join("^@")) ?? "";
    log.push({ tool, argv: [...argv], kind: key });
    if (key === "" && argv.includes("api")) {
      // FIX-1214 tests intentionally exhaust the REST fallback as well.
      return { code: 1, stdout: "", stderr: "EOF" };
    }
    return results[key] ?? { code: 0, stdout: "", stderr: "" };
  };
}

describe("runPublishPlan FIX-1214 degraded publish on transient GitHub API faults", () => {
  it("transient pr-create failure after push => degraded status 0 with env:gh_api", async () => {
    const plan = pubPlan("gh-pr-merge-auto");
    const log: { tool: string; argv: string[]; kind?: string }[] = [];
    const run = fakeRun(
      {
        "gh-pr-view": { code: 1, stdout: "", stderr: "" },
        "gh-pr-create": { code: 1, stdout: "", stderr: `Post "https://api.github.com/graphql": EOF` },
      },
      log,
      indexByArgv(plan),
    );
    const res = await runPublishPlan(plan, {
      ghAvailable: async () => true,
      run,
      sleep: async () => {},
      retries: 1,
    });
    expect(res).toEqual({
      prUrl: "",
      ok: false,
      status: 0,
      degraded: true,
      rootCauseKey: "env:gh_api",
    });
    expect(log.map((l) => l.kind)).toEqual([
      "git-push",
      "gh-pr-view",
      "gh-pr-create",
      "gh-pr-create",
      "",
      "gh-pr-view",
    ]);
  });

  it("permanent pr-create failure => status 1 (no degradation)", async () => {
    const plan = pubPlan("gh-pr-merge-auto");
    const log: { tool: string; argv: string[]; kind?: string }[] = [];
    const run = fakeRun(
      {
        "gh-pr-view": { code: 1, stdout: "", stderr: "" },
        "gh-pr-create": { code: 1, stdout: "", stderr: "a pull request already exists" },
      },
      log,
      indexByArgv(plan),
    );
    const res = await runPublishPlan(plan, { ghAvailable: async () => true, run, sleep: async () => {}, retries: 1 });
    expect(res).toEqual({ prUrl: "", ok: false, status: 1 });
  });

  it("transient admin-merge failure => degraded status 0 with env:gh_api", async () => {
    const plan = pubPlan("gh-pr-merge-admin");
    const log: { tool: string; argv: string[]; kind?: string }[] = [];
    const run = fakeRun(
      {
        "gh-pr-view": { code: 0, stdout: "https://github.com/o/r/pull/3\n", stderr: "" },
        "gh-pr-merge-admin": { code: 1, stdout: "", stderr: "HTTP 503: Service Unavailable" },
      },
      log,
      indexByArgv(plan),
    );
    const res = await runPublishPlan(plan, {
      ghAvailable: async () => true,
      run,
      sleep: async () => {},
      retries: 1,
    });
    expect(res).toEqual({
      prUrl: "https://github.com/o/r/pull/3",
      ok: false,
      status: 0,
      degraded: true,
      rootCauseKey: "env:gh_api",
    });
  });

  it("non-transient admin-merge failure => status 1", async () => {
    const plan = pubPlan("gh-pr-merge-admin");
    const log: { tool: string; argv: string[]; kind?: string }[] = [];
    const run = fakeRun(
      {
        "gh-pr-view": { code: 0, stdout: "https://github.com/o/r/pull/3\n", stderr: "" },
        "gh-pr-merge-admin": { code: 1, stdout: "", stderr: "no admin permission" },
      },
      log,
      indexByArgv(plan),
    );
    const res = await runPublishPlan(plan, { ghAvailable: async () => true, run, sleep: async () => {}, retries: 1 });
    expect(res).toEqual({ prUrl: "https://github.com/o/r/pull/3", ok: false, status: 1 });
  });

  it("transient create eventually succeeds via retry => normal status 0", async () => {
    const plan = pubPlan("gh-pr-merge-auto");
    const log: { tool: string; argv: string[]; kind?: string }[] = [];
    let createCalls = 0;
    const run: RunStep = async (tool, argv) => {
      const kind = indexByArgv(plan).get(argv.join("^@")) ?? "";
      log.push({ tool, argv: [...argv], kind });
      if (kind === "gh-pr-create") {
        createCalls += 1;
        if (createCalls < 2) return { code: 1, stdout: "", stderr: "EOF" };
        return { code: 0, stdout: "https://github.com/o/r/pull/21\n", stderr: "" };
      }
      if (kind === "gh-pr-view") return { code: 1, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    };
    const sleeps: number[] = [];
    const res = await runPublishPlan(plan, {
      ghAvailable: async () => true,
      run,
      sleep: async (ms) => sleeps.push(ms),
      retries: 3,
    });
    expect(res).toEqual({ prUrl: "https://github.com/o/r/pull/21", ok: true, status: 0 });
    expect(createCalls).toBe(2);
    expect(sleeps).toEqual([15_000]); // one retry before success
  });

  it("exponential backoff schedule uses 15s/30s/60s/120s caps", async () => {
    const plan = pubPlan("gh-pr-merge-auto");
    const sleeps: number[] = [];
    let createCalls = 0;
    const run: RunStep = async (tool, argv) => {
      const kind = indexByArgv(plan).get(argv.join("^@")) ?? "";
      if (kind === "gh-pr-create") {
        createCalls += 1;
        return { code: 1, stdout: "", stderr: "EOF" };
      }
      if (kind === "gh-pr-view") return { code: 1, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    };
    await runPublishPlan(plan, {
      ghAvailable: async () => true,
      run,
      sleep: async (ms) => sleeps.push(ms),
      retries: 4,
    });
    expect(createCalls).toBe(5);
    expect(sleeps).toEqual([15_000, 30_000, 60_000, 120_000]);
  });
});
