/**
 * US-TRUTH-016 AC4 — CLI `roll truth query <storyId>` tests.
 *
 * AC4: the ONE CLI entry for deterministic delivery-truth queries.
 * Tests: help output, human-readable format, --json format, unknown subcommand,
 * missing storyId, no deliveries (todo), in_flight, done, failed scenarios.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { truthCommand } from "../src/commands/truth.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env["ROLL_LANG"];
});

function project(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-truth-cmd-"));
  dirs.push(p);
  mkdirSync(join(p, ".roll", "loop"), { recursive: true });
  return p;
}

function writeDeliveries(p: string, records: unknown[]): void {
  const lines = records.map((r) => JSON.stringify(r) + "\n").join("");
  writeFileSync(join(p, ".roll", "loop", "deliveries.jsonl"), lines);
}

const PRESENT = (value: unknown) => ({ present: true, value });
const ABSENT = (reason: string) => ({ present: false, reason });

/** Capture stdout + exit code for a truthCommand call. */
function run(args: string[], cwd: string): { stdout: string; stderr: string; code: number } {
  const out: string[] = [];
  const err: string[] = [];
  const so = process.stdout.write.bind(process.stdout);
  const se = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string) => (out.push(s), true)) as typeof process.stdout.write;
  process.stderr.write = ((s: string) => (err.push(s), true)) as typeof process.stderr.write;
  const save = process.cwd();
  let code: number;
  try {
    process.chdir(cwd);
    code = truthCommand(args);
  } finally {
    process.chdir(save);
    process.stdout.write = so;
    process.stderr.write = se;
  }
  return { stdout: out.join(""), stderr: err.join(""), code };
}

// ── Help ────────────────────────────────────────────────────────────────────

describe("roll truth — help", () => {
  it("prints usage on bare call", () => {
    const p = project();
    const { stdout, stderr, code } = run([], p);
    expect(code).toBe(1);
    expect(stdout).toContain("truth query");
  });

  it("prints usage on --help", () => {
    const p = project();
    const { stdout, stderr, code } = run(["--help"], p);
    expect(code).toBe(0);
    expect(stdout).toContain("truth query");
  });

  it("prints error on unknown subcommand", () => {
    const p = project();
    const { stderr, code } = run(["unknown"], p);
    expect(code).toBe(1);
    expect(stderr).toContain("unknown");
  });
});

// ── query: human-readable ───────────────────────────────────────────────────

describe("roll truth query — human-readable", () => {
  it("todo: no deliveries → lifecycleState: todo", () => {
    const p = project();
    const { stdout, code } = run(["query", "US-NOEXIST"], p);
    expect(code).toBe(0);
    expect(stdout).toContain("US-NOEXIST");
    expect(stdout).toContain("lifecycleState: todo");
    expect(stdout).toContain("delivered: false");
  });

  it("in_flight: shows PR details", () => {
    const p = project();
    writeDeliveries(p, [
      {
        storyId: "US-INF",
        cycleId: "cycle-001",
        lifecycleState: "in_flight",
        prNumber: PRESENT(42),
        prUrl: PRESENT("https://gh/pull/42"),
        mergedAt: ABSENT("not_merged"),
        mergeCommit: ABSENT("not_merged"),
        recordedAt: 1000,
      },
    ]);
    const { stdout, code } = run(["query", "US-INF"], p);
    expect(code).toBe(0);
    expect(stdout).toContain("lifecycleState: in_flight");
    expect(stdout).toContain("prNumber: 42");
    expect(stdout).toContain("prUrl: https://gh/pull/42");
    expect(stdout).toContain("delivered: false");
  });

  it("done: shows merge details", () => {
    const p = project();
    writeDeliveries(p, [
      {
        storyId: "US-DONE",
        cycleId: "cycle-002",
        lifecycleState: "done",
        prNumber: PRESENT(99),
        prUrl: PRESENT("https://gh/pull/99"),
        mergedAt: PRESENT(2000),
        mergeCommit: PRESENT("abc123def456"),
        recordedAt: 2000,
      },
    ]);
    const { stdout, code } = run(["query", "US-DONE"], p);
    expect(code).toBe(0);
    expect(stdout).toContain("lifecycleState: done");
    expect(stdout).toContain("delivered: true");
    expect(stdout).toContain("mergeCommit: abc123def456");
  });

  it("failed: no PR details", () => {
    const p = project();
    writeDeliveries(p, [
      {
        storyId: "US-FAIL",
        cycleId: "cycle-003",
        lifecycleState: "failed",
        prNumber: ABSENT("no_publish"),
        prUrl: ABSENT("no_publish"),
        mergedAt: ABSENT("not_relevant"),
        mergeCommit: ABSENT("not_relevant"),
        recordedAt: 3000,
      },
    ]);
    const { stdout, code } = run(["query", "US-FAIL"], p);
    expect(code).toBe(0);
    expect(stdout).toContain("lifecycleState: failed");
    expect(stdout).toContain("delivered: false");
    // No prNumber/prUrl displayed when undefined
    expect(stdout).not.toContain("prNumber:");
  });
});

// ── query: --json ───────────────────────────────────────────────────────────

describe("roll truth query --json", () => {
  it("emits full StoryDeliveryTruth as JSON", () => {
    const p = project();
    writeDeliveries(p, [
      {
        storyId: "US-JSON",
        cycleId: "cycle-json",
        lifecycleState: "in_flight",
        prNumber: PRESENT(77),
        prUrl: PRESENT("https://gh/pull/77"),
        mergedAt: ABSENT("not_merged"),
        mergeCommit: ABSENT("not_merged"),
        recordedAt: 4000,
      },
    ]);
    const { stdout, code } = run(["query", "US-JSON", "--json"], p);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.storyId).toBe("US-JSON");
    expect(parsed.lifecycleState).toBe("in_flight");
    expect(parsed.delivered).toBe(false);
    expect(parsed.prNumber).toBe(77);
    expect(parsed.prUrl).toBe("https://gh/pull/77");
  });

  it("--json with todo (no deliveries)", () => {
    const p = project();
    const { stdout, code } = run(["query", "US-EMPTY", "--json"], p);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.lifecycleState).toBe("todo");
    expect(parsed.delivered).toBe(false);
    expect(parsed.deliveringCycles).toEqual([]);
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────────

describe("roll truth query — edge cases", () => {
  it("missing storyId prints error", () => {
    const p = project();
    const { stderr, code } = run(["query"], p);
    expect(code).toBe(1);
    expect(stderr).toContain("storyId");
  });

  it("handles torn JSON gracefully via readDeliveries skip", () => {
    const p = project();
    writeFileSync(
      join(p, ".roll", "loop", "deliveries.jsonl"),
      [
        // Valid record — different cycleId so both survive readDeliveries dedup
        JSON.stringify({
          storyId: "US-A", cycleId: "c1", lifecycleState: "in_flight",
          prNumber: PRESENT(1), prUrl: ABSENT("n/a"), mergedAt: ABSENT("n/a"),
          mergeCommit: ABSENT("n/a"), recordedAt: 100,
        }) + "\n",
        // Torn line (should be skipped by readDeliveries)
        "{broken",
        // Another valid — same storyId, different cycleId, later lifecycle
        JSON.stringify({
          storyId: "US-A", cycleId: "c2", lifecycleState: "done",
          prNumber: PRESENT(1), prUrl: ABSENT("n/a"), mergedAt: PRESENT(200),
          mergeCommit: PRESENT("ccc"), recordedAt: 200,
        }) + "\n",
        // Empty line (should be skipped)
        "",
      ].join("\n"),
    );
    const { stdout, code } = run(["query", "US-A"], p);
    expect(code).toBe(0);
    // Multiple cycles: latest lifecycleState (in_flight from c2=200 wins) but
    // delivered is true because c2's record is "done".
    // Actually c2 is the latest recordedAt (200), so lifecycleState is "done".
    expect(stdout).toContain("lifecycleState: done");
    expect(stdout).toContain("delivered: true");
    // Both cycles are delivering
    expect(stdout).toContain("c1");
    expect(stdout).toContain("c2");
  });
});
