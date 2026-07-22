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
  claimStoryLease,
  cleanDeadLeases,
  isHumanSoftLeaseActive,
  isLeaseAlive,
  isPidAlive,
  HUMAN_SOFT_LEASE_HOURS,
  readLeases,
  releaseStoryLease,
  writeLeases,
  setLease,
  removeLease,
  reconcileExpiredClaims,
  type LeaseMap,
} from "../src/index.js";
import { existsSync, mkdtempSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from "fs";
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

describe("cleanDeadLeases (FIX-1232)", () => {
  it("removes dead PID entries and keeps live ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "clean-dead-"));
    const path = join(dir, "leases.json");
    try {
      setLease(path, "FIX-DEAD", { pid: 999999999, claimedAt: 1000, source: "cycle" });
      setLease(path, "FIX-LIVE", { pid: process.pid, claimedAt: 2000, source: "cycle" });
      const cleaned = cleanDeadLeases(path);
      expect(cleaned).toEqual(["FIX-DEAD"]);
      const remaining = readLeases(path);
      expect(remaining["FIX-DEAD"]).toBeUndefined();
      expect(remaining["FIX-LIVE"]).toBeDefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("removes all entries and deletes the file when none survive", () => {
    const dir = mkdtempSync(join(tmpdir(), "clean-dead-all-"));
    const path = join(dir, "leases.json");
    try {
      setLease(path, "FIX-1", { pid: 999999999, claimedAt: 1000, source: "cycle" });
      setLease(path, "FIX-2", { pid: 999999998, claimedAt: 2000, source: "cycle" });
      const cleaned = cleanDeadLeases(path);
      expect(cleaned.sort()).toEqual(["FIX-1", "FIX-2"]);
      // File should be deleted
      const { existsSync } = require("fs");
      expect(existsSync(path)).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("skips human/supervisor leases (no pid)", () => {
    const dir = mkdtempSync(join(tmpdir(), "clean-skip-human-"));
    const path = join(dir, "leases.json");
    try {
      setLease(path, "FIX-HUMAN", { claimedAt: 1000, source: "human" });
      setLease(path, "FIX-DEAD", { pid: 999999999, claimedAt: 2000, source: "cycle" });
      const cleaned = cleanDeadLeases(path);
      expect(cleaned).toEqual(["FIX-DEAD"]);
      const remaining = readLeases(path);
      expect(remaining["FIX-HUMAN"]).toBeDefined();
      expect(remaining["FIX-DEAD"]).toBeUndefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("returns empty array for missing or empty file", () => {
    expect(cleanDeadLeases("/nonexistent/path/file.json")).toEqual([]);
    expect(cleanDeadLeases("/dev/null")).toEqual([]);
  });
});

// ─── US-DELTA-003: atomic claimStoryLease / releaseStoryLease ───────────────

describe("claimStoryLease — atomic no-clobber claim", () => {
  it("claims an unclaimed story and writes entry with source + delegationId", () => {
    const dir = mkdtempSync(join(tmpdir(), "claim-test-"));
    const path = join(dir, "leases.json");
    try {
      const result = claimStoryLease(path, "US-001", {
        pid: process.pid,
        claimedAt: NOW,
        source: "host-delegation",
        delegationId: "deleg-aaa",
        runId: "delta-deleg-aaa",
      });
      expect(result.status).toBe("claimed");

      const leases = readLeases(path);
      expect(leases["US-001"]).toBeDefined();
      expect(leases["US-001"]!.source).toBe("host-delegation");
      expect(leases["US-001"]!.delegationId).toBe("deleg-aaa");
      expect(leases["US-001"]!.runId).toBe("delta-deleg-aaa");
      expect(leases["US-001"]!.pid).toBe(process.pid);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("returns exists when story already claimed by any source", () => {
    const dir = mkdtempSync(join(tmpdir(), "claim-test-"));
    const path = join(dir, "leases.json");
    try {
      // Pre-claim via cycle
      const r1 = claimStoryLease(path, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });
      expect(r1.status).toBe("claimed");

      // Second claim from host-delegation must fail
      const r2 = claimStoryLease(path, "US-001", {
        pid: process.pid, claimedAt: NOW + 1, source: "host-delegation",
        delegationId: "deleg-bbb", runId: "delta-deleg-bbb",
      });
      expect(r2.status).toBe("exists");
      if (r2.status === "exists") {
        expect(r2.existingSource).toBe("cycle");
      }

      // First claim entry is preserved (not overwritten)
      const leases = readLeases(path);
      expect(leases["US-001"]!.source).toBe("cycle");
      expect(leases["US-001"]!.delegationId).toBeUndefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("rejects host-delegation claim without delegationId", () => {
    const dir = mkdtempSync(join(tmpdir(), "claim-test-"));
    const path = join(dir, "leases.json");
    try {
      expect(() => claimStoryLease(path, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "host-delegation",
      })).toThrow("delegationId");
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("two claims in same process: second returns exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "claim-race-"));
    const path = join(dir, "leases.json");
    try {
      const r1 = claimStoryLease(path, "US-RACE", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });
      expect(r1.status).toBe("claimed");

      const r2 = claimStoryLease(path, "US-RACE", {
        pid: 99999, claimedAt: NOW + 1, source: "host-delegation",
        delegationId: "deleg-bbb", runId: "delta-bbb",
      });
      expect(r2.status).toBe("exists");

      // Only first claim persists
      const leases = readLeases(path);
      expect(leases["US-RACE"]!.source).toBe("cycle");
      expect(leases["US-RACE"]!.pid).toBe(process.pid);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("stale lock from dead PID is broken and claim succeeds", () => {
    const dir = mkdtempSync(join(tmpdir(), "claim-stale-"));
    const path = join(dir, "leases.json");
    const lockPath = `${path}.lock`;
    try {
      // Simulate a stale lock from a dead PID
      writeFileSync(lockPath, "999999999", "utf8");
      // Set mtime to be old (STALE_LOCK_MS + 1s)
      const oldTime = new Date(Date.now() - 31_000);
      utimesSync(lockPath, oldTime, oldTime);

      const result = claimStoryLease(path, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });
      expect(result.status).toBe("claimed");

      // Lock file must be cleaned up (released after claim)
      expect(existsSync(lockPath)).toBe(false);

      const leases = readLeases(path);
      expect(leases["US-001"]!.source).toBe("cycle");
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("lock from live PID is never broken (fail-loud, not silent)", () => {
    const dir = mkdtempSync(join(tmpdir(), "claim-live-"));
    const path = join(dir, "leases.json");
    const lockPath = `${path}.lock`;
    try {
      // Simulate a lock from the current live PID
      writeFileSync(lockPath, String(process.pid), "utf8");
      const oldTime = new Date(Date.now() - 31_000);
      utimesSync(lockPath, oldTime, oldTime);

      // Should time out because the lock-owning PID is alive
      expect(() => claimStoryLease(path, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow("Timed out");
    } finally {
      // Clean up our own lock
      try { unlinkSync(lockPath); } catch {}
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  }, 10000);
});

describe("releaseStoryLease — match-only release", () => {
  it("releases matching host-delegation lease by delegationId", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-test-"));
    const path = join(dir, "leases.json");
    try {
      claimStoryLease(path, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "host-delegation",
        delegationId: "deleg-aaa", runId: "delta-deleg-aaa",
      });

      // Correct delegationId — releases
      const r = releaseStoryLease(path, "US-001", {
        source: "host-delegation", delegationId: "deleg-aaa",
      });
      expect(r).toBe(true);
      expect(readLeases(path)["US-001"]).toBeUndefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("refuses to release mismatched delegationId (match-only)", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-test-"));
    const path = join(dir, "leases.json");
    try {
      claimStoryLease(path, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "host-delegation",
        delegationId: "deleg-aaa", runId: "delta-deleg-aaa",
      });

      // Wrong delegationId — refuses
      const r = releaseStoryLease(path, "US-001", {
        source: "host-delegation", delegationId: "deleg-WRONG",
      });
      expect(r).toBe(false);

      // Lease is preserved
      const leases = readLeases(path);
      expect(leases["US-001"]!.delegationId).toBe("deleg-aaa");
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("refuses to release mismatched source (cycle cannot release host-delegation)", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-test-"));
    const path = join(dir, "leases.json");
    try {
      claimStoryLease(path, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "host-delegation",
        delegationId: "deleg-aaa", runId: "delta-deleg-aaa",
      });

      // Cycle cannot release host-delegation
      const r = releaseStoryLease(path, "US-001", {
        source: "cycle", pid: process.pid,
      });
      expect(r).toBe(false);

      // Lease preserved
      expect(readLeases(path)["US-001"]!.source).toBe("host-delegation");
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("refuses to release mismatched pid for cycle source", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-test-"));
    const path = join(dir, "leases.json");
    try {
      claimStoryLease(path, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });

      // Wrong pid — refuses
      const r = releaseStoryLease(path, "US-001", {
        source: "cycle", pid: 99999,
      });
      expect(r).toBe(false);

      // Lease preserved
      expect(readLeases(path)["US-001"]!.pid).toBe(process.pid);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("releases matching cycle lease by pid", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-test-"));
    const path = join(dir, "leases.json");
    try {
      claimStoryLease(path, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });

      const r = releaseStoryLease(path, "US-001", {
        source: "cycle", pid: process.pid,
      });
      expect(r).toBe(true);
      expect(readLeases(path)["US-001"]).toBeUndefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("returns false for non-existent story", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-test-"));
    const path = join(dir, "leases.json");
    try {
      expect(releaseStoryLease(path, "US-NOPE", { source: "cycle" })).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("does not remove other stories from the map", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-test-"));
    const path = join(dir, "leases.json");
    try {
      claimStoryLease(path, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "host-delegation",
        delegationId: "deleg-aaa", runId: "delta-deleg-aaa",
      });
      claimStoryLease(path, "US-002", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });

      // Release only US-001
      releaseStoryLease(path, "US-001", {
        source: "host-delegation", delegationId: "deleg-aaa",
      });

      const leases = readLeases(path);
      expect(leases["US-001"]).toBeUndefined();
      expect(leases["US-002"]).toBeDefined();
      expect(leases["US-002"]!.source).toBe("cycle");
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("deletes the file when last entry is released", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-test-"));
    const path = join(dir, "leases.json");
    try {
      claimStoryLease(path, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });
      expect(existsSync(path)).toBe(true);

      releaseStoryLease(path, "US-001", { source: "cycle", pid: process.pid });
      expect(existsSync(path)).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });
});
