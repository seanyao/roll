/** US-DOSSIER-013 — cycle ledger VM + verdict vocabulary + tape facts. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bucketCounts,
  collectCycleLedger,
  CYCLE_VERDICTS,
  ledgerFailedCount,
  ledgerVerdict,
  reconcilePendingMergeVerdicts,
  reconcileSupersededVerdicts,
  type CycleLedgerRow,
} from "../src/lib/cycle-ledger.js";
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

  it("FIX-351: a gates-passed-but-unpublished cycle is `unpublished` (neutral), NOT `failed`", () => {
    // The runner writes status `local` / outcome `unpublished` for a `built`
    // (gates-passed) cycle whose publish couldn't complete. Either side maps to
    // the neutral verdict — never the failed cluster.
    expect(ledgerVerdict("local", "unpublished")).toBe("unpublished");
    expect(ledgerVerdict("local", "")).toBe("unpublished"); // status-only
    expect(ledgerVerdict("", "unpublished")).toBe("unpublished"); // outcome-only
    expect(ledgerVerdict("local", "unpublished")).not.toBe("failed");
  });

  it("FIX-351: a genuinely-failed cycle stays `failed` (the distinction is preserved)", () => {
    // FIX-328's shape: a hard attest gate block → status/outcome `failed`. The
    // FIX-351 reclassification must NOT touch a real gate failure.
    expect(ledgerVerdict("failed", "failed")).toBe("failed");
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

  it("US-LOOP-078: carries the standard ActivitySignal stream beside the ledger row", () => {
    const p = project(
      [
        { cycle_id: "c1", status: "merged", outcome: "delivered", story_id: "US-X-1", agent: "claude", ts: "2026-06-12T01:00:00Z", tcr_count: 1, merge_commit: "abc" },
      ],
      [
        { type: "cycle:start", cycleId: "c1", storyId: "US-X-1", agent: "claude", ts: 1_000 },
        { type: "cycle:phase", cycleId: "c1", phase: "execute", ts: 2_000 },
        { type: "cycle:tcr", cycleId: "c1", commitHash: "abcdef123456", message: "tcr: ship it", ts: 3_000 },
        { type: "peer:gate", cycleId: "c1", verdict: "consulted", reasons: [], ts: 4_000 },
        { type: "pr:open", prNumber: 77, storyId: "US-X-1", ts: 5_000 },
        { type: "ci:pass", prNumber: 77, workflow: "test-ts", runId: 1, url: "https://ci.example", ts: 6_000 },
        { type: "pr:merge", prNumber: 77, storyId: "US-X-1", ts: 7_000 },
        { type: "cycle:end", cycleId: "c1", status: "merged", outcome: "delivered", ts: 8_000 },
      ],
    );

    const row = collectCycleLedger(p)[0]!;
    expect(row.signals?.map((s) => [s.seg, s.kind, s.signalKind, s.summary])).toEqual([
      ["cycle", "lifecycle", undefined, "周期开始 · cycle start · US-X-1"],
      ["build", "lifecycle", undefined, "阶段 · phase · execute"],
      ["build", "tcr", "tcr", "TCR abcdef123 · tcr: ship it"],
      ["peer", "gate", "peer", "Peer gate · consulted"],
      ["pr", "pr", "pr", "PR #77 开启 · opened"],
      ["ci", "gate", "ci", "Gate CI 通过 · PR #77"],
      ["pr", "pr", "pr", "PR #77 合并 · merged"],
      ["end", "lifecycle", undefined, "周期结束 · cycle end · delivered"],
    ]);
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

describe("FIX-351 — gates-passed-but-unpublished renders neutral, not failed", () => {
  it("reproduces FIX-313's cycle: gates passed (attest produced, peer consulted, 3 tcr commits) + publish couldn't complete → `unpublished`, NEUTRAL end, NOT in failed count", () => {
    // FIX-313's actual runs row + events (cycle 20260617-031926-76145): a sound,
    // gate-passed cycle whose publish couldn't complete. Pre-FIX-351 the runner
    // wrote status/outcome `failed`; FIX-351 writes `local`/`unpublished`.
    const p = project(
      [
        {
          cycle_id: "20260617-031926-76145",
          status: "local",
          outcome: "unpublished",
          story_id: "FIX-313",
          agent: "codex",
          ts: "2026-06-16T19:40:53Z",
          duration_sec: 1287,
          tcr_count: 3,
        },
      ],
      [
        { type: "peer:gate", cycleId: "20260617-031926-76145", verdict: "consulted", reasons: [], ts: 1 },
        { type: "attest:gate", cycleId: "20260617-031926-76145", verdict: "produced", reasons: [], ts: 2 },
      ],
    );
    const rows = collectCycleLedger(p);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.verdict).toBe("unpublished");
    expect(r.verdict).not.toBe("failed");
    // the end segment is NEUTRAL (idle-class grey), never red (fail).
    expect(r.tape.find((s) => s.key === "end")?.state).toBe("idle");
    expect(r.tape.find((s) => s.key === "end")?.detail).toBe("unpublished");
    // the build/ci segments still show the sound work (green): 3 commits + attest ✓.
    expect(r.tape.find((s) => s.key === "build")?.state).toBe("pass");
    expect(r.tape.find((s) => s.key === "ci")?.state).toBe("pass");
    // it does NOT count as a failure.
    expect(ledgerFailedCount(rows)).toBe(0);
  });

  it("a genuinely-failed cycle (FIX-328's empty-shell attest block) is STILL `failed` and red", () => {
    // FIX-328's shape: a hard attest gate block stamps status/outcome `failed`.
    // FIX-351 must not flip this to neutral — a real gate failure stays red.
    const p = project(
      [
        {
          cycle_id: "20260617-074515-4067",
          status: "failed",
          outcome: "failed",
          story_id: "FIX-328",
          agent: "codex",
          ts: "2026-06-17T07:45:15Z",
          duration_sec: 1150,
          tcr_count: 1,
        },
      ],
      [{ type: "attest:gate", cycleId: "20260617-074515-4067", verdict: "skipped", reasons: ["empty shell"], ts: 1 }],
    );
    const rows = collectCycleLedger(p);
    const r = rows[0]!;
    expect(r.verdict).toBe("failed");
    expect(r.tape.find((s) => s.key === "end")?.state).toBe("fail");
    expect(ledgerFailedCount(rows)).toBe(1);
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

describe("FIX-350 — reconcile is CYCLE-ACCURATE: a cycle is delivered IFF its OWN recorded PR merged", () => {
  // Owner decision (FIX-350): a pending_merge cycle flips to delivered IFF its
  // OWN recorded PR carries a `(#N)` merge commit on main — NOT if the story
  // merely landed via some OTHER PR. When a row HAS a recorded PR number, the
  // probe decides SOLELY by gitHasPrMergeCommit(that PR); it falls back to the
  // story-id grep (FIX-347) ONLY for old cycles with no recorded PR number.
  //
  // FIX-287's reproduced case: cycle 20260616-234303-21843 ended
  // published_pending_merge and recorded PR #773 on its cycle:terminal twin.
  // PR #773 then merged to main as `tcr: align machine page typography (#773)` —
  // a `(#773)` squash that does NOT name FIX-287. The PR-number match must flip it.
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

  // FIX-311's reproduced case: its cycle recorded PR #763, which NEVER merged —
  // the story instead landed via LATER PRs #766/#767. A row WITH a recorded PR
  // number that did NOT merge must STAY pending even though main carries commits
  // naming FIX-311 (the FIX-311/284 regression FIX-350 closes).
  function fix311Ledger() {
    const p = project(
      [
        {
          cycle_id: "20260615-100000-31100",
          status: "published",
          outcome: "published_pending_merge",
          story_id: "FIX-311",
          agent: "codex",
          ts: "2026-06-15T10:00:00Z",
          duration_sec: 900,
          tcr_count: 1,
        },
      ],
      [
        {
          type: "cycle:terminal",
          schema: 1,
          cycleId: "20260615-100000-31100",
          storyId: "FIX-311",
          agent: "codex",
          model: "gpt-5.5",
          startedAt: 1781600000,
          endedAt: 1781600900,
          outcome: "published_pending_merge",
          pr: { present: true, value: { url: "https://github.com/seanyao/roll/pull/763", state: "OPEN" } },
          branch: { present: true, value: "loop/cycle-20260615-100000-31100" },
          commit: { present: false, reason: "not_recorded" },
          tcr: { present: true, value: 1 },
          attest: { present: false, reason: "not_applicable" },
          usage: { present: false, reason: "no_parseable_usage" },
          cost: { present: false, reason: "no_parseable_usage" },
          ts: 1781600900,
        },
      ],
    );
    const rows = collectCycleLedger(p);
    expect(rows[0]!.verdict).toBe("pending_merge");
    expect(rows[0]!.prNumber).toBe(763);
    return rows;
  }

  // A merge-truth probe over a single `(#773)` squash that does NOT name FIX-287
  // — exactly what main carries (`tcr: align machine page typography (#773)`).
  const fakeGit = {
    commits: [{ subject: "tcr: align machine page typography (#773)", message: "tcr: align machine page typography (#773)\n", files: [] }],
    slug: "seanyao/roll",
  };

  it("(a) row WITH prNumber whose PR merged → delivered (PR #773 merged via a `(#773)` commit that does NOT name FIX-287)", () => {
    const rows = fix287Ledger();
    const out = reconcilePendingMergeVerdicts(rows, cycleMergeTruth(fakeGit));
    expect(out[0]!.verdict).toBe("delivered");
    expect(out[0]!.tape.find((s) => s.key === "end")?.state).toBe("pass");
  });

  it("(b) KEY: row WITH prNumber whose PR did NOT merge → STAYS pending, EVEN IF a commit subject names the story-id (FIX-311/284 regression)", () => {
    const rows = fix311Ledger();
    // main carries LATER PRs (#766/#767) that name FIX-311 — its story landed,
    // but its OWN recorded PR #763 never merged (no `(#763)` commit on main).
    // The OLD FIX-348 OR-branch wrongly flipped this to delivered via the story
    // grep; FIX-350 keeps it pending because PR #763 is the sole arbiter.
    const laterPrGit = {
      commits: [
        { subject: "Fix: FIX-311 — dashboard reconcile (#766)", message: "", files: [] },
        { subject: "Fix: FIX-311 follow-up (#767)", message: "", files: [] },
      ],
      slug: "seanyao/roll",
    };
    const out = reconcilePendingMergeVerdicts(rows, cycleMergeTruth(laterPrGit));
    expect(out[0]!.verdict).toBe("pending_merge");
  });

  it("(b') the SAME row flips to delivered only once its OWN PR #763 carries a `(#763)` merge commit", () => {
    const rows = fix311Ledger();
    const ownPrGit = { commits: [{ subject: "tcr: something (#763)", message: "", files: [] }], slug: "seanyao/roll" };
    const out = reconcilePendingMergeVerdicts(rows, cycleMergeTruth(ownPrGit));
    expect(out[0]!.verdict).toBe("delivered");
  });

  it("(c) row with NO prNumber → falls back to storyHasMergeEvidence (old cycles predating the terminal PR event)", () => {
    const rows = fix287Ledger();
    rows[0]!.prNumber = undefined; // simulate a pre-terminal-event cycle: no PR recorded
    // With no PR number, the story-id grep is the only signal. A commit naming
    // FIX-287 → delivered; one that doesn't → stays pending.
    const namedGit = { commits: [{ subject: "Fix: FIX-287 — typography", message: "", files: [] }], slug: "seanyao/roll" };
    expect(reconcilePendingMergeVerdicts(rows, cycleMergeTruth(namedGit))[0]!.verdict).toBe("delivered");

    const rows2 = fix287Ledger();
    rows2[0]!.prNumber = undefined;
    const unrelatedGit = { commits: [{ subject: "Fix: something unrelated (#999)", message: "", files: [] }], slug: "seanyao/roll" };
    expect(reconcilePendingMergeVerdicts(rows2, cycleMergeTruth(unrelatedGit))[0]!.verdict).toBe("pending_merge");
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

  it("gitHasPrMergeCommit: matches `(#N)` and `PR #N`, rejects open/near misses", () => {
    const g = { commits: [{ subject: "tcr: x (#773)", message: "", files: [] }], slug: undefined };
    expect(gitHasPrMergeCommit(g, 773)).toBe(true);
    expect(gitHasPrMergeCommit(g, 77)).toBe(false);
    expect(gitHasPrMergeCommit(g, 7730)).toBe(false);
    expect(gitHasPrMergeCommit({ commits: [{ subject: "Merge PR #42", message: "", files: [] }], slug: undefined }, 42)).toBe(true);
    expect(gitHasPrMergeCommit(null, 773)).toBe(false);
    expect(gitHasPrMergeCommit(g, 0)).toBe(false);
  });

  it("cycleMergeTruth: a recorded PR number is the SOLE arbiter; the story-id grep is the no-PR fallback", () => {
    const truth = cycleMergeTruth(fakeGit); // main carries only `(#773)`, naming no story
    // PR present → decided solely by gitHasPrMergeCommit.
    expect(truth("FIX-287", 773)).toBe(true); // own PR merged
    expect(truth("FIX-287", 999)).toBe(false); // own PR not merged — even though...
    // ...the story-id grep would also be false here; the key is the PR is the arbiter.
    // Empty story-id with no PR → must NOT match every commit (`"".includes` guard).
    expect(truth("", undefined)).toBe(false);
    // No PR → falls back to the story-id grep.
    expect(truth("", 773)).toBe(true); // PR present still decides
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

describe("FIX-337 (AC3) — reconcileSupersededVerdicts: a card delivered elsewhere stops inflating failed", () => {
  function row(verdict: ReturnType<typeof ledgerVerdict>, storyId: string): CycleLedgerRow {
    return {
      cycleId: `c-${storyId}-${verdict}`,
      tsSec: 1781230000,
      verdict,
      storyId,
      agent: "claude",
      model: "claude",
      tokens: "—",
      cost: "—",
      toolSummary: "",
      toolCosts: [],
      toolTimeline: [],
      duration: "—",
      tape: [
        { key: "end", detail: verdict, state: verdict === "delivered" ? "pass" : "fail" },
      ],
      evidence: [],
    };
  }

  it("a FAILED cycle whose story is superseded → `superseded` (neutral grey end), no longer failed", () => {
    const rows = [row("failed", "FIX-900"), row("delivered", "US-OK")];
    const out = reconcileSupersededVerdicts(rows, (id) => id === "FIX-900");
    const f = out.find((r) => r.storyId === "FIX-900")!;
    expect(f.verdict).toBe("superseded");
    expect(f.tape.find((s) => s.key === "end")?.state).toBe("idle"); // neutral, not red
    expect(f.tape.find((s) => s.key === "end")?.detail).toBe("superseded");
    expect(ledgerFailedCount(out)).toBe(0); // the failure no longer counts
  });

  it("blocked/reverted/pending_merge are eligible; delivered/idle/unpublished/unknown are not", () => {
    const rows = [
      row("blocked", "B"),
      row("reverted", "R"),
      row("pending_merge", "P"),
      row("delivered", "D"),
      row("idle", "I"),
      row("unpublished", "U"),
      row("unknown", "K"),
    ];
    const out = reconcileSupersededVerdicts(rows, () => true); // every story superseded
    const byStory = new Map(out.map((r) => [r.storyId, r.verdict]));
    expect(byStory.get("B")).toBe("superseded");
    expect(byStory.get("R")).toBe("superseded");
    expect(byStory.get("P")).toBe("superseded");
    // terminal / non-failure verdicts are never touched.
    expect(byStory.get("D")).toBe("delivered");
    expect(byStory.get("I")).toBe("idle");
    expect(byStory.get("U")).toBe("unpublished");
    expect(byStory.get("K")).toBe("unknown");
  });

  it("a failed cycle whose story is NOT superseded stays failed (red)", () => {
    const out = reconcileSupersededVerdicts([row("failed", "FIX-LIVE")], () => false);
    expect(out[0]!.verdict).toBe("failed");
    expect(ledgerFailedCount(out)).toBe(1);
  });

  it("an empty story-id has nothing to match on → left untouched even if the probe says true", () => {
    const out = reconcileSupersededVerdicts([row("failed", "")], () => true);
    expect(out[0]!.verdict).toBe("failed");
  });
});

describe("FIX-337 (AC2) — bucketCounts: every verdict bucket, sum === rows.length", () => {
  function r(verdict: ReturnType<typeof ledgerVerdict>): CycleLedgerRow {
    return {
      cycleId: `c-${verdict}-${Math.random()}`,
      tsSec: 1781230000,
      verdict,
      storyId: "",
      agent: "",
      model: "—",
      tokens: "—",
      cost: "—",
      toolSummary: "",
      toolCosts: [],
      toolTimeline: [],
      duration: "—",
      tape: [],
      evidence: [],
    };
  }

  it("keys on the full CYCLE_VERDICTS order; unseen buckets are 0, never absent", () => {
    const counts = bucketCounts([r("delivered"), r("failed"), r("superseded")]);
    for (const v of CYCLE_VERDICTS) expect(counts).toHaveProperty(v); // every key present
    expect(counts.delivered).toBe(1);
    expect(counts.failed).toBe(1);
    expect(counts.superseded).toBe(1);
    expect(counts.idle).toBe(0); // unseen → 0
  });

  it("the sum of all buckets equals the row count (the AC invariant)", () => {
    const rows = [
      r("delivered"), r("delivered"),
      r("pending_merge"), r("unpublished"), r("superseded"),
      r("failed"), r("reverted"), r("blocked"),
      r("idle"), r("unknown"),
    ];
    const counts = bucketCounts(rows);
    const summed = CYCLE_VERDICTS.reduce((a, v) => a + counts[v], 0);
    expect(summed).toBe(rows.length); // 10
  });
});

describe("FIX-290/FIX-337 (AC4) — failed AND idle real cycles keep model + duration", () => {
  it("an idle-verdict cycle that picked a story keeps model + duration; tokens honest", () => {
    // a real idle cycle (story picked) — NOT a heartbeat, so it is kept. Its
    // model + duration must still render; tokens are an honest "—" (true-0).
    const p = project([
      { cycle_id: "idle-real", status: "idle", story_id: "US-9", agent: "kimi", model: "kimi-k2", ts: "2026-06-12T05:00:00Z", duration_sec: 300 },
    ]);
    const r = collectCycleLedger(p)[0]!;
    expect(r.verdict).toBe("idle");
    expect(r.model).toBe("kimi-k2"); // present, not dropped
    expect(r.duration).toBe("5m00s"); // present
    expect(r.tokens).toBe("—"); // true-0 (no usage_unknown flag) — never "?"
  });

  it("a failed cycle with readable 0 tokens shows '—', model + duration intact", () => {
    const p = project([
      { cycle_id: "f0", status: "failed", outcome: "failed", story_id: "US-F", agent: "pi", model: "gpt-5", ts: "2026-06-12T05:00:00Z", duration_sec: 90, tokens_in: 0, tokens_out: 0 },
    ]);
    const r = collectCycleLedger(p)[0]!;
    expect(r.verdict).toBe("failed");
    expect(r.model).toBe("gpt-5");
    expect(r.duration).toBe("1m30s");
    expect(r.tokens).toBe("—");
  });
});
