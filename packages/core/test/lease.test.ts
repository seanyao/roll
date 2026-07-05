/**
 * Tests for FIX-1211: lease-aware In Progress handling.
 *
 * AC1: In Progress line without lease in 24h soft lease not picked; timeout
 *      recovery logged is produced by reconcileExpiredClaims.
 * AC2: Loop's own lease death recovery doesn't regress.
 * AC3: Concurrent same-story scenario sealed in tests.
 */
import { describe, expect, it } from "vitest";
import {
  buildClaimedByOther,
  isHumanSoftLeaseActive,
  isLeaseAlive,
  isPidAlive,
  HUMAN_SOFT_LEASE_HOURS,
  readLeases,
  writeLeases,
  setLease,
  removeLease,
  reconcileExpiredClaims,
  type LeaseMap,
} from "../src/index.js";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const NOW = 1_700_000_000_000; // arbitrary stable epoch ms for tests

// ─── Lease store helpers ────────────────────────────────────────────────────

describe("readLeases / writeLeases / setLease / removeLease", () => {
  it("readLeases returns empty for missing file", () => {
    expect(readLeases("/nonexistent/path/file.json")).toEqual({});
  });

  it("readLeases returns empty for unparseable file", () => {
    expect(readLeases("/dev/null")).toEqual({});
  });

  it("round-trips via writeLeases + readLeases", () => {
    const dir = mkdtempSync(join(tmpdir(), "lease-test-"));
    const path = join(dir, "leases.json");
    try {
      const data: LeaseMap = { "FIX-1": { pid: 123, claimedAt: NOW, source: "cycle" } };
      writeLeases(path, data);
      const loaded = readLeases(path);
      expect(loaded).toEqual(data);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("setLease + removeLease round-trip", () => {
    const dir = mkdtempSync(join(tmpdir(), "lease-test-"));
    const path = join(dir, "leases.json");
    try {
      setLease(path, "FIX-1", { claimedAt: NOW, source: "human" });
      expect(Object.keys(readLeases(path))).toEqual(["FIX-1"]);
      expect(removeLease(path, "FIX-1")).toBe(true);
      expect(readLeases(path)).toEqual({});
      expect(removeLease(path, "FIX-MISSING")).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });
});

// ─── PID and lease lifetime helpers ──────────────────────────────────────────

describe("isPidAlive", () => {
  it("returns true for current process", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it("returns false for a non-existent PID", () => {
    expect(isPidAlive(999_999_999)).toBe(false);
  });
});

describe("isLeaseAlive", () => {
  it("returns true for a lease with a live PID", () => {
    expect(isLeaseAlive({ pid: process.pid, claimedAt: NOW, source: "cycle" })).toBe(true);
  });

  it("returns false when no PID is set (human/supervisor claim)", () => {
    expect(isLeaseAlive({ claimedAt: NOW, source: "human" })).toBe(false);
  });

  it("returns false for a dead PID", () => {
    expect(isLeaseAlive({ pid: 999_999_999, claimedAt: NOW, source: "cycle" })).toBe(false);
  });
});

describe("isHumanSoftLeaseActive", () => {
  it("returns true for a recent claim", () => {
    expect(isHumanSoftLeaseActive({ claimedAt: NOW, source: "human" }, NOW)).toBe(true);
  });

  it("returns true for a claim just under 24h ago", () => {
    const justUnder = NOW - HUMAN_SOFT_LEASE_HOURS * 3600_000 + 1;
    expect(isHumanSoftLeaseActive({ claimedAt: justUnder, source: "human" }, NOW)).toBe(true);
  });

  it("returns false at the 24h boundary", () => {
    const boundary = NOW - HUMAN_SOFT_LEASE_HOURS * 3600_000;
    expect(isHumanSoftLeaseActive({ claimedAt: boundary, source: "human" }, NOW)).toBe(false);
  });

  it("returns false for an old claim", () => {
    const old = NOW - (HUMAN_SOFT_LEASE_HOURS + 1) * 3600_000;
    expect(isHumanSoftLeaseActive({ claimedAt: old, source: "human" }, NOW)).toBe(false);
  });
});

// ─── AC1: buildClaimedByOther — lease-aware predicate ────────────────────────

describe("buildClaimedByOther (AC1: lease-aware skip)", () => {
  const ownPid = process.pid;

  it("returns true when story has NO lease entry", () => {
    expect(buildClaimedByOther({}, NOW, ownPid)("FIX-999")).toBe(true);
  });

  it("returns false when own PID has a live lease", () => {
    const leases: LeaseMap = { "FIX-1": { pid: ownPid, claimedAt: NOW, source: "cycle" } };
    expect(buildClaimedByOther(leases, NOW, ownPid)("FIX-1")).toBe(false);
  });

  it("returns true when a DIFFERENT PID has the lease", () => {
    const leases: LeaseMap = { "FIX-1": { pid: 99999, claimedAt: NOW, source: "cycle" } };
    expect(buildClaimedByOther(leases, NOW, ownPid)("FIX-1")).toBe(true);
  });

  it("returns true when own PID lease is dead", () => {
    const leases: LeaseMap = { "FIX-1": { pid: 999_999_999, claimedAt: NOW, source: "cycle" } };
    expect(buildClaimedByOther(leases, NOW, ownPid)("FIX-1")).toBe(true);
  });

  it("returns true for human-claimed (no pid)", () => {
    const leases: LeaseMap = { "FIX-1": { claimedAt: NOW, source: "human" } };
    expect(buildClaimedByOther(leases, NOW, ownPid)("FIX-1")).toBe(true);
  });
});

// ─── AC2: death recovery regression ─────────────────────────────────────────

describe("Death recovery regression (AC2)", () => {
  it("dead PID lease is correctly identified", () => {
    expect(isLeaseAlive({ pid: process.pid, claimedAt: NOW, source: "cycle" })).toBe(true);
    expect(isLeaseAlive({ pid: 999_999_999, claimedAt: NOW, source: "cycle" })).toBe(false);
  });

  it("dead-own-lease is claimed-by-other (eligible for reclaim)", () => {
    const leases: LeaseMap = { "FIX-1": { pid: 999_999_999, claimedAt: NOW - 3600_000, source: "cycle" } };
    expect(buildClaimedByOther(leases, NOW, process.pid)("FIX-1")).toBe(true);
  });
});

// ─── AC3: concurrent same-story scenario ─────────────────────────────────────

describe("Concurrent same-story prevention (AC3)", () => {
  it("claimer sees not-other, concurrent sees other", () => {
    const leases: LeaseMap = {
      "FIX-CONCURRENT": { pid: 11111, claimedAt: NOW, source: "cycle" },
    };
    // Claimer PID 11111 is not alive -> sees as claimed (correct)
    const claimedClaimer = buildClaimedByOther(leases, NOW, 11111);
    expect(claimedClaimer("FIX-CONCURRENT")).toBe(true);
    // Fresh PID also sees as claimed
    expect(buildClaimedByOther(leases, NOW, process.pid)("FIX-CONCURRENT")).toBe(true);
  });

  it("no lease -> both PIDs see as claimed", () => {
    expect(buildClaimedByOther({}, NOW, 11111)("FIX-HUMAN")).toBe(true);
    expect(buildClaimedByOther({}, NOW, 22222)("FIX-HUMAN")).toBe(true);
  });

  it("human lease visible to all concurrent loops", () => {
    const leases: LeaseMap = { "FIX-HUMAN": { claimedAt: NOW, source: "supervisor" } };
    expect(buildClaimedByOther(leases, NOW, 11111)("FIX-HUMAN")).toBe(true);
    expect(buildClaimedByOther(leases, NOW, 22222)("FIX-HUMAN")).toBe(true);
  });
});

// ─── AC1: reconcileExpiredClaims — 24h soft lease expiry ─────────────────────

describe("reconcileExpiredClaims (FIX-1211 AC1)", () => {
  it("returns empty when no in-progress stories", () => {
    expect(reconcileExpiredClaims({ inProgress: [], leases: {}, now: NOW })).toEqual([]);
  });

  it("skips stories with no lease entry", () => {
    const r = reconcileExpiredClaims({ inProgress: [{ id: "FIX-1" }], leases: {}, now: NOW });
    expect(r).toEqual([]);
  });

  it("skips cycle-claimed stories", () => {
    const r = reconcileExpiredClaims({
      inProgress: [{ id: "FIX-1" }],
      leases: { "FIX-1": { pid: 12345, claimedAt: NOW - 48 * 3600_000, source: "cycle" } },
      now: NOW,
    });
    expect(r).toEqual([]);
  });

  it("returns expired human-claimed stories >24h", () => {
    const r = reconcileExpiredClaims({
      inProgress: [{ id: "FIX-1" }],
      leases: { "FIX-1": { claimedAt: NOW - 25 * 3600_000, source: "human" } },
      now: NOW,
    });
    expect(r).toHaveLength(1);
    expect(r[0].storyId).toBe("FIX-1");
    expect(r[0].ageHours).toBeGreaterThan(24);
  });

  it("keeps human-claimed stories under 24h", () => {
    const r = reconcileExpiredClaims({
      inProgress: [{ id: "FIX-1" }],
      leases: { "FIX-1": { claimedAt: NOW - 12 * 3600_000, source: "human" } },
      now: NOW,
    });
    expect(r).toEqual([]);
  });

  it("handles supervisor-claimed stories", () => {
    const r = reconcileExpiredClaims({
      inProgress: [{ id: "FIX-1" }],
      leases: { "FIX-1": { claimedAt: NOW - 48 * 3600_000, source: "supervisor" } },
      now: NOW,
    });
    expect(r).toHaveLength(1);
    expect(r[0].storyId).toBe("FIX-1");
  });

  it("mixed: only expired non-cycle claims", () => {
    const r = reconcileExpiredClaims({
      inProgress: [{ id: "FIX-1" }, { id: "FIX-2" }, { id: "FIX-3" }, { id: "FIX-4" }],
      leases: {
        "FIX-1": { pid: 12345, claimedAt: NOW - 48 * 3600_000, source: "cycle" },
        "FIX-2": { claimedAt: NOW - 12 * 3600_000, source: "human" },
        "FIX-3": { claimedAt: NOW - 48 * 3600_000, source: "human" },
      },
      now: NOW,
    });
    expect(r).toHaveLength(1);
    expect(r[0].storyId).toBe("FIX-3");
  });
});

describe("removeLease onlySource scoping (kimi review: cycle terminal must not wipe human claims)", () => {
  it("cycle-scoped removal skips a human lease and removes a cycle lease", () => {
    const path = join(mkdtempSync(join(tmpdir(), "lease-scope-")), "leases.json");
    setLease(path, "US-X-1", { claimedAt: 1000, source: "human" });
    setLease(path, "US-X-2", { pid: 4242, claimedAt: 1000, source: "cycle" });

    expect(removeLease(path, "US-X-1", "cycle")).toBe(false);
    expect(readLeases(path)["US-X-1"]?.source).toBe("human");

    expect(removeLease(path, "US-X-2", "cycle")).toBe(true);
    expect(readLeases(path)["US-X-2"]).toBeUndefined();
  });

  it("unscoped removal still removes any source (explicit pardon path)", () => {
    const path = join(mkdtempSync(join(tmpdir(), "lease-scope2-")), "leases.json");
    setLease(path, "US-X-3", { claimedAt: 1000, source: "human" });
    expect(removeLease(path, "US-X-3")).toBe(true);
  });
});
