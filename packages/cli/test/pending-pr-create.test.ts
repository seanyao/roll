/**
 * FIX-1214 — pending-pr-create queue + PR-loop retry tests.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { GhResult } from "@roll/infra";
import {
  addPendingPrCreate,
  openPendingPrCreates,
  pendingPrCreatePath,
  readPendingPrCreates,
  removePendingPrCreate,
  type PendingPrCreateDeps,
  type PendingPrCreateEntry,
} from "../src/runner/pending-pr-create.js";

function makeDirs() {
  const root = mkdtempSync(join(tmpdir(), "roll-pending-pr-"));
  const runtimeDir = join(root, ".roll", "loop");
  const projectCwd = root;
  mkdirSync(runtimeDir, { recursive: true });
  return { root, runtimeDir, projectCwd };
}

function entry(overrides: Partial<PendingPrCreateEntry> = {}): PendingPrCreateEntry {
  return {
    storyId: "FIX-1214",
    cycleId: "c1",
    branch: "loop/cycle-1214",
    slug: "o/r",
    body: "body",
    draft: false,
    manualMerge: false,
    createdAt: 1,
    ...overrides,
  };
}

function deps(runtimeDir: string, projectCwd: string, ghResults: GhResult[]): PendingPrCreateDeps {
  let i = 0;
  return {
    gh: async () => ghResults[i++] ?? { code: 1, stdout: "", stderr: "no more scripted results" },
    nowMs: () => 1234,
    runtimeDir,
    projectCwd,
    alert: () => {},
    info: () => {},
  };
}

describe("pending-pr-create queue", () => {
  it("reads an empty queue when the file is missing", () => {
    const { runtimeDir } = makeDirs();
    expect(readPendingPrCreates(runtimeDir)).toEqual([]);
  });

  it("adds, deduplicates by branch, and removes entries", () => {
    const { runtimeDir } = makeDirs();
    addPendingPrCreate(runtimeDir, entry());
    addPendingPrCreate(runtimeDir, entry({ branch: "loop/other" }));
    addPendingPrCreate(runtimeDir, entry({ body: "updated body" }));
    const queued = readPendingPrCreates(runtimeDir);
    expect(queued).toHaveLength(2);
    expect(queued.find((e) => e.branch === "loop/cycle-1214")?.body).toBe("updated body");
    removePendingPrCreate(runtimeDir, "loop/other");
    expect(readPendingPrCreates(runtimeDir).map((e) => e.branch)).toEqual(["loop/cycle-1214"]);
  });
});

describe("openPendingPrCreates", () => {
  it("opens a deferred PR, emits pr:open, writes DeliveryRecord, and removes the queue entry", async () => {
    const { runtimeDir, projectCwd } = makeDirs();
    addPendingPrCreate(runtimeDir, entry());
    const d = deps(runtimeDir, projectCwd, [
      { code: 0, stdout: "https://github.com/o/r/pull/42\n", stderr: "" },
    ]);
    const ghCalls: string[][] = [];
    d.gh = async (args) => {
      ghCalls.push([...args]);
      return { code: 0, stdout: "https://github.com/o/r/pull/42\n", stderr: "" };
    };

    await openPendingPrCreates(d, "o/r", new Set());

    expect(ghCalls).toHaveLength(1);
    expect(ghCalls[0]).toContain("pr");
    expect(ghCalls[0]).toContain("create");
    expect(ghCalls[0]).toContain("loop/cycle-1214");

    const events = readFileSync(join(runtimeDir, "events.ndjson"), "utf8").trim().split("\n");
    expect(JSON.parse(events[0] ?? "{}")).toEqual({
      type: "pr:open",
      prNumber: 42,
      storyId: "FIX-1214",
      ts: 1234,
    });

    const deliveries = readFileSync(join(projectCwd, ".roll", "loop", "deliveries.jsonl"), "utf8").trim().split("\n");
    const record = JSON.parse(deliveries[0] ?? "{}") as { lifecycleState: string; prNumber: unknown; prUrl: unknown };
    expect(record.lifecycleState).toBe("pending_merge");
    expect(record.prNumber).toEqual({ present: true, value: 42 });
    expect(record.prUrl).toEqual({ present: true, value: "https://github.com/o/r/pull/42" });

    expect(readPendingPrCreates(runtimeDir)).toEqual([]);
  });

  it("US-DELIV-001: a deferred PR open ALSO emits delivery:published (same awaiting_merge fact as the happy path)", async () => {
    const { runtimeDir, projectCwd } = makeDirs();
    addPendingPrCreate(runtimeDir, entry());
    const d = deps(runtimeDir, projectCwd, [
      { code: 0, stdout: "https://github.com/o/r/pull/42\n", stderr: "" },
    ]);

    await openPendingPrCreates(d, "o/r", new Set());

    const events = readFileSync(join(runtimeDir, "events.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { type: string });
    const published = events.filter((e) => e.type === "delivery:published");
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: "delivery:published",
      cycleId: "c1",
      storyId: "FIX-1214",
      branch: "loop/cycle-1214",
      prNumber: 42,
      prUrl: "https://github.com/o/r/pull/42",
      ts: 1234,
    });
  });

  it("skips branches that already have an open PR and cleans the stale queue entry", async () => {
    const { runtimeDir, projectCwd } = makeDirs();
    addPendingPrCreate(runtimeDir, entry());
    const d = deps(runtimeDir, projectCwd, []);
    await openPendingPrCreates(d, "o/r", new Set(["loop/cycle-1214"]));
    expect(readPendingPrCreates(runtimeDir)).toEqual([]);
  });

  it("leaves the entry in the queue when gh create fails", async () => {
    const { runtimeDir, projectCwd } = makeDirs();
    addPendingPrCreate(runtimeDir, entry());
    const d = deps(runtimeDir, projectCwd, [{ code: 1, stdout: "", stderr: "EOF" }]);
    await openPendingPrCreates(d, "o/r", new Set());
    expect(readPendingPrCreates(runtimeDir)).toHaveLength(1);
  });

  it("ignores entries for a different slug", async () => {
    const { runtimeDir, projectCwd } = makeDirs();
    addPendingPrCreate(runtimeDir, entry({ slug: "other/repo" }));
    const d = deps(runtimeDir, projectCwd, []);
    await openPendingPrCreates(d, "o/r", new Set());
    expect(readPendingPrCreates(runtimeDir)).toHaveLength(1);
  });

  it("passes --draft for draft entries", async () => {
    const { runtimeDir, projectCwd } = makeDirs();
    addPendingPrCreate(runtimeDir, entry({ draft: true }));
    const d = deps(runtimeDir, projectCwd, []);
    const ghCalls: string[][] = [];
    d.gh = async (args) => {
      ghCalls.push([...args]);
      return { code: 0, stdout: "https://github.com/o/r/pull/7\n", stderr: "" };
    };
    await openPendingPrCreates(d, "o/r", new Set());
    expect(ghCalls[0]).toContain("--draft");
  });
});
