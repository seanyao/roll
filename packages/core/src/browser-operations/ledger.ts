/** US-BROW-005 — append-only operation and lease transition ledger. */
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserActionResult, BrowserOperationEvent, BrowserOperationRun } from "@roll/spec";
import { BrowserLeaseLock } from "./lease-lock.js";
import { persistDiagnostic, type DiagnosticInput, type DiagnosticRedactor, type PersistDiagnosticResult } from "./redaction.js";

const LEDGER_SCHEMA = "browser-ledger.v1";

interface BrowserLedgerLine {
  schema: typeof LEDGER_SCHEMA;
  event: BrowserOperationEvent;
}

export interface BrowserLedgerStore {
  ensureFile(path: string): void;
  readText(path: string): string;
  appendLine(path: string, line: string): void;
}

export const nodeBrowserLedgerStore: BrowserLedgerStore = {
  ensureFile(path) {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) writeFileSync(path, "", "utf8");
  },
  readText(path) {
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  },
  appendLine(path, line) {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, line, { encoding: "utf8", flag: "a" });
  },
};

/** Serializes the read-then-append idempotency transition across processes. */
export interface BrowserLedgerGuard {
  acquire(eventsPath: string, idempotencyKey: string): (() => void) | undefined;
}

export const nodeBrowserLedgerGuard: BrowserLedgerGuard = {
  acquire(eventsPath, idempotencyKey) {
    const token = randomUUID();
    const lock = new BrowserLeaseLock();
    const acquired = lock.acquire({
      directory: `${dirname(eventsPath)}/.browser-operation-locks`,
      endpointHash: createHash("sha256").update(idempotencyKey, "utf8").digest("hex"),
      leaseId: `operation-${token}`,
      holderPid: process.pid,
      holderToken: token,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    return acquired.kind === "acquired" ? () => { lock.release(acquired.path, token); } : undefined;
  },
};

export type StartBrowserRunResult =
  | { kind: "started" }
  | { kind: "resumed"; runId: string }
  | { kind: "replayed"; result: BrowserActionResult }
  | { kind: "in_progress" };

/**
 * The ledger is the authority for durable browser-operation facts. It makes
 * idempotency replayable without treating the event stream as a lock.
 */
export class BrowserOperationLedger {
  constructor(
    private readonly store: BrowserLedgerStore = nodeBrowserLedgerStore,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly guard: BrowserLedgerGuard = nodeBrowserLedgerGuard,
  ) {}

  start(path: string, run: BrowserOperationRun): StartBrowserRunResult {
    const release = this.guard.acquire(path, run.idempotencyKey);
    if (release === undefined) return { kind: "in_progress" };
    try {
      return this.startExclusive(path, run);
    } finally {
      release();
    }
  }

  private startExclusive(path: string, run: BrowserOperationRun): StartBrowserRunResult {
    const prior = this.findByIdempotency(path, run.idempotencyKey);
    if (prior !== undefined) {
      const terminal = prior.find((event): event is Extract<BrowserOperationEvent, { type: "browser:operation-finished" }> => event.type === "browser:operation-finished");
      if (terminal !== undefined) return { kind: "replayed", result: terminal.result };
      const request = prior.find((event): event is Extract<BrowserOperationEvent, { type: "browser:operation-requested" }> => event.type === "browser:operation-requested");
      if (request?.holderTokenHash !== run.holderTokenHash) return { kind: "in_progress" };
      return { kind: "resumed", runId: request?.runId ?? run.runId };
    }

    this.append(path, {
      type: "browser:operation-requested",
      runId: run.runId,
      ts: this.now(),
      request: toRequest(run),
      holderTokenHash: run.holderTokenHash,
    });
    this.append(path, { type: "browser:operation-authorized", runId: run.runId, ts: this.now(), policyFingerprint: run.policyFingerprint });
    this.append(path, { type: "browser:operation-started", runId: run.runId, ts: this.now() });
    return { kind: "started" };
  }

  finish(path: string, result: BrowserActionResult): void {
    const existing = this.read(path).some((event) => event.type === "browser:operation-finished" && event.runId === result.runId);
    if (!existing) this.append(path, { type: "browser:operation-finished", runId: result.runId, ts: this.now(), result });
  }

  recordDiagnostic(
    path: string,
    runId: string,
    input: DiagnosticInput,
    redactor?: DiagnosticRedactor,
  ): PersistDiagnosticResult {
    const outcome = persistDiagnostic(input, redactor);
    if (outcome.kind === "stored") {
      this.append(path, { type: "browser:diagnostic-recorded", runId, ts: this.now(), ref: outcome.artifact });
    } else {
      this.append(path, { type: "browser:diagnostic-dropped", runId, ts: this.now(), failure: outcome.failure });
    }
    return outcome;
  }

  recordLeaseOrphaned(path: string, lease: { leaseId: string; endpointHash: string; holderPid: number }): void {
    this.append(path, { type: "browser:lease-orphaned", ...lease, ts: this.now() });
  }

  read(path: string): BrowserOperationEvent[] {
    const events: BrowserOperationEvent[] = [];
    for (const line of this.store.readText(path).split("\n")) {
      if (line.trim() === "") continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (isLedgerLine(parsed)) events.push(parsed.event);
      } catch {
        // Torn lines are ignored; a later append remains readable.
      }
    }
    return events;
  }

  private append(path: string, event: BrowserOperationEvent): void {
    this.store.ensureFile(path);
    this.store.appendLine(path, `${JSON.stringify({ schema: LEDGER_SCHEMA, event } satisfies BrowserLedgerLine)}\n`);
  }

  private findByIdempotency(path: string, idempotencyKey: string): BrowserOperationEvent[] | undefined {
    const events = this.read(path);
    const request = events.find(
      (event): event is Extract<BrowserOperationEvent, { type: "browser:operation-requested" }> =>
        event.type === "browser:operation-requested" && event.request.idempotencyKey === idempotencyKey,
    );
    return request === undefined ? undefined : events.filter((event) => runIdOf(event) === request.runId);
  }
}

function toRequest(run: BrowserOperationRun) {
  return {
    idempotencyKey: run.idempotencyKey,
    storyId: run.storyId ?? "",
    cycleId: run.cycleId,
    caller: run.caller,
    lane: run.lane,
    targetUrl: run.requestedOrigin,
    purpose: "diagnose" as const,
  };
}

function isLedgerLine(value: unknown): value is BrowserLedgerLine {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Record<string, unknown>;
  return line["schema"] === LEDGER_SCHEMA && typeof line["event"] === "object" && line["event"] !== null && typeof (line["event"] as Record<string, unknown>)["type"] === "string";
}

function runIdOf(event: BrowserOperationEvent): string | undefined {
  return "runId" in event ? event.runId : undefined;
}
