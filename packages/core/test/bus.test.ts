/**
 * Unit tests for the EventBus write side (US-CORE-009) using an in-memory
 * EventStore fake: append discipline (single line, file ensured first),
 * runs.jsonl upsert dedupe by (storyId+cycleId), ensureEventFiles self-heal,
 * and the rotation-awareness helpers.
 */
import type { RollEvent } from "@roll/spec";
import { absent, present } from "@roll/spec";
import { describe, expect, it } from "vitest";
import {
  EVENTS_FILE,
  EventBus,
  type EventStore,
  ROTATE_LIMIT_BYTES,
  RUNS_FILE,
  rotationNeeded,
  rotationPlan,
  serializeEvent,
} from "../src/index.js";

/** In-memory EventStore recording every operation. */
function fakeStore(): EventStore & { files: Map<string, string>; appendCalls: number } {
  const files = new Map<string, string>();
  return {
    files,
    appendCalls: 0,
    exists(p: string) {
      return files.has(p);
    },
    ensureFile(p: string) {
      if (!files.has(p)) files.set(p, "");
    },
    readText(p: string) {
      return files.get(p) ?? "";
    },
    appendLine(p: string, line: string) {
      this.appendCalls += 1;
      files.set(p, (files.get(p) ?? "") + line);
    },
    writeText(p: string, data: string) {
      files.set(p, data);
    },
    size(p: string) {
      return Buffer.byteLength(files.get(p) ?? "", "utf8");
    },
  };
}

const EVENTS = "/proj/.roll/loop/events.ndjson";
const RUNS = "/proj/.roll/loop/runs.jsonl";

describe("appendEvent", () => {
  it("ensures the file then appends exactly one newline-terminated line", () => {
    const store = fakeStore();
    const bus = new EventBus(store);
    const ev: RollEvent = { type: "loop:fire", loop: "main", ts: 1000 };
    const line = bus.appendEvent(EVENTS, ev);
    expect(store.appendCalls).toBe(1);
    expect(line).toBe('{"type":"loop:fire","loop":"main","ts":1000000}\n');
    expect(store.readText(EVENTS)).toBe(line);
  });

  it("round-trips through readEvents, skipping bad lines (I8)", () => {
    const store = fakeStore();
    const bus = new EventBus(store);
    bus.appendEvent(EVENTS, { type: "loop:fire", loop: "main", ts: 1 });
    store.appendLine(EVENTS, "{ not json\n");
    store.appendLine(EVENTS, "\n");
    bus.appendEvent(EVENTS, { type: "loop:idle", loop: "main", nextFire: 5, ts: 2 });
    const evs = bus.readEvents(EVENTS);
    expect(evs.map((e) => e.type)).toEqual(["loop:fire", "loop:idle"]);
  });

  it("FIX-352: normalizes terminal timestamp fields at the write boundary", () => {
    const store = fakeStore();
    const bus = new EventBus(store);
    const ev: RollEvent = {
      type: "cycle:terminal",
      schema: 1,
      cycleId: "c1",
      storyId: "FIX-352",
      agent: "codex",
      model: "gpt",
      startedAt: 1_780_000_000,
      endedAt: 1_780_000_100,
      outcome: "failed",
      pr: absent("no_publish_attempted"),
      branch: present("loop/c"),
      commit: absent("not_recorded"),
      tcr: present(1),
      attest: absent("not_rendered"),
      usage: absent("no_parseable_usage"),
      cost: absent("no_parseable_usage"),
      ts: 1_780_000_100,
    };
    const line = bus.appendEvent(EVENTS, ev);
    expect(JSON.parse(line)).toMatchObject({
      startedAt: 1_780_000_000_000,
      endedAt: 1_780_000_100_000,
      ts: 1_780_000_100_000,
    });
  });
});

describe("ensureEventFiles", () => {
  it("creates both runtime files (FIX-157 self-heal), idempotent", () => {
    const store = fakeStore();
    const bus = new EventBus(store);
    bus.ensureEventFiles(EVENTS, RUNS);
    expect(store.exists(EVENTS)).toBe(true);
    expect(store.exists(RUNS)).toBe(true);
    store.appendLine(EVENTS, "x\n");
    bus.ensureEventFiles(EVENTS, RUNS); // must not clobber
    expect(store.readText(EVENTS)).toBe("x\n");
  });
});

describe("upsertRun dedupe by (storyId + cycleId)", () => {
  it("new key → appended", () => {
    const store = fakeStore();
    const bus = new EventBus(store);
    const r = bus.upsertRun(RUNS, { storyId: "US-1", cycleId: "cyc-a" }, { status: "built" });
    expect(r).toBe("appended");
    expect(bus.readRuns(RUNS)).toHaveLength(1);
  });

  it("same story+cycle → updated in place (no duplicate row)", () => {
    const store = fakeStore();
    const bus = new EventBus(store);
    bus.upsertRun(RUNS, { storyId: "US-1", cycleId: "cyc-a" }, { status: "built" });
    const r = bus.upsertRun(RUNS, { storyId: "US-1", cycleId: "cyc-a" }, { status: "delivered" });
    expect(r).toBe("updated");
    const rows = bus.readRuns(RUNS);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["status"]).toBe("delivered");
    expect(rows[0]?.["story_id"]).toBe("US-1");
    expect(rows[0]?.["cycle_id"]).toBe("cyc-a");
  });

  it("distinct cycle of same story → appended (new row)", () => {
    const store = fakeStore();
    const bus = new EventBus(store);
    bus.upsertRun(RUNS, { storyId: "US-1", cycleId: "cyc-a" }, { status: "built" });
    const r = bus.upsertRun(RUNS, { storyId: "US-1", cycleId: "cyc-b" }, { status: "built" });
    expect(r).toBe("appended");
    expect(bus.readRuns(RUNS)).toHaveLength(2);
  });

  it("matches rows that carry routed_story/cycleId field aliases", () => {
    const store = fakeStore();
    const bus = new EventBus(store);
    // seed a row in the bash-ish shape using routed_story.
    store.writeText(RUNS, `${JSON.stringify({ routed_story: "US-9", cycle_id: "z", status: "x" })}\n`);
    const r = bus.upsertRun(RUNS, { storyId: "US-9", cycleId: "z" }, { status: "done" });
    expect(r).toBe("updated");
    expect(bus.readRuns(RUNS)).toHaveLength(1);
  });
});

describe("rotation awareness", () => {
  it("rotationNeeded at >10 MiB", () => {
    expect(rotationNeeded(ROTATE_LIMIT_BYTES)).toBe(false);
    expect(rotationNeeded(ROTATE_LIMIT_BYTES + 1)).toBe(true);
  });

  it("rotationPlan mirrors _loop_event_rotate (.4 rm; .3→.4 …; cur→.1; recreate)", () => {
    const plan = rotationPlan("/x/events.ndjson");
    expect(plan).toEqual([
      { op: "remove", path: "/x/events.ndjson.4" },
      { op: "rename", from: "/x/events.ndjson.3", to: "/x/events.ndjson.4" },
      { op: "rename", from: "/x/events.ndjson.2", to: "/x/events.ndjson.3" },
      { op: "rename", from: "/x/events.ndjson.1", to: "/x/events.ndjson.2" },
      { op: "rename", from: "/x/events.ndjson", to: "/x/events.ndjson.1" },
      { op: "create", path: "/x/events.ndjson" },
    ]);
  });

  it("serializeEvent + file-name constants", () => {
    expect(serializeEvent({ type: "loop:fire", loop: "main", ts: 1 })).toBe(
      '{"type":"loop:fire","loop":"main","ts":1000}\n',
    );
    expect(EVENTS_FILE).toBe("events.ndjson");
    expect(RUNS_FILE).toBe("runs.jsonl");
  });
});
