/**
 * FIX-248 — `roll loop status` showed "15 cycles · 0 failed" against a
 * runs.jsonl truth of 14 failed + 1 idle (2026-06-10), with neutral dots on
 * every row and an agents line ("claude 0/34 · pi 0/16") whose numerator
 * counted the v2-only literal `built` and whose denominator came from a
 * different window than the panel.
 *
 * Root cause: every section classifies on v2 literals ("fail", `built`) while
 * the v3 heart emits "failed"/"blocked"/"aborted" (events) and
 * idle/done/published/failed (runs rows). One normalization choke point fixes
 * ROLLUP, day bands, row glyphs and story panels together; the agents line is
 * additionally pinned to the SAME cycle window the panel renders.
 *
 * AC3 fixture: the shape of the real 2026-06-10 day — 14 failed + 1 idle, all
 * agent pi — frozen as a regression harness.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentSummaryLine, dashboardCommand, panelOutcome } from "../src/commands/dashboard.js";
import { renderState } from "../src/render.js";

/** Capture dashboardCommand stdout with a scoped env + cwd (same harness as
 *  dashboard-history.test.ts). */
function tsRun(env: Record<string, string | undefined>, argv: string[], cwd: string): string {
  const save: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    save[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const saveCwd = process.cwd();
  process.chdir(cwd);
  const chunks: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  // @ts-expect-error — capture-only override
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  try {
    dashboardCommand(argv);
  } finally {
    process.stdout.write = realWrite;
    renderState.useColor = true;
    process.chdir(saveCwd);
    for (const [k, v] of Object.entries(save)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return chunks.join("");
}

describe("FIX-248 AC1 — panelOutcome folds v3 literals onto the panel vocabulary", () => {
  it("failure family → fail", () => {
    for (const o of ["failed", "blocked", "aborted", "interrupted", "fail"]) {
      expect(panelOutcome(o)).toBe("fail");
    }
  });
  it("success family → done (published = delivered pending merge)", () => {
    for (const o of ["delivered", "done", "merged", "published"]) {
      expect(panelOutcome(o)).toBe("done");
    }
  });
  it("idle/running/unknown pass through", () => {
    expect(panelOutcome("idle")).toBe("idle");
    expect(panelOutcome("running")).toBe("running");
    expect(panelOutcome("weird")).toBe("weird");
  });
});

describe("FIX-248 AC2 — agents line counts v3 success statuses over the given records", () => {
  it("done/published/merged count as success; failed does not; denominator = records given", () => {
    const recs = [
      { run_id: "a1", agent: "pi", status: "failed" },
      { run_id: "a2", agent: "pi", status: "done" },
      { run_id: "a3", agent: "pi", status: "published" },
      { run_id: "a4", agent: "pi", status: "merged" },
      { run_id: "a5", agent: "pi", status: "failed" },
      { run_id: "a6", agent: "claude", status: "built" },
    ];
    const line = agentSummaryLine(recs, recs.length);
    expect(line).toContain("pi 3/5");
    expect(line).toContain("claude 1/1");
  });
});

describe("FIX-248 AC3 — the 2026-06-10 day shape (14 failed + 1 idle, all pi) renders truthfully", () => {
  it("ROLLUP failed=14, day band carries the count, rows show ✗, agents denominator = window", () => {
    const rt = mkdtempSync(join(tmpdir(), "roll-248-rt-"));
    const nowSec = Math.floor(Date.now() / 1000);
    const events: object[] = [];
    const runs: object[] = [];
    for (let i = 0; i < 15; i++) {
      const id = `D${String(i).padStart(2, "0")}`;
      const start = nowSec - 3600 * 10 + i * 1800;
      const failed = i < 14; // 14 failed + 1 idle — the real 6/10 ledger shape
      events.push({ type: "cycle:start", cycleId: id, storyId: "", ts: start });
      events.push({
        type: "cycle:end",
        cycleId: id,
        outcome: failed ? "failed" : "built",
        ts: start + 600,
      });
      runs.push({
        run_id: id,
        cycle_id: id,
        status: failed ? "failed" : "idle",
        outcome: failed ? "failed" : "built",
        agent: "pi",
        model: "deepseek-v4-pro",
        built: [],
        tcr_count: failed ? 1 : 0,
        story_id: failed ? "FIX-232" : "",
        tokens_in: 1000,
        tokens_out: 200,
        tokens_cache_read: 5000,
        tokens_cache_write: 100,
        cost_usd: 0.02,
        cost_effective_usd: 0.02,
        ts: new Date((start + 600) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      });
    }
    writeFileSync(join(rt, "events.ndjson"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    writeFileSync(join(rt, "runs.jsonl"), runs.map((r) => JSON.stringify(r)).join("\n") + "\n");

    const proj = mkdtempSync(join(tmpdir(), "roll-248-proj-"));
    mkdirSync(join(proj, ".roll"), { recursive: true });
    writeFileSync(
      join(proj, ".roll", "backlog.md"),
      ["| ID | Description | Status |", "|----|----|----|", "| FIX-232 | launchctl poison | 📋 Todo |", ""].join("\n"),
    );
    const home = mkdtempSync(join(tmpdir(), "roll-248-home-"));
    const shared = mkdtempSync(join(tmpdir(), "roll-248-shared-"));
    const out = tsRun(
      {
        HOME: home,
        ROLL_PROJECT_RUNTIME_DIR: rt,
        ROLL_SHARED_ROOT: shared,
        ROLL_MAIN_SLUG: "test-fix248",
        _LAUNCHD_DIR: join(home, "la"),
      },
      ["--no-color", "--en"],
      proj,
    );
    // AC1: the failed metric surfaces all 14 (whichever UTC+8 day bucket the
    // relative fixture timestamps land in — the count itself is the contract).
    expect(out).toMatch(/failed[^\n]*\b14\b/);
    // Row glyphs: 14 failure marks in RECENT.
    expect((out.match(/✗/g) ?? []).length).toBeGreaterThanOrEqual(14);
    // AC2: agents line over the SAME 15-cycle window — pi 0/15 (0 successes).
    expect(out).toContain("pi 0/15");
    // No section claims zero failures anywhere.
    expect(out).not.toMatch(/·\s*0 failed/);
    // FIX-249 AC3: tokens/cost columns light up from the v3 rows' own fields.
    expect(out).toMatch(/input tokens[^\n]*15K/); // 15 × 1000
    expect(out).toMatch(/cache reads[^\n]*75K/); // 15 × 5000
    expect(out).toMatch(/cost[^\n]*\$0\.30/); // 15 × $0.02
  });
});
