import { describe, expect, it } from "vitest";
import type { BrowserDenialReason, DiagnosticArtifactRef } from "@roll/spec";
import { BrowserOperationRunService, isActiveRunState, type DiagnosticFailure } from "../src/browser-operations/run-service.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

const now = () => "2026-07-15T00:00:00.000Z";

function newRun(overrides?: { lane?: "managed" | "interactive"; idempotencyKey?: string }) {
  return BrowserOperationRunService.create({
    runId: "run-1",
    idempotencyKey: overrides?.idempotencyKey ?? "key-1",
    storyId: "US-BROW-004a",
    caller: "builder",
    lane: overrides?.lane ?? "managed",
    requestedOrigin: "https://example.test",
    holderTokenHash: "hash-1",
    now,
  });
}

function diagRef(id: string): DiagnosticArtifactRef {
  return { artifactId: id, kind: "console-summary", digest: `d-${id}`, bytes: 100, untrusted: true, diagnosticOnly: true };
}

function failure(category: DiagnosticFailure["category"], message: string): DiagnosticFailure {
  return { category, message, at: now() };
}

const DENIED_CODE: BrowserDenialReason = { code: "policy_disabled", message: "Operation was denied by policy" };

// ── AC1: State machine — valid transitions ──────────────────────────────────

describe("US-BROW-004a — BrowserOperationRunService state machine", () => {
  describe("valid transitions", () => {
    it("requested → authorized → running → passed (full happy path)", () => {
      const s = newRun()
        .authorize("fp-1")
        .start()
        .addDiagnostic(diagRef("d1"))
        .pass();

      expect(s.run.state).toBe("passed");
      expect(s.run.policyFingerprint).toBe("fp-1");
      expect(s.run.startedAt).toBe(now());
      expect(s.run.endedAt).toBe(now());
      expect(s.run.result).toBe("pass");
      expect(s.run.diagnostics).toHaveLength(1);
      expect(s.isTerminal()).toBe(true);
      expect(s.terminalResult()).toEqual({ kind: "pass", diagnostics: [diagRef("d1")] });
    });

    it("requested → authorized → running → failed", () => {
      const f = failure("devtools-error", "CDP connection refused");
      const s = newRun()
        .authorize("fp-1")
        .start()
        .fail([f]);

      expect(s.run.state).toBe("failed");
      expect(s.run.result).toBe("fail");
      expect(s.isTerminal()).toBe(true);
      expect(s.terminalResult()).toEqual({ kind: "fail", failures: [f], diagnostics: [] });
    });

    it("requested → authorized → running → expired", () => {
      const s = newRun()
        .authorize("fp-1")
        .start()
        .expire();

      expect(s.run.state).toBe("expired");
      expect(s.run.result).toBe("skipped");
      expect(s.isTerminal()).toBe(true);
      expect(s.terminalResult()).toEqual({ kind: "skipped", reason: "run expired" });
    });

    it("requested → denied (policy gate before authorization)", () => {
      const s = newRun().deny();

      expect(s.run.state).toBe("denied");
      expect(s.run.result).toBe("denied");
      expect(s.isTerminal()).toBe(true);
      expect(s.terminalResult()).toEqual({ kind: "denied", reason: DENIED_CODE });
    });

    it("authorized → denied (policy change mid-flight)", () => {
      const s = newRun().authorize("fp-1").deny();

      expect(s.run.state).toBe("denied");
      expect(s.run.result).toBe("denied");
    });

    it("running → denied (policy change during execution)", () => {
      const s = newRun().authorize("fp-1").start().deny();

      expect(s.run.state).toBe("denied");
      expect(s.run.result).toBe("denied");
    });

    it("multiple diagnostics accumulated before terminal", () => {
      const s = newRun()
        .authorize("fp-1")
        .start()
        .addDiagnostic(diagRef("d1"))
        .addDiagnostic(diagRef("d2"))
        .addDiagnostic(diagRef("d3"))
        .pass();

      expect(s.run.diagnostics).toHaveLength(3);
      expect(s.run.diagnostics.map(d => d.artifactId)).toEqual(["d1", "d2", "d3"]);
    });

    it("fail with multiple categorized failures", () => {
      const s = newRun()
        .authorize("fp-1")
        .start()
        .fail([
          failure("timeout", "Navigation timed out after 30s"),
          failure("crash", "Chrome renderer process crashed"),
          failure("devtools-error", "DevTools socket closed unexpectedly"),
        ]);

      expect(s.run.state).toBe("failed");
      const result = s.terminalResult();
      expect(result?.kind).toBe("fail");
      if (result?.kind === "fail") {
        expect(result.failures).toHaveLength(3);
        expect(result.failures.map(f => f.category)).toEqual(["timeout", "crash", "devtools-error"]);
      }
    });
  });

  // ── AC1: Invalid transitions ────────────────────────────────────────────

  describe("invalid transitions", () => {
    it("cannot start without authorization", () => {
      expect(() => newRun().start()).toThrow('Expected run state "authorized" but was "requested"');
    });

    it("cannot pass without starting", () => {
      expect(() => newRun().authorize("fp-1").pass()).toThrow('Expected run state "running"');
    });

    it("cannot fail without starting", () => {
      expect(() => newRun().authorize("fp-1").fail([failure("timeout", "x")])).toThrow('Expected run state "running"');
    });

    it("cannot expire without running", () => {
      expect(() => newRun().authorize("fp-1").expire()).toThrow('Expected run state "running"');
    });

    it("cannot authorize from terminal state (passed)", () => {
      const s = newRun().authorize("fp-1").start().pass();
      expect(() => s.authorize("fp-2")).toThrow('Expected run state "requested"');
    });

    it("cannot authorize from terminal state (failed)", () => {
      const s = newRun().authorize("fp-1").start().fail([failure("crash", "boom")]);
      expect(() => s.authorize("fp-2")).toThrow('Expected run state "requested"');
    });

    it("cannot authorize from terminal state (denied)", () => {
      const s = newRun().deny();
      expect(() => s.authorize("fp-2")).toThrow('Expected run state "requested"');
    });

    it("cannot authorize from terminal state (expired)", () => {
      const s = newRun().authorize("fp-1").start().expire();
      expect(() => s.authorize("fp-2")).toThrow('Expected run state "requested"');
    });

    it("cannot start from terminal state", () => {
      const s = newRun().authorize("fp-1").start().pass();
      expect(() => s.start()).toThrow('Expected run state "authorized"');
    });

    it("cannot pass twice", () => {
      const r = newRun().authorize("fp-1").start();
      const passed = r.pass();
      expect(() => passed.pass()).toThrow('Expected run state "running"');
    });

    it("cannot deny from terminal state", () => {
      const s = newRun().authorize("fp-1").start().pass();
      expect(() => s.deny()).toThrow(/Cannot deny run in terminal state/);
    });

    it("cannot call fail with empty failures array", () => {
      expect(() => newRun().authorize("fp-1").start().fail([])).toThrow("fail() requires at least one DiagnosticFailure");
    });
  });
});

// ── AC2: Diagnostic failure category type safety ────────────────────────────

describe("US-BROW-004a — AC2 diagnostic failure type safety", () => {
  it("terminalResult() for pass has no failures field (type-level exclusion)", () => {
    const s = newRun().authorize("fp-1").start().pass();
    const r = s.terminalResult();
    expect(r?.kind).toBe("pass");
    if (r && r.kind === "pass") {
      // pass variant has diagnostics but NO failures field
      expect("failures" in r).toBe(false);
    }
  });

  it("terminalResult() for fail requires at least one failure (enforced at runtime)", () => {
    // Runtime enforcement: fail() rejects empty arrays
    expect(() => newRun().authorize("fp-1").start().fail([])).toThrow("at least one DiagnosticFailure");
  });

  it("all three failure categories are representable", () => {
    const categories: DiagnosticFailure["category"][] = ["timeout", "crash", "devtools-error"];
    const s = newRun().authorize("fp-1").start().fail(categories.map(c => failure(c, `Error: ${c}`)));
    const r = s.terminalResult();
    expect(r?.kind).toBe("fail");
    if (r?.kind === "fail") {
      expect(new Set(r.failures.map(f => f.category))).toEqual(new Set(categories));
    }
  });

  it("expired runs carry a timeout diagnostic failure, not a pass", () => {
    const s = newRun().authorize("fp-1").start().expire();
    const r = s.terminalResult();
    expect(r?.kind).toBe("skipped"); // expired = skipped, not passed
    // Timeout is captured as a diagnostic failure internally
    expect(s.diagnosticFailures).toHaveLength(1);
    expect(s.diagnosticFailures[0].category).toBe("timeout");
  });
});

// ── AC3: Idempotency ────────────────────────────────────────────────────────

describe("US-BROW-004a — AC3 idempotency", () => {
  it("isActiveRunState returns true for non-terminal states", () => {
    expect(isActiveRunState("requested")).toBe(true);
    expect(isActiveRunState("authorized")).toBe(true);
    expect(isActiveRunState("running")).toBe(true);
  });

  it("isActiveRunState returns false for terminal states", () => {
    expect(isActiveRunState("passed")).toBe(false);
    expect(isActiveRunState("failed")).toBe(false);
    expect(isActiveRunState("denied")).toBe(false);
    expect(isActiveRunState("expired")).toBe(false);
  });

  it("same idempotencyKey can create distinct runs, but terminal result replay is deterministic", () => {
    // Two separate factory calls with the same key produce distinct run objects
    // (the idempotency gate lives in the ledger, not the aggregate factory).
    // The aggregate itself properly tracks the key and exposes isTerminal() so
    // the ledger/runner can enforce "no second active run."
    const runA = BrowserOperationRunService.create({
      runId: "run-dup-a",
      idempotencyKey: "dup-key",
      storyId: "US-BROW-004a",
      caller: "builder",
      lane: "managed",
      requestedOrigin: "https://example.test",
      holderTokenHash: "hash-a",
      now,
    }).authorize("fp-1").start().pass();

    const runB = BrowserOperationRunService.create({
      runId: "run-dup-b",
      idempotencyKey: "dup-key",
      storyId: "US-BROW-004a",
      caller: "builder",
      lane: "managed",
      requestedOrigin: "https://example.test",
      holderTokenHash: "hash-b",
      now,
    });

    expect(runA.run.idempotencyKey).toBe(runB.run.idempotencyKey);
    expect(runA.run.runId).not.toBe(runB.run.runId); // distinct IDs
    expect(runA.isTerminal()).toBe(true);
    expect(runB.isTerminal()).toBe(false);

    // A terminal run can be replayed: terminalResult() is deterministic
    const resultA = runA.terminalResult();
    const resultB = runB.terminalResult();
    expect(resultA).toBeDefined();
    expect(resultB).toBeUndefined(); // not yet terminal
  });

  it("idempotencyKey is immutable on the aggregate (no setter)", () => {
    const s = newRun();
    expect(s.run.idempotencyKey).toBe("key-1");
    // mutations return new aggregates; the original key never changes
    const s2 = s.authorize("fp-1").start().pass();
    expect(s2.run.idempotencyKey).toBe("key-1");
  });
});

// ── Profile lifecycle ───────────────────────────────────────────────────────

describe("US-BROW-004a — temporary profile lifecycle", () => {
  it("created → active → removed (normal lifecycle)", () => {
    const s = newRun();
    expect(s.profileState).toBe("created");

    const s2 = s.activateProfile();
    expect(s2.profileState).toBe("active");

    const s3 = s2.removeProfile();
    expect(s3.profileState).toBe("removed");
    expect(s3.isProfileRemoved()).toBe(true);
  });

  it("created → removed (creation failure — must still clean up)", () => {
    const s = newRun();
    const s2 = s.removeProfile();
    expect(s2.profileState).toBe("removed");
  });

  it("profile removed is idempotent (removed → removed)", () => {
    const s = newRun().activateProfile().removeProfile();
    expect(s.profileState).toBe("removed");
    const s2 = s.removeProfile();
    expect(s2.profileState).toBe("removed");
    expect(s2).toBe(s); // same reference — no-op
  });

  it("profile must be removed even after a failed run", () => {
    // Start the run normally
    const s = newRun().authorize("fp-1").start();
    expect(s.profileState).toBe("created");

    // Activate profile (simulate Chrome launch)
    const active = s.activateProfile();
    expect(active.profileState).toBe("active");

    // Run fails
    const failed = active.fail([failure("crash", "Chrome renderer died")]);
    expect(failed.run.state).toBe("failed");
    expect(failed.profileState).toBe("active"); // not yet cleaned up

    // Profile MUST be removed even after failure
    const cleaned = failed.removeProfile();
    expect(cleaned.profileState).toBe("removed");
  });

  it("profile must be removed even after a passed run", () => {
    const s = newRun().authorize("fp-1").start().activateProfile().pass();
    expect(s.run.state).toBe("passed");
    expect(s.profileState).toBe("active");
    const cleaned = s.removeProfile();
    expect(cleaned.profileState).toBe("removed");
  });

  it("cannot activate from removed state", () => {
    const s = newRun().removeProfile();
    expect(() => s.activateProfile()).toThrow('Expected profile state "created" but was "removed"');
  });

  it("cannot activate from active state (no double activation)", () => {
    const s = newRun().activateProfile();
    expect(() => s.activateProfile()).toThrow('Expected profile state "created" but was "active"');
  });

  it("profile lifecycle is independent of run state — profile can be active before run starts", () => {
    const s = newRun().activateProfile();
    expect(s.profileState).toBe("active");
    expect(s.run.state).toBe("requested");
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe("US-BROW-004a — edge cases", () => {
  it("run identity: runId and idempotencyKey are preserved through all transitions", () => {
    const s = newRun()
      .authorize("fp-1")
      .start()
      .addDiagnostic(diagRef("d1"))
      .pass()
      .removeProfile();

    expect(s.run.runId).toBe("run-1");
    expect(s.run.idempotencyKey).toBe("key-1");
  });

  it("caller, lane, requestedOrigin are preserved through all transitions", () => {
    const s = newRun()
      .authorize("fp-1")
      .start()
      .fail([failure("timeout", "timeout")]);

    expect(s.run.caller).toBe("builder");
    expect(s.run.lane).toBe("managed");
    expect(s.run.requestedOrigin).toBe("https://example.test");
  });

  it("immutable update: each mutation returns a new instance", () => {
    const s1 = newRun();
    const s2 = s1.authorize("fp-1");
    const s3 = s2.start();

    expect(s1).not.toBe(s2);
    expect(s2).not.toBe(s3);
    expect(s1.run.state).toBe("requested");
    expect(s2.run.state).toBe("authorized");
    expect(s3.run.state).toBe("running");
  });

  it("holderTokenHash is preserved", () => {
    const s = newRun().authorize("fp-1").start().pass();
    expect(s.run.holderTokenHash).toBe("hash-1");
  });

  it("all terminal states report isTerminal() = true", () => {
    const passed = newRun().authorize("fp-1").start().pass();
    const failed = newRun().authorize("fp-1").start().fail([failure("crash", "x")]);
    const denied = newRun().deny();
    const expired = newRun().authorize("fp-1").start().expire();

    expect(passed.isTerminal()).toBe(true);
    expect(failed.isTerminal()).toBe(true);
    expect(denied.isTerminal()).toBe(true);
    expect(expired.isTerminal()).toBe(true);
  });

  it("all non-terminal states report isTerminal() = false", () => {
    expect(newRun().isTerminal()).toBe(false);
    expect(newRun().authorize("fp-1").isTerminal()).toBe(false);
    expect(newRun().authorize("fp-1").start().isTerminal()).toBe(false);
  });
});
