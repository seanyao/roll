/** US-DOSSIER-013 — cycle ledger VM + verdict vocabulary + tape facts. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectCycleLedger, ledgerFailedCount, ledgerVerdict, reconcilePendingMergeVerdicts } from "../src/lib/cycle-ledger.js";
import { cycleMergeTruth, gitHasPrMergeCommit } from "../src/lib/story-dossier.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(rows: object[], events: object[] = []): string {
  const p = mkdtempSync(join(tmpdir(), "roll-cyl-"));
  dirs.push(p);
  mkdirSync(join(p, ".roll", "loop"), { recursive: true });
  writeFileSync(join(p, ".roll", "loop", "runs.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  if (events.length > 0) writeFileSync(join(p, ".roll", "loop", "events.ndjson"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return p;
}

describe("ledgerVerdict — AC4: the CLI's vocabulary", () => {
  it("maps statuses/outcomes honestly", () => {
    expect(ledgerVerdict("merged", "delivered")).toBe("delivered");
    expect(ledgerVerdict("reverted", "")).toBe("reverted");
    expect(ledgerVerdict("failed", "failed")).toBe("failed");
    expect(ledgerVerdict("blocked", "blocked")).toBe("blocked");
    expect(ledgerVerdict("aborted", "aborted_no_delivery")).toBe("failed");
    expect(ledgerVerdict("idle", "idle_no_work")).toBe("idle");
    expect(ledgerVerdict("", "")).toBe("unknown");
  });

  it("FIX-324: gave_up is a failure-to-deliver, never a dirty `unknown`", () => {
    expect(ledgerVerdict("gave_up", "gave_up")).toBe("failed");
    expect(ledgerVerdict("gave_up", "")).toBe("failed"); // status-only
    expect(ledgerVerdict("", "gave_up")).toBe("failed"); // outcome-only
  });

  it("FIX-322: published (PR open, not merged) is pending_merge, NOT delivered (done≡merged)", () => {
    expect(ledgerVerdict("published", "published_pending_merge")).toBe("pending_merge");
    expect(ledgerVerdict("published", "")).toBe("pending_merge");
    expect(ledgerVerdict("built", "")).toBe("pending_merge");
    expect(ledgerVerdict("done", "")).toBe("pending_merge"); // un-backfilled done = not yet merged
    expect(ledgerVerdict("merged", "delivered")).toBe("delivered"); // only a real merge is delivered
    expect(ledgerVerdict("", "delivered")).toBe("delivered");
  });

  it("FIX-322: one card with a published row + a merged row → exactly one delivered, one pending_merge (no double-delivered)", () => {
    expect(ledgerVerdict("published", "published_pending_merge")).toBe("pending_merge");
    expect(ledgerVerdict("merged", "delivered")).toBe("delivered");
  });
});

describe("collectCycleLedger", () => {
  it("builds rows newest-first with telemetry and a seven-segment tape", () => {
    const p = project(
      [
        { cycle_id: "c1", status: "merged", outcome: "delivered", story_id: "US-X-1", agent: "claude", ts: "2026-06-12T01:00:00Z", duration_sec: 95, cost_usd: 0.42, tokens_in: 1200, tokens_out: 400, tcr_count: 5, merge_commit: "abc" },
        { cycle_id: "c2", status: "failed", outcome: "failed", story_id: "US-X-2", agent: "pi", ts: "2026-06-12T02:00:00Z", duration_sec: 30 },
      ],
      [
        { type: "peer:gate", cycleId: "c1", verdict: "consulted", reasons: [], ts: 1 },
        { type: "pair:verdict", cycleId: "c1", peer: "kimi", verdict: "refine", findings: 2, cost: 0.1, stage: "code", ts: 2 },
        { type: "attest:gate", cycleId: "c1", verdict: "produced", reasons: [], ts: 3 },
        { type: "pr:merge", prNumber: 123, storyId: "US-X-1", ts: 4 },
      ],
    );
    const rows = collectCycleLedger(p);
    expect(rows.map((r) => r.cycleId)).toEqual(["c2", "c1"]); // newest first
    const c1 = rows[1]!;
    expect(c1.verdict).toBe("delivered");
    expect(c1.tokens).toBe("1k/400");
    expect(c1.cost).toBe("$0.42");
    expect(c1.duration).toBe("1m35s");
    expect(c1.tape.map((s) => s.key)).toEqual(["cycle", "story", "build", "peer", "ci", "pr", "end"]);
    expect(c1.tape[2]?.detail).toBe("5 commits");
    expect(c1.tape[3]?.detail).toBe("refine");
    expect(c1.tape[4]?.detail).toBe("attest ✓");
    expect(c1.tape[5]?.detail).toBe("#123 merged");
    expect(c1.tape[6]?.detail).toBe("delivered");
  });

  it("AC2 regression: failed count = failed + reverted + blocked", () => {
    const p = project([
      { cycle_id: "a", status: "failed", ts: "2026-06-12T01:00:00Z" },
      { cycle_id: "b", status: "reverted", ts: "2026-06-12T02:00:00Z" },
      { cycle_id: "c", status: "blocked", ts: "2026-06-12T03:00:00Z" },
      { cycle_id: "d", status: "merged", outcome: "delivered", ts: "2026-06-12T04:00:00Z" },
    ]);
    const rows = collectCycleLedger(p);
    expect(ledgerFailedCount(rows)).toBe(3);
  });

  it("honest dashes when telemetry is missing", () => {
    const p = project([{ cycle_id: "x", status: "aborted", outcome: "aborted_no_delivery" }]);
    const r = collectCycleLedger(p)[0]!;
    expect(r.tokens).toBe("—");
    expect(r.cost).toBe("—");
    expect(r.duration).toBe("—");
    expect(r.verdict).toBe("failed");
  });

  it("FIX-290 AC3: usage_unknown renders tokens/cost as '?' (UNKNOWN), model+duration still present — never a misleading 0/$0", () => {
    // The failed-cycle record the runner writes when usage_credentials_missing:
    // model fixed by routing, duration known, tokens/cost unreadable → unknown.
    const p = project([
      {
        cycle_id: "u",
        status: "failed",
        outcome: "failed",
        story_id: "FIX-284",
        agent: "pi",
        model: "kimi-k2-instruct",
        ts: "2026-06-12T00:57:00Z",
        duration_sec: 1020,
        usage_unknown: true,
      },
    ]);
    const r = collectCycleLedger(p)[0]!;
    expect(r.verdict).toBe("failed");
    expect(r.model).toBe("kimi-k2-instruct"); // AC2: present
    expect(r.duration).toBe("17m00s"); // present
    expect(r.tokens).toBe("?"); // AC3: unknown, NOT "—" and NOT 0
    expect(r.cost).toBe("?"); // AC3: unknown, NOT "$0.00"
  });

  it("FIX-290 AC3: a real 0-token cycle is '—' (TRUE-0), distinct from '?' (UNKNOWN)", () => {
    // A real cycle (story picked) whose parsed usage genuinely summed to 0 — kept
    // (it is a cycle, not an idle heartbeat) and rendered "—", not "?".
    const p = project([
      { cycle_id: "z", status: "aborted", outcome: "aborted_no_delivery", story_id: "FIX-Z", ts: "2026-06-12T01:00:00Z", tokens_in: 0, tokens_out: 0 },
    ]);
    const r = collectCycleLedger(p)[0]!;
    expect(r.tokens).toBe("—"); // not "?": this row was NOT marked usage_unknown
    expect(r.cost).toBe("—");
  });
});

describe("FIX-297 — idle heartbeats are not cycles", () => {
  it("excludes idle_no_work heartbeats but keeps real cycles (delivered + failed)", () => {
    const p = project([
      // real delivered cycle
      { cycle_id: "real-1", status: "merged", outcome: "delivered", story_id: "US-A-1", agent: "claude", ts: "2026-06-12T05:00:00Z" },
      // idle heartbeat, explicit outcome form (the live runner's shape)
      { cycle_id: "idle-1", status: "idle", outcome: "idle_no_work", story_id: "", agent: "", tcr_count: 0, built: [], ts: "2026-06-12T04:00:00Z" },
      // real failed cycle
      { cycle_id: "real-2", status: "failed", outcome: "failed", story_id: "US-A-2", agent: "pi", ts: "2026-06-12T03:00:00Z" },
      // idle heartbeat, status-only form (older shape: status idle, no outcome)
      { cycle_id: "idle-2", status: "idle", story_id: "", agent: "", tcr_count: 0, built: [], ts: "2026-06-12T02:00:00Z" },
    ]);
    const rows = collectCycleLedger(p);
    expect(rows.map((r) => r.cycleId)).toEqual(["real-1", "real-2"]); // newest-first, idle excluded
    expect(rows.some((r) => r.verdict === "idle")).toBe(false);
  });

  it("failures stay first-class: failed/blocked/aborted real cycles present and counted", () => {
    const p = project([
      { cycle_id: "f", status: "failed", outcome: "failed", story_id: "US-1", ts: "2026-06-12T05:00:00Z" },
      { cycle_id: "b", status: "blocked", outcome: "blocked", story_id: "US-2", ts: "2026-06-12T04:00:00Z" },
      { cycle_id: "ab", status: "aborted", outcome: "aborted_no_delivery", story_id: "US-3", ts: "2026-06-12T03:00:00Z" },
      { cycle_id: "rev", status: "reverted", story_id: "US-4", ts: "2026-06-12T02:00:00Z" },
      // a pile of idle heartbeats that must NOT dilute or hide the failures
      { cycle_id: "i1", status: "idle", outcome: "idle_no_work", story_id: "", tcr_count: 0, built: [], ts: "2026-06-12T01:30:00Z" },
      { cycle_id: "i2", status: "idle", outcome: "idle_no_work", story_id: "", tcr_count: 0, built: [], ts: "2026-06-12T01:00:00Z" },
    ]);
    const rows = collectCycleLedger(p);
    expect(rows.map((r) => r.cycleId).sort()).toEqual(["ab", "b", "f", "rev"]); // all 4 failures kept, both idle dropped
    expect(ledgerFailedCount(rows)).toBe(4); // failed + blocked + aborted + reverted, none swallowed
  });

  it("an idle-verdict row that DID pick a story or do work is a real cycle, not a heartbeat", () => {
    const p = project([
      // status idle but story present → real cycle, kept
      { cycle_id: "with-story", status: "idle", story_id: "US-9", agent: "kimi", ts: "2026-06-12T05:00:00Z" },
      // status idle, no story, but tcr work happened → real cycle, kept
      { cycle_id: "with-work", status: "idle", story_id: "", tcr_count: 3, ts: "2026-06-12T04:00:00Z" },
      // status idle, no story, but something was built → real cycle, kept
      { cycle_id: "with-built", status: "idle", story_id: "", built: ["US-7"], ts: "2026-06-12T03:00:00Z" },
      // genuine heartbeat → dropped
      { cycle_id: "pure-idle", status: "idle", outcome: "idle_no_work", story_id: "", tcr_count: 0, built: [], ts: "2026-06-12T02:00:00Z" },
    ]);
    const rows = collectCycleLedger(p);
    expect(rows.map((r) => r.cycleId).sort()).toEqual(["with-built", "with-story", "with-work"]);
  });
});

describe("FIX-347 — reconcilePendingMergeVerdicts: render-time merge-truth", () => {
  // Build a ledger from a published_pending_merge cycle (PR open at cycle-end):
  // its row says outcome=published_pending_merge → verdict pending_merge, and the
  // pr-open event makes the pr tape segment read "#N open".
  function pendingLedger(storyId = "FIX-287") {
    const p = project(
      [
        {
          cycle_id: "20260616-234303-21843",
          status: "published",
          outcome: "published_pending_merge",
          story_id: storyId,
          agent: "claude",
          ts: "2026-06-16T23:43:03Z",
          duration_sec: 600,
          tcr_count: 4,
        },
      ],
      [{ type: "pr:open", prNumber: 773, storyId, ts: 1 }],
    );
    const rows = collectCycleLedger(p);
    expect(rows[0]!.verdict).toBe("pending_merge"); // un-reconciled snapshot is yellow
    expect(rows[0]!.tape.find((s) => s.key === "pr")?.detail).toBe("#773 open");
    return rows;
  }

  it("AC1/AC4: PR merged (git merge-truth true) → delivered/green, tape promoted", () => {
    // This is FIX-287's exact case: cycle 20260616-234303-21843 ended
    // published_pending_merge, PR #773 then merged by the PR loop.
    const rows = pendingLedger();
    const out = reconcilePendingMergeVerdicts(rows, () => true);
    expect(out[0]!.verdict).toBe("delivered");
    expect(out[0]!.tape.find((s) => s.key === "end")?.state).toBe("pass");
    expect(out[0]!.tape.find((s) => s.key === "pr")?.detail).toBe("#773 merged");
    expect(out[0]!.tape.find((s) => s.key === "pr")?.state).toBe("pass");
  });

  it("AC4: PR still open (no merge evidence) → stays pending_merge/yellow", () => {
    const rows = pendingLedger();
    const out = reconcilePendingMergeVerdicts(rows, () => false);
    expect(out[0]!.verdict).toBe("pending_merge");
    expect(out[0]!.tape.find((s) => s.key === "pr")?.detail).toBe("#773 open");
  });

  it("AC3/AC4: PR closed-unmerged (no merge evidence) is NOT conflated with failed", () => {
    // A closed-unmerged PR leaves no merge commit, so the git check is false —
    // the row stays pending_merge (the cycle-terminal / backfill owns the
    // failed/abandon credit). Reconcile must never invent a `failed` from the
    // mere absence of a merge.
    const rows = pendingLedger();
    const out = reconcilePendingMergeVerdicts(rows, () => false);
    expect(out[0]!.verdict).not.toBe("failed");
    expect(out[0]!.verdict).toBe("pending_merge");
  });

  it("AC3: real failed / idle / delivered cycles are left untouched (only pending_merge reconciles)", () => {
    const p = project([
      { cycle_id: "f", status: "failed", outcome: "failed", story_id: "US-F", ts: "2026-06-16T05:00:00Z" },
      { cycle_id: "d", status: "merged", outcome: "delivered", story_id: "US-D", ts: "2026-06-16T04:00:00Z" },
      { cycle_id: "pm", status: "published", outcome: "published_pending_merge", story_id: "US-PM", ts: "2026-06-16T03:00:00Z" },
    ]);
    // isMerged returns true for EVERY story — proving non-pending rows are not
    // re-derived (a failed cycle must stay red even if its story later merged
    // elsewhere; only the pending_merge row flips).
    const out = reconcilePendingMergeVerdicts(collectCycleLedger(p), () => true);
    const byId = new Map(out.map((r) => [r.cycleId, r.verdict]));
    expect(byId.get("f")).toBe("failed"); // red stays red
    expect(byId.get("d")).toBe("delivered");
    expect(byId.get("pm")).toBe("delivered"); // the pending one flips
  });

  it("AC4: a pending_merge row with no story_id is never flipped (nothing to match on)", () => {
    const p = project([
      { cycle_id: "ns", status: "published", outcome: "published_pending_merge", story_id: "US-S", ts: "2026-06-16T03:00:00Z" },
    ]);
    const rows = collectCycleLedger(p);
    // simulate a missing story id on the row
    rows[0]!.storyId = "";
    const out = reconcilePendingMergeVerdicts(rows, () => true);
    expect(out[0]!.verdict).toBe("pending_merge");
  });
});

describe("FIX-348 — reconcile by recorded PR number when the merge commit does NOT name the story", () => {
  // FIX-287's reproduced case: cycle 20260616-234303-21843 ended
  // published_pending_merge and recorded PR #773 on its cycle:terminal twin
  // (pr.value.url = .../pull/773). PR #773 then merged to main as
  // `tcr: align machine page typography (#773)` — a `(#773)` squash that does
  // NOT name FIX-287. The story-id grep finds nothing; the PR-number match must.
  function fix287Ledger() {
    const p = project(
      [
        {
          cycle_id: "20260616-234303-21843",
          status: "published",
          outcome: "published_pending_merge",
          story_id: "FIX-287",
          agent: "codex",
          ts: "2026-06-16T23:43:03Z",
          duration_sec: 1140,
          tcr_count: 1,
        },
      ],
      [
        {
          type: "cycle:terminal",
          schema: 1,
          cycleId: "20260616-234303-21843",
          storyId: "FIX-287",
          agent: "codex",
          model: "gpt-5.5",
          startedAt: 1781624584,
          endedAt: 1781625724,
          outcome: "published_pending_merge",
          pr: { present: true, value: { url: "https://github.com/seanyao/roll/pull/773", state: "OPEN" } },
          branch: { present: true, value: "loop/cycle-20260616-234303-21843" },
          commit: { present: false, reason: "not_recorded" },
          tcr: { present: true, value: 1 },
          attest: { present: false, reason: "not_applicable" },
          usage: { present: false, reason: "no_parseable_usage" },
          cost: { present: false, reason: "no_parseable_usage" },
          ts: 1781625724,
        },
      ],
    );
    const rows = collectCycleLedger(p);
    expect(rows[0]!.verdict).toBe("pending_merge");
    expect(rows[0]!.prNumber).toBe(773); // PR number threaded from cycle:terminal
    return rows;
  }

  // A merge-truth probe over a single `(#773)` squash that does NOT name FIX-287
  // — exactly what main carries (`tcr: align machine page typography (#773)`).
  const fakeGit = {
    commits: [{ subject: "tcr: align machine page typography (#773)", message: "tcr: align machine page typography (#773)\n", files: [] }],
    slug: "seanyao/roll",
  };

  it("AC: PR #773 merged via a `(#773)` commit that does NOT name FIX-287 → delivered", () => {
    const rows = fix287Ledger();
    const out = reconcilePendingMergeVerdicts(rows, cycleMergeTruth(fakeGit));
    expect(out[0]!.verdict).toBe("delivered");
    expect(out[0]!.tape.find((s) => s.key === "end")?.state).toBe("pass");
  });

  it("RED LINE: an OPEN PR (no `(#N)` merge commit on main) stays pending_merge", () => {
    const rows = fix287Ledger();
    // main has no commit referencing #773 → the PR is still open/unmerged.
    const openGit = { commits: [{ subject: "Fix: something unrelated (#999)", message: "", files: [] }], slug: "seanyao/roll" };
    const out = reconcilePendingMergeVerdicts(rows, cycleMergeTruth(openGit));
    expect(out[0]!.verdict).toBe("pending_merge");
  });

  it("does NOT confuse PR #773 with PR #77 or #7730 (exact number match)", () => {
    const rows = fix287Ledger();
    const nearGit = {
      commits: [
        { subject: "tcr: a (#77)", message: "", files: [] },
        { subject: "tcr: b (#7730)", message: "", files: [] },
      ],
      slug: "seanyao/roll",
    };
    const out = reconcilePendingMergeVerdicts(rows, cycleMergeTruth(nearGit));
    expect(out[0]!.verdict).toBe("pending_merge");
  });

  it("falls back to the story-id grep (FIX-347) when the commit DOES name the story", () => {
    const rows = fix287Ledger();
    const namedGit = { commits: [{ subject: "Fix: FIX-287 — typography (#773)", message: "", files: [] }], slug: "seanyao/roll" };
    const out = reconcilePendingMergeVerdicts(rows, cycleMergeTruth(namedGit));
    expect(out[0]!.verdict).toBe("delivered");
  });

  it("gitHasPrMergeCommit: matches `(#N)` and `PR #N`, rejects open/near misses", () => {
    const g = { commits: [{ subject: "tcr: x (#773)", message: "", files: [] }], slug: undefined };
    expect(gitHasPrMergeCommit(g, 773)).toBe(true);
    expect(gitHasPrMergeCommit(g, 77)).toBe(false);
    expect(gitHasPrMergeCommit(g, 7730)).toBe(false);
    expect(gitHasPrMergeCommit({ commits: [{ subject: "Merge PR #42", message: "", files: [] }], slug: undefined }, 42)).toBe(true);
    expect(gitHasPrMergeCommit(null, 773)).toBe(false);
    expect(gitHasPrMergeCommit(g, 0)).toBe(false);
  });

  it("cycleMergeTruth: an empty story-id never matches every commit (only the PR number decides)", () => {
    // "".includes("") is always true — the probe must NOT pass "" to the grep.
    const truth = cycleMergeTruth(fakeGit);
    expect(truth("", undefined)).toBe(false);
    expect(truth("", 773)).toBe(true);
    expect(truth("", 999)).toBe(false);
  });
});

describe("kimi pair-review regressions", () => {
  it("duplicate cycle ids: the last (newest) record wins", () => {
    const p = project([
      { cycle_id: "dup", status: "failed", ts: "2026-06-12T01:00:00Z" },
      { cycle_id: "dup", status: "merged", outcome: "delivered", ts: "2026-06-12T02:00:00Z" },
    ]);
    const rows = collectCycleLedger(p);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verdict).toBe("delivered");
  });

  it("numeric epoch ts is understood (seconds and millis)", () => {
    // Real cycles (failed) — idle heartbeats are excluded (FIX-297), so use
    // non-idle rows to exercise the epoch-ts parsing.
    const p = project([
      { cycle_id: "s", status: "failed", ts: 1781230000 },
      { cycle_id: "ms", status: "failed", ts: 1781230000000 },
    ]);
    const rows = collectCycleLedger(p);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.tsSec === 1781230000)).toBe(true);
  });

  it("a skipped peer gate renders as an idle segment", () => {
    const p = project(
      [{ cycle_id: "c", status: "merged", outcome: "delivered", story_id: "US-1", ts: "2026-06-12T01:00:00Z" }],
      [{ type: "peer:gate", cycleId: "c", verdict: "skipped", reasons: [], ts: 1 }],
    );
    const peer = collectCycleLedger(p)[0]?.tape.find((s) => s.key === "peer");
    expect(peer?.state).toBe("idle");
    expect(peer?.detail).toBe("skipped");
  });
});
