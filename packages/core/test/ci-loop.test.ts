/**
 * Unit tests for the CI-loop pure decision layer (ci-loop.ts).
 * Covers: heal-budget resolution, FIX-103 red-conclusion classifier, the
 * pre-run CI gate (exit 0/1/2), heal-lock liveness, red-PR heal-or-alert,
 * dedup-key + alert line, failing-run-id selection, tick shape.
 */
import { describe, expect, it } from "vitest";
import {
  CI_FAILED_CONCLUSIONS,
  DEFAULT_HEAL_MAX,
  ciRedAlertDedupKey,
  ciRedAlertLine,
  ciTick,
  firstFailingRunId,
  healLockVerdict,
  healProducedCommits,
  prHealVerdict,
  precheckCiVerdict,
  redConclusions,
  resolveHealMax,
} from "../src/loop/ci-loop.js";

describe("resolveHealMax (bin/roll 11250-11251 / 11488-11489)", () => {
  it("NO_HEAL=1 → 0 (disabled)", () => {
    expect(resolveHealMax("1", "5")).toBe(0);
  });
  it("numeric HEAL_MAX → that value", () => {
    expect(resolveHealMax(undefined, "3")).toBe(3);
    expect(resolveHealMax("0", "3")).toBe(3); // NO_HEAL not "1"
  });
  it("unset/non-numeric → default", () => {
    expect(resolveHealMax(undefined, undefined)).toBe(DEFAULT_HEAL_MAX);
    expect(resolveHealMax(undefined, "abc")).toBe(DEFAULT_HEAL_MAX);
  });
  it("default is 2", () => {
    expect(DEFAULT_HEAL_MAX).toBe(2);
  });
});

describe("redConclusions — FIX-103 classifier (bin/roll 11237-11239)", () => {
  it("blocking set is exactly the oracle's", () => {
    expect([...CI_FAILED_CONCLUSIONS].sort()).toEqual(
      ["action_required", "cancelled", "failure", "startup_failure", "timed_out"].sort(),
    );
  });
  it("null/running is NOT red (the FIX-103 point)", () => {
    expect(redConclusions([{ conclusion: null, status: "in_progress" }])).toEqual([]);
    expect(redConclusions([{ conclusion: undefined }])).toEqual([]);
  });
  it("success/skipped/neutral not red", () => {
    expect(redConclusions([{ conclusion: "success" }, { conclusion: "skipped" }, { conclusion: "neutral" }])).toEqual([]);
  });
  it("collects sorted-unique red conclusions", () => {
    expect(
      redConclusions([
        { conclusion: "failure" },
        { conclusion: "timed_out" },
        { conclusion: "failure" },
        { conclusion: "success" },
      ]),
    ).toEqual(["failure", "timed_out"]);
  });
});

describe("precheckCiVerdict — pre-run gate (bin/roll 11220-11298)", () => {
  it("gh/commit unresolved → exit 0 no_runs", () => {
    expect(precheckCiVerdict({ ghAndCommitOk: false, runs: [], healMax: 2, headHealCount: 0 })).toEqual({
      exit: 0,
      reason: "no_runs",
    });
  });
  it("no runs → exit 0", () => {
    expect(precheckCiVerdict({ ghAndCommitOk: true, runs: [], healMax: 2, headHealCount: 0 })).toEqual({
      exit: 0,
      reason: "no_runs",
    });
  });
  it("green/pending → exit 0", () => {
    expect(
      precheckCiVerdict({ ghAndCommitOk: true, runs: [{ conclusion: "success" }], healMax: 2, headHealCount: 0 }),
    ).toEqual({ exit: 0, reason: "green_or_pending" });
  });
  it("red + heal available → exit 2, increments counter", () => {
    expect(
      precheckCiVerdict({ ghAndCommitOk: true, runs: [{ conclusion: "failure" }], healMax: 2, headHealCount: 1 }),
    ).toEqual({ exit: 2, reason: "red_heal_available", nextCount: 2 });
  });
  it("red + budget hit → exit 1 abort with conclusions", () => {
    expect(
      precheckCiVerdict({
        ghAndCommitOk: true,
        runs: [{ conclusion: "failure" }, { conclusion: "timed_out" }],
        healMax: 2,
        headHealCount: 2,
      }),
    ).toEqual({ exit: 1, reason: "red_abort", redConclusions: ["failure", "timed_out"] });
  });
  it("red + heal disabled (max 0) → exit 1 abort", () => {
    expect(
      precheckCiVerdict({ ghAndCommitOk: true, runs: [{ conclusion: "failure" }], healMax: 0, headHealCount: 0 }),
    ).toEqual({ exit: 1, reason: "red_abort", redConclusions: ["failure"] });
  });
});

describe("healLockVerdict (bin/roll 11497-11503)", () => {
  it("no lock → free", () => {
    expect(healLockVerdict({ lockPresent: false, lockPidAlive: undefined })).toEqual({ kind: "free" });
  });
  it("live pid → in_flight", () => {
    expect(healLockVerdict({ lockPresent: true, lockPidAlive: true })).toEqual({ kind: "in_flight" });
  });
  it("dead pid → reclaim", () => {
    expect(healLockVerdict({ lockPresent: true, lockPidAlive: false })).toEqual({ kind: "reclaim" });
  });
});

describe("prHealVerdict — heal-or-alert (bin/roll 11484-11524)", () => {
  const base = { pr: "42", headRef: "loop/cycle-x", healMax: 2, prHealCount: 0, lock: { kind: "free" } as const };
  it("disabled → alert disabled", () => {
    const v = prHealVerdict({ ...base, healMax: 0 });
    expect(v.kind).toBe("alert");
    if (v.kind === "alert") {
      expect(v.reason).toBe("disabled");
      expect(v.message).toContain("auto-heal off");
    }
  });
  it("lock live → in_flight", () => {
    expect(prHealVerdict({ ...base, lock: { kind: "in_flight" } }).kind).toBe("in_flight");
  });
  it("budget exhausted → alert budget_exhausted", () => {
    const v = prHealVerdict({ ...base, prHealCount: 2 });
    expect(v.kind).toBe("alert");
    if (v.kind === "alert") {
      expect(v.reason).toBe("budget_exhausted");
      expect(v.message).toBe("auto-heal budget exhausted (2/2) — fix manually");
    }
  });
  it("under budget → dispatch with next count + attempt", () => {
    const v = prHealVerdict({ ...base, prHealCount: 0 });
    expect(v).toEqual({ kind: "dispatch", nextCount: 1, attempt: "1/2" });
  });
  it("disabled takes precedence over a live lock", () => {
    const v = prHealVerdict({ ...base, healMax: 0, lock: { kind: "in_flight" } });
    expect(v.kind).toBe("alert"); // oracle checks NO_HEAL before the lock
  });
});

describe("ciRedAlert dedup + line (bin/roll 11455-11457)", () => {
  it("dedup key is stable per PR", () => {
    expect(ciRedAlertDedupKey("42")).toBe("[TYPE:loop-pr-ci-red] PR #42 ");
  });
  it("line embeds ts, pr, head, message", () => {
    expect(ciRedAlertLine("2026-06-05T00:00:00Z", "42", "loop/cycle-x", "budget exhausted")).toBe(
      "[2026-06-05T00:00:00Z] [error] [TYPE:loop-pr-ci-red] PR #42 loop/cycle-x: budget exhausted",
    );
  });
  it("line contains the dedup key (so grep -qF matches)", () => {
    const line = ciRedAlertLine("2026-06-05T00:00:00Z", "42", "loop/cycle-x", "m");
    expect(line.includes(ciRedAlertDedupKey("42"))).toBe(true);
  });
});

describe("firstFailingRunId (bin/roll 11544-11545)", () => {
  it("picks first FAILURE link's run id", () => {
    expect(
      firstFailingRunId([
        { state: "SUCCESS", link: "https://github.com/o/r/actions/runs/111" },
        { state: "FAILURE", link: "https://github.com/o/r/actions/runs/222/job/9" },
        { state: "FAILURE", link: "https://github.com/o/r/actions/runs/333" },
      ]),
    ).toBe("222");
  });
  it("no FAILURE → undefined", () => {
    expect(firstFailingRunId([{ state: "SUCCESS", link: "runs/1" }])).toBeUndefined();
  });
  it("FAILURE with no runs/ in link → skipped", () => {
    expect(firstFailingRunId([{ state: "FAILURE", link: "https://x/checks/1" }])).toBeUndefined();
  });
  it("undefined link → skipped", () => {
    expect(firstFailingRunId([{ state: "FAILURE", link: undefined }])).toBeUndefined();
  });
});

describe("healProducedCommits (bin/roll 11562)", () => {
  it("ahead > 0 → push", () => {
    expect(healProducedCommits(3)).toBe(true);
  });
  it("ahead 0 → no push", () => {
    expect(healProducedCommits(0)).toBe(false);
  });
});

describe("ciTick", () => {
  it("shape", () => {
    expect(ciTick("idle", "gh_unavailable")).toEqual({ loop: "ci", outcome: "idle", note: "gh_unavailable" });
  });
});
