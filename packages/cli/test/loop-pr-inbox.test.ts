/**
 * Unit tests for the PR-loop runtime tick adapter (loop-pr-inbox.ts, US-PORT-001).
 * The pure decisions live in core/pr-loop.ts (tested there); here we assert the
 * IMPERATIVE WALK: the idle-gate ladder routing, per-PR action dispatch, the
 * rebase circuit→recheck→merge chain, and the terminal tick — all with faked
 * gh/git/fs deps.
 */
import { describe, expect, it } from "vitest";
import type { PrTick } from "@roll/core";
import {
  type PrInboxDeps,
  type PrViewFacts,
  parseRollEvidenceTrailer,
  reducePrView,
  runPrInbox,
  upsertRebaseAttempts,
} from "../src/commands/loop-pr-inbox.js";
import { parseRebaseAttempts } from "@roll/core";

interface Recorder {
  ticks: PrTick[];
  alerts: string[];
  readied: string[];
  merged: string[];
  healed: string[];
  rebased: string[];
  circuitCalls: string[];
  /** FIX-367: (num, headRef) pairs the durable merge-record hook saw. */
  mergedRecorded: Array<{ num: string; headRef: string }>;
}

function harness(overrides: Partial<PrInboxDeps> = {}): { deps: PrInboxDeps; rec: Recorder } {
  const rec: Recorder = { ticks: [], alerts: [], readied: [], merged: [], healed: [], rebased: [], circuitCalls: [], mergedRecorded: [] };
  const deps: PrInboxDeps = {
    ghAvailable: async () => true,
    resolveSlug: async () => "owner/repo",
    listOpenPrs: async () => ({ code: 0, stdout: "[]" }),
    viewPr: async () => ({ bot: "", ciState: "success", mergeable: "CLEAN" }),
    ready: async (_slug, num) => {
      rec.readied.push(num);
      return true;
    },
    merge: async (_slug, num) => {
      rec.merged.push(num);
      return true;
    },
    onMerged: async (_slug, num, headRef) => {
      rec.mergedRecorded.push({ num, headRef });
    },
    heal: async (num) => {
      rec.healed.push(num);
    },
    rebaseCircuitAllowed: (num) => {
      rec.circuitCalls.push(num);
      return true;
    },
    rebaseStale: async (num) => {
      rec.rebased.push(num);
      return { bot: "", ciState: "success", mergeable: "CLEAN" };
    },
    alert: (line) => rec.alerts.push(line),
    writeTick: (t) => rec.ticks.push(t),
    info: () => {},
    warn: () => {},
    ...overrides,
  };
  return { deps, rec };
}

function listOf(prs: Array<{ number: number; headRefName: string }>): PrInboxDeps["listOpenPrs"] {
  return async () => ({ code: 0, stdout: JSON.stringify(prs) });
}

describe("reducePrView — last BOT/APP review + rollup reduction (bin/roll 11996-12007)", () => {
  it("picks the LAST bot/app review state", () => {
    const f = reducePrView({
      reviews: [
        { authorAssociation: "BOT", state: "CHANGES_REQUESTED" },
        { authorAssociation: "MEMBER", state: "APPROVED" },
        { authorAssociation: "APP", state: "APPROVED" },
      ],
      mergeStateStatus: "CLEAN",
      statusCheckRollup: [{ conclusion: "SUCCESS" }],
    });
    expect(f).toEqual({ bot: "APPROVED", ciState: "success", mergeable: "CLEAN", manualMerge: false });
  });
  it("no bot reviews → empty bot; empty rollup → '' ci", () => {
    const f = reducePrView({ reviews: [{ authorAssociation: "MEMBER", state: "APPROVED" }] });
    expect(f).toEqual({ bot: "", ciState: "", mergeable: "", manualMerge: false });
  });
  it("detects manual-merge marker from PR body or labels", () => {
    expect(reducePrView({ body: "fix\n\n[roll:manual-merge]" }).manualMerge).toBe(true);
    expect(reducePrView({ labels: [{ name: "manual-merge" }] }).manualMerge).toBe(true);
  });
  it("US-EVID-019: parses the Roll-Evidence trailer", () => {
    expect(parseRollEvidenceTrailer("body\n\nRoll-Evidence: US-EVID-019 roll-meta@abcdef123456 features/e/US/ac-map.json\n")).toEqual({
      storyId: "US-EVID-019",
      repo: "roll-meta",
      sha: "abcdef123456",
      acMapPath: "features/e/US/ac-map.json",
    });
    expect(parseRollEvidenceTrailer("no trailer")).toBeNull();
  });
  it("any FAILURE → failure ci", () => {
    const f = reducePrView({ statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }] });
    expect(f.ciState).toBe("failure");
  });
});

describe("upsertRebaseAttempts — minimal YAML round-trip (bin/roll 11838-11871)", () => {
  it("creates pr_state from an empty body", () => {
    const out = upsertRebaseAttempts("", "5", "100 200");
    expect(out).toBe(`pr_state:\n  "5":\n    attempts_at: "100 200"\n`);
    expect(parseRebaseAttempts(out, "5")).toEqual([100, 200]);
  });
  it("appends a new pr alongside an existing one (no extra blank lines)", () => {
    let s = upsertRebaseAttempts("", "5", "100");
    s = upsertRebaseAttempts(s, "9", "300");
    expect(s).not.toMatch(/\n\n/); // no accreted blank lines
    expect(parseRebaseAttempts(s, "5")).toEqual([100]);
    expect(parseRebaseAttempts(s, "9")).toEqual([300]);
  });
  it("overwrites an existing pr's value, idempotent across repeats", () => {
    let s = upsertRebaseAttempts("", "5", "100");
    s = upsertRebaseAttempts(s, "5", "100 200");
    s = upsertRebaseAttempts(s, "5", "100 200 300");
    expect(parseRebaseAttempts(s, "5")).toEqual([100, 200, 300]);
    expect(s.match(/"5":/g)?.length).toBe(1); // exactly one entry, not duplicated
    expect(s).not.toMatch(/\n\n/);
  });
  it("preserves a leading non-pr_state field", () => {
    const s = upsertRebaseAttempts("status: idle\n", "7", "42");
    expect(s).toContain("status: idle");
    expect(parseRebaseAttempts(s, "7")).toEqual([42]);
  });
});

describe("runPrInbox — idle-gate ladder", () => {
  it("gh unavailable → idle gh_unavailable, no walk", async () => {
    const { deps, rec } = harness({ ghAvailable: async () => false });
    const t = await runPrInbox(deps);
    expect(t).toEqual({ loop: "pr", outcome: "idle", note: "gh_unavailable" });
    expect(rec.ticks).toEqual([t]);
    expect(rec.merged).toEqual([]);
  });
  it("no slug → idle gh_unavailable", async () => {
    const { deps } = harness({ resolveSlug: async () => undefined });
    expect((await runPrInbox(deps)).note).toBe("gh_unavailable");
  });
  it("list error → idle gh_error", async () => {
    const { deps } = harness({ listOpenPrs: async () => ({ code: 1, stdout: "" }) });
    expect((await runPrInbox(deps)).note).toBe("gh_error");
  });
  it("empty stdout → idle empty_response", async () => {
    const { deps } = harness({ listOpenPrs: async () => ({ code: 0, stdout: "   " }) });
    expect((await runPrInbox(deps)).note).toBe("empty_response");
  });
  it("'[]' → idle no_open_prs", async () => {
    const { deps } = harness({ listOpenPrs: async () => ({ code: 0, stdout: "[]" }) });
    expect((await runPrInbox(deps)).note).toBe("no_open_prs");
  });
});

describe("runPrInbox — per-PR action dispatch", () => {
  it("ready + clean → merge, then acted tick", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 7, headRefName: "loop/x" }]),
      viewPr: async () => ({ bot: "", ciState: "success", mergeable: "CLEAN" }),
    });
    const t = await runPrInbox(deps);
    expect(rec.merged).toEqual(["7"]);
    expect(t).toEqual({ loop: "pr", outcome: "acted", note: "inbox_done" });
  });
  it("bot APPROVED + clean → merge", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 8, headRefName: "feat/y" }]),
      viewPr: async () => ({ bot: "APPROVED", ciState: "success", mergeable: "CLEAN" }),
    });
    await runPrInbox(deps);
    expect(rec.merged).toEqual(["8"]);
  });
  it("US-EVID-019: unresolvable evidence blocks eager auto-merge", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 81, headRefName: "loop/missing-evidence" }]),
      viewPr: async () => ({ bot: "", ciState: "success", mergeable: "CLEAN", evidenceResolvable: false }),
    });
    await runPrInbox(deps);
    expect(rec.merged).toEqual([]);
    expect(rec.alerts[0]).toContain("evidence_unresolvable");
  });
  it("US-EVID-019: evidence block alert includes missing paths", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 83, headRefName: "loop/missing-list" }]),
      viewPr: async () => ({
        bot: "APPROVED",
        ciState: "success",
        mergeable: "CLEAN",
        evidenceResolvable: false,
        evidenceMissing: ["US-EVID-019:AC1 screenshots/missing.png"],
      }),
    });
    await runPrInbox(deps);
    expect(rec.merged).toEqual([]);
    expect(rec.alerts[0]).toContain("screenshots/missing.png");
  });
  it("FIX-1027: manual draft + bot APPROVED + clean → ready first, then merge", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 30, headRefName: "loop/manual-review" }]),
      viewPr: async () => ({
        bot: "APPROVED",
        ciState: "success",
        mergeable: "CLEAN",
        manualMerge: true,
        isDraft: true,
      }),
    });
    await runPrInbox(deps);
    expect(rec.readied).toEqual(["30"]);
    expect(rec.merged).toEqual(["30"]);
    expect(rec.mergedRecorded).toEqual([{ num: "30", headRef: "loop/manual-review" }]);
  });
  it("FIX-1027 guard: manual draft with green CI but no bot approve stays open", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 31, headRefName: "loop/manual-review" }]),
      viewPr: async () => ({
        bot: "",
        ciState: "success",
        mergeable: "CLEAN",
        manualMerge: true,
        isDraft: true,
      }),
    });
    await runPrInbox(deps);
    expect(rec.readied).toEqual([]);
    expect(rec.merged).toEqual([]);
  });
  it("US-EVID-019: unresolvable evidence blocks manual draft promotion", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 82, headRefName: "loop/manual-missing-evidence" }]),
      viewPr: async () => ({
        bot: "APPROVED",
        ciState: "success",
        mergeable: "CLEAN",
        manualMerge: true,
        isDraft: true,
        evidenceResolvable: false,
      }),
    });
    await runPrInbox(deps);
    expect(rec.readied).toEqual([]);
    expect(rec.merged).toEqual([]);
    expect(rec.alerts[0]).toContain("evidence_unresolvable");
  });
  it("FIX-1027 guard: failed ready leaves the PR unmerged for the next tick", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 32, headRefName: "loop/manual-review" }]),
      viewPr: async () => ({
        bot: "APPROVED",
        ciState: "success",
        mergeable: "CLEAN",
        manualMerge: true,
        isDraft: true,
      }),
      ready: async (_slug, num) => {
        rec.readied.push(num);
        return false;
      },
    });
    await runPrInbox(deps);
    expect(rec.readied).toEqual(["32"]);
    expect(rec.merged).toEqual([]);
  });
  it("bot CHANGES_REQUESTED → alert, no merge", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 9, headRefName: "loop/z" }]),
      viewPr: async () => ({ bot: "CHANGES_REQUESTED", ciState: "success", mergeable: "CLEAN" }),
    });
    await runPrInbox(deps);
    expect(rec.merged).toEqual([]);
    expect(rec.alerts[0]).toContain("PR #9");
    expect(rec.alerts[0]).toContain("CHANGES_REQUESTED");
  });
  it("ci_red → heal, no merge", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 10, headRefName: "loop/a" }]),
      viewPr: async () => ({ bot: "", ciState: "failure", mergeable: "CLEAN" }),
    });
    await runPrInbox(deps);
    expect(rec.healed).toEqual(["10"]);
    expect(rec.merged).toEqual([]);
  });
  it("ready but not mergeable → skip (no merge)", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 11, headRefName: "loop/b" }]),
      viewPr: async () => ({ bot: "", ciState: "success", mergeable: "BLOCKED" }),
    });
    await runPrInbox(deps);
    expect(rec.merged).toEqual([]);
  });
  it("a failed pr view is skipped, walk continues", async () => {
    let first = true;
    const { deps, rec } = harness({
      listOpenPrs: listOf([
        { number: 1, headRefName: "loop/p" },
        { number: 2, headRefName: "loop/q" },
      ]),
      viewPr: async () => {
        if (first) {
          first = false;
          return undefined; // view failed for PR #1
        }
        return { bot: "", ciState: "success", mergeable: "CLEAN" };
      },
    });
    await runPrInbox(deps);
    expect(rec.merged).toEqual(["2"]);
  });

  // ── FIX-367: durably record merge truth the instant the PR-lane merges ───────
  it("FIX-367: an eager merge fires onMerged with the cycle headRef", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 7, headRefName: "loop/cycle-20260619-022646" }]),
      viewPr: async () => ({ bot: "", ciState: "success", mergeable: "CLEAN" }),
    });
    await runPrInbox(deps);
    expect(rec.merged).toEqual(["7"]);
    // The card's merge is recorded NOW (→ runs row credited → picker excludes it),
    // not only after the next `loop run-once` backfill — closes the re-pick window.
    expect(rec.mergedRecorded).toEqual([{ num: "7", headRef: "loop/cycle-20260619-022646" }]);
  });
  it("FIX-367: a FAILED merge does NOT record merge truth (no premature Done)", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 9, headRefName: "loop/cycle-x" }]),
      viewPr: async () => ({ bot: "", ciState: "success", mergeable: "CLEAN" }),
      merge: async (_slug, num) => {
        rec.merged.push(num);
        return false; // merge attempt failed → PR left open, nothing merged
      },
    });
    await runPrInbox(deps);
    expect(rec.mergedRecorded).toEqual([]);
  });
});

describe("runPrInbox — stale → rebase circuit → recheck → merge", () => {
  const staleView: PrViewFacts = { bot: "", ciState: "pending", mergeable: "BEHIND" };

  it("circuit allowed + recheck clean → rebase then eager merge", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 20, headRefName: "loop/r" }]),
      viewPr: async () => staleView,
      rebaseStale: async (num) => {
        rec.rebased.push(num);
        return { bot: "", ciState: "success", mergeable: "CLEAN" };
      },
    });
    await runPrInbox(deps);
    expect(rec.circuitCalls).toEqual(["20"]);
    expect(rec.rebased).toEqual(["20"]);
    expect(rec.merged).toEqual(["20"]);
    // FIX-367: the post-rebase merge path also records merge truth durably.
    expect(rec.mergedRecorded).toEqual([{ num: "20", headRef: "loop/r" }]);
  });

  it("US-EVID-019: unresolvable evidence blocks post-rebase eager merge", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 23, headRefName: "loop/u" }]),
      viewPr: async () => staleView,
      rebaseStale: async (num) => {
        rec.rebased.push(num);
        return { bot: "", ciState: "success", mergeable: "CLEAN", evidenceResolvable: false };
      },
    });
    await runPrInbox(deps);
    expect(rec.rebased).toEqual(["23"]);
    expect(rec.merged).toEqual([]);
    expect(rec.alerts[0]).toContain("evidence_unresolvable");
  });

  it("circuit TRIPPED → no rebase, no merge (honors the verdict)", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 21, headRefName: "loop/s" }]),
      viewPr: async () => staleView,
      rebaseCircuitAllowed: (num) => {
        rec.circuitCalls.push(num);
        return false; // tripped
      },
    });
    await runPrInbox(deps);
    expect(rec.rebased).toEqual([]);
    expect(rec.merged).toEqual([]);
  });

  it("rebase done but recheck still not clean → no merge", async () => {
    const { deps, rec } = harness({
      listOpenPrs: listOf([{ number: 22, headRefName: "loop/t" }]),
      viewPr: async () => staleView,
      rebaseStale: async (num) => {
        rec.rebased.push(num);
        return { bot: "", ciState: "pending", mergeable: "BEHIND" };
      },
    });
    await runPrInbox(deps);
    expect(rec.rebased).toEqual(["22"]);
    expect(rec.merged).toEqual([]);
  });
});
