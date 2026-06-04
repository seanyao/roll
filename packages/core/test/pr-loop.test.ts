/**
 * Unit tests for the PR-loop pure decision layer (pr-loop.ts).
 * Covers: idle-gate ladder, CI rollup reduction, classify, eager-merge gate,
 * bot-review gate, per-PR action selection (+ rebase re-check), the 24h rebase
 * circuit breaker, attempts_at parse/render, fork rebaseability, fallback re-export.
 */
import { describe, expect, it } from "vitest";
import {
  classifyPr,
  decidePublishOutcome,
  eagerMergeEligible,
  botReviewAction,
  parseRebaseAttempts,
  prActedTick,
  prIdleTick,
  prInboxGate,
  REBASE_CIRCUIT_MAX,
  REBASE_CIRCUIT_WINDOW_SEC,
  reduceCiRollup,
  rebaseCircuitVerdict,
  rebaseRecheckAction,
  rebaseable,
  renderRebaseAttempts,
  selectPrAction,
} from "../src/loop/pr-loop.js";

describe("prInboxGate — early-return ladder (bin/roll 11965-11974)", () => {
  const base = { ghAvailable: true, listOk: true, listStdout: '[{"number":1}]', openCount: 1 };
  it("gh unavailable → idle gh_unavailable", () => {
    expect(prInboxGate({ ...base, ghAvailable: false })).toEqual(prIdleTick("gh_unavailable"));
  });
  it("list failed → idle gh_error", () => {
    expect(prInboxGate({ ...base, listOk: false })).toEqual(prIdleTick("gh_error"));
  });
  it("empty stdout → idle empty_response", () => {
    expect(prInboxGate({ ...base, listStdout: "  " })).toEqual(prIdleTick("empty_response"));
  });
  it("'[]' → idle no_open_prs", () => {
    expect(prInboxGate({ ...base, listStdout: "[]" })).toEqual(prIdleTick("no_open_prs"));
  });
  it("zero count → idle zero_prs", () => {
    expect(prInboxGate({ ...base, openCount: 0 })).toEqual(prIdleTick("zero_prs"));
  });
  it("has work → undefined (walk PRs)", () => {
    expect(prInboxGate(base)).toBeUndefined();
  });
  it("acted tick shape", () => {
    expect(prActedTick()).toEqual({ loop: "pr", outcome: "acted", note: "inbox_done" });
  });
});

describe("reduceCiRollup — jq reduction (bin/roll 11996-12000)", () => {
  it("empty rollup → '' (unknown)", () => {
    expect(reduceCiRollup([])).toBe("");
  });
  it("any FAILURE → failure (priority over success)", () => {
    expect(reduceCiRollup(["SUCCESS", "FAILURE", "SKIPPED"])).toBe("failure");
  });
  it("all SUCCESS/SKIPPED → success", () => {
    expect(reduceCiRollup(["SUCCESS", "SKIPPED", "SUCCESS"])).toBe("success");
  });
  it("null (still running) → pending", () => {
    expect(reduceCiRollup(["SUCCESS", null])).toBe("pending");
  });
  it("neutral → pending (not success)", () => {
    expect(reduceCiRollup(["SUCCESS", "NEUTRAL"])).toBe("pending");
  });
});

describe("classifyPr — pure routing (bin/roll 11748-11763)", () => {
  it("BEHIND/DIRTY/CONFLICTING → stale (checked first)", () => {
    expect(classifyPr("failure", "BEHIND")).toBe("stale"); // stale wins over ci_red
    expect(classifyPr("success", "DIRTY")).toBe("stale");
    expect(classifyPr("success", "CONFLICTING")).toBe("stale");
  });
  it("ci failure (clean) → ci_red", () => {
    expect(classifyPr("failure", "CLEAN")).toBe("ci_red");
  });
  it("else → ready", () => {
    expect(classifyPr("success", "CLEAN")).toBe("ready");
    expect(classifyPr("", "CLEAN")).toBe("ready");
    expect(classifyPr("pending", "CLEAN")).toBe("ready");
  });
});

describe("eagerMergeEligible — both spellings (bin/roll 11950-11955)", () => {
  it("CI success + MERGEABLE → true", () => {
    expect(eagerMergeEligible("success", "MERGEABLE")).toBe(true);
  });
  it("CI success + CLEAN → true (mergeStateStatus spelling)", () => {
    expect(eagerMergeEligible("success", "CLEAN")).toBe(true);
  });
  it("CI not success → false", () => {
    expect(eagerMergeEligible("pending", "CLEAN")).toBe(false);
    expect(eagerMergeEligible("failure", "MERGEABLE")).toBe(false);
  });
  it("not mergeable spelling → false", () => {
    expect(eagerMergeEligible("success", "BLOCKED")).toBe(false);
    expect(eagerMergeEligible("success", "BEHIND")).toBe(false);
  });
});

describe("botReviewAction (bin/roll 12003-12019)", () => {
  it("APPROVED → merge_if_clean", () => {
    expect(botReviewAction("APPROVED")).toEqual({ kind: "merge_if_clean" });
  });
  it("CHANGES_REQUESTED → alert", () => {
    expect(botReviewAction("CHANGES_REQUESTED")).toEqual({ kind: "alert_changes_requested" });
  });
  it("other → fall_through", () => {
    expect(botReviewAction("")).toEqual({ kind: "fall_through" });
    expect(botReviewAction("COMMENTED")).toEqual({ kind: "fall_through" });
  });
});

describe("selectPrAction — composed inbox body (bin/roll 12003-12048)", () => {
  it("bot APPROVED + clean → merge bot_approved", () => {
    expect(selectPrAction({ bot: "APPROVED", ciState: "success", mergeable: "CLEAN" })).toEqual({
      kind: "merge",
      reason: "bot_approved",
    });
  });
  it("bot APPROVED but not clean → skip", () => {
    expect(selectPrAction({ bot: "APPROVED", ciState: "pending", mergeable: "CLEAN" })).toEqual({
      kind: "skip",
      reason: "bot_approved_not_clean",
    });
  });
  it("bot CHANGES_REQUESTED → alert", () => {
    expect(selectPrAction({ bot: "CHANGES_REQUESTED", ciState: "success", mergeable: "CLEAN" })).toEqual({
      kind: "alert",
      reason: "bot_changes_requested",
    });
  });
  it("classify ci_red → heal", () => {
    expect(selectPrAction({ bot: "", ciState: "failure", mergeable: "CLEAN" })).toEqual({ kind: "heal" });
  });
  it("classify stale → rebase", () => {
    expect(selectPrAction({ bot: "", ciState: "success", mergeable: "BEHIND" })).toEqual({ kind: "rebase" });
  });
  it("classify ready + eligible → merge eager_ready", () => {
    expect(selectPrAction({ bot: "", ciState: "success", mergeable: "CLEAN" })).toEqual({
      kind: "merge",
      reason: "eager_ready",
    });
  });
  it("classify ready but not eligible → skip", () => {
    expect(selectPrAction({ bot: "", ciState: "pending", mergeable: "CLEAN" })).toEqual({
      kind: "skip",
      reason: "ready_not_mergeable",
    });
  });
});

describe("rebaseRecheckAction (bin/roll 12030-12043)", () => {
  it("clean after rebase → merge eager_after_rebase", () => {
    expect(rebaseRecheckAction("success", "CLEAN")).toEqual({ kind: "merge", reason: "eager_after_rebase" });
  });
  it("still not mergeable → skip", () => {
    expect(rebaseRecheckAction("pending", "CLEAN")).toEqual({
      kind: "skip",
      reason: "still_not_mergeable_after_rebase",
    });
  });
});

describe("rebaseCircuitVerdict — 24h sliding window (bin/roll 11770-11827)", () => {
  const now = 1_700_000_000;
  it("constants match oracle", () => {
    expect(REBASE_CIRCUIT_WINDOW_SEC).toBe(86400);
    expect(REBASE_CIRCUIT_MAX).toBe(3);
  });
  it("under budget → allowed, appends now", () => {
    const v = rebaseCircuitVerdict([now - 10, now - 20], now);
    expect(v.allowed).toBe(true);
    expect(v.windowCount).toBe(2);
    expect(v.freshTimestamps).toEqual([now - 10, now - 20, now]);
  });
  it("prunes >24h entries before counting", () => {
    const v = rebaseCircuitVerdict([now - 90000, now - 5, now - 6], now);
    expect(v.windowCount).toBe(2); // the 90000s-old one dropped
    expect(v.allowed).toBe(true);
    expect(v.freshTimestamps).toEqual([now - 5, now - 6, now]);
  });
  it("3 in-window → TRIP (no append)", () => {
    const v = rebaseCircuitVerdict([now - 1, now - 2, now - 3], now);
    expect(v.allowed).toBe(false);
    expect(v.windowCount).toBe(3);
    expect(v.freshTimestamps).toEqual([now - 1, now - 2, now - 3]); // unchanged
  });
  it("drops non-integer timestamps", () => {
    const v = rebaseCircuitVerdict([now - 1, Number.NaN, 1.5], now);
    expect(v.windowCount).toBe(1);
    expect(v.allowed).toBe(true);
  });
  it("exactly at cutoff is kept (>=)", () => {
    const cutoff = now - 86400;
    const v = rebaseCircuitVerdict([cutoff], now);
    expect(v.windowCount).toBe(1);
  });
});

describe("parseRebaseAttempts / renderRebaseAttempts (bin/roll 11781-11862)", () => {
  const state = [
    "pr_state:",
    '  "123":',
    '    attempts_at: "1700000000 1700000030"',
    '  "456":',
    '    attempts_at: "1699999999"',
  ].join("\n");
  it("extracts the target pr's timestamps", () => {
    expect(parseRebaseAttempts(state, "123")).toEqual([1700000000, 1700000030]);
  });
  it("extracts a different pr", () => {
    expect(parseRebaseAttempts(state, "456")).toEqual([1699999999]);
  });
  it("absent pr → []", () => {
    expect(parseRebaseAttempts(state, "999")).toEqual([]);
  });
  it("no pr_state block → []", () => {
    expect(parseRebaseAttempts("other: 1\n", "123")).toEqual([]);
  });
  it("render is space-joined", () => {
    expect(renderRebaseAttempts([1, 2, 3])).toBe("1 2 3");
    expect(renderRebaseAttempts([])).toBe("");
  });
  it("round-trips", () => {
    const ts = parseRebaseAttempts(state, "123");
    const rendered = renderRebaseAttempts(ts);
    expect(rendered).toBe("1700000000 1700000030");
  });
});

describe("rebaseable — fork guard (bin/roll 11891)", () => {
  it("fork → not rebaseable", () => {
    expect(rebaseable(true)).toBe(false);
  });
  it("same-repo → rebaseable", () => {
    expect(rebaseable(false)).toBe(true);
  });
});

describe("decidePublishOutcome re-export (B-group fallback, delivery/pr.ts)", () => {
  it("status 0 → done", () => {
    expect(decidePublishOutcome(0)).toEqual({ kind: "done" });
  });
  it("status 2 → merge-back", () => {
    expect(decidePublishOutcome(2)).toEqual({ kind: "merge-back" });
  });
  it("other → orphan-push", () => {
    expect(decidePublishOutcome(7)).toEqual({ kind: "orphan-push" });
  });
});
