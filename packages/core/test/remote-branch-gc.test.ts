import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMOTE_GC_GRACE_MIN,
  parseCycleBranchCreatedMs,
  selectDeletableRemoteBranches,
} from "../src/index.js";

const OLD = "loop/cycle-20260625-014719-23131";
const createdOf = (b: string): number => parseCycleBranchCreatedMs(b) as number;
const empty: ReadonlySet<string> = new Set();

/** Build an input where OLD is well past the grace and every set is empty. */
function base(over: Partial<Parameters<typeof selectDeletableRemoteBranches>[0]> = {}) {
  const created = createdOf(OLD);
  return {
    remoteBranches: [OLD],
    openPrHeads: empty,
    pendingBranches: empty,
    activeRunBranches: empty,
    graceMs: 30 * 60_000,
    nowMs: created + 60 * 60_000, // 1h later → past 30m grace
    ...over,
  };
}

describe("parseCycleBranchCreatedMs", () => {
  it("parses the embedded YYYYMMDD-HHMMSS stamp", () => {
    expect(parseCycleBranchCreatedMs(OLD)).toBe(new Date(2026, 5, 25, 1, 47, 19).getTime());
  });
  it("returns undefined for non-loop/cycle or unparseable names", () => {
    expect(parseCycleBranchCreatedMs("main")).toBeUndefined();
    expect(parseCycleBranchCreatedMs("loop/cycle-nope")).toBeUndefined();
    expect(parseCycleBranchCreatedMs("v2")).toBeUndefined();
  });
});

describe("selectDeletableRemoteBranches (US-LOOP-097 narrow D)", () => {
  it("deletes an old, unreferenced loop/cycle branch", () => {
    expect(selectDeletableRemoteBranches(base())).toEqual([OLD]);
  });

  it("KEEPS a branch with an open PR", () => {
    expect(selectDeletableRemoteBranches(base({ openPrHeads: new Set([OLD]) }))).toEqual([]);
  });

  it("KEEPS a FIX-1214 degraded branch (in pending-pr-create queue)", () => {
    expect(selectDeletableRemoteBranches(base({ pendingBranches: new Set([OLD]) }))).toEqual([]);
  });

  it("KEEPS an orphan/local/pending branch the runs ledger still tracks", () => {
    expect(selectDeletableRemoteBranches(base({ activeRunBranches: new Set([OLD]) }))).toEqual([]);
  });

  it("KEEPS a branch younger than the grace window", () => {
    const created = createdOf(OLD);
    expect(selectDeletableRemoteBranches(base({ nowMs: created + 5 * 60_000 }))).toEqual([]); // 5m < 30m
  });

  it("KEEPS non-loop/cycle branches (main / v2 / worktree-agent-)", () => {
    const inp = base({ remoteBranches: ["main", "v2", "worktree-agent-1", "release/v1"] });
    expect(selectDeletableRemoteBranches(inp)).toEqual([]);
  });

  it("KEEPS a loop/cycle branch with an unparseable stamp (unknown age → conservative)", () => {
    expect(selectDeletableRemoteBranches(base({ remoteBranches: ["loop/cycle-weird"] }))).toEqual([]);
  });

  it("mixes: deletes only the ones clearing every guard", () => {
    const young = "loop/cycle-20260625-020000-1"; // 02:00:00, kept as fresh
    const prd = "loop/cycle-20260101-000000-9"; // old but has an open PR → kept
    const inp = base({
      remoteBranches: [OLD, young, "main", prd],
      openPrHeads: new Set([prd]),
      // 02:20:00 → OLD(01:47:19) is ~33m old (> 30m grace); young(02:00:00) is
      // 20m old (< grace, kept). main non-prefix, prd has PR.
      nowMs: createdOf(young) + 20 * 60_000,
    });
    expect(selectDeletableRemoteBranches(inp)).toEqual([OLD]);
  });

  it("default grace constant is 30 minutes", () => {
    expect(DEFAULT_REMOTE_GC_GRACE_MIN).toBe(30);
  });
});
