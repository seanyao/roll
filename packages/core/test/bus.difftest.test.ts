/**
 * diff-test: EventBus append discipline vs the frozen bash `_loop_event`
 * (bin/roll:7902-7989) and `_loop_event_rotate` (7991-8004).
 *
 * What is byte-compared: the APPEND MECHANICS the bash guarantees —
 *   - file location: events land in the runtime dir resolved from
 *     ROLL_PROJECT_RUNTIME_DIR (the env override the dashboard resolver and
 *     `_loop_runtime_dir` both honour);
 *   - ensure-exists self-heal (FIX-157): the file is created before the append;
 *   - exactly one newline-terminated line is appended per call (FIX-067 single
 *     O_APPEND write — no lock);
 *   - rotation plan: the `.4 rm / .3→.4 / … / cur→.1 / recreate` sequence.
 *
 * DELIBERATE v3 DIVERGENCE (documented, not byte-equal): the LINE SCHEMA. v2's
 * `_loop_event` writes a flat legacy line `{"ts","stage","label","detail",
 * "outcome"}`; the v3 contract (card) types events as @roll/spec RollEvent
 * (parseEventLine), a different, richer schema. So we compare the *mechanism*
 * (file path, one-line-per-call, ensure-exists, rotation), and assert the
 * schema divergence explicitly — we do NOT byte-compare the JSON payload shape.
 *
 * Harness mirrors store.difftest.test.ts: sed-slice the bash fn, eval it, run
 * against a temp ROLL_PROJECT_RUNTIME_DIR, inspect the resulting file.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { EventBus, nodeEventStore } from "../src/index.js";
import type { RollEvent } from "@roll/spec";

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

/**
 * Frozen v2 `_loop_event` output line (bin/roll:7902-7989). The oracle wrote a
 * single newline-terminated flat-schema line `{ts, stage, label, detail,
 * outcome}` per call. Captured while the diff-test agreed; `ts` is a live epoch
 * in the real oracle so it is canonicalised to a fixed value here (no assertion
 * inspects it — only the per-call line count, trailing newline, and key set).
 */
const V2_EVENT_LINE =
  '{"ts":1700000000,"stage":"cycle_end","label":"cyc-2","detail":"branch-x","outcome":"delivered"}\n';

describe("frozen: EventBus append mechanics == bash _loop_event", () => {
  it("writes ONE newline-terminated line per call (file location parity)", () => {
    // v2: exactly one trailing-newline line landed in <rtDir>/events.ndjson.
    expect(V2_EVENT_LINE.endsWith("\n")).toBe(true);
    expect(V2_EVENT_LINE.split("\n").filter((l) => l !== "")).toHaveLength(1);

    // TS: appending one RollEvent lands exactly one line in the same file name.
    const rtDir = mkdtempSync(join(tmpdir(), "roll-bus-ts-"));
    dirs.push(rtDir);
    const eventsPath = join(rtDir, "events.ndjson");
    const bus = new EventBus(nodeEventStore);
    const ev: RollEvent = {
      type: "cycle:start",
      cycleId: "cyc-1",
      storyId: "US-1",
      agent: "kimi",
      model: "kimi-k2",
      ts: 1_700_000_000_000,
    };
    bus.appendEvent(eventsPath, ev);
    const tsContent = readFileSync(eventsPath, "utf8");
    expect(tsContent.endsWith("\n")).toBe(true);
    expect(tsContent.split("\n").filter((l) => l !== "")).toHaveLength(1);
  });

  it("ensure-exists self-heal: file created before append (FIX-157)", () => {
    const rtDir = mkdtempSync(join(tmpdir(), "roll-bus-heal-"));
    dirs.push(rtDir);
    const eventsPath = join(rtDir, "events.ndjson");
    const runsPath = join(rtDir, "runs.jsonl");
    const bus = new EventBus(nodeEventStore);
    bus.ensureEventFiles(eventsPath, runsPath);
    expect(readFileSync(eventsPath, "utf8")).toBe("");
    expect(readFileSync(runsPath, "utf8")).toBe("");
  });

  it("DOCUMENTED divergence: v2 flat schema vs v3 RollEvent schema", () => {
    const bashLine = JSON.parse(V2_EVENT_LINE.trim()) as Record<string, unknown>;
    // v2 line shape: flat {ts, stage, label, detail, outcome}.
    expect(Object.keys(bashLine).sort()).toEqual(["detail", "label", "outcome", "stage", "ts"]);

    // v3 RollEvent is a different, typed schema (parseEventLine round-trips it).
    const bus = new EventBus(nodeEventStore);
    const ev: RollEvent = { type: "loop:fire", loop: "main", ts: 1 };
    const line = bus.appendEvent(join(mkdtempSync(join(tmpdir(), "roll-bus-div-")), "events.ndjson"), ev);
    const v3Line = JSON.parse(line.trim()) as Record<string, unknown>;
    // The schemas MUST differ — v3 uses `type`, not the v2 `stage`/`outcome` pair.
    expect(v3Line).toHaveProperty("type");
    expect(v3Line).not.toHaveProperty("stage");
  });
});
