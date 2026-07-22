/**
 * US-DELTA-001 — Visible-mode projection and delegation status view tests.
 */
import { describe, expect, it } from "vitest";
import {
  visibleMode,
  visibleModeFromShape,
  renderCost,
  HOST_UNOBSERVABLE_COST,
  projectDelegationStatus,
  buildStatusFixture,
} from "../src/delta-team/projection.js";
import type { RollEvent, DeliveryShape } from "@roll/spec";

describe("US-DELTA-001 AC2 — VisibleDeliveryMode projection", () => {
  it("loop-autonomous → autonomous-loop (regardless of topology)", () => {
    expect(visibleMode("loop-autonomous", "solo")).toBe("autonomous-loop");
    expect(visibleMode("loop-autonomous", "full-delta-team")).toBe("autonomous-loop");
  });

  it("host-guided + solo → solo-skill", () => {
    expect(visibleMode("host-guided", "solo")).toBe("solo-skill");
  });

  it("host-guided + delta-team → delta-team", () => {
    expect(visibleMode("host-guided", "delta-team")).toBe("delta-team");
  });

  it("host-guided + full-delta-team → full-delta-team", () => {
    expect(visibleMode("host-guided", "full-delta-team")).toBe("full-delta-team");
  });

  it("visibleModeFromShape derives from DeliveryShape", () => {
    const shape: DeliveryShape = {
      trigger: "host-guided",
      topology: "delta-team",
      qualityProfile: "verified",
    };
    expect(visibleModeFromShape(shape)).toBe("delta-team");
  });

  it("four projection rules cover all trigger×topology combos", () => {
    const results = new Set<string>();
    for (const trigger of ["host-guided", "loop-autonomous"] as const) {
      for (const topology of ["solo", "delta-team", "full-delta-team"] as const) {
        results.add(visibleMode(trigger, topology));
      }
    }
    // Only four distinct visible modes should ever be produced
    expect(results.size).toBeLessThanOrEqual(4);
    expect([...results].sort()).toEqual([
      "autonomous-loop",
      "delta-team",
      "full-delta-team",
      "solo-skill",
    ]);
  });
});

describe("US-DELTA-001 AC8 — Cost rendering", () => {
  it("host-attested cost is always ? (host_unobservable)", () => {
    expect(renderCost("host-attested")).toBe(HOST_UNOBSERVABLE_COST);
  });

  it("null provenance (unresolved role) renders host-unobservable", () => {
    expect(renderCost(null)).toBe(HOST_UNOBSERVABLE_COST);
  });

  it("adapter-observed cost renders usage_authority_unavailable in v1", () => {
    expect(renderCost("adapter-observed")).toBe("? (usage_authority_unavailable)");
  });

  it("HOST_UNOBSERVABLE_COST constant is exact string", () => {
    expect(HOST_UNOBSERVABLE_COST).toBe("? (host_unobservable)");
  });
});

describe("US-DELTA-001 AC9 — Deterministic status projection", () => {
  it("unknown delegation returns unknown status", () => {
    const view = projectDelegationStatus("d-none", []);
    expect(view.delegationId).toBe("d-none");
    expect(view.status).toBe("unknown");
    expect(view.visibleMode).toBeNull();
    expect(view.trigger).toBeNull();
    expect(view.roles).toEqual([]);
    expect(view.totalCost).toBe(HOST_UNOBSERVABLE_COST);
  });

  it("delta:prepared transitions to prepared status", () => {
    const events: RollEvent[] = [
      {
        type: "delta:prepared",
        delegationId: "d1",
        runId: "delta-d1",
        storyId: "US-TEST-1",
        trigger: "host-guided",
        topology: "delta-team",
        qualityProfile: "verified",
        presetId: "p1",
        presetSha256: "abc",
        hostId: "pi",
        ts: 1,
      },
    ];
    const view = projectDelegationStatus("d1", events);
    expect(view.status).toBe("prepared");
    expect(view.storyId).toBe("US-TEST-1");
    expect(view.visibleMode).toBe("delta-team");
    expect(view.trigger).toBe("host-guided");
    expect(view.topology).toBe("delta-team");
  });

  it("role_resolved transitions to in_progress", () => {
    const events: RollEvent[] = [
      {
        type: "delta:prepared",
        delegationId: "d1",
        runId: "delta-d1",
        storyId: "US-TEST-1",
        trigger: "host-guided",
        topology: "solo",
        qualityProfile: "standard",
        presetId: "p1",
        presetSha256: "abc",
        hostId: "pi",
        ts: 1,
      },
      {
        type: "delta:role_resolved",
        delegationId: "d1",
        storyId: "US-TEST-1",
        role: "builder",
        roleInstanceId: "ri-b1",
        hostId: "pi",
        modelId: "sonnet",
        source: "preset-preference",
        reasons: ["coding"],
        inventorySha256: "def",
        ts: 2,
      },
    ];
    const view = projectDelegationStatus("d1", events);
    expect(view.status).toBe("in_progress");
    expect(view.roles).toHaveLength(1);
    expect(view.roles[0]).toMatchObject({
      role: "builder",
      status: "resolved",
      hostId: "pi",
      modelId: "sonnet",
      cost: HOST_UNOBSERVABLE_COST,
    });
  });

  it("role_started updates role status and records provenance", () => {
    const events: RollEvent[] = [
      {
        type: "delta:prepared",
        delegationId: "d1",
        runId: "delta-d1",
        storyId: "US-TEST-1",
        trigger: "host-guided",
        topology: "delta-team",
        qualityProfile: "verified",
        presetId: "p1",
        presetSha256: "abc",
        hostId: "pi",
        ts: 1,
      },
      {
        type: "delta:role_resolved",
        delegationId: "d1",
        storyId: "US-TEST-1",
        role: "designer",
        roleInstanceId: "ri-d1",
        hostId: "pi",
        modelId: "opus",
        source: "preset-preference",
        reasons: ["reasoning"],
        inventorySha256: "def",
        ts: 2,
      },
      {
        type: "delta:role_started",
        delegationId: "d1",
        storyId: "US-TEST-1",
        role: "designer",
        sessionId: "s1",
        roleInstanceId: "ri-d1",
        hostId: "pi",
        modelId: "opus",
        identityProvenance: "host-attested",
        worktreeAccess: "read-only",
        ts: 3,
      },
    ];
    const view = projectDelegationStatus("d1", events);
    expect(view.status).toBe("in_progress");
    expect(view.roles[0]).toMatchObject({
      role: "designer",
      status: "started",
      identityProvenance: "host-attested",
      cost: HOST_UNOBSERVABLE_COST,
    });
  });

  it("artifact_published advances role to artifact_published", () => {
    const events: RollEvent[] = [
      {
        type: "delta:prepared",
        delegationId: "d1",
        runId: "delta-d1",
        storyId: "US-TEST-1",
        trigger: "host-guided",
        topology: "solo",
        qualityProfile: "standard",
        presetId: "p1",
        presetSha256: "abc",
        hostId: "pi",
        ts: 1,
      },
      {
        type: "delta:role_resolved",
        delegationId: "d1",
        storyId: "US-TEST-1",
        role: "builder",
        roleInstanceId: "ri-b1",
        hostId: "pi",
        modelId: "sonnet",
        source: "preset-preference",
        reasons: ["coding"],
        inventorySha256: "def",
        ts: 2,
      },
      {
        type: "delta:artifact_published",
        delegationId: "d1",
        storyId: "US-TEST-1",
        role: "builder",
        path: "execute-evidence.md",
        sha256: "ghi",
        manifestPath: "artifact-manifest.json",
        sessionId: "s1",
        roleInstanceId: "ri-b1",
        identityProvenance: "host-attested",
        ts: 3,
      },
    ];
    const view = projectDelegationStatus("d1", events);
    expect(view.roles[0]).toMatchObject({
      role: "builder",
      status: "artifact_published",
      identityProvenance: "host-attested",
      cost: HOST_UNOBSERVABLE_COST,
    });
  });

  it("delta:terminal(handoff_ready) sets handoff_ready status", () => {
    const events: RollEvent[] = [
      {
        type: "delta:prepared",
        delegationId: "d1",
        runId: "delta-d1",
        storyId: "US-TEST-1",
        trigger: "host-guided",
        topology: "solo",
        qualityProfile: "standard",
        presetId: "p1",
        presetSha256: "abc",
        hostId: "pi",
        ts: 1,
      },
      {
        type: "delta:terminal",
        delegationId: "d1",
        storyId: "US-TEST-1",
        outcome: "handoff_ready",
        terminalBinding: "handoff_only",
        deliveryDisposition: "owner_continue",
        ts: 2,
      },
    ];
    const view = projectDelegationStatus("d1", events);
    expect(view.status).toBe("handoff_ready");
    expect(view.terminalBinding).toBe("handoff_only");
    expect(view.deliveryDisposition).toBe("owner_continue");
  });

  it("delta:terminal(abandoned) sets abandoned status", () => {
    const events: RollEvent[] = [
      {
        type: "delta:prepared",
        delegationId: "d1",
        runId: "delta-d1",
        storyId: "US-TEST-1",
        trigger: "host-guided",
        topology: "solo",
        qualityProfile: "standard",
        presetId: "p1",
        presetSha256: "abc",
        hostId: "pi",
        ts: 1,
      },
      {
        type: "delta:terminal",
        delegationId: "d1",
        storyId: "US-TEST-1",
        outcome: "abandoned",
        terminalBinding: "handoff_only",
        ts: 2,
      },
    ];
    const view = projectDelegationStatus("d1", events);
    expect(view.status).toBe("abandoned");
  });

  it("delta:blocked sets blocked status with reason and detail", () => {
    const events: RollEvent[] = [
      {
        type: "delta:prepared",
        delegationId: "d1",
        runId: "delta-d1",
        storyId: "US-TEST-1",
        trigger: "host-guided",
        topology: "delta-team",
        qualityProfile: "verified",
        presetId: "p1",
        presetSha256: "abc",
        hostId: "pi",
        ts: 1,
      },
      {
        type: "delta:blocked",
        delegationId: "d1",
        storyId: "US-TEST-1",
        role: "builder",
        reason: "host_attestation_invalid",
        detail: "host attestation missing for builder role",
        ts: 2,
      },
    ];
    const view = projectDelegationStatus("d1", events);
    expect(view.status).toBe("blocked");
    expect(view.blockReason).toBe("host_attestation_invalid");
    expect(view.blockDetail).toContain("host attestation");
  });

  it("ignores events for other delegations", () => {
    const events: RollEvent[] = [
      {
        type: "delta:prepared",
        delegationId: "d1",
        runId: "delta-d1",
        storyId: "US-TEST-1",
        trigger: "host-guided",
        topology: "solo",
        qualityProfile: "standard",
        presetId: "p1",
        presetSha256: "abc",
        hostId: "pi",
        ts: 1,
      },
      {
        type: "delta:prepared",
        delegationId: "d2",
        runId: "delta-d2",
        storyId: "US-TEST-2",
        trigger: "loop-autonomous",
        topology: "full-delta-team",
        qualityProfile: "designed",
        presetId: "p2",
        presetSha256: "xyz",
        hostId: "adapter",
        ts: 2,
      },
    ];
    // Only d1 events should be folded
    const view = projectDelegationStatus("d1", events);
    expect(view.storyId).toBe("US-TEST-1");
    expect(view.trigger).toBe("host-guided");
  });

  it("total cost is always host-unobservable", () => {
    const events: RollEvent[] = [
      {
        type: "delta:prepared",
        delegationId: "d1",
        runId: "delta-d1",
        storyId: "US-TEST-1",
        trigger: "host-guided",
        topology: "full-delta-team",
        qualityProfile: "designed",
        presetId: "p1",
        presetSha256: "abc",
        hostId: "pi",
        ts: 1,
      },
    ];
    const view = projectDelegationStatus("d1", events);
    expect(view.totalCost).toBe(HOST_UNOBSERVABLE_COST);
  });
});

describe("US-DELTA-001 AC9 — Status fixtures cover all modes", () => {
  it("unknown fixture", () => {
    const f = buildStatusFixture("unknown");
    expect(f.status).toBe("unknown");
    expect(f.visibleMode).toBeNull();
    expect(f.trigger).toBeNull();
  });

  it("autonomous-loop fixture", () => {
    const f = buildStatusFixture("autonomous-loop");
    expect(f.status).toBe("in_progress");
    expect(f.visibleMode).toBe("autonomous-loop");
    expect(f.trigger).toBe("loop-autonomous");
    expect(f.roles[0].identityProvenance).toBe("adapter-observed");
    expect(f.totalCost).toBe("? (usage_authority_unavailable)");
  });

  it("full-delta-team fixture", () => {
    const f = buildStatusFixture("full-delta-team");
    expect(f.status).toBe("handoff_ready");
    expect(f.visibleMode).toBe("full-delta-team");
    expect(f.terminalBinding).toBe("handoff_only");
    expect(f.deliveryDisposition).toBe("owner_continue");
    expect(f.roles).toHaveLength(3);
    expect(f.totalCost).toBe(HOST_UNOBSERVABLE_COST);
  });

  it("delta-team fixture", () => {
    const f = buildStatusFixture("delta-team");
    expect(f.status).toBe("in_progress");
    expect(f.visibleMode).toBe("delta-team");
    expect(f.trigger).toBe("host-guided");
    expect(f.topology).toBe("delta-team");
    expect(f.roles).toHaveLength(3);
    expect(f.totalCost).toBe(HOST_UNOBSERVABLE_COST);
  });

  it("solo-skill fixture", () => {
    const f = buildStatusFixture("solo-skill");
    expect(f.status).toBe("handoff_ready");
    expect(f.visibleMode).toBe("solo-skill");
    expect(f.terminalBinding).toBe("handoff_only");
    expect(f.roles).toHaveLength(1);
  });

  it("blocked fixture", () => {
    const f = buildStatusFixture("blocked");
    expect(f.status).toBe("blocked");
    expect(f.blockReason).toBe("host_attestation_invalid");
    expect(f.blockDetail).toContain("host attestation");
  });

  it("all six fixtures produce distinct statuses", () => {
    const scenarios = ["autonomous-loop", "full-delta-team", "delta-team", "solo-skill", "unknown", "blocked"] as const;
    const fixtures = scenarios.map((s) => buildStatusFixture(s));
    const statuses = fixtures.map((f) => f.status);
    // Each fixture should have a distinct status or mode combination
    const distinctKeys = fixtures.map((f) => `${f.status}:${f.visibleMode}`);
    expect(new Set(distinctKeys).size).toBe(fixtures.length);
  });
});
