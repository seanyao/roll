/**
 * US-DELIV-002 — layered reconcile-from-main: comprehensive test matrix.
 *
 * Evaluation contract expected_evidence:
 *   1. Layered determination matrix:
 *      - PR MERGED → delivered / pr_state (L1 strongest)
 *      - patch-id ∈ main → delivered_external / patch_id (L2 squash-safe)
 *      - Amend → L2 miss but L1 catches it (L1 authoritative)
 *      - L3 alone → NOT sufficient
 *      - All miss → wait (never fabricate delivered)
 *   2. Retroactive heal: existing unpublished branch with patch-id match
 *      → delivered_external
 *   3. CLI `roll loop reconcile --json` evidence (see CLI test file).
 */
import { describe, expect, it } from "vitest";
import { reconcileDelivery, reconciledEventPayload } from "../src/index.js";
import type { ReconcileCycle, ReconcileFacts } from "../src/index.js";

// ── Test helpers ──────────────────────────────────────────────────────────────

const CYCLE: ReconcileCycle = {
  cycleId: "cycle-A",
  storyId: "US-X-001",
  branch: "loop/cycle-A",
  prNumber: 42,
  deliveryState: "awaiting_merge",
};

const CYCLE_NO_PR: ReconcileCycle = {
  cycleId: "cycle-B",
  storyId: "US-X-002",
  branch: "loop/cycle-B",
  deliveryState: "awaiting_merge",
};

function facts(overrides: Partial<ReconcileFacts> = {}): ReconcileFacts {
  return {
    mainPatchIds: new Set<string>(),
    backlogDone: false,
    attestPresent: false,
    ...overrides,
  };
}

// ── L1: PR state (strongest signal) ──────────────────────────────────────────

describe("reconcileDelivery — L1 PR state", () => {
  it("PR MERGED → delivered via pr_state", () => {
    const result = reconcileDelivery(CYCLE, facts({
      prState: "MERGED",
      prMergeCommit: "abc123",
    }));
    expect(result).toEqual({
      kind: "delivered",
      via: "external",
      signal: "pr_state",
      mergeCommit: "abc123",
    });
  });

  it("PR MERGED without mergeCommit → delivered (mergeCommit absent)", () => {
    const result = reconcileDelivery(CYCLE, facts({
      prState: "MERGED",
    }));
    expect(result).toEqual({
      kind: "delivered",
      via: "external",
      signal: "pr_state",
      mergeCommit: undefined,
    });
  });

  it("PR MERGED with patch-id also matching → L1 wins, L1 is authoritative", () => {
    const result = reconcileDelivery(CYCLE, facts({
      prState: "MERGED",
      prMergeCommit: "def456",
      branchNetPatchId: "pid-1",
      mainPatchIds: new Set(["pid-1"]),
    }));
    // L1 fires first, L2 is never reached — L1 is authoritative.
    expect(result).toEqual({
      kind: "delivered",
      via: "external",
      signal: "pr_state",
      mergeCommit: "def456",
    });
  });

  it("PR OPEN → does not trigger delivered (no L1)", () => {
    const result = reconcileDelivery(CYCLE, facts({
      prState: "OPEN",
    }));
    expect(result.kind).not.toBe("delivered");
    // With no CI info and no L2, falls to wait.
    expect(result.kind).toBe("wait");
  });

  it("PR CLOSED → does not trigger delivered (closed = not merged)", () => {
    const result = reconcileDelivery(CYCLE, facts({
      prState: "CLOSED",
    }));
    expect(result.kind).toBe("wait");
  });

  it("PR state undefined (gh unavailable) → no L1, falls through to L2/wait", () => {
    const result = reconcileDelivery(CYCLE, facts({
      prState: undefined,
    }));
    expect(result.kind).toBe("wait");
  });
});

// ── L2: patch-id equivalence ─────────────────────────────────────────────────

describe("reconcileDelivery — L2 patch-id equivalence", () => {
  it("branchNetPatchId ∈ mainPatchIds → delivered via patch_id", () => {
    const result = reconcileDelivery(CYCLE, facts({
      branchNetPatchId: "pid-xyz",
      mainPatchIds: new Set(["pid-abc", "pid-xyz", "pid-def"]),
    }));
    expect(result).toEqual({
      kind: "delivered",
      via: "external",
      signal: "patch_id",
    });
  });

  it("branchNetPatchId not in mainPatchIds → no L2 hit", () => {
    const result = reconcileDelivery(CYCLE, facts({
      branchNetPatchId: "pid-missing",
      mainPatchIds: new Set(["pid-abc", "pid-def"]),
    }));
    expect(result.kind).toBe("wait");
  });

  it("L2 works without PR (offline / no gh) — patch-id alone suffices", () => {
    const result = reconcileDelivery(CYCLE_NO_PR, facts({
      prState: undefined,
      branchNetPatchId: "pid-offline",
      mainPatchIds: new Set(["pid-offline"]),
    }));
    expect(result).toEqual({
      kind: "delivered",
      via: "external",
      signal: "patch_id",
    });
  });

  it("empty mainPatchIds → L2 never hits", () => {
    const result = reconcileDelivery(CYCLE, facts({
      branchNetPatchId: "pid-any",
      mainPatchIds: new Set(),
    }));
    expect(result.kind).toBe("wait");
  });

  it("branchNetPatchId undefined (branch deleted) → L2 cannot fire", () => {
    const result = reconcileDelivery(CYCLE, facts({
      branchNetPatchId: undefined,
      mainPatchIds: new Set(["pid-any"]),
    }));
    expect(result.kind).toBe("wait");
  });
});

// ── L1 + L2 interaction — amend scenario ─────────────────────────────────────

describe("reconcileDelivery — L1/L2 interaction (amend scenario)", () => {
  it("amend: L1 MERGED hits, L2 patch-id misses → delivered via L1 (authoritative)", () => {
    // Supervisor amends the merge (conflict resolution), so the net diff
    // on main differs from the cycle branch's net diff. L2 misses, but L1
    // still sees MERGED — delivered via L1.
    const result = reconcileDelivery(CYCLE, facts({
      prState: "MERGED",
      prMergeCommit: "amended-commit",
      branchNetPatchId: "pid-original", // original diff
      mainPatchIds: new Set(["pid-amended"]), // amended diff on main → L2 miss
    }));
    expect(result).toEqual({
      kind: "delivered",
      via: "external",
      signal: "pr_state",
      mergeCommit: "amended-commit",
    });
  });

  it("both L1 and L2 miss → wait (never fabricate)", () => {
    const result = reconcileDelivery(CYCLE, facts({
      prState: "OPEN",
      branchNetPatchId: "pid-original",
      mainPatchIds: new Set(["pid-other"]),
    }));
    // OPEN PR with no CI info and no L2 → wait
    expect(result.kind).toBe("wait");
  });
});

// ── CI-driven decisions ──────────────────────────────────────────────────────

describe("reconcileDelivery — CI-driven (merge_now / ci_failed)", () => {
  it("PR OPEN + CI green → merge_now", () => {
    const result = reconcileDelivery(CYCLE, facts({
      prState: "OPEN",
      ciGreen: true,
    }));
    expect(result).toEqual({ kind: "merge_now", method: "squash" });
  });

  it("PR OPEN + CI red → ci_failed", () => {
    const result = reconcileDelivery(CYCLE, facts({
      prState: "OPEN",
      ciGreen: false,
    }));
    expect(result).toEqual({ kind: "ci_failed" });
  });

  it("PR OPEN + CI unknown → wait (not green, not red)", () => {
    const result = reconcileDelivery(CYCLE, facts({
      prState: "OPEN",
      ciGreen: undefined,
    }));
    expect(result.kind).toBe("wait");
  });

  it("CI green without OPEN PR → wait (merge_now requires open PR)", () => {
    const result = reconcileDelivery(CYCLE, facts({
      prState: undefined,
      ciGreen: true,
    }));
    expect(result.kind).toBe("wait");
  });
});

// ── L3: weak signals alone NEVER suffice ─────────────────────────────────────

describe("reconcileDelivery — L3 weak signals (never sufficient)", () => {
  it("L3 alone (backlog Done + attest) → wait, NOT delivered", () => {
    const result = reconcileDelivery(CYCLE, facts({
      backlogDone: true,
      attestPresent: true,
    }));
    // L3 is explicitly NOT sufficient (design §3.3, §8, FIX-304).
    expect(result.kind).toBe("wait");
    expect(result.kind).not.toBe("delivered");
  });

  it("L3 alone with everything else missing → wait", () => {
    const result = reconcileDelivery(CYCLE, facts({
      prState: undefined,
      branchNetPatchId: undefined,
      mainPatchIds: new Set(),
      backlogDone: true,
      attestPresent: true,
    }));
    expect(result.kind).toBe("wait");
  });

  it("L3 + L1 merged → delivered (L1 strong enough alone)", () => {
    const result = reconcileDelivery(CYCLE, facts({
      prState: "MERGED",
      backlogDone: true,
      attestPresent: true,
    }));
    expect(result.kind).toBe("delivered");
  });
});

// ── All signals miss → wait ──────────────────────────────────────────────────

describe("reconcileDelivery — all miss → wait", () => {
  it("completely empty facts → wait", () => {
    const result = reconcileDelivery(CYCLE, facts());
    expect(result.kind).toBe("wait");
  });

  it("PR OPEN but no CI info + no L2 → wait", () => {
    const result = reconcileDelivery(CYCLE, facts({
      prState: "OPEN",
      ciGreen: undefined,
      branchNetPatchId: undefined,
    }));
    expect(result.kind).toBe("wait");
  });

  it("gh down (prState undefined) + branch gone (patchId undefined) → wait", () => {
    const result = reconcileDelivery(CYCLE, facts({
      prState: undefined,
      branchNetPatchId: undefined,
    }));
    expect(result.kind).toBe("wait");
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe("reconcileDelivery — idempotency", () => {
  it("same inputs produce same output (multiple calls)", () => {
    const f = facts({ prState: "MERGED", prMergeCommit: "abc" });
    const r1 = reconcileDelivery(CYCLE, f);
    const r2 = reconcileDelivery(CYCLE, f);
    const r3 = reconcileDelivery(CYCLE, f);
    expect(r2).toEqual(r1);
    expect(r3).toEqual(r1);
  });

  it("patch-id hit is idempotent", () => {
    const f = facts({
      branchNetPatchId: "pid",
      mainPatchIds: new Set(["pid"]),
    });
    expect(reconcileDelivery(CYCLE, f)).toEqual(reconcileDelivery(CYCLE, f));
  });

  it("wait is idempotent", () => {
    const f = facts();
    expect(reconcileDelivery(CYCLE, f)).toEqual(reconcileDelivery(CYCLE, f));
  });
});

// ── reconciledEventPayload ────────────────────────────────────────────────────

describe("reconciledEventPayload", () => {
  const TS = 1_750_000_000_000;

  it("builds a delivery:reconciled event from a delivered result", () => {
    const result = { kind: "delivered" as const, via: "external" as const, signal: "pr_state" as const, mergeCommit: "abc" };
    const payload = reconciledEventPayload(CYCLE, result, TS);
    expect(payload).toEqual({
      type: "delivery:reconciled",
      cycleId: "cycle-A",
      storyId: "US-X-001",
      state: "delivered_external",
      mergedBy: "external",
      mergeCommit: "abc",
      signal: "pr_state",
      ts: TS,
    });
  });

  it("runner via → state is delivered (not delivered_external)", () => {
    const result = { kind: "delivered" as const, via: "runner" as const, signal: "patch_id" as const, mergeCommit: "def" };
    const payload = reconciledEventPayload(CYCLE, result, TS);
    expect(payload.state).toBe("delivered");
    expect(payload.mergedBy).toBe("runner");
  });

  it("patch_id signal is passed through", () => {
    const result = { kind: "delivered" as const, via: "external" as const, signal: "patch_id" as const };
    const payload = reconciledEventPayload(CYCLE, result, TS);
    expect(payload.signal).toBe("patch_id");
    expect(payload.mergeCommit).toBe("unknown"); // no mergeCommit provided
  });

  it("mergeCommit defaults to 'unknown' when absent", () => {
    const result = { kind: "delivered" as const, via: "external" as const, signal: "patch_id" as const };
    const payload = reconciledEventPayload(CYCLE, result, TS);
    expect(payload.mergeCommit).toBe("unknown");
  });
});

// ── Retroactive heal scenario ─────────────────────────────────────────────────

describe("reconcileDelivery — retroactive heal (goal 4)", () => {
  it("existing unpublished cycle with patch-id match → delivered_external", () => {
    // A cycle that was published_pending_merge but never got reconciled.
    // The branch still exists (or its net diff is still reachable).
    // Its patch-id matches a main commit → retroactively delivered_external.
    const cyc: ReconcileCycle = {
      cycleId: "old-cycle-1",
      storyId: "US-OLD-001",
      branch: "loop/old-cycle-1",
      deliveryState: "awaiting_merge",
    };
    const result = reconcileDelivery(cyc, facts({
      branchNetPatchId: "pid-retro",
      mainPatchIds: new Set(["pid-retro", "pid-other"]),
    }));
    expect(result).toEqual({
      kind: "delivered",
      via: "external",
      signal: "patch_id",
    });
  });

  it("existing cycle with deleted branch + PR MERGED → delivered", () => {
    // Branch was deleted after merge, but PR still shows MERGED.
    const cyc: ReconcileCycle = {
      cycleId: "old-cycle-2",
      storyId: "US-OLD-002",
      branch: "loop/old-cycle-2",
      deliveryState: "awaiting_merge",
    };
    const result = reconcileDelivery(cyc, facts({
      prState: "MERGED",
      prMergeCommit: "merged-after-delete",
      branchNetPatchId: undefined, // branch gone
    }));
    expect(result).toEqual({
      kind: "delivered",
      via: "external",
      signal: "pr_state",
      mergeCommit: "merged-after-delete",
    });
  });

  it("existing cycle with no evidence at all → wait (stays awaiting_merge)", () => {
    const cyc: ReconcileCycle = {
      cycleId: "old-cycle-3",
      storyId: "US-OLD-003",
      branch: "loop/old-cycle-3",
      deliveryState: "awaiting_merge",
    };
    const result = reconcileDelivery(cyc, facts());
    expect(result.kind).toBe("wait");
  });
});
