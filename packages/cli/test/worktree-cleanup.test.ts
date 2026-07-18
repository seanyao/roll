/**
 * FIX-1273 — `roll worktree cleanup` tests.
 *
 * Covers the seven ACs: enumerated canary trip; deterministic minimal auditable
 * dry-run (no mutation); apply revalidates against a FRESH audit and removes
 * only inactive/merged/clean `disposable_candidate` worktrees before pruning;
 * unpublished/dirty/active/external/missing/changed-head/newly-dirtied worktrees
 * are preserved or fail closed (no force cleanup, no threshold-only deletion, no
 * substitution); the 9→8 worked sample clears pressure; repeat/concurrent apply
 * is idempotent + safe; CLI help documents dry-run-first + preservation + resume.
 *
 * scorer_focus: action derives from a FRESH audit; a canary count NEVER becomes
 * a blanket deletion; preservation holds under every race/failure path.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RollEvent } from "@roll/spec";
import type { WorktreeAuditOutput, WorktreeAuditRecord } from "../src/commands/worktree-audit.js";
import { auditWorktrees } from "../src/commands/worktree-audit.js";
import {
  applyWorktreeCleanup,
  CLEANUP_USAGE,
  formatCanaryTripReport,
  isSafelyDisposable,
  planWorktreeCleanup,
  resolveStandaloneMergedBranches,
  worktreeCleanupCommand,
  type CleanupBranchCandidate,
  type StandaloneBranchDeps,
} from "../src/commands/worktree-cleanup.js";

// ─── fixtures ─────────────────────────────────────────────────────────────

function rec(overrides: Partial<WorktreeAuditRecord> = {}): WorktreeAuditRecord {
  return {
    path: "/repo/.roll/loop/worktrees/cycle-1",
    owner: "loop",
    head: "sha-1",
    dirtyTracked: false,
    dirtyUntracked: false,
    ahead: 0,
    mergeEvidence: { kind: "ancestor" },
    active: false,
    disposition: "disposable_candidate",
    reason: "merged worktree with no tracked dirt; candidate for future gc",
    ...overrides,
  };
}

function auditOf(
  records: WorktreeAuditRecord[],
  ephemeralBranches: string[] = [],
): WorktreeAuditOutput {
  return {
    schema: 1,
    generatedAt: "2026-07-18T00:00:00.000Z",
    repo: "repo",
    records,
    ephemeralBranches,
    summary: {
      total: records.length,
      loop: records.filter((r) => r.owner === "loop").length,
      manual: records.filter((r) => r.owner === "manual").length,
      external: records.filter((r) => r.owner === "external").length,
      active: records.filter((r) => r.active).length,
      disposableCandidates: records.filter((r) => r.disposition === "disposable_candidate").length,
      preserved: records.filter(
        (r) => r.disposition !== "disposable_candidate" && r.disposition !== "external_unmanaged",
      ).length,
      ephemeralBranches: ephemeralBranches.length,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── AC1: enumerated canary trip ──────────────────────────────────────────

describe("AC1: canary trip enumerates counted refs + dispositions", () => {
  it("audit enumerates the exact ephemeral branches the canary counts", () => {
    const out = auditWorktrees({
      repoRoot: "/fake/repo",
      home: "/home/user",
      integrationBranch: "origin/main",
      git: (args) => {
        if (args[0] === "worktree" && args[1] === "list") return "";
        if (args[0] === "branch" && args[1] === "--format=%(refname:short)") {
          // isEphemeralBranch matches loop/* and fix|feat|refactor cycle refs;
          // main / a feature branch must NOT be counted.
          return "main\nloop/cycle-20260718-000000-1\nloop/cycle-20260718-000000-2\n";
        }
        return "";
      },
    });
    expect(out.ephemeralBranches).toEqual([
      "loop/cycle-20260718-000000-1",
      "loop/cycle-20260718-000000-2",
    ]);
    expect(out.summary.ephemeralBranches).toBe(2);
  });

  it("trip report enumerates branches + worktrees with disposition and emits a structured event", () => {
    const audit = auditOf(
      [
        rec({ path: "/repo/.roll/loop/worktrees/cycle-A", disposition: "disposable_candidate" }),
        rec({
          path: "/repo/.roll/loop/worktrees/cycle-B",
          disposition: "preserved_unpublished",
          ahead: 3,
          mergeEvidence: { kind: "none" },
        }),
      ],
      ["loop/cycle-x", "loop/cycle-y"],
    );
    const { alert, event } = formatCanaryTripReport(audit, 3, 1_700_000_000_000);

    // Enumerated, not a bare count.
    expect(alert).toContain("loop/cycle-x");
    expect(alert).toContain("loop/cycle-y");
    expect(alert).toContain("cycle-A");
    expect(alert).toContain("[disposable_candidate]");
    expect(alert).toContain("cycle-B");
    expect(alert).toContain("[preserved_unpublished]");
    // Points at the safe recovery route + explicit resume.
    expect(alert).toContain("roll worktree cleanup --dry-run");
    expect(alert).toContain("roll loop resume");

    expect(event.type).toBe("branch_canary_tripped");
    if (event.type === "branch_canary_tripped") {
      expect(event.total).toBe(4); // 2 branches + 2 worktrees
      expect(event.threshold).toBe(3);
      expect(event.ephemeralBranches).toEqual(["loop/cycle-x", "loop/cycle-y"]);
      expect(event.worktrees).toEqual([
        { path: "/repo/.roll/loop/worktrees/cycle-A", disposition: "disposable_candidate" },
        { path: "/repo/.roll/loop/worktrees/cycle-B", disposition: "preserved_unpublished" },
      ]);
    }
  });
});

// ─── AC2: deterministic minimal auditable dry-run (no mutation) ────────────

describe("AC2: deterministic minimal dry-run plan", () => {
  it("selects only the MINIMUM candidates needed to clear pressure", () => {
    // canaryTotal = 1 branch + 3 loop worktrees = 4; threshold 3 ⇒ excess 1.
    const audit = auditOf(
      [
        rec({ path: "/repo/.roll/loop/worktrees/cycle-c" }),
        rec({ path: "/repo/.roll/loop/worktrees/cycle-a" }),
        rec({ path: "/repo/.roll/loop/worktrees/cycle-b" }),
      ],
      ["loop/cycle-z"],
    );
    const plan = planWorktreeCleanup(audit, 3);
    expect(plan.candidates).toHaveLength(1);
    // deterministic: lowest path first.
    expect(plan.candidates[0].path).toBe("/repo/.roll/loop/worktrees/cycle-a");
    expect(plan.canaryTotal).toBe(4);
    expect(plan.projectedTotal).toBe(3);
    // The other two disposables are preserved this round (minimal set).
    expect(plan.preserved.map((p) => p.path).sort()).toEqual([
      "/repo/.roll/loop/worktrees/cycle-b",
      "/repo/.roll/loop/worktrees/cycle-c",
    ]);
  });

  it("is stable across runs (deterministic ordering)", () => {
    const audit = auditOf(
      [
        rec({ path: "/repo/.roll/loop/worktrees/cycle-9" }),
        rec({ path: "/repo/.roll/loop/worktrees/cycle-1" }),
        rec({ path: "/repo/.roll/loop/worktrees/cycle-5" }),
      ],
      ["b1", "b2"],
    );
    const a = planWorktreeCleanup(audit, 3);
    const b = planWorktreeCleanup(audit, 3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("never proposes a threshold-only deletion: no candidates when already under threshold", () => {
    // 1 branch + 1 disposable worktree = 2 ≤ threshold 8 ⇒ nothing to do even
    // though a disposable candidate exists. A canary count is never a mandate.
    const audit = auditOf([rec()], ["loop/cycle-z"]);
    const plan = planWorktreeCleanup(audit, 8);
    expect(plan.candidates).toHaveLength(0);
    expect(plan.preserved.map((p) => p.path)).toEqual([rec().path]);
  });

  it("CLI dry-run mutates nothing and prints the plan", async () => {
    const removeWorktree = vi.fn(() => ({ ok: true, detail: "" }));
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array) => {
      writes.push(String(s));
      return true;
    });
    const code = await worktreeCleanupCommand(["--dry-run", "--repo", "/fake/repo"], {
      git: gitMock({
        branches: ["loop/cycle-z"],
        worktrees: [{ path: "/fake/repo/.roll/loop/worktrees/cycle-a", disposable: true }],
      }),
      integrationBranch: "origin/main",
      removeWorktree,
    });
    expect(code).toBe(0);
    expect(removeWorktree).not.toHaveBeenCalled();
    const out = writes.join("");
    expect(out).toContain("dry-run");
    expect(out).toContain("counted ephemeral branches");
  });
});

// ─── AC3: apply revalidates + removes only proven candidates ───────────────

describe("AC3: apply removes only revalidated candidates", () => {
  it("re-runs a FRESH audit before EVERY removal (scorer_focus)", async () => {
    const audit = auditOf(
      [
        rec({ path: "/repo/.roll/loop/worktrees/cycle-a", head: "sha-a" }),
        rec({ path: "/repo/.roll/loop/worktrees/cycle-b", head: "sha-b" }),
      ],
      ["b1", "b2", "b3", "b4", "b5", "b6", "b7"],
    );
    const plan = planWorktreeCleanup(audit, 8); // 7 + 2 = 9 > 8 ⇒ 1 candidate
    // Two candidates to force two audit re-runs; widen threshold so both selected.
    const plan2 = planWorktreeCleanup(
      auditOf(audit.records, ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"]),
      8,
    );
    expect(plan.candidates).toHaveLength(1);
    expect(plan2.candidates).toHaveLength(2);

    const auditFn = vi.fn(() => audit);
    const removeWorktree = vi.fn(() => ({ ok: true, detail: "" }));
    const events: RollEvent[] = [];
    const res = await applyWorktreeCleanup(plan2, {
      repositoryRoot: "/repo",
      dryRun: false,
      audit: auditFn,
      removeWorktree,
      emit: (e) => events.push(e),
      nowMs: () => 1,
    });
    // audit() called once per candidate (fresh authority each time).
    expect(auditFn).toHaveBeenCalledTimes(2);
    expect(res.removed).toHaveLength(2);
    expect(removeWorktree).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.type === "worktree_cleanup_applied")).toHaveLength(2);
  });

  it("removes exactly the candidate path, then prune runs (no other path touched)", async () => {
    const audit = auditOf([rec({ path: "/repo/.roll/loop/worktrees/cycle-a" })], ["b1"]);
    const plan = planWorktreeCleanup(audit, 0); // force selection
    const removed: string[] = [];
    const res = await applyWorktreeCleanup(plan, {
      repositoryRoot: "/repo",
      dryRun: false,
      audit: () => audit,
      removeWorktree: (_root, path) => {
        removed.push(path);
        return { ok: true, detail: "" };
      },
      emit: () => {},
    });
    expect(removed).toEqual(["/repo/.roll/loop/worktrees/cycle-a"]);
    expect(res.refused).toHaveLength(0);
  });

  it("dry-run apply revalidates but performs NO git mutation", async () => {
    const audit = auditOf([rec()], ["b1"]);
    const plan = planWorktreeCleanup(audit, 0);
    const removeWorktree = vi.fn(() => ({ ok: true, detail: "" }));
    const events: RollEvent[] = [];
    const res = await applyWorktreeCleanup(plan, {
      repositoryRoot: "/repo",
      dryRun: true,
      audit: () => audit,
      removeWorktree,
      emit: (e) => events.push(e),
    });
    expect(res.removed).toHaveLength(1); // "would remove"
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(events.filter((e) => e.type === "worktree_cleanup_applied")).toHaveLength(0);
  });
});

// ─── AC4: preservation + fail-closed under every race/failure path ─────────

describe("AC4: preservation and fail-closed refusals", () => {
  it("never plans unpublished / dirty / active / external worktrees", () => {
    const audit = auditOf(
      [
        rec({ path: "/w/unpub", disposition: "preserved_unpublished", ahead: 2, mergeEvidence: { kind: "none" } }),
        rec({ path: "/w/dirty", disposition: "preserved_dirty_no_tcr", dirtyTracked: true }),
        rec({ path: "/w/active", disposition: "active", active: true }),
        rec({ path: "/w/ext", owner: "external", disposition: "external_unmanaged" }),
      ],
      ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "b10"],
    );
    const plan = planWorktreeCleanup(audit, 0);
    expect(plan.candidates).toHaveLength(0);
    expect(plan.preserved.map((p) => p.path).sort()).toEqual(["/w/active", "/w/dirty", "/w/ext", "/w/unpub"]);
  });

  const races: Array<{ name: string; fresh: WorktreeAuditRecord; reason: string }> = [
    { name: "changed head", fresh: rec({ head: "sha-CHANGED" }), reason: "changed-head" },
    { name: "newly dirtied", fresh: rec({ dirtyTracked: true }), reason: "dirty" },
    { name: "concurrent activation", fresh: rec({ active: true }), reason: "active" },
    {
      name: "lost disposability",
      fresh: rec({ disposition: "preserved_unpublished", ahead: 1, mergeEvidence: { kind: "none" } }),
      reason: "disposition",
    },
  ];
  for (const r of races) {
    it(`fails closed on ${r.name} without removing/substituting`, async () => {
      const planAudit = auditOf([rec({ path: "/repo/.roll/loop/worktrees/cycle-a", head: "sha-1" })], ["b1"]);
      const plan = planWorktreeCleanup(planAudit, 0);
      const freshAudit = auditOf([{ ...r.fresh, path: "/repo/.roll/loop/worktrees/cycle-a" }], ["b1"]);
      const removeWorktree = vi.fn(() => ({ ok: true, detail: "" }));
      const events: RollEvent[] = [];
      const res = await applyWorktreeCleanup(plan, {
        repositoryRoot: "/repo",
        dryRun: false,
        audit: () => freshAudit,
        removeWorktree,
        emit: (e) => events.push(e),
        nowMs: () => 1,
      });
      expect(removeWorktree).not.toHaveBeenCalled(); // no force cleanup
      expect(res.removed).toHaveLength(0);
      expect(res.refused).toHaveLength(1);
      expect(res.refused[0].reason).toContain(r.reason);
      expect(events.some((e) => e.type === "worktree_cleanup_refused")).toBe(true);
    });
  }

  it("missing path (already removed) fails closed — idempotent + safe", async () => {
    const planAudit = auditOf([rec({ path: "/repo/.roll/loop/worktrees/cycle-a" })], ["b1"]);
    const plan = planWorktreeCleanup(planAudit, 0);
    const removeWorktree = vi.fn(() => ({ ok: true, detail: "" }));
    const res = await applyWorktreeCleanup(plan, {
      repositoryRoot: "/repo",
      dryRun: false,
      audit: () => auditOf([], []), // candidate gone
      removeWorktree,
      emit: () => {},
    });
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(res.refused[0].reason).toContain("missing");
  });

  it("one candidate goes dirty after dry-run: it is refused, the clean one still removed, NO preserved substituted", async () => {
    const planAudit = auditOf(
      [
        rec({ path: "/repo/.roll/loop/worktrees/cycle-a", head: "sha-a" }),
        rec({ path: "/repo/.roll/loop/worktrees/cycle-b", head: "sha-b" }),
        // A preserved worktree that must NEVER be touched as a substitute.
        rec({ path: "/repo/.roll/loop/worktrees/cycle-keep", disposition: "preserved_unpublished", ahead: 5, mergeEvidence: { kind: "none" } }),
      ],
      ["b1", "b2", "b3", "b4", "b5", "b6", "b7"],
    );
    const plan = planWorktreeCleanup(planAudit, 0); // both disposables selected
    expect(plan.candidates.map((c) => c.path)).toEqual([
      "/repo/.roll/loop/worktrees/cycle-a",
      "/repo/.roll/loop/worktrees/cycle-b",
    ]);
    // Fresh audit: cycle-b became dirty; cycle-keep is still preserved.
    const freshAudit = auditOf(
      [
        rec({ path: "/repo/.roll/loop/worktrees/cycle-a", head: "sha-a" }),
        rec({ path: "/repo/.roll/loop/worktrees/cycle-b", head: "sha-b", dirtyTracked: true, disposition: "preserved_dirty_no_tcr" }),
        rec({ path: "/repo/.roll/loop/worktrees/cycle-keep", disposition: "preserved_unpublished", ahead: 5, mergeEvidence: { kind: "none" } }),
      ],
      [],
    );
    const removedPaths: string[] = [];
    const res = await applyWorktreeCleanup(plan, {
      repositoryRoot: "/repo",
      dryRun: false,
      audit: () => freshAudit,
      removeWorktree: (_r, p) => {
        removedPaths.push(p);
        return { ok: true, detail: "" };
      },
      emit: () => {},
    });
    expect(removedPaths).toEqual(["/repo/.roll/loop/worktrees/cycle-a"]); // only the clean one
    expect(res.refused.map((x) => x.path)).toEqual(["/repo/.roll/loop/worktrees/cycle-b"]);
    // The preserved worktree was never removed as a substitute.
    expect(removedPaths).not.toContain("/repo/.roll/loop/worktrees/cycle-keep");
  });

  it("isSafelyDisposable rejects every non-safe shape", () => {
    expect(isSafelyDisposable(rec())).toBe(true);
    expect(isSafelyDisposable(rec({ active: true }))).toBe(false);
    expect(isSafelyDisposable(rec({ dirtyTracked: true }))).toBe(false);
    expect(isSafelyDisposable(rec({ dirtyTracked: "unknown" }))).toBe(false);
    expect(isSafelyDisposable(rec({ owner: "external" }))).toBe(false);
    expect(isSafelyDisposable(rec({ mergeEvidence: { kind: "none" } }))).toBe(false);
    expect(isSafelyDisposable(rec({ disposition: "preserved_needs_review" }))).toBe(false);
    expect(isSafelyDisposable(rec({ head: undefined }))).toBe(false);
  });
});

// ─── AC5: 9 → 8 worked sample + idempotent/concurrent ──────────────────────

describe("AC5: 9→8 worked sample clears pressure; repeat is idempotent", () => {
  it("plans exactly the one merged clean candidate (9 → 8)", () => {
    // 5 ephemeral branches + 4 loop worktrees (3 preserved + 1 disposable).
    const audit = auditOf(
      [
        rec({ path: "/w/preserved-1", disposition: "preserved_unpublished", ahead: 2, mergeEvidence: { kind: "none" } }),
        rec({ path: "/w/preserved-2", disposition: "preserved_dirty_no_tcr", dirtyTracked: true }),
        rec({ path: "/w/preserved-3", disposition: "preserved_needs_review", mergeEvidence: { kind: "none" } }),
        rec({ path: "/w/disposable-1", disposition: "disposable_candidate" }),
      ],
      ["l1", "l2", "l3", "l4", "l5"],
    );
    const plan = planWorktreeCleanup(audit, 8);
    expect(plan.canaryTotal).toBe(9);
    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0].path).toBe("/w/disposable-1");
    expect(plan.projectedTotal).toBe(8);
  });

  it("apply removes the candidate; a repeat apply against a fresh (now-empty) audit is a safe no-op", async () => {
    const audit = auditOf(
      [
        rec({ path: "/w/preserved-1", disposition: "preserved_unpublished", ahead: 2, mergeEvidence: { kind: "none" } }),
        rec({ path: "/w/disposable-1" }),
      ],
      ["l1", "l2", "l3", "l4", "l5", "l6", "l7"],
    );
    const plan = planWorktreeCleanup(audit, 8);
    expect(plan.candidates).toHaveLength(1);

    // First apply: candidate present → removed.
    let live = audit.records.slice();
    const auditFn = () => auditOf(live, []);
    const res1 = await applyWorktreeCleanup(plan, {
      repositoryRoot: "/repo",
      dryRun: false,
      audit: auditFn,
      removeWorktree: (_r, p) => {
        live = live.filter((x) => x.path !== p); // simulate git removing it
        return { ok: true, detail: "" };
      },
      emit: () => {},
    });
    expect(res1.removed).toHaveLength(1);

    // Repeat with the SAME (stale) plan against the now-updated audit → refused
    // missing, never a re-delete or a substitution.
    const removeAgain = vi.fn(() => ({ ok: true, detail: "" }));
    const res2 = await applyWorktreeCleanup(plan, {
      repositoryRoot: "/repo",
      dryRun: false,
      audit: auditFn,
      removeWorktree: removeAgain,
      emit: () => {},
    });
    expect(removeAgain).not.toHaveBeenCalled();
    expect(res2.removed).toHaveLength(0);
    expect(res2.refused[0].reason).toContain("missing");
  });
});

// ─── AC6: CLI help documents dry-run-first + preservation + resume ─────────

describe("AC6: CLI help + guidance", () => {
  it("usage documents dry-run-first, preservation, and explicit resume", () => {
    expect(CLEANUP_USAGE).toContain("dry-run");
    expect(CLEANUP_USAGE.toLowerCase()).toContain("preserved");
    expect(CLEANUP_USAGE).toContain("roll loop resume");
    expect(CLEANUP_USAGE).toContain("--apply");
    expect(CLEANUP_USAGE).toContain("SOLE authority");
  });

  it("--help prints usage and exits 0 without side effects", async () => {
    const removeWorktree = vi.fn(() => ({ ok: true, detail: "" }));
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await worktreeCleanupCommand(["--help"], { removeWorktree });
    expect(code).toBe(0);
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  it("--apply and --dry-run together are rejected", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await worktreeCleanupCommand(["--apply", "--dry-run"]);
    expect(code).toBe(2);
  });
});

// ─── CLI apply integration (end-to-end via injected git) ───────────────────

describe("CLI apply integration", () => {
  it("under threshold: apply removes nothing (no blanket delete)", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array) => {
      writes.push(String(s));
      return true;
    });
    const removeWorktree = vi.fn(() => ({ ok: true, detail: "" }));
    const code = await worktreeCleanupCommand(["--apply", "--repo", "/fake/repo"], {
      git: gitMock({
        branches: ["loop/cycle-z"],
        worktrees: [
          { path: "/fake/repo/.roll/loop/worktrees/cycle-a", disposable: true },
          { path: "/fake/repo/.roll/loop/worktrees/cycle-b", disposable: false, ahead: 3 },
        ],
      }),
      integrationBranch: "origin/main",
      removeWorktree,
    });
    // canaryTotal = 1 + 2 = 3 ≤ 8 default ⇒ nothing to remove.
    expect(code).toBe(0);
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(writes.join("")).toContain("apply");
  });

  it("over threshold: apply removes the disposable candidate and emits an applied event", async () => {
    vi.stubEnv("ROLL_BRANCH_CANARY_MAX", "2");
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const removed: string[] = [];
    const events: RollEvent[] = [];
    const code = await worktreeCleanupCommand(["--apply", "--repo", "/fake/repo"], {
      git: gitMock({
        branches: ["loop/cycle-z"],
        worktrees: [
          { path: "/fake/repo/.roll/loop/worktrees/cycle-a", disposable: true },
          { path: "/fake/repo/.roll/loop/worktrees/cycle-b", disposable: false, ahead: 3 },
        ],
      }),
      integrationBranch: "origin/main",
      removeWorktree: (_r, p) => {
        removed.push(p);
        return { ok: true, detail: "" };
      },
      emit: (e) => events.push(e),
    });
    // canaryTotal = 1 + 2 = 3 > 2 ⇒ remove exactly one disposable (cycle-a).
    expect(code).toBe(0);
    expect(removed).toEqual(["/fake/repo/.roll/loop/worktrees/cycle-a"]);
    expect(events.filter((e) => e.type === "worktree_cleanup_applied")).toHaveLength(1);
    vi.unstubAllEnvs();
  });
});

// ─── git mock helper (integration) ─────────────────────────────────────────

interface WtFixture {
  path: string;
  disposable: boolean;
  head?: string;
  ahead?: number;
}

function gitMock(state: { branches: string[]; worktrees: WtFixture[] }): (args: string[], cwd: string) => string {
  const headOf = (p: string) => `head-${p.split("/").pop()}`;
  return (args: string[], cwd: string): string => {
    if (args[0] === "worktree" && args[1] === "list") {
      return (
        state.worktrees
          .map((w) => `worktree ${w.path}\nHEAD ${w.head ?? headOf(w.path)}\nbranch refs/heads/loop/${w.path.split("/").pop()}`)
          .join("\n\n") + "\n"
      );
    }
    if (args[0] === "branch" && args[1] === "--format=%(refname:short)") {
      return state.branches.join("\n") + "\n";
    }
    // Per-worktree probes keyed by cwd.
    const wt = state.worktrees.find((w) => w.path === cwd);
    if (!wt) return "";
    if (args[0] === "status") return ""; // clean
    if (args[0] === "rev-parse") return wt.head ?? headOf(wt.path);
    if (args[0] === "merge-base" && args[1] !== "--is-ancestor") {
      // ancestor iff disposable (headSha === mergeBase).
      return wt.disposable ? (wt.head ?? headOf(wt.path)) : "different-base";
    }
    if (args[0] === "rev-list") return String(wt.ahead ?? (wt.disposable ? 0 : 1));
    if (args[0] === "branch" && args[1] === "--merged") return "";
    return "";
  };
}

// ─── FIX-1454: standalone merged-branch recovery ────────────────────────────

describe("FIX-1454 resolveStandaloneMergedBranches", () => {
  const baseDeps = (over: Partial<StandaloneBranchDeps> = {}): StandaloneBranchDeps => ({
    attachedBranches: new Set<string>(),
    currentBranch: null,
    refSha: (b) => `sha-${b}`,
    branchMerge: () => "pr_merged",
    ...over,
  });

  it("returns merged standalone branches as candidates with sha + evidence", () => {
    const audit = auditOf([], ["loop/cycle-a", "loop/cycle-b"]);
    const out = resolveStandaloneMergedBranches(audit, baseDeps());
    expect(out).toEqual<CleanupBranchCandidate[]>([
      { branch: "loop/cycle-a", expectedSha: "sha-loop/cycle-a", mergeKind: "pr_merged" },
      { branch: "loop/cycle-b", expectedSha: "sha-loop/cycle-b", mergeKind: "pr_merged" },
    ]);
  });

  it("excludes attached, current, protected, unmerged, and missing-ref branches (fail closed)", () => {
    const audit = auditOf([], ["loop/cycle-attached", "loop/cycle-current", "main", "loop/cycle-unmerged", "loop/cycle-missing", "loop/cycle-ok"]);
    const out = resolveStandaloneMergedBranches(audit, baseDeps({
      attachedBranches: new Set(["loop/cycle-attached"]),
      currentBranch: "loop/cycle-current",
      refSha: (b) => (b === "loop/cycle-missing" ? null : `sha-${b}`),
      branchMerge: (b) => (b === "loop/cycle-unmerged" ? null : "ancestor"),
    }));
    expect(out.map((c) => c.branch)).toEqual(["loop/cycle-ok"]);
  });
});

describe("FIX-1454 planWorktreeCleanup with branch candidates", () => {
  it("fills the minimal set with worktrees first, then merged branches, to clear excess", () => {
    // 2 counted worktrees + 3 counted branches = canary 5, threshold 2 → excess 3.
    const wt = rec({ path: "/repo/.roll/loop/worktrees/cycle-1", head: "h1" });
    const branches: CleanupBranchCandidate[] = [
      { branch: "loop/cycle-a", expectedSha: "sa", mergeKind: "ancestor" },
      { branch: "loop/cycle-b", expectedSha: "sb", mergeKind: "pr_merged" },
      { branch: "loop/cycle-c", expectedSha: "sc", mergeKind: "ancestor" },
    ];
    const audit = auditOf([wt, rec({ path: "/repo/.roll/loop/worktrees/cycle-keep", disposition: "preserved_unpublished", mergeEvidence: { kind: "none" } })], ["loop/cycle-a", "loop/cycle-b", "loop/cycle-c"]);
    const plan = planWorktreeCleanup(audit, 2, branches);
    // excess 3: 1 disposable worktree + 2 branches (deterministic by name).
    expect(plan.candidates.map((c) => c.path)).toEqual(["/repo/.roll/loop/worktrees/cycle-1"]);
    expect(plan.branchCandidates.map((b) => b.branch)).toEqual(["loop/cycle-a", "loop/cycle-b"]);
    expect(plan.projectedTotal).toBe(2);
  });

  it("selects no branches when worktrees alone clear the excess", () => {
    const audit = auditOf([rec({ path: "/repo/.roll/loop/worktrees/cycle-1" })], ["loop/cycle-a"]);
    const plan = planWorktreeCleanup(audit, 1, [{ branch: "loop/cycle-a", expectedSha: "sa", mergeKind: "ancestor" }]);
    // canary 2, threshold 1 → excess 1: one worktree suffices, branch preserved.
    expect(plan.candidates).toHaveLength(1);
    expect(plan.branchCandidates).toHaveLength(0);
  });
});

describe("FIX-1454 applyWorktreeCleanup branch deletion", () => {
  const planWith = (branchCandidates: CleanupBranchCandidate[]): Parameters<typeof applyWorktreeCleanup>[0] => ({
    schema: 1, generatedAt: "t", threshold: 1, canaryTotal: 2, projectedTotal: 1,
    countedBranches: branchCandidates.map((b) => b.branch), countedWorktrees: [],
    candidates: [], branchCandidates, preserved: [],
  });

  it("deletes a branch that revalidates (sha + merged + unattached)", async () => {
    const removeBranch = vi.fn(() => ({ ok: true, detail: "" }));
    const res = await applyWorktreeCleanup(planWith([{ branch: "loop/cycle-a", expectedSha: "sa", mergeKind: "ancestor" }]), {
      repositoryRoot: "/repo", dryRun: false,
      freshBranchDeps: () => ({ attachedBranches: new Set(), currentBranch: null, refSha: () => "sa", branchMerge: () => "ancestor" }),
      removeBranch,
    });
    expect(res.branchesRemoved.map((b) => b.branch)).toEqual(["loop/cycle-a"]);
    expect(removeBranch).toHaveBeenCalledWith("/repo", "loop/cycle-a");
    expect(res.refused).toHaveLength(0);
  });

  it("refuses (no delete) on changed ref, re-attach, or lost merge — fail closed", async () => {
    const cases: Array<[string, StandaloneBranchDeps]> = [
      ["changed-ref", { attachedBranches: new Set(), currentBranch: null, refSha: () => "DIFFERENT", branchMerge: () => "ancestor" }],
      ["attached", { attachedBranches: new Set(["loop/cycle-a"]), currentBranch: null, refSha: () => "sa", branchMerge: () => "ancestor" }],
      ["not-merged", { attachedBranches: new Set(), currentBranch: null, refSha: () => "sa", branchMerge: () => null }],
      ["missing", { attachedBranches: new Set(), currentBranch: null, refSha: () => null, branchMerge: () => "ancestor" }],
    ];
    for (const [, deps] of cases) {
      const removeBranch = vi.fn(() => ({ ok: true, detail: "" }));
      const res = await applyWorktreeCleanup(planWith([{ branch: "loop/cycle-a", expectedSha: "sa", mergeKind: "ancestor" }]), {
        repositoryRoot: "/repo", dryRun: false, freshBranchDeps: () => deps, removeBranch,
      });
      expect(res.branchesRemoved).toHaveLength(0);
      expect(res.refused).toHaveLength(1);
      expect(removeBranch).not.toHaveBeenCalled();
    }
  });

  it("dry-run revalidates but never deletes", async () => {
    const removeBranch = vi.fn(() => ({ ok: true, detail: "" }));
    const res = await applyWorktreeCleanup(planWith([{ branch: "loop/cycle-a", expectedSha: "sa", mergeKind: "ancestor" }]), {
      repositoryRoot: "/repo", dryRun: true,
      freshBranchDeps: () => ({ attachedBranches: new Set(), currentBranch: null, refSha: () => "sa", branchMerge: () => "ancestor" }),
      removeBranch,
    });
    expect(res.branchesRemoved).toHaveLength(1);
    expect(removeBranch).not.toHaveBeenCalled();
  });
});
