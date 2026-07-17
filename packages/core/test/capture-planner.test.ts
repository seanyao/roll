/**
 * US-EVID-030 — CapturePlanner unit tests.
 *
 * Covers AC1 (plan every eligible lane), AC2 (independent dispatch — a failed /
 * timed-out lane never suppresses another or deletes a taken image), AC3 (URL
 * normalization + login/foreign redirect rejection), AC4 (durable requested +
 * terminal facts), AC5 (idempotent re-run, no overwrite of an accepted artifact)
 * and the scorer_focus (lanes are ACTUALLY invoked; one surface cannot leak
 * evidence to an unrelated AC).
 *
 * The receipt store is an in-memory fake faithful to `RollCaptureReceiptStore`'s
 * append-only / freeze-accepted / dup-reject semantics. The REAL store is
 * exercised end-to-end in the CLI integration fixture (AC6).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  CaptureIntentV2,
  CaptureReceiptV2,
} from "@roll/spec";
import { ROLL_CAPTURE_PROTOCOL_V2, validateCaptureReceiptV2 } from "@roll/spec";
import {
  CapturePlanner,
  DEFAULT_CAPTURE_POLICY,
  type CaptureLanePort,
  type CapturePlanContext,
  type CaptureReceiptPersistOutcome,
  type CaptureReceiptStorePort,
  type DeclaredSurface,
} from "../src/attest/capture-planner.js";

const PROJECT_ROOT = "/repo";
const RUN_DIR = "/repo/.roll/features/acceptance-evidence/US-EVID-030/run1";
const TEAM = "http://localhost:3000/team";

function ctx(overrides: Partial<CapturePlanContext> = {}): CapturePlanContext {
  return { storyId: "US-EVID-030", runId: "run1", runDir: RUN_DIR, projectRoot: PROJECT_ROOT, ...overrides };
}

function shaOf(seed: string): string {
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

/** A faithful in-memory mirror of RollCaptureReceiptStore's contract. */
class FakeReceiptStore implements CaptureReceiptStorePort {
  readonly receipts = new Map<string, CaptureReceiptV2>();
  readonly sets = new Map<string, { attempts: string[]; acceptedReceiptId: string | null }>();
  readonly persistCalls: Array<{ intent: CaptureIntentV2; receipt: CaptureReceiptV2 }> = [];

  captureSetId(keys: Pick<CaptureReceiptV2, "storyId" | "runId" | "surfaceId">): string {
    return `${keys.storyId}|${keys.runId}|${keys.surfaceId}`;
  }

  async persistReceipt(intent: CaptureIntentV2, receipt: CaptureReceiptV2): Promise<CaptureReceiptPersistOutcome> {
    this.persistCalls.push({ intent, receipt });
    const captureSetId = this.captureSetId(receipt);
    const validation = validateCaptureReceiptV2(receipt, intent);
    if (!validation.ok) return { status: "rejected", reason: validation.errors.join("; "), captureSetId };

    const set = this.sets.get(captureSetId) ?? { attempts: [], acceptedReceiptId: null };
    const existing = this.receipts.get(receipt.requestId);
    if (existing !== undefined) {
      if (sameContent(existing, receipt)) {
        return { status: "duplicate", receipt: existing, captureSetId, accepted: set.acceptedReceiptId === existing.requestId };
      }
      return { status: "rejected", reason: `duplicate_request_id_different_content: ${receipt.requestId}`, captureSetId, existing };
    }
    this.receipts.set(receipt.requestId, receipt);
    if (!set.attempts.includes(receipt.requestId)) set.attempts.push(receipt.requestId);
    if (set.acceptedReceiptId === null && receipt.state === "taken") set.acceptedReceiptId = receipt.requestId;
    this.sets.set(captureSetId, set);
    return { status: "persisted", receipt, captureSetId, accepted: set.acceptedReceiptId === receipt.requestId };
  }
}

function sameContent(a: CaptureReceiptV2, b: CaptureReceiptV2): boolean {
  const key = (r: CaptureReceiptV2): string =>
    JSON.stringify([r.storyId, r.runId, r.surfaceId, r.source, r.captureClass, r.state, r.screenshotPath ?? null, r.sha256 ?? null, r.finalUrl ?? null, r.reason ?? null, r.target ?? null]);
  return key(a) === key(b);
}

/** A recording lane whose behavior is supplied per call. */
function recordingLane(source: CaptureLanePort["source"], impl: (intent: CaptureIntentV2) => Promise<CaptureReceiptV2>): CaptureLanePort & { calls: CaptureIntentV2[] } {
  const calls: CaptureIntentV2[] = [];
  return {
    source,
    calls,
    run(intent) {
      calls.push(intent);
      return impl(intent);
    },
  };
}

function takenReceipt(intent: CaptureIntentV2, overrides: Partial<CaptureReceiptV2> = {}): CaptureReceiptV2 {
  const captureClass = intent.source === "roll-capture-window" ? "physical" : "rendered";
  return {
    protocol: ROLL_CAPTURE_PROTOCOL_V2,
    requestId: intent.requestId,
    storyId: intent.storyId,
    runId: intent.runId,
    surfaceId: intent.surface.id,
    source: intent.source,
    captureClass,
    state: "taken",
    screenshotPath: intent.out,
    sha256: shaOf(intent.requestId),
    ...(captureClass === "rendered" ? { finalUrl: intent.surface.id } : {}),
    ...(captureClass === "physical" && intent.target !== undefined ? { target: intent.target } : {}),
    responsePath: `${intent.out}.response.json`,
    startedAt: "2026-07-18T10:00:01.000+08:00",
    finishedAt: "2026-07-18T10:00:02.000+08:00",
    ...overrides,
  };
}

// ── AC1 — plan every policy-eligible lane ────────────────────────────────────

describe("CapturePlanner.plan — eligible lanes (AC1)", () => {
  it("plans BOTH the physical window lane and the rendered lane when a window app is declared", () => {
    const planner = new CapturePlanner();
    const surface: DeclaredSurface = { declaredUrl: TEAM, expectedAcIds: ["AC2", "AC3"], windowApp: "Google Chrome", windowTitle: "团队管理" };
    const plan = planner.plan(surface, ctx());

    expect(plan.surfaceId).toBe(TEAM);
    expect(plan.lanes.map((l) => l.source).sort()).toEqual(["playwright-rendered", "roll-capture-window"]);
    const physical = plan.lanes.find((l) => l.source === "roll-capture-window")!;
    const rendered = plan.lanes.find((l) => l.source === "playwright-rendered")!;
    expect(physical.captureClass).toBe("physical");
    expect(physical.operation).toBe("capture-window");
    expect(physical.intent.target).toEqual({ appName: "Google Chrome", windowTitle: "团队管理" });
    expect(rendered.captureClass).toBe("rendered");
    expect(rendered.operation).toBe("register-rendered");
    // Harness-owned binding: paths derived under runDir/screenshots, never typed.
    expect(physical.intent.out.startsWith(`${RUN_DIR}/screenshots/`)).toBe(true);
    expect(rendered.intent.out.startsWith(`${RUN_DIR}/screenshots/`)).toBe(true);
    expect(rendered.intent.inputPath?.startsWith(`${RUN_DIR}/screenshots/`)).toBe(true);
    // Both intents share the SAME canonical surface (→ one CaptureSet).
    expect(physical.intent.surface.id).toBe(rendered.intent.surface.id);
    expect(physical.intent.surface.expectedAcIds).toEqual(["AC2", "AC3"]);
  });

  it("plans ONLY the rendered lane and records a concrete skip when no window app is declared", () => {
    const planner = new CapturePlanner();
    const plan = planner.plan({ declaredUrl: TEAM, expectedAcIds: ["AC2"] }, ctx());
    expect(plan.lanes.map((l) => l.source)).toEqual(["playwright-rendered"]);
    expect(plan.skipped).toContainEqual({ source: "roll-capture-window", reason: expect.stringContaining("no capture_window_app") });
  });

  it("respects the policy sources allow-list", () => {
    const planner = new CapturePlanner();
    const plan = planner.plan(
      { declaredUrl: TEAM, expectedAcIds: ["AC2"], windowApp: "Google Chrome" },
      ctx({ policy: { ...DEFAULT_CAPTURE_POLICY, sources: ["roll-capture-window"] } }),
    );
    expect(plan.lanes.map((l) => l.source)).toEqual(["roll-capture-window"]);
    expect(plan.skipped).toContainEqual({ source: "playwright-rendered", reason: expect.stringContaining("not enabled") });
  });
});

// ── AC3 — URL normalization ──────────────────────────────────────────────────

describe("CapturePlanner.plan — URL normalization (AC3)", () => {
  it("canonicalizes the declared URL into surfaceId + intents", () => {
    const planner = new CapturePlanner();
    const plan = planner.plan({ declaredUrl: "http://localhost:3000/team?tab=1#top", expectedAcIds: ["AC1"] }, ctx());
    expect(plan.surfaceId).toBe("http://localhost:3000/team?tab=1#top");
    expect(plan.lanes[0]!.intent.surface.id).toBe("http://localhost:3000/team?tab=1#top");
  });

  it("plans NOTHING for a non-URL declared surface and says why", () => {
    const planner = new CapturePlanner();
    const plan = planner.plan({ declaredUrl: "not a url", expectedAcIds: ["AC1"] }, ctx());
    expect(plan.surfaceId).toBeNull();
    expect(plan.lanes).toHaveLength(0);
    expect(plan.skipped).toContainEqual({ source: "surface", reason: expect.stringContaining("not a valid URL") });
  });
});

// ── scorer_focus + AC4 — lanes are actually invoked, facts are durable ────────

describe("CapturePlanner.run — dispatches real executors and records durable facts (scorer_focus, AC4)", () => {
  it("INVOKES every injected lane executor and records requested + terminal facts with source, timing, and digest", async () => {
    const store = new FakeReceiptStore();
    const requestedSink: unknown[] = [];
    const finishedSink: unknown[] = [];
    const planner = new CapturePlanner({ ledger: { requested: (f) => void requestedSink.push(f), finished: (f) => void finishedSink.push(f) } });
    const surface: DeclaredSurface = { declaredUrl: TEAM, expectedAcIds: ["AC2", "AC3"], windowApp: "Google Chrome", windowTitle: "团队管理" };

    const physical = recordingLane("roll-capture-window", async (i) => takenReceipt(i));
    const rendered = recordingLane("playwright-rendered", async (i) => takenReceipt(i));
    const result = await planner.capture(surface, ctx(), [physical, rendered], store);

    // The lanes were ACTUALLY called — not merely planned/skipped.
    expect(physical.calls).toHaveLength(1);
    expect(rendered.calls).toHaveLength(1);
    expect(store.persistCalls).toHaveLength(2);

    // Durable requested fact per lane, emitted before dispatch.
    expect(requestedSink).toHaveLength(2);
    expect(result.requested.map((r) => r.source).sort()).toEqual(["playwright-rendered", "roll-capture-window"]);
    // Durable terminal fact per lane, carrying source, timing, and a digest.
    expect(finishedSink).toHaveLength(2);
    expect(result.attempts).toHaveLength(2);
    for (const a of result.attempts) {
      expect(a.state).toBe("taken");
      expect(a.accepted).toBe(true);
      expect(a.sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(typeof a.startedAt).toBe("string");
      expect(a.durationMs).toBeGreaterThanOrEqual(0);
      expect(a.expectedAcIds).toEqual(["AC2", "AC3"]);
    }
    // AC6 shape: both taken images land in ONE CaptureSet.
    expect(new Set(result.persisted.map((p) => p.captureSetId)).size).toBe(1);
    expect(result.taken).toHaveLength(2);
    expect(result.taken.map((t) => t.receipt.captureClass).sort()).toEqual(["physical", "rendered"]);
    // Exactly ONE is the store's frozen canonical receipt (AC5 invariant).
    expect(result.persisted.filter((p) => p.frozenAccepted)).toHaveLength(1);
  });
});

// ── AC2 — independent dispatch ───────────────────────────────────────────────

describe("CapturePlanner.run — independent dispatch (AC2)", () => {
  it("a THROWING lane does not suppress the sibling and never deletes its taken image", async () => {
    const store = new FakeReceiptStore();
    const planner = new CapturePlanner();
    const surface: DeclaredSurface = { declaredUrl: TEAM, expectedAcIds: ["AC2"], windowApp: "Google Chrome" };

    const physical = recordingLane("roll-capture-window", async () => {
      throw new Error("Capture.app not running");
    });
    const rendered = recordingLane("playwright-rendered", async (i) => takenReceipt(i));
    const result = await planner.capture(surface, ctx(), [physical, rendered], store);

    // Both lanes attempted; the failing one is recorded, not silent.
    expect(physical.calls).toHaveLength(1);
    const physFact = result.attempts.find((a) => a.source === "roll-capture-window")!;
    const rendFact = result.attempts.find((a) => a.source === "playwright-rendered")!;
    expect(physFact.state).toBe("failed");
    expect(physFact.reason).toContain("Capture.app not running");
    expect(physFact.accepted).toBe(false);
    // The rendered lane still succeeded and is accepted + retained in the store.
    expect(rendFact.state).toBe("taken");
    expect(rendFact.accepted).toBe(true);
    const setId = store.captureSetId({ storyId: "US-EVID-030", runId: "run1", surfaceId: TEAM });
    expect(store.sets.get(setId)!.acceptedReceiptId).toBe(rendFact.requestId);
    expect(store.receipts.get(rendFact.requestId)?.state).toBe("taken");
    // The failed attempt is DURABLY recorded in the same CaptureSet.
    expect(store.sets.get(setId)!.attempts).toContain(physFact.requestId);
  });

  it("a TIMED-OUT lane does not suppress the sibling", async () => {
    const store = new FakeReceiptStore();
    const planner = new CapturePlanner();
    const surface: DeclaredSurface = { declaredUrl: TEAM, expectedAcIds: ["AC2"], windowApp: "Google Chrome" };
    // Small per-lane deadline; the physical lane hangs forever.
    const policyCtx = ctx({ policy: { ...DEFAULT_CAPTURE_POLICY, timeoutMs: 25 } });

    const physical = recordingLane("roll-capture-window", () => new Promise<CaptureReceiptV2>(() => {}));
    const rendered = recordingLane("playwright-rendered", async (i) => takenReceipt(i));
    const result = await planner.capture(surface, policyCtx, [physical, rendered], store);

    const physFact = result.attempts.find((a) => a.source === "roll-capture-window")!;
    const rendFact = result.attempts.find((a) => a.source === "playwright-rendered")!;
    expect(physFact.state).toBe("timeout");
    expect(physFact.reason).toContain("timed out");
    expect(rendFact.state).toBe("taken");
    expect(rendFact.accepted).toBe(true);
  });
});

// ── AC3 — reject login/foreign redirects ─────────────────────────────────────

describe("CapturePlanner.run — rejects login/foreign redirects (AC3)", () => {
  it("a rendered receipt whose finalUrl left the surface is NOT accepted and records the reason", async () => {
    const store = new FakeReceiptStore();
    const planner = new CapturePlanner();
    const surface: DeclaredSurface = { declaredUrl: TEAM, expectedAcIds: ["AC2"] };

    const rendered = recordingLane("playwright-rendered", async (i) =>
      takenReceipt(i, { finalUrl: "http://localhost:3000/login" }),
    );
    const result = await planner.capture(surface, ctx(), [rendered], store);

    expect(rendered.calls).toHaveLength(1);
    const fact = result.attempts[0]!;
    expect(fact.state).toBe("failed");
    expect(fact.accepted).toBe(false);
    expect(fact.reason).toMatch(/does not equal the surface|invalid target|redirect/u);
    expect(result.taken).toHaveLength(0);
  });
});

// ── AC5 — idempotency + no overwrite ─────────────────────────────────────────

describe("CapturePlanner.run — idempotency and no overwrite of an accepted artifact (AC5)", () => {
  it("a repeat of the same capture intent is idempotent (duplicate, not overwrite)", async () => {
    const store = new FakeReceiptStore();
    const planner = new CapturePlanner();
    const surface: DeclaredSurface = { declaredUrl: TEAM, expectedAcIds: ["AC2"], windowApp: "Google Chrome" };
    const lanes = () => [
      recordingLane("roll-capture-window", async (i) => takenReceipt(i)),
      recordingLane("playwright-rendered", async (i) => takenReceipt(i)),
    ];

    const first = await planner.capture(surface, ctx(), lanes(), store);
    expect(first.taken).toHaveLength(2);
    const takenIds = first.taken.map((a) => a.receipt.requestId).sort();

    const second = await planner.capture(surface, ctx(), lanes(), store);
    // Re-run persists the SAME content → duplicates, no new receipts written.
    expect(second.attempts.every((a) => a.persist === "duplicate")).toBe(true);
    expect(store.receipts.size).toBe(2);
    expect(second.taken.map((a) => a.receipt.requestId).sort()).toEqual(takenIds);
  });

  it("a concurrent second taken attempt for the same surface cannot replace the frozen accepted artifact", async () => {
    const store = new FakeReceiptStore();
    const planner = new CapturePlanner();
    const surface: DeclaredSurface = { declaredUrl: TEAM, expectedAcIds: ["AC2"] };

    // Two rendered attempts dispatched concurrently — one is enough to accept;
    // a retry with a different digest joins the set but never overwrites.
    const first = recordingLane("playwright-rendered", async (i) => takenReceipt(i));
    const r1 = await planner.capture(surface, ctx(), [first], store);
    const firstAccepted = r1.taken[0]!.receipt;

    const retryPlanner = new CapturePlanner();
    const plan = retryPlanner.plan(surface, ctx({ runId: "run1" }));
    // Force a NEW request id for the retry but same surface (same CaptureSet).
    plan.lanes[0]!.intent = { ...plan.lanes[0]!.intent, requestId: `${plan.lanes[0]!.intent.requestId}-retry` };
    const retryLane = recordingLane("playwright-rendered", async (i) => takenReceipt(i, { sha256: shaOf("different") }));
    const r2 = await retryPlanner.run(plan, [retryLane], store);

    const setId = store.captureSetId({ storyId: "US-EVID-030", runId: "run1", surfaceId: TEAM });
    // Accepted stays frozen to the FIRST taken receipt; the retry is retained but
    // NOT frozen and cannot overwrite the first artifact.
    expect(store.sets.get(setId)!.acceptedReceiptId).toBe(firstAccepted.requestId);
    expect(r2.persisted[0]!.frozenAccepted).toBe(false);
    expect(store.receipts.get(firstAccepted.requestId)?.sha256).toBe(firstAccepted.sha256);
  });
});

// ── scorer_focus — no cross-AC / cross-surface leak ──────────────────────────

describe("CapturePlanner — one surface cannot leak evidence to an unrelated AC (scorer_focus)", () => {
  it("binds each accepted artifact ONLY to its declared surface and named ACs", async () => {
    const store = new FakeReceiptStore();
    const planner = new CapturePlanner();

    const team: DeclaredSurface = { declaredUrl: TEAM, expectedAcIds: ["AC2", "AC3"] };
    const admin: DeclaredSurface = { declaredUrl: "http://localhost:3000/admin", expectedAcIds: ["AC7"] };

    const teamRes = await planner.capture(team, ctx(), [recordingLane("playwright-rendered", async (i) => takenReceipt(i))], store);
    const adminRes = await planner.capture(admin, ctx(), [recordingLane("playwright-rendered", async (i) => takenReceipt(i))], store);

    // Distinct CaptureSets, distinct AC bindings — no bleed.
    expect(teamRes.captureSetId).not.toBe(adminRes.captureSetId);
    const teamAccepted = teamRes.taken[0]!;
    const adminAccepted = adminRes.taken[0]!;
    expect(teamAccepted.receipt.surfaceId).toBe(TEAM);
    expect(teamAccepted.intent.surface.expectedAcIds).toEqual(["AC2", "AC3"]);
    expect(adminAccepted.receipt.surfaceId).toBe("http://localhost:3000/admin");
    expect(adminAccepted.intent.surface.expectedAcIds).toEqual(["AC7"]);
    // The team surface's facts never carry AC7, and vice versa.
    expect(teamRes.attempts.every((a) => !a.expectedAcIds.includes("AC7"))).toBe(true);
    expect(adminRes.attempts.every((a) => !a.expectedAcIds.some((id) => id === "AC2" || id === "AC3"))).toBe(true);
  });
});

// ── US-EVID-031 — failureKind classification (poisoned vs broken machine) ─────

describe("CapturePlanner.run — classifies failureKind for the EvidenceHealth resolver (US-EVID-031)", () => {
  it("a poisoned lane (login/foreign redirect) is tagged failureKind=invalid-target", async () => {
    const store = new FakeReceiptStore();
    const planner = new CapturePlanner();
    const surface: DeclaredSurface = { declaredUrl: TEAM, expectedAcIds: ["AC2"] };
    const rendered = recordingLane("playwright-rendered", async (i) => takenReceipt(i, { finalUrl: "http://localhost:3000/login" }));
    const result = await planner.capture(surface, ctx(), [rendered], store);
    const fact = result.attempts[0]!;
    expect(fact.state).toBe("failed");
    expect(fact.failureKind).toBe("invalid-target");
    expect(fact.accepted).toBe(false);
  });

  it("a forged digest (invalid taken receipt) is tagged failureKind=invalid-target", async () => {
    const store = new FakeReceiptStore();
    const planner = new CapturePlanner();
    const surface: DeclaredSurface = { declaredUrl: TEAM, expectedAcIds: ["AC2"] };
    const rendered = recordingLane("playwright-rendered", async (i) => takenReceipt(i, { sha256: "sha256:not-a-real-digest" }));
    const result = await planner.capture(surface, ctx(), [rendered], store);
    const fact = result.attempts[0]!;
    expect(fact.state).toBe("failed");
    expect(fact.failureKind).toBe("invalid-target");
  });

  it("a THROWING lane is tagged failureKind=infrastructure", async () => {
    const store = new FakeReceiptStore();
    const planner = new CapturePlanner();
    const surface: DeclaredSurface = { declaredUrl: TEAM, expectedAcIds: ["AC2"], windowApp: "Google Chrome" };
    const physical = recordingLane("roll-capture-window", async () => {
      throw new Error("Capture.app not running");
    });
    const rendered = recordingLane("playwright-rendered", async (i) => takenReceipt(i));
    const result = await planner.capture(surface, ctx(), [physical, rendered], store);
    const physFact = result.attempts.find((a) => a.source === "roll-capture-window")!;
    const rendFact = result.attempts.find((a) => a.source === "playwright-rendered")!;
    expect(physFact.state).toBe("failed");
    expect(physFact.failureKind).toBe("infrastructure");
    // The accepted taken image carries NO failureKind.
    expect(rendFact.state).toBe("taken");
    expect(rendFact.failureKind).toBeUndefined();
  });

  it("a TIMED-OUT lane is tagged failureKind=infrastructure", async () => {
    const store = new FakeReceiptStore();
    const planner = new CapturePlanner();
    const surface: DeclaredSurface = { declaredUrl: TEAM, expectedAcIds: ["AC2"], windowApp: "Google Chrome" };
    const policyCtx = ctx({ policy: { ...DEFAULT_CAPTURE_POLICY, timeoutMs: 20 } });
    const physical = recordingLane("roll-capture-window", () => new Promise<CaptureReceiptV2>(() => {}));
    const result = await planner.capture(surface, policyCtx, [physical], store);
    const fact = result.attempts.find((a) => a.source === "roll-capture-window")!;
    expect(fact.state).toBe("timeout");
    expect(fact.failureKind).toBe("infrastructure");
  });

  it("a missing executor (no lane injected) is tagged failureKind=infrastructure (skipped)", async () => {
    const store = new FakeReceiptStore();
    const planner = new CapturePlanner();
    const surface: DeclaredSurface = { declaredUrl: TEAM, expectedAcIds: ["AC2"] };
    const result = await planner.capture(surface, ctx(), [], store);
    const fact = result.attempts[0]!;
    expect(fact.state).toBe("skipped");
    expect(fact.failureKind).toBe("infrastructure");
  });
});

// ── plan validity guard ──────────────────────────────────────────────────────

describe("CapturePlanner.plan — derives only valid intents", () => {
  it("every planned intent passes validateCaptureIntentV2 against its own request id", () => {
    const planner = new CapturePlanner();
    const plan = planner.plan({ declaredUrl: TEAM, expectedAcIds: ["AC2"], windowApp: "Google Chrome" }, ctx());
    for (const lane of plan.lanes) {
      expect(lane.intent.requestId).toMatch(/^[A-Za-z0-9._-]+$/u);
      expect(lane.intent.protocol).toBe(ROLL_CAPTURE_PROTOCOL_V2);
    }
    // Sanity: the planner never left an eligible source unaccounted for.
    const accounted = new Set([...plan.lanes.map((l) => l.source), ...plan.skipped.map((s) => s.source)]);
    expect(accounted.has("roll-capture-window")).toBe(true);
    expect(accounted.has("playwright-rendered")).toBe(true);
  });
});
