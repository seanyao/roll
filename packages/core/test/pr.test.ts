/**
 * Unit tests for the PRLifecycle pure decision logic (delivery/pr.ts).
 * Behaviour assertions from a careful reading of the v2 oracle; the
 * byte-equivalence claims are covered separately in pr.difftest.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  branchTitleSuffix,
  cycleBranchName,
  cycleId,
  decidePublishOutcome,
  dedupeSortedIds,
  isEphemeralBranch,
  nextWaitAction,
  parseClaimedIdsFromBacklog,
  planPublishDocPr,
  planPublishPr,
  prStateToOutcome,
  DEFAULT_PR_MERGE_TIMEOUT,
  PR_MERGE_POLL_INTERVAL,
} from "../src/index.js";

describe("cycle branch naming", () => {
  it("cycleId joins timestamp-pid like `$(date +%Y%m%d-%H%M%S)-$$`", () => {
    expect(cycleId("20260605-013000", 12345)).toBe("20260605-013000-12345");
  });
  it("cycleBranchName prefixes loop/cycle-", () => {
    expect(cycleBranchName("20260605-013000-12345")).toBe("loop/cycle-20260605-013000-12345");
  });
  it("branchTitleSuffix strips a single loop/ prefix", () => {
    expect(branchTitleSuffix("loop/cycle-abc")).toBe("cycle-abc");
    expect(branchTitleSuffix("worktree-agent-x")).toBe("worktree-agent-x");
  });
});

describe("planPublishPr / planPublishDocPr", () => {
  const input = { branch: "loop/cycle-x", slug: "o/r", body: "B" };

  it("US-LOOP-094: pr plan is gh-only view → create → merge --auto (push hoisted out)", () => {
    const steps = planPublishPr(input);
    // The git-push step is no longer in the plan (done in the worktree by the
    // terminal handler); the plan is gh-only.
    expect(steps.map((s) => s.kind)).toEqual([
      "gh-pr-view",
      "gh-pr-create",
      "gh-pr-merge-auto",
    ]);
    expect(steps.some((s) => s.kind === "git-push")).toBe(false);
    expect(steps[2]?.argv).toEqual([
      "-R",
      "o/r",
      "pr",
      "merge",
      "loop/cycle-x",
      "--auto",
      "--squash",
      "--delete-branch",
    ]);
  });

  it("default title derives from the branch suffix", () => {
    const create = planPublishPr(input).find((s) => s.kind === "gh-pr-create");
    expect(create?.argv).toContain("loop cycle cycle-x");
  });

  it("explicit title overrides the default", () => {
    const create = planPublishPr({ ...input, title: "my title" }).find(
      (s) => s.kind === "gh-pr-create",
    );
    expect(create?.argv).toContain("my title");
  });

  it("manualMerge opens the PR but does not arm auto-merge", () => {
    const steps = planPublishPr({ ...input, manualMerge: true });
    expect(steps.map((s) => s.kind)).toEqual(["gh-pr-view", "gh-pr-create"]);
    const create = steps.find((s) => s.kind === "gh-pr-create");
    expect(create?.argv).toContain("B\n\n[roll:manual-merge]");
  });

  it("FIX-909: draft manual review PR uses --draft and does not arm auto-merge", () => {
    const steps = planPublishPr({ ...input, manualMerge: true, draft: true });
    expect(steps.map((s) => s.kind)).toEqual(["gh-pr-view", "gh-pr-create"]);
    const create = steps.find((s) => s.kind === "gh-pr-create");
    expect(create?.argv).toContain("--draft");
    expect(create?.argv).toContain("B\n\n[roll:manual-merge]");
  });

  it("doc plan swaps the merge tail to --admin and titles `doc update`", () => {
    const steps = planPublishDocPr(input);
    expect(steps.map((s) => s.kind)).toEqual([
      "gh-pr-view",
      "gh-pr-create",
      "gh-pr-merge-admin",
    ]);
    expect(steps[2]?.argv).toEqual([
      "-R",
      "o/r",
      "pr",
      "merge",
      "loop/cycle-x",
      "--admin",
      "--squash",
      "--delete-branch",
    ]);
    const create = steps.find((s) => s.kind === "gh-pr-create");
    expect(create?.argv).toContain("doc update cycle-x");
  });

  it("manualMerge doc plan also leaves the PR open for a human", () => {
    expect(planPublishDocPr({ ...input, manualMerge: true }).map((s) => s.kind)).toEqual([
      "gh-pr-view",
      "gh-pr-create",
    ]);
  });
});

describe("decidePublishOutcome (cycle-end ladder top-level branch)", () => {
  it("status 0 → done", () => {
    expect(decidePublishOutcome(0)).toEqual({ kind: "done" });
  });
  it("status 2 (gh missing) → merge-back", () => {
    expect(decidePublishOutcome(2)).toEqual({ kind: "merge-back" });
  });
  it("any other non-zero → orphan-push", () => {
    expect(decidePublishOutcome(1)).toEqual({ kind: "orphan-push" });
    expect(decidePublishOutcome(127)).toEqual({ kind: "orphan-push" });
  });
});

describe("nextWaitAction (pure _loop_wait_pr_merge step)", () => {
  it("MERGED → merged regardless of elapsed", () => {
    expect(nextWaitAction("MERGED", 0)).toEqual({ kind: "merged" });
    expect(nextWaitAction("MERGED", 9999)).toEqual({ kind: "merged" });
  });
  it("CLOSED → closed", () => {
    expect(nextWaitAction("CLOSED", 30)).toEqual({ kind: "closed" });
  });
  it("OPEN before timeout → wait one interval", () => {
    expect(nextWaitAction("OPEN", 0)).toEqual({
      kind: "wait",
      sleepSeconds: PR_MERGE_POLL_INTERVAL,
    });
  });
  it("OPEN at/after timeout → timeout", () => {
    expect(nextWaitAction("OPEN", DEFAULT_PR_MERGE_TIMEOUT)).toEqual({ kind: "timeout" });
    expect(nextWaitAction("UNKNOWN", DEFAULT_PR_MERGE_TIMEOUT + 1)).toEqual({ kind: "timeout" });
  });
  it("honors custom timeout/interval", () => {
    expect(nextWaitAction("OPEN", 5, { timeout: 10, interval: 2 })).toEqual({
      kind: "wait",
      sleepSeconds: 2,
    });
    expect(nextWaitAction("OPEN", 10, { timeout: 10 })).toEqual({ kind: "timeout" });
  });
});

describe("prStateToOutcome (_loop_emit_pr_final map)", () => {
  it("MERGED→merged, CLOSED→closed, OPEN/UNKNOWN/other→open", () => {
    expect(prStateToOutcome("MERGED")).toBe("merged");
    expect(prStateToOutcome("CLOSED")).toBe("closed");
    expect(prStateToOutcome("OPEN")).toBe("open");
    expect(prStateToOutcome("UNKNOWN")).toBe("open");
    expect(prStateToOutcome("garbage")).toBe("open");
  });
});

describe("parseClaimedIdsFromBacklog (_loop_pr_claimed_stories awk)", () => {
  it("collects linked + bare ids only from 🔨 In Progress rows", () => {
    const backlog = [
      "| [US-A](features/a.md) | desc | 🔨 In Progress |",
      "| FIX-9 | bare id | 🔨 In Progress |",
      "| US-B | not in progress | 📋 Todo |",
      "| [US-C](url) | done | ✅ Done |",
    ].join("\n");
    expect(parseClaimedIdsFromBacklog(backlog)).toEqual(["US-A", "FIX-9"]);
  });
  it("skips empty id cells", () => {
    expect(parseClaimedIdsFromBacklog("|  | x | 🔨 In Progress |")).toEqual([]);
  });
});

describe("dedupeSortedIds (awk 'NF' | sort -u)", () => {
  it("dedupes, drops empties, sorts ascending", () => {
    expect(dedupeSortedIds(["US-B", "US-A", "US-B", "", "FIX-1"])).toEqual([
      "FIX-1",
      "US-A",
      "US-B",
    ]);
  });
});

describe("stale cycle-branch GC predicate", () => {
  it("ephemeral prefixes recognised", () => {
    expect(isEphemeralBranch("loop/cycle-x")).toBe(true);
    expect(isEphemeralBranch("worktree-agent-1")).toBe(true);
    expect(isEphemeralBranch("claude/foo")).toBe(true);
    expect(isEphemeralBranch("main")).toBe(false);
    expect(isEphemeralBranch("feature/x")).toBe(false);
  });
});
