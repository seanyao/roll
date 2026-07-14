import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BrowserLeaseLock, nodeBrowserLeaseLockStore, type BrowserLeaseLockStore } from "../src/browser-operations/lease-lock.js";

class FakeLockStore implements BrowserLeaseLockStore {
  readonly files = new Map<string, string>();

  createExclusive(path: string, text: string): boolean {
    if (this.files.has(path)) return false;
    this.files.set(path, text);
    return true;
  }

  readText(path: string): string | undefined {
    return this.files.get(path);
  }

  remove(path: string): void {
    this.files.delete(path);
  }

  replace(path: string, text: string): void {
    this.files.set(path, text);
  }

  claimStale(path: string, expected: string): boolean {
    if (this.files.get(path) !== expected) return false;
    this.files.delete(path);
    return true;
  }
}

describe("US-BROW-005 — BrowserLeaseLock", () => {
  it("uses the filesystem O_EXCL path across independent lock instances", () => {
    const directory = mkdtempSync(join(tmpdir(), "roll-browser-lock-"));
    try {
      const first = new BrowserLeaseLock(nodeBrowserLeaseLockStore, () => true, () => 1000);
      const second = new BrowserLeaseLock(nodeBrowserLeaseLockStore, () => true, () => 1000);
      const input = {
        directory,
        endpointHash: "endpoint-a",
        leaseId: "lease-a",
        holderPid: 10,
        holderToken: "holder-a",
        expiresAt: "1970-01-01T00:01:00.000Z",
      };

      expect(first.acquire(input).kind).toBe("acquired");
      expect(second.acquire({ ...input, leaseId: "lease-b", holderPid: 11, holderToken: "holder-b" })).toMatchObject({ kind: "held", holderPid: 10 });
      expect(second.acquire({ ...input, endpointHash: "endpoint-b", leaseId: "lease-c", holderPid: 12, holderToken: "holder-c" }).kind).toBe("acquired");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses atomic exclusive creation so a competing holder cannot seize an endpoint", () => {
    const locks = new BrowserLeaseLock(new FakeLockStore(), () => true, () => 1000);
    const first = locks.acquire({
      directory: "/locks",
      endpointHash: "endpoint-a",
      leaseId: "lease-a",
      holderPid: 10,
      holderToken: "holder-a",
      expiresAt: "1970-01-01T00:00:02.000Z",
    });
    const second = locks.acquire({
      directory: "/locks",
      endpointHash: "endpoint-a",
      leaseId: "lease-b",
      holderPid: 11,
      holderToken: "holder-b",
      expiresAt: "1970-01-01T00:00:02.000Z",
    });

    expect(first.kind).toBe("acquired");
    expect(second).toMatchObject({ kind: "held", holderPid: 10 });
  });

  it("reclaims a dead holder and records the orphan for the event ledger", () => {
    const store = new FakeLockStore();
    const locks = new BrowserLeaseLock(store, (pid) => pid !== 10, () => 1000);
    locks.acquire({
      directory: "/locks",
      endpointHash: "endpoint-a",
      leaseId: "lease-a",
      holderPid: 10,
      holderToken: "holder-a",
      expiresAt: "1970-01-01T00:00:00.000Z",
    });

    const reclaimed = locks.acquire({
      directory: "/locks",
      endpointHash: "endpoint-a",
      leaseId: "lease-b",
      holderPid: 11,
      holderToken: "holder-b",
      expiresAt: "1970-01-01T00:01:00.000Z",
    });

    expect(reclaimed).toMatchObject({
      kind: "acquired",
      reclaimed: { leaseId: "lease-a", holderPid: 10, endpointHash: "endpoint-a" },
    });
  });

  it("does not seize an expired lock while the recorded holder process is still alive", () => {
    const store = new FakeLockStore();
    const locks = new BrowserLeaseLock(store, () => true, () => 1000);
    locks.acquire({
      directory: "/locks",
      endpointHash: "endpoint-a",
      leaseId: "lease-a",
      holderPid: 10,
      holderToken: "holder-a",
      expiresAt: "1970-01-01T00:00:00.000Z",
    });

    expect(locks.acquire({
      directory: "/locks",
      endpointHash: "endpoint-a",
      leaseId: "lease-b",
      holderPid: 11,
      holderToken: "holder-b",
      expiresAt: "1970-01-01T00:01:00.000Z",
    })).toMatchObject({ kind: "held", holderPid: 10 });
  });

  it("reclaims a lock when a reused PID has a different process identity", () => {
    const store = new FakeLockStore();
    let identity = "process-start-a";
    const locks = new BrowserLeaseLock(store, () => true, () => 1000, () => identity);
    locks.acquire({
      directory: "/locks",
      endpointHash: "endpoint-a",
      leaseId: "lease-a",
      holderPid: 10,
      holderToken: "holder-a",
      expiresAt: "1970-01-01T00:01:00.000Z",
    });
    identity = "process-start-b";

    expect(locks.acquire({
      directory: "/locks",
      endpointHash: "endpoint-a",
      leaseId: "lease-b",
      holderPid: 11,
      holderToken: "holder-b",
      expiresAt: "1970-01-01T00:01:00.000Z",
    })).toMatchObject({ kind: "acquired", reclaimed: { leaseId: "lease-a" } });
  });

  it("updates heartbeat only for the token-hash holder", () => {
    let now = 0;
    const store = new FakeLockStore();
    const locks = new BrowserLeaseLock(store, () => true, () => now);
    const acquired = locks.acquire({
      directory: "/locks",
      endpointHash: "endpoint-a",
      leaseId: "lease-a",
      holderPid: 10,
      holderToken: "holder-a",
      expiresAt: "1970-01-01T00:01:00.000Z",
    });
    if (acquired.kind !== "acquired") throw new Error("expected acquired lock");

    now = 1000;
    expect(locks.heartbeat(acquired.path, "wrong-holder")).toEqual({ kind: "not_holder" });
    expect(locks.heartbeat(acquired.path, "holder-a", "1970-01-01T00:02:00.000Z")).toMatchObject({
      kind: "renewed",
      record: { heartbeatAt: "1970-01-01T00:00:01.000Z", expiresAt: "1970-01-01T00:02:00.000Z" },
    });
    expect(store.files.get(acquired.path)).toContain('"leaseId":"lease-a"');
    expect([...store.files.keys()].some((path) => path.endsWith(".heartbeat"))).toBe(true);
  });
});
