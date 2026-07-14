/**
 * US-TRUTH-006 — registry hygiene + the deliberate-red fixture.
 */
import { describe, expect, it } from "vitest";
import {
  GRANDFATHERED_FIELDS,
  TRUTH_FIELD_REGISTRY,
  absent,
  buildTerminalEvent,
  registrationHint,
  registryProblems,
  unregisteredFields,
} from "../src/index.js";

describe("US-TRUTH-006 AC1/AC4 — registry hygiene", () => {
  it("every entry binds to a declared anchor; every derived-cache states a rebuild", () => {
    expect(registryProblems()).toEqual([]);
  });

  it("US-BROW-005 registers ledger lock, idempotency, and untrusted diagnostic fields", () => {
    const keys = [
      "runId", "idempotencyKey", "holderTokenHash", "state", "result",
      "holderPid", "heartbeatAt", "endpointHash", "artifactId", "bytes",
      "untrusted", "diagnosticOnly", "failure",
    ];
    const missing = unregisteredFields("browser", keys);
    expect(missing, registrationHint("browser", missing)).toEqual([]);
  });

  it("the grandfather list is explicit and short — history is listed, not hidden", () => {
    expect(GRANDFATHERED_FIELDS.length).toBeLessThanOrEqual(8);
    expect(GRANDFATHERED_FIELDS).toContain("project"); // the v2-era column
  });

  it("no duplicate (surface, field) registrations", () => {
    const seen = new Set<string>();
    for (const f of TRUTH_FIELD_REGISTRY) {
      const k = `${f.surface}.${f.field}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });
});

describe("US-TRUTH-006 AC2 — real builders' fields are all registered", () => {
  it("a REAL cycle:terminal event carries only registered fields", () => {
    const e = buildTerminalEvent({
      cycleId: "C",
      storyId: "S",
      agent: "pi",
      startedAt: 1,
      endedAt: 2,
      outcome: "failed",
      pr: absent("no_publish_attempted"),
      branch: absent("not_recorded"),
      commit: absent("not_recorded"),
      tcr: absent("not_recorded"),
      attest: absent("not_rendered"),
      usage: absent("no_parseable_usage"),
      cost: absent("no_parseable_usage"),
    });
    const missing = unregisteredFields("event:cycle:terminal", Object.keys(e));
    expect(missing, registrationHint("event:cycle:terminal", missing)).toEqual([]);
  });

  it("US-GOAL-001 registers persisted goal.yaml fields", () => {
    const keys = ["schema", "scope", "review", "limits", "status", "usage", "createdAt", "updatedAt", "lastDecisionReason"];
    const missing = unregisteredFields("goal", keys);
    expect(missing, registrationHint("goal", missing)).toEqual([]);
  });
});

describe("US-TRUTH-006 AC3/AC6 — the guard reds loudly on an unregistered field", () => {
  it("a doctored row with a sneaky new field is caught, with a how-to-register pointer", () => {
    const sneaky = ["run_id", "status", "vibe_score"]; // someone 顺手 added vibe_score
    const missing = unregisteredFields("runs", sneaky);
    expect(missing).toEqual(["vibe_score"]);
    const hint = registrationHint("runs", missing);
    expect(hint).toContain("truth-registry.ts");
    expect(hint).toContain("anchor");
    expect(hint).toContain("rebuild");
  });

  it("grandfathered v2 columns do not red the guard", () => {
    expect(unregisteredFields("runs", ["project", "result_eval"])).toEqual([]);
  });
});
