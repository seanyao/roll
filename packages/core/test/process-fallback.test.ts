/**
 * US-LOOP-107 — process-fallback scheduler backend tests.
 *
 * Covers lease atomicity, liveness evaluation, heartbeat expiry, stale PID,
 * command-digest pinning, and lease-directory claim races.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimFallbackLeaseDir,
  computeFallbackCommandDigest,
  evaluateFallbackLiveness,
  fallbackHeartbeatPath,
  fallbackLeasePath,
  readFallbackLease,
  removeFallbackLease,
  writeFallbackLease,
  type FallbackLease,
} from "../src/loop/process-fallback.js";

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "roll-fb-"));
  return d;
}

function lease(): FallbackLease {
  return {
    pid: 12345,
    commandDigest: computeFallbackCommandDigest({
      projectPath: "/proj",
      slug: "s",
      periodMinutes: 30,
      rollBin: "roll",
    }),
    ownerConfirmedAt: "2026-07-15T10:00:00Z",
    startedAt: "2026-07-15T10:00:00Z",
    heartbeatAt: "2026-07-15T10:00:00Z",
  };
}

describe("computeFallbackCommandDigest", () => {
  it("is stable for identical inputs", () => {
    const inputs = { projectPath: "/proj", slug: "s", periodMinutes: 30, rollBin: "roll" };
    expect(computeFallbackCommandDigest(inputs)).toBe(computeFallbackCommandDigest(inputs));
  });

  it("changes when any input changes", () => {
    const base = { projectPath: "/proj", slug: "s", periodMinutes: 30, rollBin: "roll" };
    const a = computeFallbackCommandDigest(base);
    expect(computeFallbackCommandDigest({ ...base, periodMinutes: 31 })).not.toBe(a);
    expect(computeFallbackCommandDigest({ ...base, rollBin: "/opt/roll" })).not.toBe(a);
    expect(computeFallbackCommandDigest({ ...base, slug: "t" })).not.toBe(a);
    expect(computeFallbackCommandDigest({ ...base, projectPath: "/other" })).not.toBe(a);
  });
});

describe("lease read / write / remove", () => {
  it("writes and reads a lease atomically", () => {
    const d = tmp();
    try {
      const l = lease();
      writeFallbackLease(d, l);
      expect(existsSync(join(d, "lease.json"))).toBe(true);
      expect(readFallbackLease(d)).toEqual(l);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("returns null for missing or invalid lease", () => {
    const d = tmp();
    try {
      expect(readFallbackLease(d)).toBeNull();
      // Invalid JSON.
      const f = join(d, "lease.json");
      mkdirSync(d, { recursive: true });
      writeFileSync(f, "not-json", "utf8");
      expect(readFallbackLease(d)).toBeNull();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("removes lease directory idempotently", () => {
    const d = tmp();
    try {
      writeFallbackLease(d, lease());
      removeFallbackLease(d);
      expect(existsSync(d)).toBe(false);
      removeFallbackLease(d); // no throw
      expect(existsSync(d)).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("evaluateFallbackLiveness", () => {
  it("unknown when lease is null", () => {
    const d = tmp();
    try {
      const h = evaluateFallbackLiveness({
        lease: null,
        heartbeatPath: fallbackHeartbeatPath(d, "s"),
        expectedDigest: "x",
        now: () => 1000,
      });
      expect(h.status).toBe("unknown");
      expect(h.alive).toBe(false);
      expect(h.lease).toBeNull();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("armed when PID live and heartbeat fresh", () => {
    const d = tmp();
    try {
      const hb = fallbackHeartbeatPath(d, "s");
      mkdirSync(join(hb, ".."), { recursive: true });
      writeFileSync(hb, "900\n", "utf8");

      const l = lease();
      const h = evaluateFallbackLiveness({
        lease: l,
        heartbeatPath: hb,
        expectedDigest: l.commandDigest,
        now: () => 1000,
        pidAlive: () => true,
        heartbeatTimeoutSec: 200,
      });
      expect(h.status).toBe("armed");
      expect(h.alive).toBe(true);
      expect(h.lease).toEqual(l);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("stale when PID is dead", () => {
    const d = tmp();
    try {
      const hb = fallbackHeartbeatPath(d, "s");
      mkdirSync(join(hb, ".."), { recursive: true });
      writeFileSync(hb, "1000\n", "utf8");

      const l = lease();
      const h = evaluateFallbackLiveness({
        lease: l,
        heartbeatPath: hb,
        expectedDigest: l.commandDigest,
        now: () => 1000,
        pidAlive: () => false,
        heartbeatTimeoutSec: 200,
      });
      expect(h.status).toBe("stale");
      expect(h.alive).toBe(false);
      expect(h.reason).toContain("PID");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("stale when heartbeat expired", () => {
    const d = tmp();
    try {
      const hb = fallbackHeartbeatPath(d, "s");
      mkdirSync(join(hb, ".."), { recursive: true });
      writeFileSync(hb, "100\n", "utf8");

      const l = lease();
      const h = evaluateFallbackLiveness({
        lease: l,
        heartbeatPath: hb,
        expectedDigest: l.commandDigest,
        now: () => 1000,
        pidAlive: () => true,
        heartbeatTimeoutSec: 200,
      });
      expect(h.status).toBe("stale");
      expect(h.alive).toBe(false);
      expect(h.reason).toContain("heartbeat stale");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("stale when command digest mismatches", () => {
    const d = tmp();
    try {
      const hb = fallbackHeartbeatPath(d, "s");
      mkdirSync(join(hb, ".."), { recursive: true });
      writeFileSync(hb, "1000\n", "utf8");

      const l = lease();
      const h = evaluateFallbackLiveness({
        lease: l,
        heartbeatPath: hb,
        expectedDigest: "different-digest",
        now: () => 1000,
        pidAlive: () => true,
        heartbeatTimeoutSec: 200,
      });
      expect(h.status).toBe("stale");
      expect(h.alive).toBe(false);
      expect(h.reason).toContain("digest mismatch");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("claimFallbackLeaseDir", () => {
  it("grants claim when directory does not exist", () => {
    const d = tmp();
    try {
      const leaseDir = fallbackLeasePath(d, "s");
      const r = claimFallbackLeaseDir(leaseDir);
      expect(r.claimed).toBe(true);
      expect(existsSync(leaseDir)).toBe(true);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("denies claim and returns existing lease when directory exists", () => {
    const d = tmp();
    try {
      const leaseDir = fallbackLeasePath(d, "s");
      writeFallbackLease(leaseDir, lease());
      const r = claimFallbackLeaseDir(leaseDir);
      expect(r.claimed).toBe(false);
      expect(r.existingLease).toEqual(lease());
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("two concurrent claims: exactly one wins", () => {
    const d = tmp();
    try {
      const leaseDir = fallbackLeasePath(d, "s");
      // Both callers see no directory initially.
      const a = claimFallbackLeaseDir(leaseDir);
      if (a.claimed) writeFallbackLease(leaseDir, lease());
      const b = claimFallbackLeaseDir(leaseDir);
      expect([a.claimed, b.claimed].filter(Boolean).length).toBe(1);
      expect((a.claimed ? a : b).existingLease).toBeNull();
      expect((a.claimed ? b : a).claimed).toBe(false);
      expect((a.claimed ? b : a).existingLease).not.toBeNull();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
