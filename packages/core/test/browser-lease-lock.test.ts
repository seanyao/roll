import { describe, expect, it } from "vitest";
import { BrowserLeaseLock, type BrowserLeaseLockStore } from "../src/browser-operations/lease-lock.js";

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
}

describe("US-BROW-005 — BrowserLeaseLock", () => {
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
      expiresAt: "1970-01-01T00:01:00.000Z",
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
});
