/**
 * US-BROW-005 — filesystem-backed exclusion for browser leases.
 *
 * Events audit a lease after the fact; this lock is the mutual-exclusion
 * primitive. The store's createExclusive operation must map to O_EXCL.
 */
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface BrowserLeaseLockRecord {
  leaseId: string;
  endpointHash: string;
  holderPid: number;
  holderTokenHash: string;
  heartbeatAt: string;
  expiresAt: string;
}

export interface BrowserLeaseLockStore {
  /** Atomically create a file only when it does not exist (O_EXCL). */
  createExclusive(path: string, text: string): boolean;
  readText(path: string): string | undefined;
  remove(path: string): void;
  /** Atomically replace an existing lock record after holder verification. */
  replace(path: string, text: string): void;
}

export const nodeBrowserLeaseLockStore: BrowserLeaseLockStore = {
  createExclusive(path, text) {
    mkdirSync(dirname(path), { recursive: true });
    try {
      const fd = openSync(path, "wx");
      try {
        writeFileSync(fd, text, "utf8");
      } finally {
        closeSync(fd);
      }
      return true;
    } catch (error: unknown) {
      if (isAlreadyExists(error)) return false;
      throw error;
    }
  },
  readText(path) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  },
  remove(path) {
    rmSync(path, { force: true });
  },
  replace(path, text) {
    writeFileSync(path, text, "utf8");
  },
};

export interface AcquireBrowserLeaseLockInput {
  directory: string;
  endpointHash: string;
  leaseId: string;
  holderPid: number;
  holderToken: string;
  expiresAt: string;
}

export type BrowserLeaseLockAcquireResult =
  | { kind: "acquired"; path: string; record: BrowserLeaseLockRecord; reclaimed?: BrowserLeaseLockRecord }
  | { kind: "held"; path: string; holderPid?: number; expiresAt?: string };

export class BrowserLeaseLock {
  constructor(
    private readonly store: BrowserLeaseLockStore = nodeBrowserLeaseLockStore,
    private readonly isProcessAlive: (pid: number) => boolean = nodeProcessAlive,
    private readonly now: () => number = Date.now,
  ) {}

  acquire(input: AcquireBrowserLeaseLockInput): BrowserLeaseLockAcquireResult {
    const path = leaseLockPath(input.directory, input.endpointHash);
    const record = toRecord(input, this.now());
    if (this.store.createExclusive(path, encode(record))) return { kind: "acquired", path, record };

    const existing = parseRecord(this.store.readText(path));
    if (existing === undefined || !isStale(existing, this.now(), this.isProcessAlive)) {
      return { kind: "held", path, holderPid: existing?.holderPid, expiresAt: existing?.expiresAt };
    }

    this.store.remove(path);
    if (this.store.createExclusive(path, encode(record))) {
      return { kind: "acquired", path, record, reclaimed: existing };
    }
    const winner = parseRecord(this.store.readText(path));
    return { kind: "held", path, holderPid: winner?.holderPid, expiresAt: winner?.expiresAt };
  }

  heartbeat(
    path: string,
    holderToken: string,
    expiresAt?: string,
  ): { kind: "renewed"; record: BrowserLeaseLockRecord } | { kind: "not_holder" } {
    const current = parseRecord(this.store.readText(path));
    const holderTokenHash = createHash("sha256").update(holderToken, "utf8").digest("hex");
    if (current === undefined || current.holderTokenHash !== holderTokenHash) return { kind: "not_holder" };
    const record: BrowserLeaseLockRecord = {
      ...current,
      heartbeatAt: new Date(this.now()).toISOString(),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    };
    this.store.replace(path, encode(record));
    return { kind: "renewed", record };
  }
}

export function leaseLockPath(directory: string, endpointHash: string): string {
  return join(directory, `${endpointHash}.lock`);
}

function toRecord(input: AcquireBrowserLeaseLockInput, now: number): BrowserLeaseLockRecord {
  return {
    leaseId: input.leaseId,
    endpointHash: input.endpointHash,
    holderPid: input.holderPid,
    holderTokenHash: createHash("sha256").update(input.holderToken, "utf8").digest("hex"),
    heartbeatAt: new Date(now).toISOString(),
    expiresAt: input.expiresAt,
  };
}

function parseRecord(text: string | undefined): BrowserLeaseLockRecord | undefined {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) return undefined;
    const { leaseId, endpointHash, holderPid, holderTokenHash, heartbeatAt, expiresAt } = value;
    if (
      typeof leaseId !== "string" || typeof endpointHash !== "string" ||
      typeof holderPid !== "number" || !Number.isSafeInteger(holderPid) || typeof holderTokenHash !== "string" ||
      typeof heartbeatAt !== "string" || typeof expiresAt !== "string"
    ) return undefined;
    return { leaseId, endpointHash, holderPid, holderTokenHash, heartbeatAt, expiresAt };
  } catch {
    return undefined;
  }
}

function isStale(record: BrowserLeaseLockRecord, now: number, alive: (pid: number) => boolean): boolean {
  const expiry = Date.parse(record.expiresAt);
  return !Number.isFinite(expiry) || expiry <= now || !alive(record.holderPid);
}

function encode(record: BrowserLeaseLockRecord): string {
  return `${JSON.stringify(record)}\n`;
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "EEXIST";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nodeProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
