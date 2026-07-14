import { describe, expect, it } from "vitest";
import type { BrowserActionResult, BrowserOperationRun } from "@roll/spec";
import { BrowserOperationLedger, type BrowserLedgerGuard, type BrowserLedgerStore } from "../src/browser-operations/ledger.js";

class FakeLedgerStore implements BrowserLedgerStore {
  readonly files = new Map<string, string>();

  ensureFile(path: string): void {
    if (!this.files.has(path)) this.files.set(path, "");
  }

  readText(path: string): string {
    return this.files.get(path) ?? "";
  }

  appendLine(path: string, line: string): void {
    this.files.set(path, `${this.files.get(path) ?? ""}${line}`);
  }
}

const freeGuard: BrowserLedgerGuard = { acquire: () => () => undefined };

function run(): BrowserOperationRun {
  return {
    runId: "run-1",
    idempotencyKey: "same-request",
    storyId: "US-BROW-005",
    caller: "supervisor",
    lane: "interactive",
    requestedOrigin: "https://example.test",
    policyFingerprint: "policy-hash",
    holderTokenHash: "holder-hash",
    state: "requested",
    diagnostics: [],
    result: "skipped",
  };
}

const terminalResult: BrowserActionResult = {
  runId: "run-1",
  actionId: "action-1",
  status: "ok",
  diagnosticRefs: [],
  redactedSummary: "safe",
};

describe("US-BROW-005 — BrowserOperationLedger", () => {
  it("persists a token-bound event sequence and replays the original terminal result for three identical retries", () => {
    const store = new FakeLedgerStore();
    const ledger = new BrowserOperationLedger(store, () => "2026-07-14T00:00:00.000Z", freeGuard);

    expect(ledger.start("/ledger/events.ndjson", run())).toMatchObject({ kind: "started" });
    ledger.finish("/ledger/events.ndjson", terminalResult);

    const retries = [1, 2, 3].map(() => ledger.start("/ledger/events.ndjson", run()));
    for (const retry of retries) {
      expect(retry).toEqual({ kind: "replayed", result: terminalResult });
    }

    const events = ledger.read("/ledger/events.ndjson");
    expect(events.map((event) => event.type)).toEqual([
      "browser:operation-requested",
      "browser:operation-authorized",
      "browser:operation-started",
      "browser:operation-finished",
    ]);
    expect(events[0]).toMatchObject({
      type: "browser:operation-requested",
      request: { idempotencyKey: "same-request" },
      holderTokenHash: "holder-hash",
    });
  });

  it("refuses a different holder from resuming a non-terminal idempotency key", () => {
    const store = new FakeLedgerStore();
    const ledger = new BrowserOperationLedger(store, () => "2026-07-14T00:00:00.000Z", freeGuard);
    ledger.start("/ledger/events.ndjson", run());

    const result = ledger.start("/ledger/events.ndjson", { ...run(), holderTokenHash: "other-holder" });

    expect(result).toEqual({ kind: "in_progress" });
  });

  it("writes classified diagnostic-drop and orphan-recovery audit events", () => {
    const store = new FakeLedgerStore();
    const ledger = new BrowserOperationLedger(store, () => "2026-07-14T00:00:00.000Z", freeGuard);

    ledger.recordDiagnostic(
      "/ledger/events.ndjson",
      "run-1",
      { artifactId: "diag-1", kind: "console-summary", text: "Authorization: Bearer secret" },
      () => {
        throw new Error("redactor failed");
      },
    );
    ledger.recordLeaseOrphaned("/ledger/events.ndjson", {
      leaseId: "lease-1",
      endpointHash: "endpoint-a",
      holderPid: 10,
    });

    expect(ledger.read("/ledger/events.ndjson")).toEqual([
      { type: "browser:diagnostic-dropped", runId: "run-1", ts: "2026-07-14T00:00:00.000Z", failure: "redaction_failed" },
      { type: "browser:lease-orphaned", leaseId: "lease-1", endpointHash: "endpoint-a", holderPid: 10, ts: "2026-07-14T00:00:00.000Z" },
    ]);
  });

  it("appends MCP bypass denials without an existence pre-check that can race with another writer", () => {
    class AppendOnlyStore extends FakeLedgerStore {
      override ensureFile(): void {
        throw new Error("security audit writes must not pre-create the file");
      }
    }
    const store = new AppendOnlyStore();
    const ledger = new BrowserOperationLedger(store, () => "2026-07-15T00:00:00.000Z", freeGuard);

    ledger.recordMcpBypassDenial("/ledger/events.ndjson", {
      type: "browser:mcp-bypass-denied",
      ts: "2026-07-15T00:00:00.000Z",
      reason: { code: "generic_mcp_bypass_denied", message: "reserved" },
    });

    expect(ledger.read("/ledger/events.ndjson")).toMatchObject([{ type: "browser:mcp-bypass-denied" }]);
  });

  it("does not append a second request while another process holds the idempotency guard", () => {
    const store = new FakeLedgerStore();
    const blockedGuard: BrowserLedgerGuard = { acquire: () => undefined };
    const ledger = new BrowserOperationLedger(store, () => "2026-07-14T00:00:00.000Z", blockedGuard);

    expect(ledger.start("/ledger/events.ndjson", run())).toEqual({ kind: "in_progress" });
    expect(ledger.read("/ledger/events.ndjson")).toEqual([]);
  });

  it("does not append a competing terminal result while another worker owns the guard", () => {
    const store = new FakeLedgerStore();
    const ledger = new BrowserOperationLedger(store, () => "2026-07-14T00:00:00.000Z", freeGuard);
    ledger.start("/ledger/events.ndjson", run());
    const blockedGuard: BrowserLedgerGuard = { acquire: () => undefined };
    const recovering = new BrowserOperationLedger(store, () => "2026-07-14T00:00:00.000Z", blockedGuard);

    expect(recovering.finish("/ledger/events.ndjson", terminalResult)).toBeUndefined();
    expect(ledger.read("/ledger/events.ndjson").map((event) => event.type)).not.toContain("browser:operation-finished");
  });
});
