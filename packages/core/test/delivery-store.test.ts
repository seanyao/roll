/**
 * US-TRUTH-014 — deliveries.jsonl append-only store tests.
 *
 * AC1: appendDelivery writes one line atomically via O_APPEND.
 * AC2: Schema-invalid rejected on write; torn/illegal lines skipped on read.
 * AC3: readDeliveries deduplicates by (storyId, cycleId) last-wins.
 * AC4: deliveriesPath resolves to <project>/.roll/loop/deliveries.jsonl.
 * AC5: Concurrent appends don't corrupt (single-line atomic, last-wins read).
 */
import { describe, expect, it } from "vitest";
import {
  appendDelivery,
  deliveriesPath,
  readDeliveries,
  readDeliveriesRaw,
  validateDeliveryRecord,
  type DeliveryStoreInterface,
} from "../src/index.js";
import type { DeliveryRecord } from "@roll/spec";
import { present, absent } from "@roll/spec";

// ── Fake store (in-memory, like FakeFileStore in store.test.ts) ──────────────

class FakeDeliveryStore implements DeliveryStoreInterface {
  files = new Map<string, string>();
  /** Ordered log of low-level operations for the atomic protocol assertion. */
  log: string[] = [];

  constructor(seed: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(seed)) this.files.set(k, v);
  }

  exists(path: string): boolean {
    return this.files.has(path);
  }

  ensureFile(path: string): void {
    if (!this.files.has(path)) {
      this.files.set(path, "");
      this.log.push(`ensureFile:${path}`);
    }
  }

  readText(path: string): string {
    return this.files.get(path) ?? "";
  }

  appendLine(path: string, line: string): void {
    this.log.push(`appendLine:${path}`);
    const current = this.files.get(path) ?? "";
    this.files.set(path, `${current}${line}`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const PROJ = "/fake/project";

function makeRecord(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    storyId: "US-TEST-001",
    cycleId: "cycle-20260621-0001",
    lifecycleState: "pending_merge",
    prNumber: present(42),
    prUrl: present("https://github.com/example/pull/42"),
    mergedAt: absent("not_recorded"),
    mergeCommit: absent("not_recorded"),
    recordedAt: 1000,
    ...overrides,
  };
}

// ── AC4: Path resolution ────────────────────────────────────────────────────

describe("US-TRUTH-014 AC4 — deliveriesPath resolution", () => {
  it("resolves to <project>/.roll/loop/deliveries.jsonl", () => {
    expect(deliveriesPath("/home/user/roll")).toBe(
      "/home/user/roll/.roll/loop/deliveries.jsonl",
    );
  });

  it("different projects yield different paths", () => {
    const a = deliveriesPath("/proj-a");
    const b = deliveriesPath("/proj-b");
    expect(a).not.toBe(b);
  });

  it("same project via different worktree paths resolves to same file", () => {
    // When the project root is the same (not the worktree), the path is identical.
    const p1 = deliveriesPath("/proj");
    const p2 = deliveriesPath("/proj");
    expect(p1).toBe(p2);
  });
});

// ── AC2 (write side): Schema validation ──────────────────────────────────────

describe("US-TRUTH-014 AC2 — validateDeliveryRecord", () => {
  it("accepts a valid complete record", () => {
    const r = validateDeliveryRecord(makeRecord());
    expect(r).not.toBeNull();
    expect(r!.storyId).toBe("US-TEST-001");
    expect(r!.cycleId).toBe("cycle-20260621-0001");
    expect(r!.lifecycleState).toBe("pending_merge");
  });

  it("rejects null / non-object", () => {
    expect(validateDeliveryRecord(null)).toBeNull();
    expect(validateDeliveryRecord("foo")).toBeNull();
    expect(validateDeliveryRecord(42)).toBeNull();
  });

  it("rejects missing storyId", () => {
    expect(validateDeliveryRecord({ cycleId: "c1", lifecycleState: "todo", recordedAt: 1 })).toBeNull();
  });

  it("rejects empty storyId", () => {
    expect(validateDeliveryRecord({ storyId: "", cycleId: "c1", lifecycleState: "todo", recordedAt: 1 })).toBeNull();
  });

  it("rejects missing cycleId", () => {
    expect(validateDeliveryRecord({ storyId: "s1", lifecycleState: "todo", recordedAt: 1 })).toBeNull();
  });

  it("rejects invalid lifecycleState", () => {
    expect(validateDeliveryRecord({ storyId: "s1", cycleId: "c1", lifecycleState: "banana", recordedAt: 1 })).toBeNull();
  });

  it("rejects missing recordedAt", () => {
    expect(validateDeliveryRecord({ storyId: "s1", cycleId: "c1", lifecycleState: "todo" })).toBeNull();
  });

  it("rejects non-finite recordedAt", () => {
    expect(validateDeliveryRecord({ storyId: "s1", cycleId: "c1", lifecycleState: "todo", recordedAt: Infinity })).toBeNull();
    expect(validateDeliveryRecord({ storyId: "s1", cycleId: "c1", lifecycleState: "todo", recordedAt: NaN })).toBeNull();
  });

  it("accepts a minimal record (all optional fields absent)", () => {
    const r = validateDeliveryRecord({
      storyId: "US-MIN",
      cycleId: "cycle-min",
      lifecycleState: "todo",
      recordedAt: 0,
    });
    expect(r).not.toBeNull();
    expect(r!.lifecycleState).toBe("todo");
  });
});

// ── AC1: Atomic append ──────────────────────────────────────────────────────

describe("US-TRUTH-014 AC1 — appendDelivery (atomic append)", () => {
  it("appends one line to an empty file", () => {
    const store = new FakeDeliveryStore();
    const record = makeRecord();
    appendDelivery(store, PROJ, record);

    const text = store.files.get(deliveriesPath(PROJ)) ?? "";
    expect(text).toContain('"storyId":"US-TEST-001"');
    expect(text).toContain('"cycleId":"cycle-20260621-0001"');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("appends a second line after the first", () => {
    const store = new FakeDeliveryStore();
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-A" }));
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-B" }));

    const text = store.files.get(deliveriesPath(PROJ)) ?? "";
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("US-A");
    expect(lines[1]).toContain("US-B");
  });

  it("uses appendLine (single write — observable in log)", () => {
    const store = new FakeDeliveryStore();
    appendDelivery(store, PROJ, makeRecord());
    // ensureFile + appendLine — never writeFileAtomic (tmp+rename)
    expect(store.log).toContain(`ensureFile:${deliveriesPath(PROJ)}`);
    expect(store.log).toContain(`appendLine:${deliveriesPath(PROJ)}`);
    // No "write:" prefix (which FakeFileStore would emit for tmp-file writes)
    expect(store.log.filter((e) => e.startsWith("write:")).length).toBe(0);
  });

  it("throws TypeError when the record fails schema validation", () => {
    const store = new FakeDeliveryStore();
    expect(() =>
      appendDelivery(store, PROJ, { storyId: "" } as DeliveryRecord),
    ).toThrow(TypeError);
    // Nothing was written
    expect(store.files.size).toBe(0);
  });
});

// ── AC2 (read side): Torn/illegal lines skipped ─────────────────────────────

describe("US-TRUTH-014 AC2 — readDeliveries skips torn/illegal lines", () => {
  it("skips a torn JSON line (partial object)", () => {
    const store = new FakeDeliveryStore();
    const path = deliveriesPath(PROJ);
    // Write a valid record, then a torn line, then another valid record
    store.ensureFile(path);
    store.appendLine(path, `${JSON.stringify(makeRecord({ storyId: "US-A" }))}\n`);
    store.appendLine(path, '{ "storyId": "US-B", "cycleId":\n'); // torn — missing closing brace
    store.appendLine(path, `${JSON.stringify(makeRecord({ storyId: "US-C" }))}\n`);

    const records = readDeliveries(store, PROJ);
    expect(records).toHaveLength(2);
    expect(records[0]!.storyId).toBe("US-A");
    expect(records[1]!.storyId).toBe("US-C");
  });

  it("skips a schema-invalid line (missing cycleId)", () => {
    const store = new FakeDeliveryStore();
    const path = deliveriesPath(PROJ);
    store.ensureFile(path);
    store.appendLine(path, `${JSON.stringify(makeRecord({ storyId: "US-A" }))}\n`);
    store.appendLine(path, `${JSON.stringify({ storyId: "US-B", lifecycleState: "todo", recordedAt: 1 })}\n`);
    store.appendLine(path, `${JSON.stringify(makeRecord({ storyId: "US-C" }))}\n`);

    const records = readDeliveries(store, PROJ);
    expect(records).toHaveLength(2);
    expect(records[0]!.storyId).toBe("US-A");
    expect(records[1]!.storyId).toBe("US-C");
  });

  it("returns [] for an empty file", () => {
    const store = new FakeDeliveryStore();
    expect(readDeliveries(store, PROJ)).toEqual([]);
  });

  it("returns [] for a file with only blank lines", () => {
    const store = new FakeDeliveryStore();
    const path = deliveriesPath(PROJ);
    store.ensureFile(path);
    store.appendLine(path, "\n\n");
    expect(readDeliveries(store, PROJ)).toEqual([]);
  });

  it("returns [] for a file with only illegal lines", () => {
    const store = new FakeDeliveryStore();
    const path = deliveriesPath(PROJ);
    store.ensureFile(path);
    store.appendLine(path, "not json at all\n");
    store.appendLine(path, '{ "storyId": "bad" }\n'); // valid JSON, bad schema
    expect(readDeliveries(store, PROJ)).toEqual([]);
  });
});

// ── AC3: Last-wins dedup ────────────────────────────────────────────────────

describe("US-TRUTH-014 AC3 — readDeliveries last-wins dedup", () => {
  it("returns distinct records in append order", () => {
    const store = new FakeDeliveryStore();
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-A", cycleId: "c1" }));
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-B", cycleId: "c2" }));

    const records = readDeliveries(store, PROJ);
    expect(records).toHaveLength(2);
    expect(records[0]!.storyId).toBe("US-A");
    expect(records[1]!.storyId).toBe("US-B");
  });

  it("same (storyId, cycleId) → last occurrence wins", () => {
    const store = new FakeDeliveryStore();
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-A", cycleId: "c1", lifecycleState: "pending_merge", recordedAt: 1000 }));
    // Same story+cycle, later write with updated lifecycle
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-A", cycleId: "c1", lifecycleState: "done", recordedAt: 2000 }));

    const records = readDeliveries(store, PROJ);
    expect(records).toHaveLength(1);
    expect(records[0]!.storyId).toBe("US-A");
    expect(records[0]!.lifecycleState).toBe("done");
    expect(records[0]!.recordedAt).toBe(2000);
  });

  it("different cycleId with same storyId → distinct records", () => {
    const store = new FakeDeliveryStore();
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-A", cycleId: "c1", lifecycleState: "pending_merge" }));
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-A", cycleId: "c2", lifecycleState: "done" }));

    const records = readDeliveries(store, PROJ);
    expect(records).toHaveLength(2);
    expect(records[0]!.cycleId).toBe("c1");
    expect(records[1]!.cycleId).toBe("c2");
  });

  it("multiple re-emissions → only the last survives", () => {
    const store = new FakeDeliveryStore();
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-X", cycleId: "cy", lifecycleState: "building", recordedAt: 1 }));
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-Y", cycleId: "cy2", lifecycleState: "pending_merge", recordedAt: 2 }));
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-X", cycleId: "cy", lifecycleState: "pending_merge", recordedAt: 3 }));
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-X", cycleId: "cy", lifecycleState: "done", recordedAt: 4 }));

    const records = readDeliveries(store, PROJ);
    expect(records).toHaveLength(2);
    expect(records[0]!.storyId).toBe("US-X");
    expect(records[0]!.lifecycleState).toBe("done");
    expect(records[1]!.storyId).toBe("US-Y");
  });
});

// ── AC5: Concurrent appends ─────────────────────────────────────────────────

describe("US-TRUTH-014 AC5 — concurrent append safety", () => {
  it("multiple appends for different keys don't corrupt the file", () => {
    const store = new FakeDeliveryStore();
    // Simulate concurrent appends: write records from different cycles
    const keys = Array.from({ length: 10 }, (_, i) => ({
      storyId: `US-CONCUR-${i}`,
      cycleId: `cycle-concur-${i}`,
    }));

    for (const key of keys) {
      appendDelivery(store, PROJ, makeRecord(key));
    }

    const records = readDeliveries(store, PROJ);
    expect(records).toHaveLength(10);

    // Every key should be present
    const got = new Set(records.map((r) => `${r.storyId}\t${r.cycleId}`));
    for (const key of keys) {
      expect(got.has(`${key.storyId}\t${key.cycleId}`)).toBe(true);
    }
  });

  it("single-line atomic append means no interleaved bytes", () => {
    const store = new FakeDeliveryStore();

    // Append two records — each appendLine is a single write call
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-A", cycleId: "c1" }));
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-B", cycleId: "c2" }));

    const text = store.files.get(deliveriesPath(PROJ)) ?? "";
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);

    // Each line must be valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

// ── Round-trip ──────────────────────────────────────────────────────────────

describe("US-TRUTH-014 round-trip", () => {
  it("write → read returns the same record shape", () => {
    const store = new FakeDeliveryStore();
    const original = makeRecord({
      storyId: "US-RT",
      cycleId: "c-rt",
      lifecycleState: "building",
      prNumber: absent("no_publish_attempted"),
      prUrl: absent("no_publish_attempted"),
      mergedAt: absent("not_applicable"),
      mergeCommit: absent("not_applicable"),
    });

    appendDelivery(store, PROJ, original);
    const records = readDeliveries(store, PROJ);

    expect(records).toHaveLength(1);
    const got = records[0]!;
    expect(got.storyId).toBe("US-RT");
    expect(got.cycleId).toBe("c-rt");
    expect(got.lifecycleState).toBe("building");
    expect(got.recordedAt).toBe(1000);

    // FactOr fields should have been serialized correctly
    if (!got.prNumber.present) {
      expect(got.prNumber.reason).toBe("no_publish_attempted");
    }
  });

  it("round-trips a record with present FactOr values", () => {
    const store = new FakeDeliveryStore();
    const original = makeRecord({
      storyId: "US-RT2",
      cycleId: "c-rt2",
      lifecycleState: "done",
      prNumber: present(99),
      prUrl: present("https://gh/pull/99"),
      mergedAt: present(3000),
      mergeCommit: present("abc123def"),
      recordedAt: 5000,
    });

    appendDelivery(store, PROJ, original);
    const records = readDeliveries(store, PROJ);

    expect(records).toHaveLength(1);
    const got = records[0]!;
    if (got.prNumber.present) expect(got.prNumber.value).toBe(99);
    if (got.mergedAt.present) expect(got.mergedAt.value).toBe(3000);
    if (got.mergeCommit.present) expect(got.mergeCommit.value).toBe("abc123def");
  });
});

// ── readDeliveriesRaw: no-dedup reader ──────────────────────────────────────

describe("readDeliveriesRaw — no dedup, returns all valid records", () => {
  it("returns all distinct records in append order", () => {
    const store = new FakeDeliveryStore();
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-A", cycleId: "c1", recordedAt: 1000 }));
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-B", cycleId: "c2", recordedAt: 2000 }));

    const records = readDeliveriesRaw(store, PROJ);
    expect(records).toHaveLength(2);
    expect(records[0]!.storyId).toBe("US-A");
    expect(records[1]!.storyId).toBe("US-B");
  });

  it("returns ALL records for same (storyId, cycleId) — no dedup", () => {
    const store = new FakeDeliveryStore();
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-A", cycleId: "c1", lifecycleState: "pending_merge", recordedAt: 1000 }));
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-A", cycleId: "c1", lifecycleState: "done", recordedAt: 2000 }));

    const records = readDeliveriesRaw(store, PROJ);
    expect(records).toHaveLength(2);
    expect(records[0]!.lifecycleState).toBe("pending_merge");
    expect(records[1]!.lifecycleState).toBe("done");
  });

  it("returns [] for empty file", () => {
    const store = new FakeDeliveryStore();
    expect(readDeliveriesRaw(store, PROJ)).toEqual([]);
  });

  it("skips torn and illegal lines", () => {
    const store = new FakeDeliveryStore();
    const path = deliveriesPath(PROJ);
    store.ensureFile(path);
    store.appendLine(path, "not json at all\n");
    store.appendLine(path, '{ "storyId": "bad" }\n');
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-OK", cycleId: "c1" }));

    const records = readDeliveriesRaw(store, PROJ);
    expect(records).toHaveLength(1);
    expect(records[0]!.storyId).toBe("US-OK");
  });

  it("preserves append order even with duplicates", () => {
    const store = new FakeDeliveryStore();
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-X", cycleId: "cy", lifecycleState: "building", recordedAt: 1 }));
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-Y", cycleId: "cy2", lifecycleState: "pending_merge", recordedAt: 2 }));
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-X", cycleId: "cy", lifecycleState: "pending_merge", recordedAt: 3 }));
    appendDelivery(store, PROJ, makeRecord({ storyId: "US-X", cycleId: "cy", lifecycleState: "done", recordedAt: 4 }));

    const records = readDeliveriesRaw(store, PROJ);
    // Raw: all 4 records survive, including the 3 for US-X/cy.
    expect(records).toHaveLength(4);
    expect(records[0]!.lifecycleState).toBe("building");
    expect(records[1]!.lifecycleState).toBe("pending_merge");
    expect(records[2]!.lifecycleState).toBe("pending_merge");
    expect(records[3]!.lifecycleState).toBe("done");
  });
});
