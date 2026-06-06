/**
 * Unit tests for the PR-loop runtime tick adapter (loop-pr-inbox.ts, US-PORT-001).
 * The pure decisions live in core/pr-loop.ts (tested there); here we assert the
 * IMPERATIVE WALK: the idle-gate ladder routing, per-PR action dispatch, the
 * rebase circuit→recheck→merge chain, and the terminal tick — all with faked
 * gh/git/fs deps.
 */
import { describe, expect, it } from "vitest";
import type { PrTick } from "@roll/core";
import { type PrInboxDeps, type PrViewFacts, reducePrView, runPrInbox } from "../src/commands/loop-pr-inbox.js";

interface Recorder {
  ticks: PrTick[];
  alerts: string[];
  merged: string[];
  healed: string[];
  rebased: string[];
  circuitCalls: string[];
}

function harness(overrides: Partial<PrInboxDeps> = {}): { deps: PrInboxDeps; rec: Recorder } {
  const rec: Recorder = { ticks: [], alerts: [], merged: [], healed: [], rebased: [], circuitCalls: [] };
  const deps: PrInboxDeps = {
    ghAvailable: async () => true,
    resolveSlug: async () => "owner/repo",
    listOpenPrs: async () => ({ code: 0, stdout: "[]" }),
    viewPr: async () => ({ bot: "", ciState: "success", mergeable: "CLEAN" }),
    merge: async (_slug, num) => {
      rec.merged.push(num);
      return true;
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
    expect(f).toEqual({ bot: "APPROVED", ciState: "success", mergeable: "CLEAN" });
  });
  it("no bot reviews → empty bot; empty rollup → '' ci", () => {
    const f = reducePrView({ reviews: [{ authorAssociation: "MEMBER", state: "APPROVED" }] });
    expect(f).toEqual({ bot: "", ciState: "", mergeable: "" });
  });
  it("any FAILURE → failure ci", () => {
    const f = reducePrView({ statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }] });
    expect(f.ciState).toBe("failure");
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
