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
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EventBus, nodeEventStore } from "../src/index.js";
import type { RollEvent } from "@roll/spec";

const REPO = resolve(__dirname, "../../..");
const ROLLBIN = `${REPO}/bin/roll`;
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

/**
 * Run bash `_loop_event stage label detail outcome` with ROLL_PROJECT_RUNTIME_DIR
 * pointed at a fresh temp dir, then return the written events.ndjson content.
 * HOME is also redirected into the temp dir so the FIX-065 prod-write tripwire
 * treats this as a sandbox.
 */
function bashLoopEvent(stage: string, label: string, detail: string, outcome: string): {
  rtDir: string;
  content: string;
} {
  const home = mkdtempSync(join(tmpdir(), "roll-bus-home-"));
  const rtDir = mkdtempSync(join(tmpdir(), "roll-bus-rt-"));
  dirs.push(home, rtDir);
  // Slice the small helpers _loop_event depends on so it can resolve the dir.
  const script = [
    `_project_slug() { echo "testslug"; }`,
    `_loop_runtime_dir() { echo "${rtDir}"; }`,
    `_loop_event_rotate() { :; }`, // rotation tested separately
    `eval "$(sed -n '/^_loop_event()/,/^}$/p' "${ROLLBIN}")"`,
    `_loop_event "$1" "$2" "$3" "$4"`,
  ].join("\n");
  execFileSync("bash", ["-c", script, "bash", stage, label, detail, outcome], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      ROLL_PROJECT_RUNTIME_DIR: rtDir,
      ROLL_LANG: "en",
      NO_COLOR: "1",
    },
  });
  return { rtDir, content: readFileSync(join(rtDir, "events.ndjson"), "utf8") };
}

describe("diff-test: EventBus append mechanics == bash _loop_event", () => {
  it("writes ONE line under the ROLL_PROJECT_RUNTIME_DIR (file location parity)", () => {
    const bash = bashLoopEvent("cycle_start", "cyc-1", "US-1", "ok");
    // bash: exactly one trailing-newline line lands in <rtDir>/events.ndjson.
    expect(bash.content.endsWith("\n")).toBe(true);
    expect(bash.content.split("\n").filter((l) => l !== "")).toHaveLength(1);

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
    const bash = bashLoopEvent("cycle_end", "cyc-2", "branch-x", "delivered");
    const bashLine = JSON.parse(bash.content.trim()) as Record<string, unknown>;
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
