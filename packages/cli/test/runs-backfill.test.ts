/**
 * FIX-243 — merge-evidence backfill, wired (v2 `_loop_backfill_merged` parity).
 *
 * Confirmed dead 2026-06-10: cycle 212711 ended failed, its PR #577 merged,
 * and多个 clean cycles later the runs row still read failed/failed with no
 * merge field — the executor's `reconcile` command is a no-op stub and
 * reconcileMergeEvidence had no live caller. This wires a file-level backfill
 * into run-once: probe claim-shaped rows' cycle branches via gh, credit ONLY
 * on MERGED evidence, rewrite the rows in place (non-candidate lines stay
 * byte-verbatim).
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { reconcileBranchName } from "@roll/core";
import { BACKFILL_PROBE_CAP, backfillMergedRuns } from "../src/lib/runs-backfill.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function tmpRuns(lines: string[]): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "roll-243-")));
  dirs.push(d);
  const p = join(d, "runs.jsonl");
  writeFileSync(p, lines.join("\n") + "\n", "utf8");
  return p;
}

const row = (cycleId: string, status: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ run_id: cycleId, cycle_id: cycleId, status, outcome: status === "done" ? "delivered" : status, ...extra });

describe("backfillMergedRuns", () => {
  it("credits failed/published rows whose PR MERGED; leaves others byte-verbatim", async () => {
    const junk = "not-json at all";
    const p = tmpRuns([
      row("c1", "failed", { story_id: "FIX-9" }), // phantom failure, PR merged
      row("c2", "published"), // merge pending, PR merged meanwhile
      row("c3", "failed"), // genuinely failed, PR closed
      row("c4", "done"), // not a candidate
      junk,
    ]);
    const fetchInfo = vi.fn(async (_slug: string, branch: string) => {
      if (branch === reconcileBranchName("c1")) return { state: "MERGED", mergedAt: "2026-06-11T02:00:00Z", mergeCommit: "aaa", prNumber: 577, prUrl: "https://github.com/o/r/pull/577" };
      if (branch === reconcileBranchName("c2")) return { state: "MERGED", mergedAt: "2026-06-11T02:05:00Z", mergeCommit: "bbb", prNumber: 578, prUrl: "https://github.com/o/r/pull/578" };
      if (branch === reconcileBranchName("c3")) return { state: "CLOSED", mergedAt: undefined, mergeCommit: undefined };
      return undefined;
    });
    const credited = await backfillMergedRuns("/unused", p, { slug: "o/r", fetchInfo });
    expect(credited.map((c) => c.cycleId).sort()).toEqual(["c1", "c2"]);
    const lines = readFileSync(p, "utf8").trimEnd().split("\n");
    const r1 = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(r1).toMatchObject({ status: "merged", outcome: "delivered", merge_commit: "aaa", story_id: "FIX-9", pr_number: 577, pr_url: "https://github.com/o/r/pull/577" });
    const r2 = JSON.parse(lines[1] ?? "") as Record<string, unknown>;
    expect(r2).toMatchObject({ status: "merged", merged_at: "2026-06-11T02:05:00Z", pr_number: 578, pr_url: "https://github.com/o/r/pull/578" });
    expect(JSON.parse(lines[2] ?? "") as Record<string, unknown>).toMatchObject({ status: "failed" }); // CLOSED ≠ credit
    expect(lines[3]).toBe(row("c4", "done")); // untouched, byte-verbatim
    expect(lines[4]).toBe(junk); // junk preserved verbatim
    expect(fetchInfo).toHaveBeenCalledTimes(3); // c4/junk never probed
  });

  it("probes at most the most-recent BACKFILL_PROBE_CAP candidates (gh fan-out bounded)", async () => {
    const many = Array.from({ length: BACKFILL_PROBE_CAP + 5 }, (_, i) => row(`c${i}`, "failed"));
    const p = tmpRuns(many);
    const fetchInfo = vi.fn(async () => undefined);
    await backfillMergedRuns("/unused", p, { slug: "o/r", fetchInfo });
    expect(fetchInfo).toHaveBeenCalledTimes(BACKFILL_PROBE_CAP);
    // the OLDEST 5 fall outside the window — most-recent rows win
    const probed = fetchInfo.mock.calls.map((c) => (c as unknown[])[1] as string);
    expect(probed).not.toContain(reconcileBranchName("c0"));
    expect(probed).toContain(reconcileBranchName(`c${BACKFILL_PROBE_CAP + 4}`));
  });

  it("no candidates / no evidence → file untouched, empty credit list", async () => {
    const p = tmpRuns([row("c4", "done"), row("c5", "idle")]);
    const before = readFileSync(p, "utf8");
    const fetchInfo = vi.fn(async () => undefined);
    const credited = await backfillMergedRuns("/unused", p, { slug: "o/r", fetchInfo });
    expect(credited).toEqual([]);
    expect(fetchInfo).not.toHaveBeenCalled();
    expect(readFileSync(p, "utf8")).toBe(before);
  });

  it("rows already carrying merge evidence are not re-probed", async () => {
    const p = tmpRuns([row("c6", "failed", { merge_commit: "old" })]);
    const fetchInfo = vi.fn(async () => undefined);
    await backfillMergedRuns("/unused", p, { slug: "o/r", fetchInfo });
    expect(fetchInfo).not.toHaveBeenCalled();
  });

  // FIX-389b AC5: PR-lane merge path — the executor published a PR, wrote
  // pr_number + pr_url to the runs row, but never ran the "done" terminal
  // (the PR merged via the async PR-lane). The backfill must credit the row
  // with merge_commit, pr_number, pr_url — all fields the projection needs.
  it("FIX-389b AC5: backfill credits a published row with merge_commit + pr_number + pr_url (PR-lane merge, executor never ran done)", async () => {
    const p = tmpRuns([
      row("c7", "published", { pr_number: 891, pr_url: "https://github.com/o/r/pull/891" }),
    ]);
    const fetchInfo = vi.fn(async () => ({
      state: "MERGED",
      mergedAt: "2026-06-21T10:00:00Z",
      mergeCommit: "abc123def",
      prNumber: 891,
      prUrl: "https://github.com/o/r/pull/891",
    }));
    const credited = await backfillMergedRuns("/unused", p, { slug: "o/r", fetchInfo });
    expect(credited).toHaveLength(1);
    const lines = readFileSync(p, "utf8").trimEnd().split("\n");
    const r = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    // All projection-required fields present:
    expect(r).toMatchObject({
      status: "merged",
      outcome: "delivered",
      merge_commit: "abc123def",
      pr_number: 891,
      pr_url: "https://github.com/o/r/pull/891",
    });
    // The original pr_number + pr_url from publish are preserved (not clobbered).
    expect(r["pr_number"]).toBe(891);
    expect(r["pr_url"]).toBe("https://github.com/o/r/pull/891");
  });
});
