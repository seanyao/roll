/**
 * US-TRUTH-005 — release gate + recorded waiver (AC6's six cases).
 */
import { describe, expect, it } from "vitest";
import { decideReleaseGate, type AuditFinding, type ReleaseWaiver } from "../src/index.js";

const NOW = 1_781_000_000;
const fail = (rule: string, subject: string): AuditFinding => ({ rule, severity: "fail", subject, detail: "d" });
const warn: AuditFinding = { rule: "usage-missing", severity: "warn", subject: "C1", detail: "d" };
const unknown: AuditFinding = { rule: "done-no-merge", severity: "unknown", subject: "US-1", detail: "gh down" };
const grandfathered: AuditFinding = { rule: "done-no-merge", severity: "grandfathered", subject: "US-OLD", detail: "d" };

const waiver = (over: Partial<ReleaseWaiver> = {}): ReleaseWaiver => ({
  reason: "owner accepts the known drift for this hotfix",
  scope: "all",
  expiresSec: NOW + 86400,
  operator: "seanyao",
  tsSec: NOW - 100,
  ...over,
});

describe("decideReleaseGate — AC6 truth table", () => {
  it("1. pass: no fail findings → ok", () => {
    const d = decideReleaseGate([warn, unknown, grandfathered], [], NOW);
    expect(d.ok).toBe(true);
    expect(d.blockedBy).toHaveLength(0);
  });

  it("2. fail block: a fail finding with no waiver blocks", () => {
    const d = decideReleaseGate([fail("done-no-merge", "US-2")], [], NOW);
    expect(d.ok).toBe(false);
    expect(d.blockedBy).toHaveLength(1);
  });

  it("3. warn allow: warns never block (reported only)", () => {
    expect(decideReleaseGate([warn], [], NOW).ok).toBe(true);
  });

  it("4. unknown policy: external flake / convergence windows never kill a release", () => {
    expect(decideReleaseGate([unknown], [], NOW).ok).toBe(true);
  });

  it("5. waiver allow: a live waiver covering rule, subject, or all lets the fail through — recorded", () => {
    const byRule = decideReleaseGate([fail("done-no-merge", "US-2")], [waiver({ scope: "done-no-merge" })], NOW);
    expect(byRule.ok).toBe(true);
    expect(byRule.waived[0]?.waiver.operator).toBe("seanyao");
    const bySubject = decideReleaseGate([fail("done-no-merge", "US-2")], [waiver({ scope: "US-2" })], NOW);
    expect(bySubject.ok).toBe(true);
    const unrelated = decideReleaseGate([fail("done-no-merge", "US-2")], [waiver({ scope: "other-rule" })], NOW);
    expect(unrelated.ok).toBe(false);
  });

  it("6. expired waiver blocks again — expiry is part of the fact", () => {
    const d = decideReleaseGate([fail("done-no-merge", "US-2")], [waiver({ expiresSec: NOW - 1 })], NOW);
    expect(d.ok).toBe(false);
    expect(d.waived).toHaveLength(0);
  });
});
