/**
 * US-DELIV-008 — the unified reconcile truth engine's IO adapter.
 *
 * One engine, two callers: `roll loop reconcile` (command) and the `roll
 * loop cycles` read path both derive a cycle's delivery judgment from the
 * SAME pure `reconcileDelivery` fed by the SAME fact-gathering
 * ({@link cycleReconcileDecision}). The old subject-match probe
 * (cycleMergeTruth) is retired as a parallel second criterion — its only
 * survivor is offline L1 merge evidence ({@link offlineMergeEvidence}): a
 * `(#N)` squash commit on main (or, for PR-less legacy cycles, a commit
 * subject naming the story) IS PR-state evidence recorded on main, just
 * read offline instead of via gh.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cycleReconcileDecision, offlineMergeEvidence } from "../src/lib/delivery-facts.js";
import type { GitDossierFacts } from "../src/lib/story-dossier.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Temp dirs must be isolated from the worktree's GIT_* env (same pattern as
 *  loop-reconcile-merge-now.test.ts). */
function withoutGitEnv<T>(fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  const vars = ["GIT_DIR", "GIT_WORK_TREE", "GIT_CEILING_DIRECTORIES", "GIT_COMMON_DIR", "GIT_INDEX_FILE"];
  for (const k of vars) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of vars) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const git = (cwd: string, cmd: string): void => {
  execSync(`git ${cmd}`, { cwd, stdio: "ignore" });
};

/**
 * A repo + bare "origin" remote so the adapter's `origin/main` /
 * `origin/<branch>` refs resolve. `setup` runs between the initial main
 * commit and the final fetch, letting each test shape main/branch history.
 */
function repoWithOrigin(setup: (p: string) => void): string {
  return withoutGitEnv(() => {
    const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-deliv008-")));
    dirs.push(p);
    git(p, "init -q --bare remote.git");
    git(p, "init -q repo");
    const r = join(p, "repo");
    git(r, "config user.email test@roll.local");
    git(r, "config user.name Test");
    git(r, "checkout -q -b main");
    git(r, "commit -q --allow-empty -m init");
    git(r, "remote add origin ../remote.git");
    setup(r);
    git(r, "fetch -q origin");
    return r;
  });
}

function gitFacts(commits: Array<{ subject: string; message?: string }>): GitDossierFacts {
  return { commits: commits.map((c) => ({ subject: c.subject, message: c.message ?? c.subject, files: [] })), slug: "o/r" };
}

describe("US-DELIV-008 — offlineMergeEvidence (offline L1)", () => {
  it("prNumber + a `(#N)` merge commit on main → MERGED (the FIX-287 squash that names no story)", () => {
    const facts = gitFacts([{ subject: "tcr: align machine page typography (#773)" }]);
    expect(offlineMergeEvidence(facts, "FIX-287", 773)).toBe("MERGED");
  });

  it("prNumber present but PR NOT on main → undefined, EVEN IF another commit names the story (FIX-311/284 cycle-accuracy)", () => {
    const facts = gitFacts([
      { subject: "Fix: FIX-311 — dashboard reconcile (#766)" },
      { subject: "Fix: FIX-311 follow-up (#767)" },
    ]);
    expect(offlineMergeEvidence(facts, "FIX-311", 763)).toBeUndefined();
  });

  it("exact PR-number match: #773 is not #77 or #7730", () => {
    const facts = gitFacts([{ subject: "tcr: a (#77)" }, { subject: "tcr: b (#7730)" }]);
    expect(offlineMergeEvidence(facts, "FIX-287", 773)).toBeUndefined();
  });

  it("no prNumber (legacy cycle) → falls back to a main commit subject naming the story", () => {
    const named = gitFacts([{ subject: "Fix: FIX-287 — typography" }]);
    expect(offlineMergeEvidence(named, "FIX-287", undefined)).toBe("MERGED");
    const unrelated = gitFacts([{ subject: "Fix: something unrelated (#999)" }]);
    expect(offlineMergeEvidence(unrelated, "FIX-287", undefined)).toBeUndefined();
  });

  it("null git facts / empty story without PR → undefined (never matches everything)", () => {
    expect(offlineMergeEvidence(null, "FIX-287", 773)).toBeUndefined();
    const facts = gitFacts([{ subject: "anything (#1)" }]);
    expect(offlineMergeEvidence(facts, "", undefined)).toBeUndefined();
  });
});

describe("US-DELIV-008 — cycleReconcileDecision (unified engine, real git)", () => {
  const CYCLE = "cycle-20260713-000000-00001";

  it("L2 patch-id: branch squash-merged onto main (same diff, different subject) → delivered via patch_id, no gh, no (#N)", () => {
    const r = repoWithOrigin((repo) => {
      git(repo, `checkout -q -b loop/${CYCLE}`);
      execSync("echo feature > feature.txt", { cwd: repo, shell: "/bin/bash" });
      git(repo, "add feature.txt");
      git(repo, "commit -q -m 'tcr: US-DELIV-008 feature'");
      git(repo, "checkout -q main");
      // Simulate the squash merge: the SAME diff lands on main under a
      // different subject (no (#N), no story name — subject-match can't see it).
      execSync("echo feature > feature.txt", { cwd: repo, shell: "/bin/bash" });
      git(repo, "add feature.txt");
      git(repo, "commit -q -m 'Story US-DELIV-009: something else (#999)'");
      git(repo, `push -q origin main loop/${CYCLE}`);
    });
    const d = withoutGitEnv(() =>
      cycleReconcileDecision(r, null, { cycleId: CYCLE, storyId: "US-DELIV-008", branch: `loop/${CYCLE}`, prNumber: 42 }),
    );
    expect(d.kind).toBe("delivered");
    expect(d.kind === "delivered" && d.signal).toBe("patch_id");
  });

  it("REGRESSION: an unmerged single-commit branch is NOT delivered — the branch's own commit must not self-match (symmetric-difference bug)", () => {
    const r = repoWithOrigin((repo) => {
      git(repo, `checkout -q -b loop/${CYCLE}`);
      execSync("echo wip > wip.txt", { cwd: repo, shell: "/bin/bash" });
      git(repo, "add wip.txt");
      git(repo, "commit -q -m 'tcr: US-DELIV-008 wip'");
      git(repo, "checkout -q main");
      git(repo, "commit -q --allow-empty -m 'unrelated main work'");
      git(repo, `push -q origin main loop/${CYCLE}`);
    });
    const d = withoutGitEnv(() =>
      cycleReconcileDecision(r, null, { cycleId: CYCLE, storyId: "US-DELIV-008", branch: `loop/${CYCLE}`, prNumber: 42 }),
    );
    expect(d.kind).toBe("wait");
  });

  it("offline L1: (#N) merge commit on main + branch deleted → delivered via pr_state (old subject-match-only case, no gh)", () => {
    const r = repoWithOrigin((repo) => {
      git(repo, "commit -q --allow-empty -m 'tcr: align machine page typography (#773)'");
      git(repo, "push -q origin main");
    });
    // Branch never existed on origin → L2 silent; the (#773) commit is the
    // only signal. The old subject-match probe caught this; the unified
    // engine must too (no coverage regression).
    const d = withoutGitEnv(() =>
      cycleReconcileDecision(r, gitFacts([{ subject: "tcr: align machine page typography (#773)" }]), {
        cycleId: CYCLE,
        storyId: "FIX-287",
        branch: `loop/${CYCLE}`,
        prNumber: 773,
      }),
    );
    expect(d.kind).toBe("delivered");
    expect(d.kind === "delivered" && d.signal).toBe("pr_state");
  });

  it("nothing merged, no PR evidence → wait (never fabricate delivered)", () => {
    const r = repoWithOrigin((repo) => {
      git(repo, "commit -q --allow-empty -m 'unrelated (#1)'");
      git(repo, "push -q origin main");
    });
    const d = withoutGitEnv(() =>
      cycleReconcileDecision(r, gitFacts([{ subject: "unrelated (#1)" }]), {
        cycleId: CYCLE,
        storyId: "FIX-287",
        branch: `loop/${CYCLE}`,
        prNumber: 773,
      }),
    );
    expect(d.kind).toBe("wait");
  });
});
