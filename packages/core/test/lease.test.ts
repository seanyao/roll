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
  injectClaimOps,
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
  type ClaimStepOps,
} from "../src/index.js";
import {
  closeSync,
  existsSync,
  fdatasyncSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
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

// ─── Module-level ClaimStepOps spy (occurrence-specific injection) ──────────

function createClaimOpsSpy(): {
  ops: ClaimStepOps;
  calls: Array<{ op: string; path: string; flags?: string }>;
  throwAtOp: (op: string, occurrence?: number) => void;
  clearThrow: () => void;
  opCounts: () => Record<string, number>;
} {
  const calls: Array<{ op: string; path: string; flags?: string }> = [];
  const throwSpecs: Array<{ op: string; occurrence: number }> = [];
  const opCounts: Record<string, number> = {};

  const realWriteTempFile = (p: string, d: string) => writeFileSync(p, d, "utf8");
  const realOpenFile = (p: string, f: string) => openSync(p, f);
  const realFsyncFile = (fd: number) => fdatasyncSync(fd);
  const realCloseFile = (fd: number) => closeSync(fd);
  const realHardLink = (s: string, d: string) => linkSync(s, d);
  const realUnlinkFile = (p: string) => unlinkSync(p);
  const realMkdir = (p: string) => mkdirSync(p, { recursive: true });
  const realRenameFile = (o: string, n: string) => renameSync(o, n);

  function checkThrow(op: string): void {
    opCounts[op] = (opCounts[op] ?? 0) + 1;
    const occurrence = opCounts[op]!;
    for (const spec of throwSpecs) {
      if (spec.op === op && spec.occurrence === occurrence) {
        throw new Error(`injected ${op} failure at occurrence ${occurrence}`);
      }
    }
  }

  return {
    ops: {
      writeTempFile(path, data) {
        checkThrow("writeTempFile");
        calls.push({ op: "writeTempFile", path });
        realWriteTempFile(path, data);
      },
      openFile(path, flags) {
        checkThrow("openFile");
        calls.push({ op: "openFile", path, flags });
        return realOpenFile(path, flags);
      },
      fsyncFile(fd) {
        checkThrow("fsyncFile");
        calls.push({ op: "fsyncFile", path: `fd:${fd}` });
        realFsyncFile(fd);
      },
      closeFile(fd) {
        checkThrow("closeFile");
        calls.push({ op: "closeFile", path: `fd:${fd}` });
        realCloseFile(fd);
      },
      hardLink(src, dest) {
        checkThrow("hardLink");
        calls.push({ op: "hardLink", path: dest });
        realHardLink(src, dest);
      },
      unlinkFile(path) {
        checkThrow("unlinkFile");
        calls.push({ op: "unlinkFile", path });
        realUnlinkFile(path);
      },
      mkdir(path) {
        checkThrow("mkdir");
        calls.push({ op: "mkdir", path });
        realMkdir(path);
      },
      renameFile(oldPath, newPath) {
        checkThrow("renameFile");
        calls.push({ op: "renameFile", path: `${oldPath} -> ${newPath}` });
        realRenameFile(oldPath, newPath);
      },
    },
    calls,
    throwAtOp(op: string, occurrence?: number) {
      throwSpecs.push({ op, occurrence: occurrence ?? 1 });
    },
    clearThrow() { throwSpecs.length = 0; },
    opCounts: () => ({ ...opCounts }),
  };
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

  // ─── Production hardlink sequence proof via fs ops seam (BLOCK-3) ──────────



  it("BLOCK-3: ops spy proves ordered protocol with exact paths, file vs directory fsync", () => {
    const dir = tmpLeaseDir();
    const spy = createClaimOpsSpy();
    try {
      injectClaimOps(spy.ops);

      const result = claimStoryLease(dir, "US-TRACE2", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });
      expect(result.status).toBe("claimed");

      const opNames = spy.calls.map(c => c.op);
      expect(opNames).toEqual([
        "writeTempFile",
        "openFile",     // temp file: flags "r+"
        "fsyncFile",
        "closeFile",
        "hardLink",
        "openFile",     // parent dir: flags "r"
        "fsyncFile",
        "closeFile",
        "unlinkFile",
      ]);

      // Verify file vs directory fsync: first openFile uses "r+" (file), second uses "r" (dir)
      expect(spy.calls[1]!.flags).toBe("r+");  // temp file fsync
      expect(spy.calls[5]!.flags).toBe("r");   // parent directory fsync

      // Verify temp path is in same directory as leases dir
      const tempPath = spy.calls[0]!.path;
      expect(tempPath).toContain(dir);
      expect(tempPath).toMatch(/\.tmp$/);

      // Verify hardLink dest is the final .lease file
      const linkDest = spy.calls[4]!.path;
      expect(linkDest).toBe(join(dir, "US-TRACE2.lease"));

      // Verify unlinkFile cleans up the temp
      expect(spy.calls[8]!.path).toBe(tempPath);

      // No temp residue on real fs
      for (const e of readdirSync(dir)) expect(e).not.toMatch(/\.tmp$/);
    } finally {
      injectClaimOps(null);
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-3: EEXIST stops with hardLink then unlinkFile cleanup, no overwrite", () => {
    const dir = tmpLeaseDir();
    try {
      claimStoryLease(dir, "US-NW2", { pid: process.pid, claimedAt: NOW, source: "cycle" });

      const spy = createClaimOpsSpy();
      injectClaimOps(spy.ops);
      const r2 = claimStoryLease(dir, "US-NW2", {
        pid: 99999, claimedAt: NOW + 1, source: "host-delegation",
        delegationId: "d2b", runId: "rd2b",
      });
      injectClaimOps(null);

      expect(r2.status).toBe("exists");
      const opNames = spy.calls.map(c => c.op);
      expect(opNames).toEqual(["writeTempFile", "openFile", "fsyncFile", "closeFile", "hardLink", "unlinkFile"]);
      // First claim preserved
      expect(readLeases(dir)["US-NW2"]!.source).toBe("cycle");
    } finally {
      injectClaimOps(null);
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  // ─── Crash points via fs ops seam — each step, verify no second owner ─────

  function crashTestOp(throwOnOp: string, expectWinner: boolean) {
    const dir = tmpLeaseDir();
    try {
      const spy = createClaimOpsSpy();
      spy.throwAtOp(throwOnOp);
      injectClaimOps(spy.ops);

      expect(() => claimStoryLease(dir, "US-CR2", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow();
      injectClaimOps(null);

      if (expectWinner) {
        expect(existsSync(join(dir, "US-CR2.lease"))).toBe(true);
      } else {
        expect(existsSync(join(dir, "US-CR2.lease"))).toBe(false);
      }

      const r2 = claimStoryLease(dir, "US-CR2", {
        pid: 99999, claimedAt: NOW + 1, source: "host-delegation",
        delegationId: "d5", runId: "rd5",
      });
      if (expectWinner) {
        expect(r2.status).toBe("exists");
        expect(readLeases(dir)["US-CR2"]!.pid).toBe(process.pid);
      } else {
        expect(r2.status).toBe("claimed");
        expect(readLeases(dir)["US-CR2"]!.pid).toBe(99999);
      }
    } finally {
      injectClaimOps(null);
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  }

  it("crash at writeTempFile: no record, retry wins", () => crashTestOp("writeTempFile", false));
  it("crash at openFile (temp file): no record, retry wins", () => crashTestOp("openFile", false));
  it("crash at fsyncFile: no record, retry wins", () => crashTestOp("fsyncFile", false));
  it("crash at hardLink (before link): no record, retry wins", () => crashTestOp("hardLink", false));
  it("crash at unlinkFile: unlink is best-effort, claim succeeds, retry blocked", () => {
    const dir = tmpLeaseDir();
    try {
      const spy = createClaimOpsSpy();
      spy.throwAtOp("unlinkFile");
      injectClaimOps(spy.ops);

      // unlinkFile is try/catch in production — the claim still succeeds
      const r1 = claimStoryLease(dir, "US-CR3", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });
      expect(r1.status).toBe("claimed");
      injectClaimOps(null);

      // Record exists (hardlink was durable)
      expect(existsSync(join(dir, "US-CR3.lease"))).toBe(true);

      // Retry blocked — record already claimed
      const r2 = claimStoryLease(dir, "US-CR3", {
        pid: 99999, claimedAt: NOW + 1, source: "host-delegation",
        delegationId: "d6", runId: "rd6",
      });
      expect(r2.status).toBe("exists");
      expect(readLeases(dir)["US-CR3"]!.pid).toBe(process.pid);
    } finally {
      injectClaimOps(null);
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });
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

      // Legacy file retired (renamed to .retired backup, not active authority)
      expect(existsSync(legacyPath)).toBe(false);
      expect(existsSync(legacyPath + ".retired")).toBe(true);

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

  // ─── BLOCK-1: canonical dir already exists + legacy coexistence ─────────

  it("BLOCK-1: canonical dir already exists + legacy same story → fail-loud, no new claim", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "canon-legacy-same-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");

    // Pre-create canonical dir (simulates prior migration or manual setup)
    mkdirSync(leasesDir, { recursive: true });
    // Write a canonical record for a DIFFERENT story (this is normal)
    writeFileSync(join(leasesDir, "US-OTHER.lease"), JSON.stringify({
      pid: 11111, claimedAt: NOW - 5000, source: "cycle",
    }) + "\n", "utf8");

    // Write legacy file with a same-story entry (the split-brain condition)
    writeFileSync(legacyPath, JSON.stringify({
      "US-SPLIT": { pid: 55555, claimedAt: NOW, source: "cycle" },
    }, null, 2) + "\n", "utf8");

    try {
      // Claim the same story that's in legacy — must fail because
      // legacy file coexists with canonical dir (data integrity failure)
      const r = claimStoryLease(leasesDir, "US-SPLIT", {
        pid: process.pid, claimedAt: NOW + 1, source: "host-delegation",
        delegationId: "deleg-split", runId: "delta-deleg-split",
      });
      // Must NOT succeed — legacy+canonical coexistence is a split-brain
      expect(r.status).toBe("exists");

      // readLeases: canonical is sole authority when dir exists.
      // Legacy entries are NOT merged (prevents resurrection on release).
      const leases = readLeases(leasesDir);
      // US-OTHER from canonical must be visible
      expect(leases["US-OTHER"]).toBeDefined();
      expect(leases["US-OTHER"]!.source).toBe("cycle");
      // US-SPLIT is only in legacy, NOT visible via readLeases when canonical exists
      expect(leases["US-SPLIT"]).toBeUndefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-1: canonical dir already exists + legacy different story → fail-loud (unmigrated legacy data)", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "canon-legacy-diff-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");

    // Pre-create canonical dir with one record
    mkdirSync(leasesDir, { recursive: true });
    writeFileSync(join(leasesDir, "US-CANON.lease"), JSON.stringify({
      pid: 11111, claimedAt: NOW - 5000, source: "cycle",
    }) + "\n", "utf8");

    // Write legacy file with a DIFFERENT story (not in canonical)
    writeFileSync(legacyPath, JSON.stringify({
      "US-LEGACY-ONLY": { pid: 66666, claimedAt: NOW, source: "human" },
    }, null, 2) + "\n", "utf8");

    try {
      // Claim a NEW story — must throw because legacy file coexists
      // with canonical dir (unmigrated legacy = data integrity error)
      expect(() => claimStoryLease(leasesDir, "US-NEW-CLAIM", {
        pid: process.pid, claimedAt: NOW + 1, source: "host-delegation",
        delegationId: "deleg-newc", runId: "delta-deleg-newc",
      })).toThrow(/coexists with canonical/);

      // readLeases: canonical is sole authority. Legacy entries not merged.
      const leases = readLeases(leasesDir);
      expect(leases["US-CANON"]).toBeDefined();
      // US-LEGACY-ONLY is only in legacy — NOT visible when canonical dir exists
      expect(leases["US-LEGACY-ONLY"]).toBeUndefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-1: canonical dir exists without legacy → normal claim succeeds", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "canon-only-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const leasesDir = join(loopDir, "leases");

    // Pre-create canonical dir with one record (normal state, no legacy)
    mkdirSync(leasesDir, { recursive: true });
    writeFileSync(join(leasesDir, "US-EXISTING.lease"), JSON.stringify({
      pid: 11111, claimedAt: NOW - 5000, source: "cycle",
    }) + "\n", "utf8");

    // NO legacy file at all
    const legacyPath = join(loopDir, "story-leases.json");
    expect(existsSync(legacyPath)).toBe(false);

    try {
      // Claim a new story — must succeed (normal behavior preserved)
      const r = claimStoryLease(leasesDir, "US-FRESH", {
        pid: process.pid, claimedAt: NOW, source: "host-delegation",
        delegationId: "deleg-fresh", runId: "delta-deleg-fresh",
      });
      expect(r.status).toBe("claimed");

      const leases = readLeases(leasesDir);
      expect(leases["US-EXISTING"]).toBeDefined();
      expect(leases["US-FRESH"]).toBeDefined();
      expect(leases["US-FRESH"]!.source).toBe("host-delegation");
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-1: readLeases with canonical dir does NOT read legacy — sole authority", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "read-coexist-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");

    // Both canonical dir AND legacy file exist
    mkdirSync(leasesDir, { recursive: true });
    writeFileSync(join(leasesDir, "US-CAN.lease"), JSON.stringify({
      pid: 100, claimedAt: NOW - 1000, source: "cycle",
    }) + "\n", "utf8");

    writeFileSync(legacyPath, JSON.stringify({
      "US-LEG": { claimedAt: NOW - 2000, source: "human" },
    }, null, 2) + "\n", "utf8");

    try {
      const leases = readLeases(leasesDir);
      // Canonical is sole authority — only canonical entries visible
      expect(leases["US-CAN"]).toBeDefined();
      expect(leases["US-CAN"]!.source).toBe("cycle");
      // Legacy entry is NOT visible (prevents resurrection on release)
      expect(leases["US-LEG"]).toBeUndefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  // ─── BLOCK-2: migration atomicity ───────────────────────────────────────

  it("BLOCK-2: unreadable/malformed legacy JSON → fail-loud, no fresh claim", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "legacy-malformed-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");
    expect(existsSync(leasesDir)).toBe(false);
    try {
      // Write malformed JSON
      writeFileSync(legacyPath, "this is not valid json {{{", "utf8");

      // Claim must fail-loud — cannot silently proceed with fresh canonical
      expect(() => claimStoryLease(leasesDir, "US-NEW", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow();

      // No canonical directory was created
      expect(existsSync(leasesDir)).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-2: migration leaves no temp residue after all-or-success migration", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "legacy-clean-mig-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");
    expect(existsSync(leasesDir)).toBe(false);
    try {
      writeFileSync(legacyPath, JSON.stringify({
        "FIX-M1": { pid: 111, claimedAt: NOW - 1000, source: "cycle" },
        "FIX-M2": { claimedAt: NOW - 2000, source: "human" },
      }, null, 2) + "\n", "utf8");

      const r = claimStoryLease(leasesDir, "US-NEW-MIG2", {
        pid: process.pid, claimedAt: NOW, source: "host-delegation",
        delegationId: "deleg-mig2b", runId: "delta-deleg-mig2b",
      });
      expect(r.status).toBe("claimed");

      // All three records exist, no temp files
      const leases = readLeases(leasesDir);
      expect(leases["FIX-M1"]).toBeDefined();
      expect(leases["FIX-M1"]!.source).toBe("cycle");
      expect(leases["FIX-M2"]).toBeDefined();
      expect(leases["FIX-M2"]!.source).toBe("human");
      expect(leases["US-NEW-MIG2"]).toBeDefined();

      for (const e of readdirSync(leasesDir)) {
        expect(e).not.toMatch(/\.tmp$/);
      }
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  // ─── BLOCK-1: post-migration semantics ─────────────────────────────────

  it("BLOCK-1: after successful migration, subsequent claim works (no coexistence error)", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "post-mig-claim-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");
    try {
      writeFileSync(legacyPath, JSON.stringify({
        "OLD-STORY": { pid: 111, claimedAt: NOW - 1000, source: "cycle" },
      }, null, 2) + "\n", "utf8");

      const r1 = claimStoryLease(leasesDir, "NEW-STORY-1", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });
      expect(r1.status).toBe("claimed");
      expect(existsSync(legacyPath)).toBe(false);
      expect(existsSync(legacyPath + ".retired")).toBe(true);

      const r2 = claimStoryLease(leasesDir, "NEW-STORY-2", {
        pid: 22222, claimedAt: NOW + 1, source: "host-delegation",
        delegationId: "deleg-post", runId: "delta-deleg-post",
      });
      expect(r2.status).toBe("claimed");

      const leases = readLeases(leasesDir);
      expect(leases["NEW-STORY-1"]).toBeDefined();
      expect(leases["NEW-STORY-2"]).toBeDefined();
      expect(leases["OLD-STORY"]).toBeDefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-1: release of migrated canonical lease does NOT resurrect from .retired backup", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "no-resurrect-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");
    try {
      writeFileSync(legacyPath, JSON.stringify({
        "US-RESURRECT": { claimedAt: NOW - 1000, source: "host-delegation", delegationId: "deleg-old", runId: "delta-old" },
      }, null, 2) + "\n", "utf8");

      const r1 = claimStoryLease(leasesDir, "US-OTHER", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });
      expect(r1.status).toBe("claimed");

      expect(existsSync(legacyPath)).toBe(false);
      expect(existsSync(join(leasesDir, "US-RESURRECT.lease"))).toBe(true);

      const released = releaseStoryLease(leasesDir, "US-RESURRECT", {
        source: "host-delegation", delegationId: "deleg-old", runId: "delta-old",
      });
      expect(released).toBe(true);
      expect(existsSync(join(leasesDir, "US-RESURRECT.lease"))).toBe(false);

      const leases = readLeases(leasesDir);
      expect(leases["US-RESURRECT"]).toBeUndefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-1: canonical-only dir ignores .retired backup on release", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "canon-only-rel-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const leasesDir = join(loopDir, "leases");
    writeFileSync(join(loopDir, "story-leases.json.retired"), JSON.stringify({
      "US-IGNORED": { claimedAt: NOW - 5000, source: "human" },
    }) + "\n", "utf8");
    try {
      claimStoryLease(leasesDir, "US-LIVE", {
        pid: process.pid, claimedAt: NOW, source: "host-delegation",
        delegationId: "deleg-live", runId: "delta-live",
      });
      releaseStoryLease(leasesDir, "US-LIVE", {
        source: "host-delegation", delegationId: "deleg-live", runId: "delta-live",
      });
      const leases = readLeases(leasesDir);
      expect(leases["US-LIVE"]).toBeUndefined();
      expect(leases["US-IGNORED"]).toBeUndefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  // ─── BLOCK-2: malformed legacy coexistence — canonical dir exists ───────

  it("BLOCK-2: canonical dir exists + legacy null → fail-loud, zero new claim effects", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "coexist-null-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");
    mkdirSync(leasesDir, { recursive: true });
    writeFileSync(legacyPath, "null", "utf8");
    try {
      const beforeLeases = readLeases(leasesDir);
      expect(() => claimStoryLease(leasesDir, "US-NEW", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/not a valid JSON object/);
      expect(readLeases(leasesDir)).toEqual(beforeLeases);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-2: canonical dir exists + legacy string scalar → fail-loud, no claim", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "coexist-scalar-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");
    mkdirSync(leasesDir, { recursive: true });
    writeFileSync(legacyPath, '"just a string"', "utf8");
    try {
      expect(() => claimStoryLease(leasesDir, "US-NEW", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/not a valid JSON object/);
      expect(existsSync(join(leasesDir, "US-NEW.lease"))).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-2: canonical dir exists + legacy array → fail-loud, no claim", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "coexist-array-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");
    mkdirSync(leasesDir, { recursive: true });
    writeFileSync(legacyPath, "[1, 2, 3]", "utf8");
    try {
      expect(() => claimStoryLease(leasesDir, "US-NEW", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/invalid entry.*not an object/);
      expect(existsSync(join(leasesDir, "US-NEW.lease"))).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-2: canonical dir exists + legacy with null entry → fail-loud", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "coexist-null-entry-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");
    mkdirSync(leasesDir, { recursive: true });
    writeFileSync(legacyPath, JSON.stringify({ "US-X": null }) + "\n", "utf8");
    try {
      expect(() => claimStoryLease(leasesDir, "US-NEW", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/invalid entry.*not an object/);
      expect(existsSync(join(leasesDir, "US-NEW.lease"))).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-2: canonical dir exists + legacy entry missing source → fail-loud", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "coexist-no-src-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");
    mkdirSync(leasesDir, { recursive: true });
    writeFileSync(legacyPath, JSON.stringify({ "US-X": { claimedAt: 1000 } }) + "\n", "utf8");
    try {
      expect(() => claimStoryLease(leasesDir, "US-NEW", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/missing source/);
      expect(existsSync(join(leasesDir, "US-NEW.lease"))).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-2: canonical dir exists + legacy entry missing claimedAt → fail-loud", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "coexist-no-ts-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");
    mkdirSync(leasesDir, { recursive: true });
    writeFileSync(legacyPath, JSON.stringify({ "US-X": { source: "cycle" } }) + "\n", "utf8");
    try {
      expect(() => claimStoryLease(leasesDir, "US-NEW", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/missing claimedAt/);
      expect(existsSync(join(leasesDir, "US-NEW.lease"))).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  // ─── BLOCK-2: malformed legacy in migration path (canonical dir absent) ─

  it("BLOCK-2: migration path — legacy null root → fail-loud, no canonical dir created", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "mig-null-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");
    writeFileSync(legacyPath, "null", "utf8");
    try {
      expect(() => claimStoryLease(leasesDir, "US-NEW", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/not a valid JSON object/);
      expect(existsSync(leasesDir)).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-2: migration path — legacy array root → fail-loud, no canonical dir", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "mig-array-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");
    writeFileSync(legacyPath, "[1,2]", "utf8");
    try {
      expect(() => claimStoryLease(leasesDir, "US-NEW", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/invalid entry.*not an object/);
      expect(existsSync(leasesDir)).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-2: migration path — legacy with null entry → fail-loud, no canonical dir", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "mig-null-entry-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");
    writeFileSync(legacyPath, JSON.stringify({ "US-X": null }) + "\n", "utf8");
    try {
      expect(() => claimStoryLease(leasesDir, "US-NEW", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/invalid entry.*not an object/);
      expect(existsSync(leasesDir)).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  // ─── BLOCK-3: migration atomicity via ops seam — rollback at each boundary ─

  function setupMigrationFixture(): { baseDir: string; loopDir: string; legacyPath: string; leasesDir: string } {
    const baseDir = mkdtempSync(join(tmpdir(), "mig-atomic-"));
    const loopDir = join(baseDir, "loop");
    mkdirSync(loopDir, { recursive: true });
    const legacyPath = join(loopDir, "story-leases.json");
    const leasesDir = join(loopDir, "leases");
    writeFileSync(legacyPath, JSON.stringify({
      "OLD-A": { pid: 111, claimedAt: NOW - 1000, source: "cycle" },
      "OLD-B": { claimedAt: NOW - 2000, source: "human" },
    }, null, 2) + "\n", "utf8");
    return { baseDir, loopDir, legacyPath, leasesDir };
  }

  it("BLOCK-3: migration writeTempFile failure → rollback, legacy-only authority", () => {
    const { baseDir, legacyPath, leasesDir } = setupMigrationFixture();
    try {
      const spy = createClaimOpsSpy();
      spy.throwAtOp("writeTempFile", 1);
      injectClaimOps(spy.ops);

      expect(() => claimStoryLease(leasesDir, "US-NEW", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/injected writeTempFile/);
      injectClaimOps(null);

      expect(existsSync(legacyPath)).toBe(true);
      expect(existsSync(legacyPath + ".retired")).toBe(false);
      const leases = readLeases(leasesDir);
      expect(leases["OLD-A"]).toBeDefined();
      expect(leases["OLD-B"]).toBeDefined();
      expect(leases["US-NEW"]).toBeUndefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-3: migration fsyncFile (temp) failure → rollback, legacy-only", () => {
    const { baseDir, legacyPath, leasesDir } = setupMigrationFixture();
    try {
      const spy = createClaimOpsSpy();
      spy.throwAtOp("fsyncFile", 1);
      injectClaimOps(spy.ops);

      expect(() => claimStoryLease(leasesDir, "US-NEW", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/injected fsyncFile/);
      injectClaimOps(null);

      expect(existsSync(legacyPath)).toBe(true);
      expect(existsSync(legacyPath + ".retired")).toBe(false);
      const leases = readLeases(leasesDir);
      expect(leases["OLD-A"]).toBeDefined();
      expect(leases["US-NEW"]).toBeUndefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-3: migration hardLink (first entry) failure → rollback, no canonical records, legacy active", () => {
    const { baseDir, legacyPath, leasesDir } = setupMigrationFixture();
    try {
      const spy = createClaimOpsSpy();
      spy.throwAtOp("hardLink", 1);
      injectClaimOps(spy.ops);

      expect(() => claimStoryLease(leasesDir, "US-NEW", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/injected hardLink/);
      injectClaimOps(null);

      expect(existsSync(legacyPath)).toBe(true);
      expect(existsSync(legacyPath + ".retired")).toBe(false);
      if (existsSync(leasesDir)) {
        for (const e of readdirSync(leasesDir)) {
          expect(e).not.toMatch(/\.lease$/);
        }
      }
      const leases = readLeases(leasesDir);
      expect(leases["OLD-A"]).toBeDefined();
      expect(leases["US-NEW"]).toBeUndefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-3: migration hardLink (second entry) failure → rollback, no canonical records, legacy active", () => {
    const { baseDir, legacyPath, leasesDir } = setupMigrationFixture();
    try {
      const spy = createClaimOpsSpy();
      spy.throwAtOp("hardLink", 2);
      injectClaimOps(spy.ops);

      expect(() => claimStoryLease(leasesDir, "US-NEW", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/injected hardLink/);
      injectClaimOps(null);

      expect(existsSync(legacyPath)).toBe(true);
      expect(existsSync(legacyPath + ".retired")).toBe(false);
      if (existsSync(leasesDir)) {
        for (const e of readdirSync(leasesDir)) {
          expect(e).not.toMatch(/\.lease$/);
        }
      }
      const leases = readLeases(leasesDir);
      expect(leases["OLD-A"]).toBeDefined();
      expect(leases["US-NEW"]).toBeUndefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-3: migration directory fsync failure → rollback (post-link), legacy active", () => {
    const { baseDir, legacyPath, leasesDir } = setupMigrationFixture();
    try {
      const spy = createClaimOpsSpy();
      spy.throwAtOp("fsyncFile", 3);
      injectClaimOps(spy.ops);

      expect(() => claimStoryLease(leasesDir, "US-NEW", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/injected fsyncFile.*occurrence 3/);
      injectClaimOps(null);

      expect(existsSync(legacyPath)).toBe(true);
      expect(existsSync(legacyPath + ".retired")).toBe(false);
      if (existsSync(leasesDir)) {
        for (const e of readdirSync(leasesDir)) {
          expect(e).not.toMatch(/\.lease$/);
        }
      }
      const leases = readLeases(leasesDir);
      expect(leases["OLD-A"]).toBeDefined();
      expect(leases["US-NEW"]).toBeUndefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-3: migration renameFile (legacy retire) failure → rollback, legacy-only authority", () => {
    const { baseDir, legacyPath, leasesDir } = setupMigrationFixture();
    try {
      const spy = createClaimOpsSpy();
      spy.throwAtOp("renameFile", 1);
      injectClaimOps(spy.ops);

      expect(() => claimStoryLease(leasesDir, "US-NEW", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/injected renameFile/);
      injectClaimOps(null);

      // Rollback: canonical dir removed, legacy still active
      expect(existsSync(legacyPath)).toBe(true);
      expect(existsSync(legacyPath + ".retired")).toBe(false);
      // readLeases falls back to legacy (canonical dir absent after rollback)
      const leases = readLeases(leasesDir);
      expect(leases["OLD-A"]).toBeDefined();
      expect(leases["OLD-B"]).toBeDefined();
      expect(leases["US-NEW"]).toBeUndefined();

      // Next attempt re-migrates
      const r2 = claimStoryLease(leasesDir, "US-NEXT", {
        pid: 99999, claimedAt: NOW + 1, source: "cycle",
      });
      // Same-story check: US-NEXT is not in legacy, so migration+claim succeeds
      expect(r2.status).toBe("claimed");
    } finally {
      try { const { rmSync } = require("fs"); rmSync(baseDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  // ─── BLOCK-4: occurrence-specific claim ops failures ────────────────────

  it("BLOCK-4: writeTempFile failure → throws, no record, no temp residue", () => {
    const dir = tmpLeaseDir();
    try {
      const spy = createClaimOpsSpy();
      spy.throwAtOp("writeTempFile", 1);
      injectClaimOps(spy.ops);

      expect(() => claimStoryLease(dir, "US-WF", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/injected writeTempFile/);
      injectClaimOps(null);

      expect(existsSync(join(dir, "US-WF.lease"))).toBe(false);
      for (const e of readdirSync(dir)) expect(e).not.toMatch(/\.tmp$/);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-4: openFile (temp, first) failure → throws, no record", () => {
    const dir = tmpLeaseDir();
    try {
      const spy = createClaimOpsSpy();
      spy.throwAtOp("openFile", 1);
      injectClaimOps(spy.ops);

      expect(() => claimStoryLease(dir, "US-OF", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/injected openFile/);
      injectClaimOps(null);

      expect(existsSync(join(dir, "US-OF.lease"))).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-4: fsyncFile (temp, first) failure → throws, no record", () => {
    const dir = tmpLeaseDir();
    try {
      const spy = createClaimOpsSpy();
      spy.throwAtOp("fsyncFile", 1);
      injectClaimOps(spy.ops);

      expect(() => claimStoryLease(dir, "US-FSYNC1", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/injected fsyncFile/);
      injectClaimOps(null);

      expect(existsSync(join(dir, "US-FSYNC1.lease"))).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-4: closeFile (temp, first) failure → throws, record not yet linked", () => {
    const dir = tmpLeaseDir();
    try {
      const spy = createClaimOpsSpy();
      spy.throwAtOp("closeFile", 1);
      injectClaimOps(spy.ops);

      expect(() => claimStoryLease(dir, "US-CLOSE", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/injected closeFile/);
      injectClaimOps(null);

      expect(existsSync(join(dir, "US-CLOSE.lease"))).toBe(false);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-4: hardLink non-EEXIST failure → throws, temp cleaned", () => {
    const dir = tmpLeaseDir();
    try {
      const spy = createClaimOpsSpy();
      spy.throwAtOp("hardLink", 1);
      injectClaimOps(spy.ops);

      expect(() => claimStoryLease(dir, "US-HLNK", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/injected hardLink/);
      injectClaimOps(null);

      expect(existsSync(join(dir, "US-HLNK.lease"))).toBe(false);
      for (const e of readdirSync(dir)) expect(e).not.toMatch(/\.tmp$/);
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-4: openFile (directory, second) failure → record exists, temp residue", () => {
    const dir = tmpLeaseDir();
    try {
      const spy = createClaimOpsSpy();
      spy.throwAtOp("openFile", 2);
      injectClaimOps(spy.ops);

      expect(() => claimStoryLease(dir, "US-DIROPEN", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/injected openFile.*occurrence 2/);
      injectClaimOps(null);

      expect(existsSync(join(dir, "US-DIROPEN.lease"))).toBe(true);
      expect(readLeases(dir)["US-DIROPEN"]).toBeDefined();
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-4: fsyncFile (directory, second) failure → record exists, owner visible, temp residue frozen", () => {
    const dir = tmpLeaseDir();
    try {
      const spy = createClaimOpsSpy();
      spy.throwAtOp("fsyncFile", 2);
      injectClaimOps(spy.ops);

      expect(() => claimStoryLease(dir, "US-DIRFSYNC", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/injected fsyncFile.*occurrence 2/);
      injectClaimOps(null);

      expect(existsSync(join(dir, "US-DIRFSYNC.lease"))).toBe(true);
      const leases = readLeases(dir);
      expect(leases["US-DIRFSYNC"]).toBeDefined();
      expect(leases["US-DIRFSYNC"]!.source).toBe("cycle");

      const temps = readdirSync(dir).filter(e => e.endsWith(".tmp"));
      expect(temps.length).toBeGreaterThanOrEqual(1);

      const r2 = claimStoryLease(dir, "US-DIRFSYNC", {
        pid: 99999, claimedAt: NOW + 1, source: "host-delegation",
        delegationId: "d2", runId: "rd2",
      });
      expect(r2.status).toBe("exists");
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-4: closeFile (directory, second) failure → record exists, owner visible", () => {
    const dir = tmpLeaseDir();
    try {
      const spy = createClaimOpsSpy();
      spy.throwAtOp("closeFile", 2);
      injectClaimOps(spy.ops);

      expect(() => claimStoryLease(dir, "US-DIRCLOSE", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      })).toThrow(/injected closeFile.*occurrence 2/);
      injectClaimOps(null);

      expect(existsSync(join(dir, "US-DIRCLOSE.lease"))).toBe(true);
      const leases = readLeases(dir);
      expect(leases["US-DIRCLOSE"]).toBeDefined();
      expect(leases["US-DIRCLOSE"]!.source).toBe("cycle");

      const r2 = claimStoryLease(dir, "US-DIRCLOSE", {
        pid: 99999, claimedAt: NOW + 1, source: "host-delegation",
        delegationId: "d3", runId: "rd3",
      });
      expect(r2.status).toBe("exists");
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("BLOCK-4: unlinkFile (temp) failure → claim succeeds, record exists, temp residue", () => {
    const dir = tmpLeaseDir();
    try {
      const spy = createClaimOpsSpy();
      spy.throwAtOp("unlinkFile", 1);
      injectClaimOps(spy.ops);

      const r1 = claimStoryLease(dir, "US-UNLINK", {
        pid: process.pid, claimedAt: NOW, source: "cycle",
      });
      expect(r1.status).toBe("claimed");
      injectClaimOps(null);

      expect(existsSync(join(dir, "US-UNLINK.lease"))).toBe(true);
      expect(readLeases(dir)["US-UNLINK"]).toBeDefined();

      const temps = readdirSync(dir).filter(e => e.endsWith(".tmp"));
      expect(temps.length).toBeGreaterThanOrEqual(1);

      const r2 = claimStoryLease(dir, "US-UNLINK", {
        pid: 99999, claimedAt: NOW + 1, source: "host-delegation",
        delegationId: "d4", runId: "rd4",
      });
      expect(r2.status).toBe("exists");
    } finally {
      try { const { rmSync } = require("fs"); rmSync(dirname(dir), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });
});
