/**
 * Unit tests: loop crash-recovery decision rules (US-LOOP-002).
 *
 * These pin the ORDERED action plans against the bin/roll oracle line ranges
 * cited in recovery.ts. The orphan-worktree rules + GC retention are pure
 * decision fns; the merge-base ancestry predicate gets a separate diff-test
 * (recovery.difftest.test.ts) against real `git merge-base --is-ancestor`.
 */
import { describe, expect, it } from "vitest";
import {
  GC_BACKUP_KEEP_DAYS,
  GC_DEFAULT_KEEP_DAYS,
  GC_MIGRATED_KEEP_DAYS,
  type OrphanWorktree,
  gcRetentionVerdict,
  healStatePlan,
  isEphemeralBranch,
  orphanPostPublishPlan,
  orphanPostRebasePlan,
  orphanWorktreePlan,
  preflightHasUnhealed,
  preflightPlan,
  recoveredOutcome,
  resolveKeepDays,
} from "../src/index.js";

// ── (1) orphan-state self-heal (bin/roll 9424-9481) ──────────────────────────

describe("healStatePlan — orphan-state self-heal (FIX-037/038)", () => {
  it("non-running status → no heal (bin/roll 9439 gate)", () => {
    expect(healStatePlan({ status: "idle", heartbeatAlive: false, lockPidAlive: undefined, tmuxSessionAlive: undefined })).toEqual([]);
  });

  it("running + fresh heartbeat → still active, no heal (primary signal, 9447-9453)", () => {
    expect(healStatePlan({ status: "running", heartbeatAlive: true, lockPidAlive: undefined, tmuxSessionAlive: undefined })).toEqual([]);
  });

  it("running + dead heartbeat + live lock pid → fallback keeps alive (9456-9461)", () => {
    expect(healStatePlan({ status: "running", heartbeatAlive: false, lockPidAlive: true, tmuxSessionAlive: undefined })).toEqual([]);
  });

  it("running + dead heartbeat + dead lock + live tmux → final signal keeps alive (9464-9465)", () => {
    expect(healStatePlan({ status: "running", heartbeatAlive: false, lockPidAlive: false, tmuxSessionAlive: true })).toEqual([]);
  });

  it("running + all signals dead/absent → heal idle + remove lock + alert, in order (9467-9477)", () => {
    const plan = healStatePlan({ status: "running", heartbeatAlive: false, lockPidAlive: undefined, tmuxSessionAlive: undefined });
    expect(plan.map((a) => a.kind)).toEqual(["heal_state_to_idle", "remove_lock", "append_alert"]);
    expect(plan[2]).toMatchObject({ kind: "append_alert", message: expect.stringContaining("FIX-037") });
  });
});

// ── (2) orphan-worktree recovery (bin/roll 8857-8910) ────────────────────────

const baseWt = (over: Partial<OrphanWorktree> = {}): OrphanWorktree => ({
  path: "/wt/slug-cycle-123",
  branch: "loop/cycle-123",
  prState: undefined,
  commitsAhead: 0,
  containsRollMeta: false,
  docOnly: false,
  ...over,
});

describe("orphanWorktreePlan — classification (FIX-040/045/114)", () => {
  it("detached HEAD → skip (bin/roll 8865)", () => {
    expect(orphanWorktreePlan(baseWt({ branch: undefined }))).toEqual([{ kind: "skip", path: "/wt/slug-cycle-123", reason: expect.any(String) }]);
  });

  it("PR MERGED remotely → cleanup, no recovery (FIX-114, 8872-8875)", () => {
    const plan = orphanWorktreePlan(baseWt({ prState: "MERGED", commitsAhead: 3 }));
    expect(plan.map((a) => a.kind)).toEqual(["worktree_cleanup"]);
  });

  it("MERGED + roll-meta embed → rollmeta_cleanup BEFORE worktree_cleanup (US-LOOP-068, 8893-8897)", () => {
    const plan = orphanWorktreePlan(baseWt({ prState: "MERGED", containsRollMeta: true }));
    expect(plan.map((a) => a.kind)).toEqual(["rollmeta_cleanup", "worktree_cleanup"]);
  });

  it("commits ahead → rebase first (FIX-045, 8882)", () => {
    expect(orphanWorktreePlan(baseWt({ commitsAhead: 2 }))).toEqual([{ kind: "rebase_onto_main", path: "/wt/slug-cycle-123", branch: "loop/cycle-123" }]);
  });

  it("no commits ahead → cleanup (8902-8908)", () => {
    expect(orphanWorktreePlan(baseWt({ commitsAhead: 0 })).map((a) => a.kind)).toEqual(["worktree_cleanup"]);
  });
});

describe("orphanPostRebasePlan / orphanPostPublishPlan — C2 audit contract (8882-8901)", () => {
  it("rebase failed → preserve (conflict/network, 8883)", () => {
    const plan = orphanPostRebasePlan(baseWt({ commitsAhead: 2 }), false);
    expect(plan).toEqual([{ kind: "preserve", path: "/wt/slug-cycle-123", branch: "loop/cycle-123", reason: expect.stringContaining("rebase") }]);
  });

  it("rebase ok → publish, doc-only flag carried (8887-8890)", () => {
    expect(orphanPostRebasePlan(baseWt({ commitsAhead: 2, docOnly: true }), true)).toEqual([
      { kind: "publish_pr", path: "/wt/slug-cycle-123", branch: "loop/cycle-123", docOnly: true },
    ]);
  });

  it("publish ok → cleanup (branch now on remote, auditable — 8892-8898)", () => {
    expect(orphanPostPublishPlan(baseWt({ commitsAhead: 2 }), true).map((a) => a.kind)).toEqual(["worktree_cleanup"]);
  });

  it("publish FAIL → preserve, NEVER destroy un-pushed commits (C2, 8900)", () => {
    const plan = orphanPostPublishPlan(baseWt({ commitsAhead: 2 }), false);
    expect(plan).toEqual([{ kind: "preserve", path: "/wt/slug-cycle-123", branch: "loop/cycle-123", reason: expect.stringContaining("C2") }]);
  });

  it("publish ok + roll-meta → rollmeta_cleanup precedes worktree_cleanup", () => {
    expect(orphanPostPublishPlan(baseWt({ containsRollMeta: true }), true).map((a) => a.kind)).toEqual(["rollmeta_cleanup", "worktree_cleanup"]);
  });
});

describe("recoveredOutcome — terminal mapping (8738/8752)", () => {
  it("published → published_pending_merge; preserved → aborted_with_delivery", () => {
    expect(recoveredOutcome(true)).toBe("published_pending_merge");
    expect(recoveredOutcome(false)).toBe("aborted_with_delivery");
  });
});

// ── (3) GC predicates (bin/roll 13019-13048 / 10577-10646) ───────────────────

// NB: the ephemeral-prefix predicate is owned by delivery/pr.ts
// (isEphemeralBranch). US-LOOP-096 removed the old ancestry-based staleness
// predicate (isStaleCycleBranch) — it had no runtime caller and mis-judged
// squash merges; remote GC now uses PR state (US-LOOP-097), not ancestry.
describe("isEphemeralBranch — ephemeral prefix recognition", () => {
  it("ephemeral prefixes recognized (13024-13026)", () => {
    expect(isEphemeralBranch("loop/cycle-1")).toBe(true);
    expect(isEphemeralBranch("worktree-agent-x")).toBe(true);
    expect(isEphemeralBranch("claude/foo")).toBe(true);
    expect(isEphemeralBranch("main")).toBe(false);
    expect(isEphemeralBranch("feat/keep")).toBe(false);
  });
});

describe("resolveKeepDays — env > yaml > default (bin/roll 10526-10532)", () => {
  it("env wins when numeric", () => {
    expect(resolveKeepDays("7", 99)).toBe(7);
  });
  it("yaml used when env absent/non-numeric", () => {
    expect(resolveKeepDays(undefined, 14)).toBe(14);
    expect(resolveKeepDays("abc", 14)).toBe(14);
  });
  it("default 30 when both absent", () => {
    expect(resolveKeepDays(undefined, undefined)).toBe(GC_DEFAULT_KEEP_DAYS);
  });
});

describe("gcRetentionVerdict — phase-2 retention (bin/roll 10594-10646)", () => {
  const now = 10_000_000;
  it("runs_tmp always removable (10594-10602)", () => {
    expect(gcRetentionVerdict("runs_tmp", now, now).remove).toBe(true);
  });
  it("backup_tgz removable only > 5 days (10605)", () => {
    expect(gcRetentionVerdict("backup_tgz", now - (GC_BACKUP_KEEP_DAYS * 86400 + 1), now).remove).toBe(true);
    expect(gcRetentionVerdict("backup_tgz", now - 86400, now).remove).toBe(false);
  });
  it("migrated removable only > 7 days (10620)", () => {
    expect(gcRetentionVerdict("migrated", now - (GC_MIGRATED_KEEP_DAYS * 86400 + 1), now).remove).toBe(true);
    expect(gcRetentionVerdict("migrated", now - 86400, now).remove).toBe(false);
  });
  it("bak uses resolved keepDays, strict `<` boundary (10635-10639)", () => {
    const keep = 30;
    const cutoff = now - keep * 86400;
    expect(gcRetentionVerdict("bak", cutoff - 1, now, keep).remove).toBe(true);
    expect(gcRetentionVerdict("bak", cutoff, now, keep).remove).toBe(false); // at boundary not `< cutoff`
  });
});

// ── NEW: startup preflight (B-group AC) ──────────────────────────────────────

describe("preflightPlan — compose heal + hooks readiness", () => {
  const aliveHooks = { isGitRepo: true, hooksPath: "hooks", preCommitPresent: true };
  const deadLiveness = { status: "running", heartbeatAlive: false, lockPidAlive: undefined, tmuxSessionAlive: undefined };
  const liveLiveness = { status: "idle", heartbeatAlive: false, lockPidAlive: undefined, tmuxSessionAlive: undefined };

  it("all healthy → empty plan", () => {
    const plan = preflightPlan({ liveness: liveLiveness, hooks: aliveHooks });
    expect(plan).toEqual([]);
    expect(preflightHasUnhealed(plan)).toBe(false);
  });

  it("orphan state heals FIRST, before hooks (startup→preflight order)", () => {
    const plan = preflightPlan({ liveness: deadLiveness, hooks: aliveHooks });
    expect(plan.map((a) => a.kind)).toEqual(["heal_state_to_idle", "remove_lock", "append_alert"]);
  });

  it("hooksPath unset → set_hooks_path 'hooks' (self-heal, _ensure_hooks_path 1388)", () => {
    const plan = preflightPlan({ liveness: liveLiveness, hooks: { isGitRepo: true, hooksPath: "", preCommitPresent: true } });
    expect(plan).toEqual([{ kind: "set_hooks_path", value: "hooks" }]);
  });

  it("hooksPath at git default .git/hooks → re-wire to 'hooks' (1388)", () => {
    const plan = preflightPlan({ liveness: liveLiveness, hooks: { isGitRepo: true, hooksPath: ".git/hooks", preCommitPresent: true } });
    expect(plan).toEqual([{ kind: "set_hooks_path", value: "hooks" }]);
  });

  it("custom non-default hooksPath → not overridden (guard at 1387)", () => {
    const plan = preflightPlan({ liveness: liveLiveness, hooks: { isGitRepo: true, hooksPath: "my-hooks", preCommitPresent: true } });
    expect(plan).toEqual([]);
  });

  it("missing pre-commit → report (NOT self-healable: template gap)", () => {
    const plan = preflightPlan({ liveness: liveLiveness, hooks: { isGitRepo: true, hooksPath: "hooks", preCommitPresent: false } });
    expect(plan).toEqual([{ kind: "report_missing_pre_commit", hooksPath: "hooks" }]);
    expect(preflightHasUnhealed(plan)).toBe(true);
  });

  it("unset hooksPath + missing pre-commit → wire path AND report effective path 'hooks'", () => {
    const plan = preflightPlan({ liveness: liveLiveness, hooks: { isGitRepo: true, hooksPath: "", preCommitPresent: false } });
    expect(plan).toEqual([
      { kind: "set_hooks_path", value: "hooks" },
      { kind: "report_missing_pre_commit", hooksPath: "hooks" },
    ]);
  });

  it("not a git repo → report, skip hooks (not healable here)", () => {
    const plan = preflightPlan({ liveness: liveLiveness, hooks: { isGitRepo: false, hooksPath: "", preCommitPresent: false } });
    expect(plan).toEqual([{ kind: "report_not_git_repo" }]);
    expect(preflightHasUnhealed(plan)).toBe(true);
  });
});
