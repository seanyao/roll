/**
 * US-BROW-008a — BrowserLease aggregate tests.
 *
 * Covers approval payload validation, localhost-only single-holder grant,
 * exactly-once release on expiry / cancel / crash / dead-PID-reclaim, and
 * race-safety for dual holders.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { BrowserOperationEvent } from "@roll/spec";
import { BrowserLeaseLock, leaseLockPath, type BrowserLeaseLockRecord, type BrowserLeaseLockStore } from "../src/browser-operations/lease-lock.js";
import { BrowserLeaseService, type BrowserLeaseGrantInput } from "../src/browser-operations/lease.js";

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

function baseInput(overrides?: Partial<BrowserLeaseGrantInput["approval"]>): BrowserLeaseGrantInput {
  return {
    approval: {
      storyId: "US-BROW-008a",
      origin: "http://localhost:3000",
      actionSummary: "diagnose checkout form",
      requestedMs: 60_000,
      credentialExportDenied: true,
      ...overrides,
    },
    holderPid: 42,
    holderToken: "token-a",
    operator: "owner",
    callerTty: true,
    callerIsScheduler: false,
  };
}

function buildService(opts: {
  store?: FakeLockStore;
  alive?: (pid: number) => boolean;
  identity?: (pid: number) => string | undefined;
  nowMs?: number;
} = {}) {
  const events: BrowserOperationEvent[] = [];
  const store = opts.store ?? new FakeLockStore();
  let nowMs = opts.nowMs ?? 1_000_000;
  const service = new BrowserLeaseService(
    "/leases",
    new BrowserLeaseLock(store, opts.alive ?? (() => true), () => nowMs, opts.identity ?? (() => "identity-a")),
    (event) => events.push(event),
    opts.alive ?? (() => true),
    opts.identity ?? (() => "identity-a"),
    () => nowMs,
    () => new Date(nowMs).toISOString(),
  );
  return { service, events, store, get nowMs() { return nowMs; }, set nowMs(v: number) { nowMs = v; } };
}

function computeHash(origin: string): string {
  return createHash("sha256").update(origin, "utf8").digest("hex");
}

function recordAt(store: FakeLockStore, origin: string): BrowserLeaseLockRecord | undefined {
  const path = leaseLockPath("/leases", computeHash(origin));
  const text = store.files.get(path);
  if (text === undefined) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return JSON.parse(text) as BrowserLeaseLockRecord;
}

describe("US-BROW-008a — BrowserLeaseService", () => {
  it("grants a localhost lease and emits the full approval payload", () => {
    const { service, events } = buildService();
    const result = service.grant(baseInput());

    expect(result.kind).toBe("granted");
    if (result.kind !== "granted") throw new Error("expected granted");
    expect(result.lease.storyId).toBe("US-BROW-008a");
    expect(result.lease.origin).toBe("http://localhost:3000");
    expect(result.lease.scope).toBe("interactive-read-write");
    expect(result.lease.ownerApproval.operator).toBe("owner");
    expect(result.lease.holderPid).toBe(42);

    const granted = events.find((e): e is Extract<BrowserOperationEvent, { type: "browser:lease-granted" }> => e.type === "browser:lease-granted");
    expect(granted).toBeDefined();
    expect(granted).toMatchObject({
      storyId: "US-BROW-008a",
      origin: "http://localhost:3000",
      actionSummary: "diagnose checkout form",
      credentialExportDenied: true,
    });
  });

  it("persists the approval payload in the lock record", () => {
    const { service, store } = buildService();
    service.grant(baseInput());
    const record = recordAt(store, "http://localhost:3000");
    expect(record).toMatchObject({
      storyId: "US-BROW-008a",
      origin: "http://localhost:3000",
      actionSummary: "diagnose checkout form",
      credentialExportDenied: true,
    });
  });

  it.each([
    { field: "storyId", override: { storyId: "" } },
    { field: "origin", override: { origin: "" } },
    { field: "actionSummary", override: { actionSummary: "" } },
    { field: "requestedMs", override: { requestedMs: 0 } },
    { field: "credentialExportDenied", override: { credentialExportDenied: false } },
  ])("denies grant when approval field $field is missing or invalid", ({ override }) => {
    const { service, events } = buildService();
    const result = service.grant(baseInput(override));
    expect(result.kind).toBe("denied");
    if (result.kind !== "denied") throw new Error("expected denied");
    expect(result.reason.code).toBe("interactive_lease_invalid_request");
    expect(events.some((e) => e.type === "browser:lease-rejected")).toBe(true);
  });

  it("denies a non-TTY caller", () => {
    const { service, events } = buildService();
    const result = service.grant({ ...baseInput(), callerTty: false });
    expect(result.kind).toBe("denied");
    if (result.kind !== "denied") throw new Error("expected denied");
    expect(result.reason.code).toBe("interactive_lease_no_tty");
    expect(events[0]?.type).toBe("browser:lease-rejected");
  });

  it("denies a scheduler identity caller", () => {
    const { service, events } = buildService();
    const result = service.grant({ ...baseInput(), callerIsScheduler: true });
    expect(result.kind).toBe("denied");
    if (result.kind !== "denied") throw new Error("expected denied");
    expect(result.reason.code).toBe("caller_not_allowed");
    expect(events[0]?.type).toBe("browser:lease-rejected");
  });

  it("denies a non-loopback origin", () => {
    const { service, events } = buildService();
    const result = service.grant(baseInput({ origin: "https://example.com" }));
    expect(result.kind).toBe("denied");
    if (result.kind !== "denied") throw new Error("expected denied");
    expect(result.reason.code).toBe("origin_not_allowed");
    expect(events[0]?.type).toBe("browser:lease-rejected");
  });

  it("caps lease duration at 15 minutes", () => {
    const { service } = buildService({ nowMs: 0 });
    const result = service.grant(baseInput({ requestedMs: 999_999_999 }));
    expect(result.kind).toBe("granted");
    if (result.kind !== "granted") throw new Error("expected granted");
    expect(new Date(result.lease.expiresAt).getTime()).toBe(15 * 60 * 1000);
  });

  it("denies a second holder for the same endpoint", () => {
    const store = new FakeLockStore();
    const { service: first } = buildService({ store });
    const { service: second, events } = buildService({ store });

    expect(first.grant(baseInput({ holderToken: "token-a" })).kind).toBe("granted");
    const result = second.grant({
      ...baseInput(),
      holderToken: "token-b",
      holderPid: 43,
    });

    expect(result.kind).toBe("denied");
    if (result.kind !== "denied") throw new Error("expected denied");
    expect(result.reason.code).toBe("interactive_lease_held");
    expect(events.some((e) => e.type === "browser:lease-rejected")).toBe(true);
  });

  it("releases a lease with the correct holder token exactly once", () => {
    const { service, events } = buildService();
    const granted = service.grant(baseInput());
    if (granted.kind !== "granted") throw new Error("expected granted");

    expect(service.release(granted.lease, "token-a").kind).toBe("released");
    expect(service.release(granted.lease, "token-a").kind).toBe("not_found");
    expect(events.filter((e) => e.type === "browser:lease-released").length).toBe(1);
  });

  it("refuses release with a wrong holder token", () => {
    const { service } = buildService();
    const granted = service.grant(baseInput());
    if (granted.kind !== "granted") throw new Error("expected granted");
    expect(service.release(granted.lease, "wrong-token").kind).toBe("not_holder");
  });

  it("releases an expired lease exactly once", () => {
    const { service, events, nowMs } = buildService({ nowMs: 0 });
    const granted = service.grant(baseInput({ requestedMs: 1_000 }));
    if (granted.kind !== "granted") throw new Error("expected granted");

    expect(service.releaseIfExpired("http://localhost:3000", 500).kind).toBe("current");
    expect(service.releaseIfExpired("http://localhost:3000", 1_500).kind).toBe("released");
    expect(service.releaseIfExpired("http://localhost:3000", 1_500).kind).toBe("current");

    expect(events.filter((e) => e.type === "browser:lease-expired").length).toBe(1);
    expect(events.filter((e) => e.type === "browser:lease-released").length).toBe(1);
  });

  it("reclaims a lease whose holder process died", () => {
    const store = new FakeLockStore();
    let alive = true;
    const { service, events } = buildService({ store, alive: () => alive, nowMs: 0 });
    const granted = service.grant(baseInput({ requestedMs: 60_000 }));
    if (granted.kind !== "granted") throw new Error("expected granted");

    alive = false;
    expect(service.reclaimDeadHolder("http://localhost:3000").kind).toBe("released");
    expect(service.reclaimDeadHolder("http://localhost:3000").kind).toBe("current");

    expect(events.filter((e) => e.type === "browser:lease-orphaned").length).toBe(1);
    expect(events.filter((e) => e.type === "browser:lease-released").length).toBe(1);
  });

  it("reclaims a lease when the recorded PID is reused by a different process", () => {
    const store = new FakeLockStore();
    let identity = "identity-a";
    const { service, events } = buildService({ store, identity: () => identity, nowMs: 0 });
    service.grant(baseInput({ requestedMs: 60_000 }));
    identity = "identity-b";

    expect(service.reclaimDeadHolder("http://localhost:3000").kind).toBe("released");
    expect(events.some((e) => e.type === "browser:lease-orphaned")).toBe(true);
    expect(events.some((e) => e.type === "browser:lease-released")).toBe(true);
  });

  it("allows independent leases for different loopback endpoints", () => {
    const store = new FakeLockStore();
    const { service } = buildService({ store });
    expect(service.grant(baseInput({ origin: "http://localhost:3000" })).kind).toBe("granted");
    expect(service.grant(baseInput({ origin: "http://127.0.0.1:4000" })).kind).toBe("granted");
  });


});
