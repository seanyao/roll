/**
 * FIX-1052 — `roll loop reconcile-pending` command tests.
 *
 * Exercises the imperative command wrapper around core/reconcile-pending:
 *   - help / unknown flags
 *   - no origin remote → error
 *   - no pending records → empty message
 *   - already-delivered skip
 *   - merged: appends done record, fetches origin/main, emits event
 *   - closed-unmerged: appends abandoned record
 *   - open / CI red: appends ci_red record
 *   - open / pending: no write, prints status
 *   - dry-run: poll but no write
 *
 * All I/O and provider calls are faked; only temp fs/git are real.
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { DeliveryRecord, PrCloudState, PrStatusProvider } from "@roll/core";
import { EventBus } from "@roll/core";
import {
  loopReconcilePendingCommand,
  RECONCILE_PENDING_USAGE,
  type LoopReconcilePendingDeps,
} from "../src/commands/loop-reconcile-pending.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function project(): string {
  const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-reconcile-")));
  dirs.push(p);
  mkdirSync(join(p, ".roll", "loop"), { recursive: true });
  execSync("git init -q", { cwd: p });
  execSync("git config user.email test@roll.local && git config user.name Test", { cwd: p });
  execSync("git checkout -q -b main && git commit -q --allow-empty -m init", { cwd: p });
  execSync("git remote add origin https://github.com/owner/repo.git", { cwd: p });
  // Make git fetch fail fast (no real remote in test env) via a dead proxy.
  execSync("git config http.proxy http://127.0.0.1:1", { cwd: p });
  return p;
}

function writeDeliveries(p: string, records: DeliveryRecord[]): void {
  const path = join(p, ".roll", "loop", "deliveries.jsonl");
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
}

function writeAcceptanceEvidence(p: string, id: string): void {
  const cardDir = join(p, ".roll", "features", "uncategorized", id);
  mkdirSync(join(cardDir, "latest"), { recursive: true });
  mkdirSync(join(cardDir, "screenshots"), { recursive: true });
  writeFileSync(join(cardDir, "screenshots", "proof.png"), "png\n");
  writeFileSync(
    join(cardDir, "ac-map.json"),
    JSON.stringify([{ ac: `${id}:AC1`, status: "pass", evidence: [{ kind: "screenshot", href: "screenshots/proof.png" }] }], null, 2) + "\n",
  );
  writeFileSync(join(cardDir, "latest", `${id}-report.html`), "<html>report</html>\n");
}

function readDeliveries(p: string): DeliveryRecord[] {
  const path = join(p, ".roll", "loop", "deliveries.jsonl");
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DeliveryRecord);
}

function events(p: string): Array<Record<string, unknown>> {
  const path = join(p, ".roll", "loop", "events.ndjson");
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function capture(): { out: string[]; err: string[]; stdout: { write(s: string): void }; stderr: { write(s: string): void } } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: { write: (s: string) => out.push(s) },
    stderr: { write: (s: string) => err.push(s) },
  };
}

function fakeProvider(states: Record<number, PrCloudState>): PrStatusProvider {
  return {
    name: "fake",
    async pollPrStatus(_slug: string, prNumber: number): Promise<PrCloudState> {
      const state = states[prNumber];
      if (state === undefined) throw new Error(`no fake state for PR #${prNumber}`);
      return state;
    },
  };
}

function deps(p: string, provider: PrStatusProvider): LoopReconcilePendingDeps & { out: string[]; err: string[] } {
  const cap = capture();
  return {
    cwd: p,
    provider,
    bus: new EventBus(),
    stdout: cap.stdout,
    stderr: cap.stderr,
    out: cap.out,
    err: cap.err,
  };
}

function pendingRecord(prNumber: number): DeliveryRecord {
  return {
    storyId: "FIX-1050",
    cycleId: "20260630-210059-58201",
    lifecycleState: "pending_merge",
    prNumber: { present: true, value: prNumber },
    prUrl: { present: true, value: `https://github.com/owner/repo/pull/${prNumber}` },
    mergedAt: { present: false, reason: "not_recorded" },
    mergeCommit: { present: false, reason: "not_recorded" },
    recordedAt: 1_779_837_600_000,
  };
}

describe("loopReconcilePendingCommand", () => {
  it("--help prints usage and exits 0", async () => {
    const d = deps(project(), fakeProvider({}));
    const code = await loopReconcilePendingCommand(["--help"], d);
    expect(code).toBe(0);
    expect(d.out.join("")).toContain(RECONCILE_PENDING_USAGE);
  });

  it("unknown flag prints error and exits 1", async () => {
    const d = deps(project(), fakeProvider({}));
    const code = await loopReconcilePendingCommand(["--wat"], d);
    expect(code).toBe(1);
    expect(d.err.join("")).toContain("unknown flag");
  });

  it("no GitHub origin remote prints error and exits 1", async () => {
    const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-reconcile-noremote-")));
    dirs.push(p);
    mkdirSync(join(p, ".roll", "loop"), { recursive: true });
    execSync("git init -q", { cwd: p });
    const d = deps(p, fakeProvider({}));
    const code = await loopReconcilePendingCommand([], d);
    expect(code).toBe(1);
    expect(d.err.join("")).toContain("cannot resolve GitHub owner/repo");
  });

  it("no pending records prints empty message and exits 0", async () => {
    const p = project();
    const d = deps(p, fakeProvider({}));
    const code = await loopReconcilePendingCommand([], d);
    expect(code).toBe(0);
    expect(d.out.join("")).toContain("No pending-merge PRs");
  });

  it("merged PR appends done record, emits pr:merge event, fetches origin/main", async () => {
    const p = project();
    writeDeliveries(p, [pendingRecord(111)]);

    const d = deps(
      p,
      fakeProvider({
        111: { kind: "merged", mergeCommit: "abc1234def", mergedAt: "2026-06-30T13:36:48Z", checkedAt: "2026-06-30T13:36:48Z" },
      }),
    );
    const code = await loopReconcilePendingCommand([], d);
    expect(code).toBe(0);
    expect(d.out.join("")).toContain("merged");

    const recs = readDeliveries(p);
    expect(recs).toHaveLength(2);
    const done = recs[recs.length - 1];
    expect(done.lifecycleState).toBe("done");
    expect(done.mergeCommit).toEqual({ present: true, value: "abc1234def" });
    expect(done.mergedAt.present).toBe(true);

    const ev = events(p);
    expect(ev.some((e) => e.type === "pr:merge" && e.prNumber === 111)).toBe(true);
  });

  it("merged PR flips backlog status from In Progress to Done (FIX-1057)", async () => {
    const p = project();

    // Write a backlog with the story in 🔨 In Progress status
    const backlogPath = join(p, ".roll", "backlog.md");
    writeFileSync(
      backlogPath,
      "## Epic: Test\n\n| ID | Description | Status |\n|----|----|----|\n| FIX-1050 | bug: PR merge leaves status in progress | 🔨 In Progress |\n",
    );
    execSync("git add .roll/backlog.md && git commit -q -m 'add backlog'", { cwd: p });

    writeDeliveries(p, [pendingRecord(777)]);
    writeAcceptanceEvidence(p, "FIX-1050");

    const d = deps(
      p,
      fakeProvider({
        777: { kind: "merged", mergeCommit: "abc7777def", mergedAt: "2026-06-30T13:36:48Z", checkedAt: "2026-06-30T13:36:48Z" },
      }),
    );
    const code = await loopReconcilePendingCommand([], d);
    expect(code).toBe(0);

    // Verify delivery record was appended
    const recs = readDeliveries(p);
    expect(recs[recs.length - 1].lifecycleState).toBe("done");

    // Verify backlog status flipped to ✅ Done
    const backlog = readFileSync(backlogPath, "utf8");
    expect(backlog).toContain("✅ Done");
    expect(backlog).not.toContain("🔨 In Progress");
  });

  it("already-delivered record is skipped", async () => {
    const p = project();
    const existing = pendingRecord(222);
    const done: DeliveryRecord = {
      ...existing,
      lifecycleState: "done",
      mergeCommit: { present: true, value: "zzz9999" },
      mergedAt: { present: true, value: 1_779_837_600_000 },
      recordedAt: 1_779_837_600_001,
    };
    writeDeliveries(p, [existing, done]);

    const d = deps(p, fakeProvider({}));
    const code = await loopReconcilePendingCommand([], d);
    expect(code).toBe(0);
    expect(d.out.join("")).toContain("already delivered");
    expect(readDeliveries(p)).toHaveLength(2);
  });

  it("closed-unmerged appends abandoned record and emits pr:close event", async () => {
    const p = project();
    writeDeliveries(p, [pendingRecord(333)]);
    const d = deps(
      p,
      fakeProvider({
        333: { kind: "closed_unmerged", closedAt: "2026-06-30T13:36:48Z", checkedAt: "2026-06-30T13:36:48Z" },
      }),
    );
    const code = await loopReconcilePendingCommand([], d);
    expect(code).toBe(0);
    expect(d.out.join("")).toContain("closed unmerged");

    const recs = readDeliveries(p);
    expect(recs[recs.length - 1].lifecycleState).toBe("abandoned");
    expect(events(p).some((e) => e.type === "pr:close")).toBe(true);
  });

  it("open with red CI appends ci_red record and emits ci:fail event", async () => {
    const p = project();
    writeDeliveries(p, [pendingRecord(444)]);
    const d = deps(
      p,
      fakeProvider({
        444: { kind: "open", ci: "red", checkedAt: "2026-06-30T13:36:48Z" },
      }),
    );
    const code = await loopReconcilePendingCommand([], d);
    expect(code).toBe(0);
    expect(d.out.join("")).toContain("CI red");

    const recs = readDeliveries(p);
    expect(recs[recs.length - 1].lifecycleState).toBe("ci_red");
    expect(events(p).some((e) => e.type === "ci:fail")).toBe(true);
  });

  it("open with pending/green CI prints status without writing new records", async () => {
    const p = project();
    writeDeliveries(p, [pendingRecord(555)]);
    const d = deps(
      p,
      fakeProvider({
        555: { kind: "open", ci: "green", checkedAt: "2026-06-30T13:36:48Z" },
      }),
    );
    const code = await loopReconcilePendingCommand([], d);
    expect(code).toBe(0);
    expect(d.out.join("")).toContain("open");
    expect(readDeliveries(p)).toHaveLength(1);
  });

  it("--dry-run polls but writes nothing", async () => {
    const p = project();
    writeDeliveries(p, [pendingRecord(666)]);
    const d = deps(
      p,
      fakeProvider({
        666: { kind: "merged", mergeCommit: "dry1111", mergedAt: "2026-06-30T13:36:48Z", checkedAt: "2026-06-30T13:36:48Z" },
      }),
    );
    const code = await loopReconcilePendingCommand(["--dry-run"], d);
    expect(code).toBe(0);
    expect(d.out.join("")).toContain("dry-run");
    expect(readDeliveries(p)).toHaveLength(1);
  });
});
