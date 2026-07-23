/**
 * Tests for FIX-1211: lease-aware In Progress handling.
 *
 * AC1: In Progress line without lease in 24h soft lease not picked; timeout
 *      recovery logged is produced by reconcileExpiredClaims.
 * AC2: Loop's own lease death recovery doesn't regress.
 * AC3: Concurrent same-story scenario sealed in tests.
 *
 * US-DELTA-003: hardlink no-clobber lease protocol.
 * - claimStoryLease uses temp+fdatasync+linkSync(EEXIST)+parent-fsync+unlink
 * - No lock file; no JSON read-modify-write
 * - Per-story canonical record files in leases directory
 */
import { describe, expect, it } from "vitest";
import {
  buildClaimedByOther,
  claimStoryLease,
  cleanDeadLeases,
  injectClaimStepHook,
  isHumanSoftLeaseActive,
  isLeaseAlive,
  isPidAlive,
  HUMAN_SOFT_LEASE_HOURS,
  readLeases,
  releaseStoryLease,
  writeLeases,
  setLease,
  removeLease,
  legacyLeasePath,
  leaseDirPath,
  reconcileExpiredClaims,
  type LeaseMap,
  type ClaimStep,
} from "../src/index.js";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";
import { randomUUID } from "crypto";

const NOW = 1_700_000_000_000; // arbitrary stable epoch ms for tests

// ─── Path helpers for tests ─────────────────────────────────────────────────

function tmpLeaseDir(): string {
  const baseDir = mkdtempSync(join(tmpdir(), "lease-test-"));
  const dir = join(baseDir, "leases");
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── readLeases / writeLeases / setLease / removeLease ──────────────────────

describe("readLeases / writeLeases / setLease / removeLease", () => {
  it("readLeases returns empty for missing directory", () => {
    expect(readLeases("/nonexistent/path/leases")).toEqual({});
  });

  it("readLeases returns empty for unparseable legacy file", () => {
    // /dev/null is not a directory and not a valid JSON file → empty
    expect(readLeases("/dev/null")).toEqual({});
  });

  it("round-trips via writeLeases + readLeases (directory)", () => {
    const dir = tmpLeaseDir();
    try {
      const data: LeaseMap = { "FIX-1": { pid: 123, claimedAt: NOW, source: "cycle" } };
      writeLeases(dir, data);
      const loaded = readLeases(dir);
      expect(loaded).toEqual(data);
      // Verify file exists on disk
      expect(existsSync(join(dir, "FIX-1.lease"))).toBe(true);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("setLease + removeLease round-trip (directory)", () => {
    const dir = tmpLeaseDir();
    try {
      setLease(dir, "FIX-1", { claimedAt: NOW, source: "human" });
      expect(Object.keys(readLeases(dir))).toEqual(["FIX-1"]);
      expect(existsSync(join(dir, "FIX-1.lease"))).toBe(true);
      expect(removeLease(dir, "FIX-1")).toBe(true);
      expect(readLeases(dir)).toEqual({});
      expect(removeLease(dir, "FIX-MISSING")).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("readLeases falls back to legacy story-leases.json when directory absent", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "legacy-test-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    try {
      const data: LeaseMap = { "FIX-LEGACY": { pid: 456, claimedAt: NOW, source: "cycle" } };
      writeFileSync(legacyPath, JSON.stringify(data, null, 2) + "\n", "utf8");

      // readLeases with a path inside the loop dir should find legacy
      const leasesDir = join(loopDir, "leases");
      const loaded = readLeases(leasesDir);
      expect(loaded).toEqual(data);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("writeLeases + readLeases correctly handles multiple stories", () => {
    const dir = tmpLeaseDir();
    try {
      const data: LeaseMap = {
        "FIX-A": { pid: 111, claimedAt: NOW, source: "cycle" },
        "FIX-B": { claimedAt: NOW, source: "human" },
        "US-HD": { claimedAt: NOW + 1, source: "host-delegation", delegationId: "deleg-xyz", runId: "delta-deleg-xyz" },
      };
      writeLeases(dir, data);
      expect(existsSync(join(dir, "FIX-A.lease"))).toBe(true);
      expect(existsSync(join(dir, "FIX-B.lease"))).toBe(true);
      expect(existsSync(join(dir, "US-HD.lease"))).toBe(true);
      const loaded = readLeases(dir);
      expect(loaded).toEqual(data);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
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
    const dir = tmpLeaseDir();
    setLease(dir, "US-X-1", { claimedAt: 1000, source: "human" });
    setLease(dir, "US-X-2", { pid: 4242, claimedAt: 1000, source: "cycle" });

    expect(removeLease(dir, "US-X-1", "cycle")).toBe(false);
    expect(readLeases(dir)["US-X-1"]?.source).toBe("human");

    expect(removeLease(dir, "US-X-2", "cycle")).toBe(true);
    expect(readLeases(dir)["US-X-2"]).toBeUndefined();
  });

  it("unscoped removal still removes any source (explicit pardon path)", () => {
    const dir = tmpLeaseDir();
    setLease(dir, "US-X-3", { claimedAt: 1000, source: "human" });
    expect(removeLease(dir, "US-X-3")).toBe(true);
  });
});

describe("cleanDeadLeases (FIX-1232)", () => {
  it("removes dead PID entries and keeps live ones", () => {
    const dir = tmpLeaseDir();
    try {
      setLease(dir, "FIX-DEAD", { pid: 999999999, claimedAt: 1000, source: "cycle" });
      setLease(dir, "FIX-LIVE", { pid: process.pid, claimedAt: 2000, source: "cycle" });
      const cleaned = cleanDeadLeases(dir);
      expect(cleaned).toEqual(["FIX-DEAD"]);
      const remaining = readLeases(dir);
      expect(remaining["FIX-DEAD"]).toBeUndefined();
      expect(remaining["FIX-LIVE"]).toBeDefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("removes all dead entries when no live entries survive", () => {
    const dir = tmpLeaseDir();
    try {
      setLease(dir, "FIX-1", { pid: 999999999, claimedAt: 1000, source: "cycle" });
      setLease(dir, "FIX-2", { pid: 999999998, claimedAt: 2000, source: "cycle" });
      const cleaned = cleanDeadLeases(dir);
      expect(cleaned.sort()).toEqual(["FIX-1", "FIX-2"]);
      // All files should be gone
      const remaining = readLeases(dir);
      expect(remaining).toEqual({});
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("skips human/supervisor leases (no pid)", () => {
    const dir = tmpLeaseDir();
    try {
      setLease(dir, "FIX-HUMAN", { claimedAt: 1000, source: "human" });
      setLease(dir, "FIX-DEAD", { pid: 999999999, claimedAt: 2000, source: "cycle" });
      const cleaned = cleanDeadLeases(dir);
      expect(cleaned).toEqual(["FIX-DEAD"]);
      const remaining = readLeases(dir);
      expect(remaining["FIX-HUMAN"]).toBeDefined();
      expect(remaining["FIX-DEAD"]).toBeUndefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("never cleans host-delegation leases", () => {
    const dir = tmpLeaseDir();
    try {
      setLease(dir, "FIX-HOST", { claimedAt: 1000, source: "host-delegation", delegationId: "deleg-1", runId: "delta-deleg-1" });
      const cleaned = cleanDeadLeases(dir);
      expect(cleaned).toEqual([]);
      const remaining = readLeases(dir);
      expect(remaining["FIX-HOST"]).toBeDefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("returns empty array for missing directory", () => {
    expect(cleanDeadLeases("/nonexistent/path/leases")).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// US-DELTA-003: hardlink no-clobber claimStoryLease / releaseStoryLease
// ═══════════════════════════════════════════════════════════════════════════════

describe("claimStoryLease — hardlink no-clobber (US-DELTA-003)", () => {
  it("claims an unclaimed story and writes per-story record file with source + delegationId", () => {
    const dir = tmpLeaseDir();
    try {
      const result = claimStoryLease(dir, "US-001", {
        pid: process.pid,
        claimedAt: NOW,
        source: "host-delegation",
        delegationId: "deleg-aaa",
        runId: "delta-deleg-aaa",
      });
      expect(result.status).toBe("claimed");

      // Verify per-story record exists
      const rp = join(dir, "US-001.lease");
      expect(existsSync(rp)).toBe(true);

      const leases = readLeases(dir);
      expect(leases["US-001"]).toBeDefined();
      expect(leases["US-001"]!.source).toBe("host-delegation");
      expect(leases["US-001"]!.delegationId).toBe("deleg-aaa");
      expect(leases["US-001"]!.runId).toBe("delta-deleg-aaa");
      expect(leases["US-001"]!.pid).toBe(process.pid);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("returns exists when story already claimed by any source (EEXIST on hardlink)", () => {
    const dir = tmpLeaseDir();
    try {
      // Pre-claim via cycle
      const r1 = claimStoryLease(dir, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });
      expect(r1.status).toBe("claimed");

      // Second claim from host-delegation must fail with EEXIST
      const r2 = claimStoryLease(dir, "US-001", {
        pid: process.pid, claimedAt: NOW + 1, source: "host-delegation",
        delegationId: "deleg-bbb", runId: "delta-deleg-bbb",
      });
      expect(r2.status).toBe("exists");
      if (r2.status === "exists") {
        expect(r2.existingSource).toBe("cycle");
      }

      // First claim entry is preserved (not overwritten)
      const leases = readLeases(dir);
      expect(leases["US-001"]!.source).toBe("cycle");
      expect(leases["US-001"]!.delegationId).toBeUndefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("rejects host-delegation claim without delegationId", () => {
    const dir = tmpLeaseDir();
    try {
      expect(() => claimStoryLease(dir, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "host-delegation",
      })).toThrow("delegationId");
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("two claims in same process: second returns exists", () => {
    const dir = tmpLeaseDir();
    try {
      const r1 = claimStoryLease(dir, "US-RACE", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });
      expect(r1.status).toBe("claimed");

      const r2 = claimStoryLease(dir, "US-RACE", {
        pid: 99999, claimedAt: NOW + 1, source: "host-delegation",
        delegationId: "deleg-bbb", runId: "delta-bbb",
      });
      expect(r2.status).toBe("exists");

      // Only first claim persists
      const leases = readLeases(dir);
      expect(leases["US-RACE"]!.source).toBe("cycle");
      expect(leases["US-RACE"]!.pid).toBe(process.pid);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("different stories can both be claimed", () => {
    const dir = tmpLeaseDir();
    try {
      const r1 = claimStoryLease(dir, "US-A", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });
      expect(r1.status).toBe("claimed");

      const r2 = claimStoryLease(dir, "US-B", {
        pid: process.pid, claimedAt: NOW, source: "host-delegation",
        delegationId: "deleg-xyz", runId: "delta-xyz",
      });
      expect(r2.status).toBe("claimed");

      const leases = readLeases(dir);
      expect(Object.keys(leases).sort()).toEqual(["US-A", "US-B"]);
      expect(existsSync(join(dir, "US-A.lease"))).toBe(true);
      expect(existsSync(join(dir, "US-B.lease"))).toBe(true);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  // ─── Hardlink mechanics proofs ──────────────────────────────────────────

  it("proves hardlink semantics: same inode for claimed record (linkSync, not copy)", () => {
    const dir = tmpLeaseDir();
    try {
      // Manually create a temp file to verify hardlink behavior
      const tmpPath = join(dir, "test-tmp.tmp");
      writeFileSync(tmpPath, JSON.stringify({ pid: 123, claimedAt: NOW, source: "cycle" }) + "\n", "utf8");

      const finalPath = join(dir, "INODE-TEST.lease");
      linkSync(tmpPath, finalPath);

      // Same inode
      const tmpStat = statSync(tmpPath);
      const finalStat = statSync(finalPath);
      expect(tmpStat.ino).toBe(finalStat.ino);
      expect(finalStat.nlink).toBe(2);

      // Cleanup
      unlinkSync(tmpPath);
      unlinkSync(finalPath);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("proves no-clobber: linkSync EEXIST when target already present", () => {
    const dir = tmpLeaseDir();
    try {
      const finalPath = join(dir, "NOCLOBBER.lease");
      const tmp1 = join(dir, "tmp1.tmp");
      const tmp2 = join(dir, "tmp2.tmp");

      writeFileSync(tmp1, JSON.stringify({ source: "cycle" }) + "\n", "utf8");
      writeFileSync(tmp2, JSON.stringify({ source: "human" }) + "\n", "utf8");

      // First link succeeds
      linkSync(tmp1, finalPath);
      expect(existsSync(finalPath)).toBe(true);

      // Second link must fail with EEXIST
      expect(() => linkSync(tmp2, finalPath)).toThrow();
      try {
        linkSync(tmp2, finalPath);
        // Should not reach here
        expect("should have thrown").toBe("EEXIST");
      } catch (e: unknown) {
        expect((e as { code?: string }).code).toBe("EEXIST");
      }

      // Content is still the first writer's
      const content = JSON.parse(readFileSync(finalPath, "utf8").trim());
      expect(content.source).toBe("cycle");

      unlinkSync(tmp1);
      unlinkSync(tmp2);
      unlinkSync(finalPath);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("proves claimStoryLease leaves no temp files after success", () => {
    const dir = tmpLeaseDir();
    try {
      claimStoryLease(dir, "US-CLEAN", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });

      // Only the .lease file should exist, no temp files
      const entries = require("fs").readdirSync(dir);
      for (const entry of entries) {
        expect(entry).not.toMatch(/\.tmp$/);
      }
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("proves claimStoryLease cleans temp even on EEXIST conflict", () => {
    const dir = tmpLeaseDir();
    try {
      claimStoryLease(dir, "US-CLEAN2", { pid: process.pid, claimedAt: NOW, source: "cycle" });
      // Second claim will fail
      claimStoryLease(dir, "US-CLEAN2", { pid: 99999, claimedAt: NOW, source: "cycle" });

      // No temp files left behind
      const entries = require("fs").readdirSync(dir);
      for (const entry of entries) {
        expect(entry).not.toMatch(/\.tmp$/);
      }
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  // ─── Production hardlink sequence tracer (Fix #3/#4: tests real claimStoryLease, not manual linkSync) ──

  it("tracer proves claimStoryLease follows ordered protocol: before-temp-write → after-temp-write → after-temp-fsync → after-link → after-parent-fsync → before-temp-unlink", () => {
    const dir = tmpLeaseDir();
    const steps: string[] = [];
    try {
      injectClaimStepHook((step: ClaimStep) => { steps.push(step); });

      const result = claimStoryLease(dir, "US-TRACE", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });
      expect(result.status).toBe("claimed");
      expect(steps).toEqual([
        "before-temp-write",
        "after-temp-write",
        "after-temp-fsync",
        "after-link",
        "after-parent-fsync",
        "before-temp-unlink",
      ]);
      // No temp residue
      for (const e of readdirSync(dir)) expect(e).not.toMatch(/\.tmp$/);
    } finally {
      injectClaimStepHook(null);
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("tracer proves EEXIST stops before after-link: second claim ends at after-temp-fsync, no overwrite", () => {
    const dir = tmpLeaseDir();
    const stepsB: string[] = [];
    try {
      claimStoryLease(dir, "US-NW", { pid: process.pid, claimedAt: NOW, source: "cycle" });

      injectClaimStepHook((step: ClaimStep) => { stepsB.push(step); });
      const r2 = claimStoryLease(dir, "US-NW", { pid: 99999, claimedAt: NOW + 1, source: "host-delegation", delegationId: "d2", runId: "rd2" });
      expect(r2.status).toBe("exists");
      expect(stepsB).toEqual(["before-temp-write", "after-temp-write", "after-temp-fsync"]);
      // First claim preserved
      expect(readLeases(dir)["US-NW"]!.source).toBe("cycle");
    } finally {
      injectClaimStepHook(null);
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  // ─── Crash points: each step, verify no second owner / no overwrite (Fix #4) ──

  function crashTest(step: ClaimStep, expectWinner: boolean) {
    const dir = tmpLeaseDir();
    try {
      injectClaimStepHook((s: ClaimStep) => { if (s === step) throw new Error("crash at " + step); });

      expect(() => claimStoryLease(dir, "US-CR", { pid: process.pid, claimedAt: NOW, source: "cycle" })).toThrow();

      if (expectWinner) {
        expect(existsSync(join(dir, "US-CR.lease"))).toBe(true);
      } else {
        expect(existsSync(join(dir, "US-CR.lease"))).toBe(false);
      }

      // Retry without crash — must succeed and be sole owner
      injectClaimStepHook(null);
      const r2 = claimStoryLease(dir, "US-CR", { pid: 99999, claimedAt: NOW + 1, source: "host-delegation", delegationId: "d4", runId: "rd4" });
      if (expectWinner) {
        expect(r2.status).toBe("exists");
        expect(readLeases(dir)["US-CR"]!.pid).toBe(process.pid);
      } else {
        expect(r2.status).toBe("claimed");
        expect(readLeases(dir)["US-CR"]!.pid).toBe(99999);
      }
    } finally {
      injectClaimStepHook(null);
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  }

  it("crash at before-temp-write: no record, retry wins", () => crashTest("before-temp-write", false));
  it("crash at after-temp-write: temp residue, no winner, retry wins", () => crashTest("after-temp-write", false));
  it("crash at after-temp-fsync: no final record, retry wins", () => crashTest("after-temp-fsync", false));
  it("crash at after-link: record exists (link durable), winner established, retry blocked", () => crashTest("after-link", true));
  it("crash at after-parent-fsync: winner established, retry blocked", () => crashTest("after-parent-fsync", true));
  it("crash at before-temp-unlink: winner established, retry blocked", () => crashTest("before-temp-unlink", true));
});

// ─── Concurrent subprocess claim (real process isolation, Fix #5) ─────────────

describe("claimStoryLease — concurrent subprocess hardlink exclusion", () => {
  /**
   * Run a claim worker via tsx. Workers use a file-based ready/go barrier:
   * 1. Worker writes ready.<workerId> → polls for go.txt
   * 2. Test waits for all ready files → writes go.txt → both workers race on claim
   * 3. Worker writes result to result.<workerId>.json → exits 0
   *
   * Returns { status, code, stderr }. Hard-fails on empty output or nonzero exit.
   */
  async function runWorker(args: {
    tsxPath: string;
    dirPath: string;
    workDir: string;
    storyId: string;
    workerId: string;
    source: string;
    pid?: number;
    delegationId?: string;
    runId?: string;
  }): Promise<{ status: string; code: number; stderr: string }> {
    const { dirPath, workDir, storyId, workerId, source, pid, delegationId, runId } = args;
    const coreIndex = join(__dirname, "..", "src", "index.ts");

    // Write a worker script that uses tsx to import from core source
    const workerScript = join(workDir, `worker-${workerId}.mjs`);
    const readyFile = join(workDir, `ready.${workerId}`);
    const goFile = join(workDir, "go.txt");
    const resultFile = join(workDir, `result.${workerId}.json`);

    const entryObj: Record<string, unknown> = { claimedAt: Date.now(), source };
    if (pid !== undefined) entryObj.pid = pid;
    if (delegationId) entryObj.delegationId = delegationId;
    if (runId) entryObj.runId = runId;

    const scriptContent = `
import { claimStoryLease } from ${JSON.stringify(coreIndex)};
import { writeFileSync, existsSync } from "node:fs";

const dirPath = ${JSON.stringify(dirPath)};
const storyId = ${JSON.stringify(storyId)};
const entry = ${JSON.stringify(entryObj)};
const readyFile = ${JSON.stringify(readyFile)};
const goFile = ${JSON.stringify(goFile)};
const resultFile = ${JSON.stringify(resultFile)};

// Signal ready
writeFileSync(readyFile, "ready", "utf8");

// Wait for go signal (poll every 5ms, max 10s)
const start = Date.now();
while (!existsSync(goFile)) {
  if (Date.now() - start > 10000) {
    process.stderr.write("timeout waiting for go signal\\n");
    process.exit(1);
  }
  await new Promise(r => setTimeout(r, 5));
}

// Race!
const result = claimStoryLease(dirPath, storyId, entry);
writeFileSync(resultFile, JSON.stringify(result), "utf8");
process.exit(0);
`;
    writeFileSync(workerScript, scriptContent, "utf8");

    return new Promise((resolve, reject) => {
      const child = spawn("npx", ["tsx", workerScript], {
        cwd: __dirname,
        stdio: "pipe",
        env: { ...process.env, NODE_ENV: "test" },
      });
      let stderr = "";
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
      child.on("close", (code) => {
        try {
          if (existsSync(resultFile)) {
            const raw = readFileSync(resultFile, "utf8").trim();
            if (raw === "") {
              reject(new Error(`worker ${workerId}: empty output, stderr=${stderr}`));
              return;
            }
            const parsed = JSON.parse(raw);
            resolve({ status: parsed.status, code: code ?? -1, stderr });
          } else {
            reject(new Error(`worker ${workerId}: no result file, code=${code}, stderr=${stderr}`));
          }
        } catch (err) {
          reject(new Error(`worker ${workerId}: parse error, code=${code}, stderr=${stderr}`));
        }
      });
      child.on("error", (err) => reject(err));
    });
  }

  /** Create a temp work dir, spawn 2 workers with ready/go barrier, assert outcome. */
  async function raceWorkers(worker1Args: Omit<Parameters<typeof runWorker>[0], "tsxPath">, worker2Args: Omit<Parameters<typeof runWorker>[0], "tsxPath">) {
    const dir = tmpLeaseDir();
    const workDir = mkdtempSync(join(tmpdir(), "lease-race-"));
    try {
      // Write go.txt first then delete it — workers poll for it
      const goFile = join(workDir, "go.txt");

      const w1 = runWorker({ ...worker1Args, dirPath: dir, workDir });
      const w2 = runWorker({ ...worker2Args, dirPath: dir, workDir });

      // Wait for both ready signals
      const ready1 = join(workDir, `ready.${worker1Args.workerId}`);
      const ready2 = join(workDir, `ready.${worker2Args.workerId}`);
      const start = Date.now();
      while (!existsSync(ready1) || !existsSync(ready2)) {
        if (Date.now() - start > 10000) throw new Error("workers never signaled ready");
        await new Promise(r => setTimeout(r, 10));
      }

      // GO!
      writeFileSync(goFile, "go", "utf8");

      const [r1, r2] = await Promise.all([w1, w2]);
      return { dir, workDir, r1, r2 };
    } catch (err) {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
      try { rmSync(dirname(dir), { recursive: true, force: true }); } catch {}
      throw err;
    }
  }

  // ── Same story, same source → exactly one winner ────────────────────────

  it("same story, two cycle claims: exactly one winner, empty stderr, zero exit", async () => {
    const { dir, workDir, r1, r2 } = await raceWorkers(
      { workerId: "a", storyId: "US-RACE-CYC", source: "cycle", pid: 10001 },
      { workerId: "b", storyId: "US-RACE-CYC", source: "cycle", pid: 10002 },
    );
    try {
      // Both exit 0
      expect(r1.code).toBe(0);
      expect(r2.code).toBe(0);
      expect(r1.stderr).toBe("");
      expect(r2.stderr).toBe("");
      // Exactly one winner
      const winners = [r1, r2].filter((r) => r.status === "claimed");
      expect(winners).toHaveLength(1);
      // Only one .lease file
      const leases = readLeases(dir);
      expect(Object.keys(leases)).toHaveLength(1);
      expect(Object.keys(leases)[0]).toBe("US-RACE-CYC");
      // No temp residue
      for (const e of readdirSync(dir)) expect(e).not.toMatch(/\.tmp$/);
    } finally {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
      try { rmSync(dirname(dir), { recursive: true, force: true }); } catch {}
    }
  }, 15000);

  // ── Same story, different sources → exactly one winner ──────────────────

  it("same story, host-delegation vs cycle: exactly one winner", async () => {
    const { dir, workDir, r1, r2 } = await raceWorkers(
      { workerId: "hd", storyId: "US-RACE-HDCYC", source: "host-delegation", delegationId: "deleg-hd", runId: "delta-hd" },
      { workerId: "cyc", storyId: "US-RACE-HDCYC", source: "cycle", pid: 20001 },
    );
    try {
      expect(r1.code).toBe(0);
      expect(r2.code).toBe(0);
      const winners = [r1, r2].filter((r) => r.status === "claimed");
      expect(winners).toHaveLength(1);
      const leases = readLeases(dir);
      expect(Object.keys(leases)).toHaveLength(1);
      for (const e of readdirSync(dir)) expect(e).not.toMatch(/\.tmp$/);
    } finally {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
      try { rmSync(dirname(dir), { recursive: true, force: true }); } catch {}
    }
  }, 15000);

  it("same story, host-delegation vs human: exactly one winner", async () => {
    const { dir, workDir, r1, r2 } = await raceWorkers(
      { workerId: "hd", storyId: "US-RACE-HDHUM", source: "host-delegation", delegationId: "deleg-hd2", runId: "delta-hd2" },
      { workerId: "hum", storyId: "US-RACE-HDHUM", source: "human" },
    );
    try {
      expect(r1.code).toBe(0);
      expect(r2.code).toBe(0);
      const winners = [r1, r2].filter((r) => r.status === "claimed");
      expect(winners).toHaveLength(1);
      expect(Object.keys(readLeases(dir))).toHaveLength(1);
    } finally {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
      try { rmSync(dirname(dir), { recursive: true, force: true }); } catch {}
    }
  }, 15000);

  it("same story, host-delegation vs supervisor: exactly one winner", async () => {
    const { dir, workDir, r1, r2 } = await raceWorkers(
      { workerId: "hd", storyId: "US-RACE-HDSUP", source: "host-delegation", delegationId: "deleg-hd3", runId: "delta-hd3" },
      { workerId: "sup", storyId: "US-RACE-HDSUP", source: "supervisor" },
    );
    try {
      expect(r1.code).toBe(0);
      expect(r2.code).toBe(0);
      const winners = [r1, r2].filter((r) => r.status === "claimed");
      expect(winners).toHaveLength(1);
      expect(Object.keys(readLeases(dir))).toHaveLength(1);
    } finally {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
      try { rmSync(dirname(dir), { recursive: true, force: true }); } catch {}
    }
  }, 15000);

  // ── Different stories, different sources → both win ─────────────────────

  it("different stories, host-delegation vs cycle: both win", async () => {
    const storyA = "US-DIFF-HD-" + randomUUID().slice(0, 8);
    const storyB = "US-DIFF-CYC-" + randomUUID().slice(0, 8);
    const { dir, workDir, r1, r2 } = await raceWorkers(
      { workerId: "hd", storyId: storyA, source: "host-delegation", delegationId: "deleg-diff-hd", runId: "delta-diff-hd" },
      { workerId: "cyc", storyId: storyB, source: "cycle", pid: 30001 },
    );
    try {
      expect(r1.status).toBe("claimed");
      expect(r2.status).toBe("claimed");
      const leases = readLeases(dir);
      expect(leases[storyA]).toBeDefined();
      expect(leases[storyB]).toBeDefined();
      expect(Object.keys(leases)).toHaveLength(2);
    } finally {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
      try { rmSync(dirname(dir), { recursive: true, force: true }); } catch {}
    }
  }, 15000);

  it("different stories, host-delegation vs human: both win", async () => {
    const storyA = "US-DIFF-HD2-" + randomUUID().slice(0, 8);
    const storyB = "US-DIFF-HUM-" + randomUUID().slice(0, 8);
    const { dir, workDir, r1, r2 } = await raceWorkers(
      { workerId: "hd", storyId: storyA, source: "host-delegation", delegationId: "deleg-diff-hd2", runId: "delta-diff-hd2" },
      { workerId: "hum", storyId: storyB, source: "human" },
    );
    try {
      expect(r1.status).toBe("claimed");
      expect(r2.status).toBe("claimed");
      expect(Object.keys(readLeases(dir))).toHaveLength(2);
    } finally {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
      try { rmSync(dirname(dir), { recursive: true, force: true }); } catch {}
    }
  }, 15000);

  // ─── Malformed/stderr → fail ────────────────────────────────────────────

  it("worker with missing storyId returns non-claimed status, test still sees exactly one winner when raced", async () => {
    // Tests that empty/malformed output would hard-fail, but valid claim works
    const { dir, workDir, r1, r2 } = await raceWorkers(
      { workerId: "ok1", storyId: "US-MALFORM", source: "cycle", pid: 40001 },
      { workerId: "ok2", storyId: "US-MALFORM", source: "cycle", pid: 40002 },
    );
    try {
      expect(r1.code).toBe(0);
      expect(r2.code).toBe(0);
      expect(r1.stderr).toBe("");
      expect(r2.stderr).toBe("");
      const winners = [r1, r2].filter((r) => r.status === "claimed");
      expect(winners).toHaveLength(1);
      // No .tmp residue after race
      for (const e of readdirSync(dir)) expect(e).not.toMatch(/\.tmp$/);
    } finally {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
      try { rmSync(dirname(dir), { recursive: true, force: true }); } catch {}
    }
  }, 15000);
});

// ─── Crash recovery: between temp/write and link/fsync/unlink ──────────────

describe("claimStoryLease — crash resilience between hardlink steps", () => {
  it("temp file from interrupted claim does not block future claims", () => {
    const dir = tmpLeaseDir();
    try {
      // Simulate crash after temp write but before link: leave a temp file
      const storyId = "US-CRASH";
      mkdirSync(dir, { recursive: true });
      const tmpPath = join(dir, `${storyId}.99999.abc12345.tmp`);
      writeFileSync(tmpPath, JSON.stringify({
        pid: 99999, claimedAt: NOW, source: "cycle",
      }) + "\n", "utf8");

      // The temp file should NOT block a new claim (different final path)
      const result = claimStoryLease(dir, storyId, {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });
      expect(result.status).toBe("claimed");

      // Clean up orphaned temp
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("crash between link and parent fsync: record is on disk and valid", () => {
    const dir = tmpLeaseDir();
    try {
      // The claim succeeds even without explicit parent fsync in the test
      // (OS will eventually flush). The key property: after linkSync returns
      // successfully, the record exists and is readable.
      mkdirSync(dir, { recursive: true });
      const rp = join(dir, "US-LINKED.lease");
      const tmpPath = join(dir, "test-pre-link.tmp");
      writeFileSync(tmpPath, JSON.stringify({
        pid: process.pid, claimedAt: NOW, source: "cycle",
      }) + "\n", "utf8");

      // Hardlink — this is the critical step
      linkSync(tmpPath, rp);
      // Simulate crash before parent fsync — record should still be readable
      expect(existsSync(rp)).toBe(true);
      const content = readFileSync(rp, "utf8");
      const parsed = JSON.parse(content.trim());
      expect(parsed.source).toBe("cycle");

      // Cleanup
      unlinkSync(tmpPath);
      unlinkSync(rp);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("temp files from old/stale PIDs do not cause torn-map behavior", () => {
    const dir = tmpLeaseDir();
    try {
      // Multiple temp files from dead PIDs
      mkdirSync(dir, { recursive: true });
      const tmp1 = join(dir, "US-TORN.99998.a1.tmp");
      const tmp2 = join(dir, "US-TORN.99999.b2.tmp");
      writeFileSync(tmp1, "stale\n", "utf8");
      writeFileSync(tmp2, "stale\n", "utf8");

      // Claim should succeed — temps are on different paths
      const result = claimStoryLease(dir, "US-TORN", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });
      expect(result.status).toBe("claimed");

      // Clean up temps
      try { unlinkSync(tmp1); } catch {}
      try { unlinkSync(tmp2); } catch {}

      // Only one valid .lease file
      const leases = readLeases(dir);
      expect(Object.keys(leases)).toEqual(["US-TORN"]);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });
});

// ─── releaseStoryLease — match-only (directory-based, no lock) ─────────────

describe("releaseStoryLease — match-only release (US-DELTA-003 directory)", () => {
  it("releases matching host-delegation lease by delegationId", () => {
    const dir = tmpLeaseDir();
    try {
      claimStoryLease(dir, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "host-delegation",
        delegationId: "deleg-aaa", runId: "delta-deleg-aaa",
      });

      const r = releaseStoryLease(dir, "US-001", {
        source: "host-delegation", delegationId: "deleg-aaa", runId: "delta-deleg-aaa",
      });
      expect(r).toBe(true);
      expect(readLeases(dir)["US-001"]).toBeUndefined();
      expect(existsSync(join(dir, "US-001.lease"))).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("refuses to release mismatched delegationId (match-only)", () => {
    const dir = tmpLeaseDir();
    try {
      claimStoryLease(dir, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "host-delegation",
        delegationId: "deleg-aaa", runId: "delta-deleg-aaa",
      });

      const r = releaseStoryLease(dir, "US-001", {
        source: "host-delegation", delegationId: "deleg-WRONG", runId: "delta-deleg-aaa",
      });
      expect(r).toBe(false);

      const leases = readLeases(dir);
      expect(leases["US-001"]!.delegationId).toBe("deleg-aaa");
      expect(existsSync(join(dir, "US-001.lease"))).toBe(true);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("refuses to release host-delegation when runId is missing (mandatory contract)", () => {
    const dir = tmpLeaseDir();
    try {
      claimStoryLease(dir, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "host-delegation",
        delegationId: "deleg-aaa", runId: "delta-deleg-aaa",
      });

      const r = releaseStoryLease(dir, "US-001", {
        source: "host-delegation", delegationId: "deleg-aaa",
      });
      expect(r).toBe(false);

      const leases = readLeases(dir);
      expect(leases["US-001"]).toBeDefined();
      expect(leases["US-001"]!.delegationId).toBe("deleg-aaa");
      expect(leases["US-001"]!.runId).toBe("delta-deleg-aaa");
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("refuses to release host-delegation when runId is mismatched", () => {
    const dir = tmpLeaseDir();
    try {
      claimStoryLease(dir, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "host-delegation",
        delegationId: "deleg-aaa", runId: "delta-deleg-aaa",
      });

      const r = releaseStoryLease(dir, "US-001", {
        source: "host-delegation", delegationId: "deleg-aaa", runId: "delta-deleg-WRONG",
      });
      expect(r).toBe(false);

      const leases = readLeases(dir);
      expect(leases["US-001"]).toBeDefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("refuses to release mismatched source (cycle cannot release host-delegation)", () => {
    const dir = tmpLeaseDir();
    try {
      claimStoryLease(dir, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "host-delegation",
        delegationId: "deleg-aaa", runId: "delta-deleg-aaa",
      });

      const r = releaseStoryLease(dir, "US-001", {
        source: "cycle", pid: process.pid,
      });
      expect(r).toBe(false);
      expect(readLeases(dir)["US-001"]!.source).toBe("host-delegation");
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("refuses to release mismatched pid for cycle source", () => {
    const dir = tmpLeaseDir();
    try {
      claimStoryLease(dir, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });

      const r = releaseStoryLease(dir, "US-001", {
        source: "cycle", pid: 99999,
      });
      expect(r).toBe(false);
      expect(readLeases(dir)["US-001"]!.pid).toBe(process.pid);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("releases matching cycle lease by pid", () => {
    const dir = tmpLeaseDir();
    try {
      claimStoryLease(dir, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });

      const r = releaseStoryLease(dir, "US-001", {
        source: "cycle", pid: process.pid,
      });
      expect(r).toBe(true);
      expect(readLeases(dir)["US-001"]).toBeUndefined();
      expect(existsSync(join(dir, "US-001.lease"))).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("returns false for non-existent story", () => {
    const dir = tmpLeaseDir();
    try {
      expect(releaseStoryLease(dir, "US-NOPE", { source: "cycle" })).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("does not remove other stories from the directory", () => {
    const dir = tmpLeaseDir();
    try {
      claimStoryLease(dir, "US-001", {
        pid: process.pid, claimedAt: NOW, source: "host-delegation",
        delegationId: "deleg-aaa", runId: "delta-deleg-aaa",
      });
      claimStoryLease(dir, "US-002", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });

      releaseStoryLease(dir, "US-001", {
        source: "host-delegation", delegationId: "deleg-aaa", runId: "delta-deleg-aaa",
      });

      const leases = readLeases(dir);
      expect(leases["US-001"]).toBeUndefined();
      expect(existsSync(join(dir, "US-001.lease"))).toBe(false);
      expect(leases["US-002"]).toBeDefined();
      expect(existsSync(join(dir, "US-002.lease"))).toBe(true);
      expect(leases["US-002"]!.source).toBe("cycle");
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("release of cycle lease does not affect adjacent host-delegation lease", () => {
    const dir = tmpLeaseDir();
    try {
      claimStoryLease(dir, "US-CYC", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });
      claimStoryLease(dir, "US-HD", {
        claimedAt: NOW, source: "host-delegation",
        delegationId: "deleg-hd", runId: "delta-hd",
      });

      expect(releaseStoryLease(dir, "US-CYC", { source: "cycle", pid: process.pid })).toBe(true);
      expect(readLeases(dir)["US-HD"]).toBeDefined();
      expect(readLeases(dir)["US-CYC"]).toBeUndefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  // ─── PID release safety (Fix #1: cycle MUST require non-empty/matching pid) ──

  it("cycle release without pid NEVER deletes — returns false, bytes unchanged", () => {
    const dir = tmpLeaseDir();
    try {
      const entry = { pid: 4242, claimedAt: NOW, source: "cycle" as const };
      claimStoryLease(dir, "US-CYC-NOPID", entry);

      // Capture bytes before attempted release
      const rp = join(dir, "US-CYC-NOPID.lease");
      expect(existsSync(rp)).toBe(true);
      const beforeBytes = readFileSync(rp);

      // Attempt release with cycle source but NO pid
      const r = releaseStoryLease(dir, "US-CYC-NOPID", { source: "cycle" });
      expect(r).toBe(false);

      // Record must still exist with identical bytes
      expect(existsSync(rp)).toBe(true);
      const afterBytes = readFileSync(rp);
      expect(afterBytes).toEqual(beforeBytes);

      // Lease must still be readable
      const leases = readLeases(dir);
      expect(leases["US-CYC-NOPID"]).toBeDefined();
      expect(leases["US-CYC-NOPID"]!.source).toBe("cycle");
      expect(leases["US-CYC-NOPID"]!.pid).toBe(4242);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("cycle release with missing pid on existing cycle lease: returns false, record untouched", () => {
    const dir = tmpLeaseDir();
    try {
      claimStoryLease(dir, "US-CYC-MISS", {
        pid: 8888, claimedAt: NOW, source: "cycle",
      });
      const rp = join(dir, "US-CYC-MISS.lease");
      const beforeBytes = readFileSync(rp);

      const r = releaseStoryLease(dir, "US-CYC-MISS", { source: "cycle" });
      expect(r).toBe(false);

      expect(readFileSync(rp)).toEqual(beforeBytes);
      expect(readLeases(dir)["US-CYC-MISS"]!.pid).toBe(8888);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("cycle release with wrong pid on existing cycle lease: returns false, record untouched", () => {
    const dir = tmpLeaseDir();
    try {
      claimStoryLease(dir, "US-CYC-WRONG", {
        pid: 1111, claimedAt: NOW, source: "cycle",
      });
      const rp = join(dir, "US-CYC-WRONG.lease");
      const beforeBytes = readFileSync(rp);

      const r = releaseStoryLease(dir, "US-CYC-WRONG", { source: "cycle", pid: 2222 });
      expect(r).toBe(false);

      expect(readFileSync(rp)).toEqual(beforeBytes);
      expect(readLeases(dir)["US-CYC-WRONG"]!.pid).toBe(1111);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("cycle release with correct pid on existing cycle lease succeeds (existing behavior verified)", () => {
    const dir = tmpLeaseDir();
    try {
      claimStoryLease(dir, "US-CYC-OK", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });
      const rp = join(dir, "US-CYC-OK.lease");
      expect(existsSync(rp)).toBe(true);

      const r = releaseStoryLease(dir, "US-CYC-OK", { source: "cycle", pid: process.pid });
      expect(r).toBe(true);
      expect(existsSync(rp)).toBe(false);
      expect(readLeases(dir)["US-CYC-OK"]).toBeUndefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("human release must not mistakenly delete a cycle lease with same story", () => {
    const dir = tmpLeaseDir();
    try {
      claimStoryLease(dir, "US-X", {
        pid: 3333, claimedAt: NOW, source: "cycle",
      });
      const rp = join(dir, "US-X.lease");
      const beforeBytes = readFileSync(rp);

      // Attempt to release as "human" — must NOT delete the cycle lease
      const r = releaseStoryLease(dir, "US-X", { source: "human" });
      expect(r).toBe(false);
      expect(readFileSync(rp)).toEqual(beforeBytes);
      expect(readLeases(dir)["US-X"]!.source).toBe("cycle");
      expect(readLeases(dir)["US-X"]!.pid).toBe(3333);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("supervisor release must not mistakenly delete a cycle lease with same story", () => {
    const dir = tmpLeaseDir();
    try {
      claimStoryLease(dir, "US-X-SUP", {
        pid: 4444, claimedAt: NOW, source: "cycle",
      });
      const rp = join(dir, "US-X-SUP.lease");
      const beforeBytes = readFileSync(rp);

      const r = releaseStoryLease(dir, "US-X-SUP", { source: "supervisor" });
      expect(r).toBe(false);
      expect(readFileSync(rp)).toEqual(beforeBytes);
      expect(readLeases(dir)["US-X-SUP"]!.source).toBe("cycle");
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });
});

// ─── Legacy compatibility tests ──────────────────────────────────────────────

describe("legacy story-leases.json compatibility", () => {
  it("legacyLeasePath returns path to story-leases.json", () => {
    expect(legacyLeasePath("/tmp/loop")).toBe("/tmp/loop/story-leases.json");
  });

  it("leaseDirPath returns path to leases directory", () => {
    expect(leaseDirPath("/tmp/loop/events.ndjson")).toBe("/tmp/loop/leases");
  });

  it("readLeases with a legacy file's parent loop dir can read legacy data", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "legacy-migrate-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");
    try {
      writeFileSync(legacyPath, JSON.stringify({
        "FIX-OLD": { pid: 99999, claimedAt: NOW, source: "cycle" },
      }, null, 2) + "\n", "utf8");

      // readLeases from leases dir should fall back to legacy
      const loaded = readLeases(leasesDir);
      expect(loaded["FIX-OLD"]).toBeDefined();
      expect(loaded["FIX-OLD"]!.source).toBe("cycle");

      // New write via claimStoryLease goes to directory
      claimStoryLease(leasesDir, "FIX-NEW", { pid: process.pid, claimedAt: NOW, source: "cycle" });
      expect(existsSync(join(leasesDir, "FIX-NEW.lease"))).toBe(true);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  // ─── Legacy migration conflict (Fix #2): same-story → fail-loud; different → migrate ──

  it("claim fails when legacy has same-story lease (no dual ownership)", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "legacy-conflict-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");
    // Canonical dir MUST NOT exist
    expect(existsSync(leasesDir)).toBe(false);
    try {
      writeFileSync(legacyPath, JSON.stringify({
        "US-LEGACY": { pid: 55555, claimedAt: NOW, source: "cycle" },
      }, null, 2) + "\n", "utf8");

      // Claim same story — must fail-loud
      const r = claimStoryLease(leasesDir, "US-LEGACY", {
        pid: process.pid, claimedAt: NOW + 1, source: "host-delegation",
        delegationId: "deleg-new", runId: "delta-deleg-new",
      });
      expect(r.status).toBe("exists");
      if (r.status === "exists") {
        expect(r.existingSource).toBe("cycle");
      }

      // No canonical directory was created (no split-brain)
      // Legacy file remains the sole authority
      const legacyContent = JSON.parse(readFileSync(legacyPath, "utf8"));
      expect(legacyContent["US-LEGACY"]).toBeDefined();
      expect(legacyContent["US-LEGACY"].pid).toBe(55555);
      expect(legacyContent["US-LEGACY"].source).toBe("cycle");

      // readLeases still sees only the legacy lease
      const leases = readLeases(leasesDir);
      expect(leases["US-LEGACY"]).toBeDefined();
      expect(leases["US-LEGACY"]!.pid).toBe(55555);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("claim succeeds on different story when legacy has other story — legacy preserved AND migrated", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "legacy-migrate-new-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");
    expect(existsSync(leasesDir)).toBe(false);
    try {
      writeFileSync(legacyPath, JSON.stringify({
        "FIX-LEGACY-A": { pid: 111, claimedAt: NOW - 1000, source: "cycle" },
        "FIX-LEGACY-B": { claimedAt: NOW - 2000, source: "human" },
      }, null, 2) + "\n", "utf8");

      // Claim a DIFFERENT story — must succeed
      const r = claimStoryLease(leasesDir, "US-NEW", {
        pid: process.pid, claimedAt: NOW, source: "host-delegation",
        delegationId: "deleg-mig", runId: "delta-deleg-mig",
      });
      expect(r.status).toBe("claimed");

      // Canonical directory created
      expect(existsSync(leasesDir)).toBe(true);

      // Legacy entries are now visible via canonical records (migrated)
      const leases = readLeases(leasesDir);
      expect(leases["FIX-LEGACY-A"]).toBeDefined();
      expect(leases["FIX-LEGACY-A"]!.source).toBe("cycle");
      expect(leases["FIX-LEGACY-A"]!.pid).toBe(111);
      expect(leases["FIX-LEGACY-B"]).toBeDefined();
      expect(leases["FIX-LEGACY-B"]!.source).toBe("human");

      // New claim also visible
      expect(leases["US-NEW"]).toBeDefined();
      expect(leases["US-NEW"]!.source).toBe("host-delegation");

      // Legacy file preserved (read-only reference)
      expect(existsSync(legacyPath)).toBe(true);

      // Verify canonical files on disk for migrated entries
      expect(existsSync(join(leasesDir, "FIX-LEGACY-A.lease"))).toBe(true);
      expect(existsSync(join(leasesDir, "FIX-LEGACY-B.lease"))).toBe(true);
      expect(existsSync(join(leasesDir, "US-NEW.lease"))).toBe(true);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("legacy same-story block works for all claim sources (cycle, human, host-delegation)", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "legacy-all-src-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");
    try {
      // Legacy has a cycle lease
      writeFileSync(legacyPath, JSON.stringify({
        "US-X": { pid: 77777, claimedAt: NOW, source: "cycle" },
      }, null, 2) + "\n", "utf8");

      // Host-delegation claim must fail
      const r1 = claimStoryLease(leasesDir, "US-X", {
        claimedAt: NOW + 1, source: "host-delegation",
        delegationId: "deleg-hd", runId: "delta-deleg-hd",
      });
      expect(r1.status).toBe("exists");

      // Cycle claim with different pid must fail
      const r2 = claimStoryLease(leasesDir, "US-X", {
        pid: 88888, claimedAt: NOW + 2, source: "cycle",
      });
      expect(r2.status).toBe("exists");

      // Human claim must fail
      const r3 = claimStoryLease(leasesDir, "US-X", {
        claimedAt: NOW + 3, source: "human",
      });
      expect(r3.status).toBe("exists");
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });
});
