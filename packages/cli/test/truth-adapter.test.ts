/**
 * US-TRUTH-004 — the one truth adapter + the unknown lane.
 *
 * dashboard / dossier / status stop re-parsing runs rows with their own
 * literals; they consume the selector-backed adapter. AC4: an unknown verdict
 * renders as unknown ("?"), never as a success-looking glyph.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TRUTH_SCHEMA_EPOCH_SEC,
  cycleTruthFromRow,
  outcomeToPanel,
  rowDelivered,
} from "../src/lib/truth-adapter.js";
import { cycleRow } from "../src/render.js";
import { dashboardCommand } from "../src/commands/dashboard.js";
import { renderState } from "../src/render.js";

const NOW = TRUTH_SCHEMA_EPOCH_SEC + 86400;
const iso = (sec: number): string => new Date(sec * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

describe("cycleTruthFromRow / outcomeToPanel — selector-backed classification", () => {
  it("published row → published_pending_merge → panel 'done'", () => {
    const t = cycleTruthFromRow({ cycle_id: "C", status: "published", outcome: "delivered", ts: iso(NOW - 100) }, { nowSec: NOW });
    expect(t.outcome).toBe("published_pending_merge");
    expect(outcomeToPanel(t.outcome, t.state)).toBe("done");
  });
  it("failed row → panel 'fail'; idle → 'idle'", () => {
    const f = cycleTruthFromRow({ cycle_id: "C", status: "failed", outcome: "failed", ts: iso(NOW - 100) }, { nowSec: NOW });
    expect(outcomeToPanel(f.outcome, f.state)).toBe("fail");
    const i = cycleTruthFromRow({ cycle_id: "C", status: "idle", outcome: "built", ts: iso(NOW - 100) }, { nowSec: NOW });
    expect(outcomeToPanel(i.outcome, i.state)).toBe("idle");
  });
  it("rowDelivered: done/merged/published/built count; failed/idle do not", () => {
    expect(rowDelivered({ cycle_id: "C", status: "done", outcome: "delivered", ts: iso(NOW) }, NOW)).toBe(true);
    expect(rowDelivered({ cycle_id: "C", status: "merged", outcome: "delivered", merge_commit: "x", ts: iso(NOW) }, NOW)).toBe(true);
    expect(rowDelivered({ cycle_id: "C", status: "published", outcome: "delivered", ts: iso(NOW) }, NOW)).toBe(true);
    expect(rowDelivered({ cycle_id: "C", status: "failed", outcome: "failed", ts: iso(NOW) }, NOW)).toBe(false);
    expect(rowDelivered({ cycle_id: "C", status: "idle", outcome: "built", ts: iso(NOW) }, NOW)).toBe(false);
  });
});

describe("AC4 — unknown renders as unknown, never as success", () => {
  it("the render layer has a distinct '?' glyph for unknown", () => {
    const row = cycleRow({
      outcome: "unknown",
      pr_outcome: null,
      start_hhmm: "10:00",
      duration_s: 60,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      cost_currency: "USD",
      cost_list: null,
      cron_cost: null,
      story: null,
      built: [],
      model: null,
      agent: null,
      pr_num: null,
      cost_list_legacy: false,
      fail_detail: null,
      label: "C-UNKNOWN",
    });
    expect(row.join("\n")).toContain("?");
    expect(row.join("\n")).not.toContain("✓");
  });

  it("a completed post-epoch cycle with NO runs row renders '?' in the panel", () => {
    const rt = mkdtempSync(join(tmpdir(), "roll-004-rt-"));
    const nowSec = Math.floor(Date.now() / 1000);
    const events = [
      { type: "cycle:start", cycleId: "GHOST", storyId: "", ts: nowSec - 1200 },
      { type: "cycle:end", cycleId: "GHOST", outcome: "failed", ts: nowSec - 600 },
    ];
    writeFileSync(join(rt, "events.ndjson"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    writeFileSync(join(rt, "runs.jsonl"), ""); // the row never landed — the orphan hole
    const proj = mkdtempSync(join(tmpdir(), "roll-004-proj-"));
    mkdirSync(join(proj, ".roll"), { recursive: true });
    writeFileSync(join(proj, ".roll", "backlog.md"), "| ID | D | Status |\n|--|--|--|\n");
    const home = mkdtempSync(join(tmpdir(), "roll-004-home-"));
    const save: Record<string, string | undefined> = {};
    const env: Record<string, string> = {
      HOME: home,
      ROLL_PROJECT_RUNTIME_DIR: rt,
      ROLL_SHARED_ROOT: mkdtempSync(join(tmpdir(), "roll-004-shared-")),
      ROLL_MAIN_SLUG: "test-truth004",
      _LAUNCHD_DIR: join(home, "la"),
    };
    for (const [k, v] of Object.entries(env)) {
      save[k] = process.env[k];
      process.env[k] = v;
    }
    const prevCwd = process.cwd();
    process.chdir(proj);
    const chunks: string[] = [];
    const realWrite = process.stdout.write.bind(process.stdout);
    // @ts-expect-error capture-only
    process.stdout.write = (c: string | Uint8Array): boolean => (chunks.push(String(c)), true);
    try {
      dashboardCommand(["--no-color", "--en"]);
    } finally {
      process.stdout.write = realWrite;
      renderState.useColor = true;
      process.chdir(prevCwd);
      for (const [k, v] of Object.entries(save)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    const out = chunks.join("");
    expect(out).toContain("?"); // the ghost cycle reads unknown…
    expect(out).not.toMatch(/GHOST.*✓/); // …never success
  });
});
