/**
 * FIX-213 — `roll loop status` history (ROLLUP + RECENT) must see v3 cycles.
 *
 * The v3 heart emits NATIVE RollEvent lines — `{ type: "cycle:end", cycleId,
 * ts: <epoch seconds> }` — but the dashboard's loader only understood the
 * legacy bash shape (`stage`/`label`/ISO `ts`). `parseTs("1780682826")` is an
 * Invalid Date, so every v3 event was dropped and `aggregate` returned 0
 * cycles ("no cycles yet · 0 cycles / 72h") despite real deliveries on disk.
 * The story id lives only in the runs row, matched back to its cycle by
 * `run_id == cycleId`.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dashboardCommand,
  mergeRunsIntoCycles,
  normalizeRawEvent,
  type Cycle,
} from "../src/commands/dashboard.js";
import { renderState } from "../src/render.js";

/** Capture dashboardCommand stdout with a scoped env + cwd. */
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

describe("FIX-213: normalizeRawEvent maps the v3 RollEvent shape to the legacy reader", () => {
  it("converts type → stage, cycleId → label, numeric-seconds ts → ISO", () => {
    const norm = normalizeRawEvent({
      type: "cycle:end",
      cycleId: "20260606-033442-28916",
      outcome: "delivered",
      ts: 1780688462,
    });
    expect(norm.stage).toBe("cycle_end");
    expect(norm.label).toBe("20260606-033442-28916");
    expect(norm.outcome).toBe("delivered");
    // 1780688462s → 2026-06-06T...Z (a valid, parseable ISO string)
    expect(Number.isNaN(new Date(norm.ts ?? "").getTime())).toBe(false);
  });

  it("maps cycle:start too and leaves ms-epoch ts untouched", () => {
    const norm = normalizeRawEvent({ type: "cycle:start", cycleId: "abc", ts: 1780688462000 });
    expect(norm.stage).toBe("cycle_start");
    expect(new Date(norm.ts ?? "").getTime()).toBe(1780688462000);
  });

  it("passes a legacy stage-shaped event through byte-identical (difftest parity)", () => {
    const legacy = { ts: "2026-06-06T10:00:00+00:00", stage: "cycle_start", label: "L", detail: "", outcome: "" };
    expect(normalizeRawEvent(legacy)).toEqual(legacy);
  });
});

describe("FIX-213: mergeRunsIntoCycles matches a runs row to its cycle by id (no ts needed)", () => {
  it("enriches story / tcr / cost from a tsless v3 runs row keyed by cycle_id", () => {
    const start = new Date("2026-06-06T03:34:42Z");
    const cycles: Cycle[] = [
      {
        label: "20260606-033442-28916",
        start,
        end: new Date(start.getTime() + 380_000),
        outcome: "done",
        story: null,
        pr: null,
        fail_detail: null,
      },
    ];
    const runs = {
      "20260606-033442-28916": {
        run_id: "20260606-033442-28916",
        cycle_id: "20260606-033442-28916",
        status: "done",
        built: ["FIX-199"],
        tcr_count: 2,
        cost_usd: 17.54,
        story_id: "FIX-199",
      },
    };
    mergeRunsIntoCycles(cycles, runs);
    expect(cycles[0]?.story).toBe("FIX-199");
    expect(cycles[0]?.tcr_count).toBe(2);
    expect(cycles[0]?.built).toEqual(["FIX-199"]);
  });
});

describe("FIX-213: dashboard counts v3 cycles and lists them in RECENT", () => {
  it("shows '2 cycles' and the story id from id-matched runs rows", () => {
    const rt = mkdtempSync(join(tmpdir(), "roll-hist-rt-"));
    const nowSec = Math.floor(Date.now() / 1000);
    // Two completed v3 cycles in NATIVE RollEvent shape (numeric-seconds ts).
    const s1 = nowSec - 3600;
    const s2 = nowSec - 1800;
    const events = [
      { type: "cycle:start", cycleId: "C1", storyId: "", ts: s1 },
      { type: "cycle:end", cycleId: "C1", outcome: "delivered", ts: s1 + 300 },
      { type: "cycle:start", cycleId: "C2", storyId: "", ts: s2 },
      { type: "cycle:end", cycleId: "C2", outcome: "delivered", ts: s2 + 300 },
    ];
    writeFileSync(join(rt, "events.ndjson"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    // runs rows: NO ts, NO project — exactly what buildRunRow wrote pre-fix.
    const runs = [
      { run_id: "C1", cycle_id: "C1", status: "done", built: ["FIX-199"], tcr_count: 1, story_id: "FIX-199" },
      { run_id: "C2", cycle_id: "C2", status: "done", built: ["FIX-206"], tcr_count: 2, story_id: "FIX-206" },
    ];
    writeFileSync(join(rt, "runs.jsonl"), runs.map((r) => JSON.stringify(r)).join("\n") + "\n");

    const proj = mkdtempSync(join(tmpdir(), "roll-hist-proj-"));
    mkdirSync(join(proj, ".roll"), { recursive: true });
    writeFileSync(
      join(proj, ".roll", "backlog.md"),
      ["| ID | Description | Status |", "|----|----|----|", "| FIX-199 | changelog drift | ✅ Done |", ""].join("\n"),
    );
    const home = mkdtempSync(join(tmpdir(), "roll-hist-home-"));
    const shared = mkdtempSync(join(tmpdir(), "roll-hist-shared-"));
    const out = tsRun(
      {
        HOME: home,
        ROLL_PROJECT_RUNTIME_DIR: rt,
        ROLL_SHARED_ROOT: shared,
        ROLL_MAIN_SLUG: "test-hist01",
        _LAUNCHD_DIR: join(home, "la"),
      },
      ["--no-color", "--en"],
      proj,
    );
    expect(out).toContain("2 cycles");
    expect(out).not.toContain("no cycles yet");
    expect(out).toContain("FIX-199");
    expect(out).toContain("FIX-206");
  });
});
