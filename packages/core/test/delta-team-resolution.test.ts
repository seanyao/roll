/**
 * US-DELTA-002 — Deterministic model resolution tests.
 *
 * Covers: pin available/unavailable, preference order, fallback recording,
 * required-diversity block, prefer-diversity fallback, cost-class filter,
 * tag filter, stable tie-break, host-id mismatch, stale inventory,
 * exclusion filter, hard cost cap, all-roles resolution.
 *
 * All model IDs use opaque, neutral identifiers — no real provider/model names.
 */
import { describe, expect, it } from "vitest";
import {
  resolveRoles,
  type OwnerConstraints,
  type InventoryFreshnessParams,
} from "../src/delta-team/model-resolution.js";
import type {
  MachineDeltaPreset,
  HostModelInventory,
  HostModelDescriptor,
} from "@roll/spec";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function mkModel(
  id: string,
  available: boolean,
  tags: string[],
  costClass?: "low" | "medium" | "high",
): HostModelDescriptor {
  return { id, available, capabilityTags: tags, costClass };
}

function mkInventory(
  hostId: string,
  observedAt: string, // ISO-8601
  models: HostModelDescriptor[],
): HostModelInventory {
  return { hostId, observedAt, models };
}

function mkPreset(overrides?: Partial<MachineDeltaPreset>): MachineDeltaPreset {
  return {
    schema: "roll-delta-preset/v1",
    id: "test-preset",
    hostId: "test-host",
    roles: {
      designer: {
        preferredModelIds: ["model-alpha", "model-beta"],
        requiredTags: ["reasoning"],
        diversity: "prefer",
      },
      builder: {
        preferredModelIds: ["model-gamma", "model-delta"],
        requiredTags: ["coding"],
        preferredCostClass: "medium",
        diversity: "prefer",
      },
      evaluator: {
        preferredModelIds: ["model-epsilon", "model-zeta"],
        requiredTags: ["review"],
        diversity: "require",
      },
    },
    ...overrides,
  };
}

// Full healthy inventory with distinct models for all roles
const healthyInventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
  mkModel("model-alpha", true, ["reasoning", "planning"], "high"),
  mkModel("model-beta", true, ["reasoning"], "high"),
  mkModel("model-gamma", true, ["coding", "testing"], "medium"),
  mkModel("model-delta", true, ["coding"], "low"),
  mkModel("model-epsilon", true, ["review", "analysis"], "high"),
  mkModel("model-zeta", true, ["review"], "medium"),
]);

const freshnessOk: InventoryFreshnessParams = {
  nowMs: Date.parse("2026-07-22T10:05:00.000Z"),
  maxInventoryAgeMs: 600_000, // 10 minutes
};

const testDelegationId = "delta-test-001";

// ── AC1: Pin available ────────────────────────────────────────────────────────

describe("US-DELTA-002 AC1 — Pin handling", () => {
  it("resolves a hard user pin when the model is available", () => {
    const preset = mkPreset();
    const result = resolveRoles(preset, healthyInventory, {
      pins: { designer: "model-alpha" },
    }, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;

    const designer = result.assignments.find(a => a.role === "designer");
    expect(designer).toBeDefined();
    expect(designer!.modelId).toBe("model-alpha");
    expect(designer!.source).toBe("user-pin");
    expect(designer!.reasons).toContain("user-pinned model resolved: model-alpha");
  });

  it("blocks when a pinned model is unavailable", () => {
    const preset = mkPreset();
    const result = resolveRoles(preset, healthyInventory, {
      pins: { designer: "model-unicorn" }, // not in inventory
    }, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("failure");
    if (result.outcome !== "failure") return;
    expect(result.reason).toContain("pin");
    expect(result.reason).toContain("model-unicorn");
  });

  it("blocks when a pinned model exists but is unavailable", () => {
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-alpha", false, ["reasoning"]), // exists but unavailable
      mkModel("model-gamma", true, ["coding"], "medium"),
      mkModel("model-epsilon", true, ["review"], "high"),
    ]);
    const preset = mkPreset();
    const result = resolveRoles(preset, inventory, {
      pins: { designer: "model-alpha" },
    }, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("failure");
    if (result.outcome !== "failure") return;
    expect(result.reason).toContain("pin");
    expect(result.reason).toContain("model-alpha");
  });

  it("user-pin source is set correctly", () => {
    const preset = mkPreset();
    const result = resolveRoles(preset, healthyInventory, {
      pins: { builder: "model-gamma" },
    }, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    const builder = result.assignments.find(a => a.role === "builder");
    expect(builder!.source).toBe("user-pin");
  });
});

// ── AC2: Preference order ─────────────────────────────────────────────────────

describe("US-DELTA-002 AC2 — Preference order", () => {
  it("picks the first available preferred model", () => {
    const preset = mkPreset();
    const result = resolveRoles(preset, healthyInventory, {}, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    const designer = result.assignments.find(a => a.role === "designer");
    expect(designer!.modelId).toBe("model-alpha"); // first in list, available
    expect(designer!.source).toBe("preset-preference");
  });

  it("falls back to second preference when first is unavailable", () => {
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-beta", true, ["reasoning"]), // second choice
      mkModel("model-gamma", true, ["coding"], "medium"),
      mkModel("model-epsilon", true, ["review"], "high"),
    ]);
    const preset = mkPreset();
    const result = resolveRoles(preset, inventory, {}, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    const designer = result.assignments.find(a => a.role === "designer");
    expect(designer!.modelId).toBe("model-beta");
    expect(designer!.source).toBe("availability-fallback");
    expect(designer!.reasons.some(r => r.includes("model-alpha"))).toBe(true);
  });

  it("records fallback reason when skipping unavailable preference", () => {
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-delta", true, ["coding"], "low"),
      mkModel("model-epsilon", true, ["review"], "high"),
      mkModel("model-beta", true, ["reasoning"]),
    ]);
    const preset = mkPreset();
    const result = resolveRoles(preset, inventory, {}, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    const builder = result.assignments.find(a => a.role === "builder");
    // builder prefers gamma (unavailable), then delta (available)
    expect(builder!.modelId).toBe("model-delta");
    expect(builder!.source).toBe("availability-fallback");
  });
});

// ── AC3: Required-diversity block ─────────────────────────────────────────────

describe("US-DELTA-002 AC3 — Required diversity", () => {
  it("blocks when required diversity cannot be met (only one model fits two roles)", () => {
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-omega", true, ["reasoning", "coding", "review"]),
    ]);
    // Make all three roles prefer the same model with required diversity
    const preset = mkPreset({
      roles: {
        designer: {
          preferredModelIds: ["model-omega"],
          requiredTags: [],
          diversity: "require",
        },
        builder: {
          preferredModelIds: ["model-omega"],
          requiredTags: [],
          diversity: "require",
        },
        evaluator: {
          preferredModelIds: ["model-omega"],
          requiredTags: [],
          diversity: "require",
        },
      },
    });

    const result = resolveRoles(preset, inventory, {}, freshnessOk, testDelegationId);
    expect(result.outcome).toBe("failure");
    if (result.outcome !== "failure") return;
    expect(result.reason.toLowerCase()).toContain("diversity");
    expect(result.reason).toContain("Required");
  });

  it("succeeds when required diversity is met (distinct models available)", () => {
    // Three distinct models, required diversity on all
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-one", true, []),
      mkModel("model-two", true, []),
      mkModel("model-three", true, []),
    ]);
    const preset = mkPreset({
      roles: {
        designer: {
          preferredModelIds: ["model-one"],
          requiredTags: [],
          diversity: "require",
        },
        builder: {
          preferredModelIds: ["model-two"],
          requiredTags: [],
          diversity: "require",
        },
        evaluator: {
          preferredModelIds: ["model-three"],
          requiredTags: [],
          diversity: "require",
        },
      },
    });

    const result = resolveRoles(preset, inventory, {}, freshnessOk, testDelegationId);
    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    const modelIds = result.assignments.map(a => a.modelId);
    // All distinct
    expect(new Set(modelIds).size).toBe(3);
  });
});

// ── AC4: Prefer-diversity fallback ────────────────────────────────────────────

describe("US-DELTA-002 AC4 — Prefer diversity", () => {
  it("preference order beats diversity (same-tier tiebreak only)", () => {
    // Plan 4.3: pin → preference → risk → diversity → cost → lexical
    // For prefer diversity, a higher-preference used model beats a lower-preference unused model.
    const preset = mkPreset({
      roles: {
        designer: {
          preferredModelIds: ["model-shared", "model-beta"],
          requiredTags: [],
          diversity: "prefer",
        },
        builder: {
          preferredModelIds: ["model-shared", "model-gamma"],
          requiredTags: [],
          diversity: "prefer",
        },
        evaluator: {
          preferredModelIds: ["model-epsilon"],
          requiredTags: [],
          diversity: "prefer",
        },
      },
    });
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-shared", true, []),
      mkModel("model-beta", true, []),
      mkModel("model-gamma", true, []),
      mkModel("model-epsilon", true, []),
    ]);

    const result = resolveRoles(preset, inventory, {}, freshnessOk, testDelegationId);
    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    // Designer picks model-shared (first pref).
    // Builder: pref is [model-shared, model-gamma]. model-shared is prefIndex=0 (used),
    // model-gamma is prefIndex=1 (unused). Preference order is primary, so builder
    // still picks model-shared (prefIndex 0 beats 1, despite it being used).
    const designer = result.assignments.find(a => a.role === "designer");
    const builder = result.assignments.find(a => a.role === "builder");
    expect(designer!.modelId).toBe("model-shared");
    // Builder picks model-shared because preference order beats diversity tiebreaker
    expect(builder!.modelId).toBe("model-shared");
    // Source should be availability-fallback since it was already used with prefer diversity
    expect(builder!.source).toBe("availability-fallback");
  });

  it("falls back to same model with availability-fallback when prefer diversity cannot be met", () => {
    const preset = mkPreset({
      roles: {
        designer: {
          preferredModelIds: ["model-only"],
          requiredTags: [],
          diversity: "prefer",
        },
        builder: {
          preferredModelIds: ["model-only"],
          requiredTags: [],
          diversity: "prefer",
        },
        evaluator: {
          preferredModelIds: ["model-only"],
          requiredTags: [],
          diversity: "prefer",
        },
      },
    });
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-only", true, []),
    ]);

    const result = resolveRoles(preset, inventory, {}, freshnessOk, testDelegationId);
    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    // All roles get the same model — prefer diversity allows this
    expect(result.assignments.every(a => a.modelId === "model-only")).toBe(true);
    // At least one role after the first should have availability-fallback source
    const fallbacks = result.assignments.filter(a => a.source === "availability-fallback");
    expect(fallbacks.length).toBeGreaterThan(0);
    // The first role should get it via preset-preference
    expect(result.assignments[0].source).toBe("preset-preference");
  });
});

// ── AC5: Cost-class filter ────────────────────────────────────────────────────

describe("US-DELTA-002 AC5 — Cost-class filter", () => {
  it("prefers models matching preferredCostClass", () => {
    // When models are not in the preference list, cost class match breaks ties.
    // All three models have the same prefIndex (MAX) since none are in preferredModelIds.
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-reasoning", true, ["reasoning"]),
      mkModel("model-low", true, ["coding"], "low"),
      mkModel("model-mid", true, ["coding"], "medium"),
      mkModel("model-high", true, ["coding"], "high"),
      mkModel("model-reviewer", true, ["review"], "high"),
    ]);
    const preset = mkPreset({
      roles: {
        designer: {
          preferredModelIds: ["model-reasoning"],
          requiredTags: ["reasoning"],
          diversity: "allow",
        },
        builder: {
          preferredModelIds: [],
          requiredTags: ["coding"],
          preferredCostClass: "medium",
          diversity: "allow",
        },
        evaluator: {
          preferredModelIds: ["model-reviewer"],
          requiredTags: ["review"],
          diversity: "allow",
        },
      },
    });

    const result = resolveRoles(preset, inventory, {}, freshnessOk, testDelegationId);
    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    const builder = result.assignments.find(a => a.role === "builder");
    // model-mid matches preferredCostClass "medium" → beats low and high
    expect(builder!.modelId).toBe("model-mid");
  });

  it("falls back to any cost class when preferred is unavailable", () => {
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-reasoning", true, ["reasoning"]),
      mkModel("model-cheap", true, ["coding"], "low"),
      mkModel("model-pricey", true, ["coding"], "high"),
      mkModel("model-reviewer", true, ["review"], "high"),
    ]);
    const preset = mkPreset({
      roles: {
        designer: {
          preferredModelIds: ["model-reasoning"],
          requiredTags: ["reasoning"],
          diversity: "allow",
        },
        builder: {
          preferredModelIds: ["model-cheap", "model-pricey"],
          requiredTags: ["coding"],
          preferredCostClass: "medium", // no medium models available
          diversity: "allow",
        },
        evaluator: {
          preferredModelIds: ["model-reviewer"],
          requiredTags: ["review"],
          diversity: "allow",
        },
      },
    });

    const result = resolveRoles(preset, inventory, {}, freshnessOk, testDelegationId);
    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    const builder = result.assignments.find(a => a.role === "builder");
    // Falls back to model-cheap (first in preference list)
    expect(builder!.modelId).toBe("model-cheap");
  });
});

// ── AC6: Tag filter ───────────────────────────────────────────────────────────

describe("US-DELTA-002 AC6 — Tag filter", () => {
  it("excludes models that do not have required tags", () => {
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-no-tag", true, []),
      mkModel("model-reasoning", true, ["reasoning"]),
      mkModel("model-gamma", true, ["coding"], "medium"),
      mkModel("model-epsilon", true, ["review"], "high"),
    ]);
    const preset = mkPreset(); // designer needs reasoning tag

    const result = resolveRoles(preset, inventory, {}, freshnessOk, testDelegationId);
    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    const designer = result.assignments.find(a => a.role === "designer");
    // model-no-tag should be excluded (no reasoning tag)
    expect(designer!.modelId).toBe("model-reasoning");
  });

  it("blocks when no model has the required tags", () => {
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-gamma", true, ["coding"], "medium"),
      mkModel("model-epsilon", true, ["review"], "high"),
    ]);
    const preset = mkPreset(); // designer needs reasoning tag, none have it

    const result = resolveRoles(preset, inventory, {}, freshnessOk, testDelegationId);
    expect(result.outcome).toBe("failure");
    if (result.outcome !== "failure") return;
    expect(result.reason).toContain("designer");
    expect(result.detail.toLowerCase()).toContain("tag");
  });
});

// ── AC7: Stable tie-break ─────────────────────────────────────────────────────

describe("US-DELTA-002 AC7 — Stable lexical tie-break", () => {
  it("uses lexical order for tie-breaking when all else is equal", () => {
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-bravo", true, ["reasoning", "general"]),
      mkModel("model-alpha", true, ["reasoning", "general"]),
      mkModel("model-charlie", true, ["reasoning", "general"]),
      mkModel("model-gamma", true, ["coding"]),
      mkModel("model-epsilon", true, ["review"]),
    ]);
    const preset = mkPreset({
      roles: {
        designer: {
          preferredModelIds: [],
          requiredTags: ["reasoning"],
          diversity: "allow",
        },
        builder: {
          preferredModelIds: ["model-gamma"],
          requiredTags: ["coding"],
          diversity: "allow",
        },
        evaluator: {
          preferredModelIds: ["model-epsilon"],
          requiredTags: ["review"],
          diversity: "allow",
        },
      },
    });

    const result = resolveRoles(preset, inventory, {}, freshnessOk, testDelegationId);
    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    const designer = result.assignments.find(a => a.role === "designer");
    // All have required tags, no preference list → lexical: model-alpha < model-bravo < model-charlie
    expect(designer!.modelId).toBe("model-alpha");
  });

  it("is deterministic across multiple invocations", () => {
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-zebra", true, ["reasoning"]),
      mkModel("model-alpha", true, ["reasoning"]),
      mkModel("model-gamma", true, ["coding"]),
      mkModel("model-epsilon", true, ["review"]),
    ]);
    const preset = mkPreset({
      roles: {
        designer: {
          preferredModelIds: [],
          requiredTags: ["reasoning"],
          diversity: "allow",
        },
        builder: {
          preferredModelIds: ["model-gamma"],
          requiredTags: ["coding"],
          diversity: "allow",
        },
        evaluator: {
          preferredModelIds: ["model-epsilon"],
          requiredTags: ["review"],
          diversity: "allow",
        },
      },
    });

    const r1 = resolveRoles(preset, inventory, {}, freshnessOk, testDelegationId);
    const r2 = resolveRoles(preset, inventory, {}, freshnessOk, testDelegationId);
    expect(r1).toEqual(r2);

    if (r1.outcome !== "success") return;
    const designer = r1.assignments.find(a => a.role === "designer");
    expect(designer!.modelId).toBe("model-alpha"); // lexical order
  });
});

// ── AC8: HostId mismatch ──────────────────────────────────────────────────────

describe("US-DELTA-002 AC8 — HostId validation", () => {
  it("fails when preset hostId differs from inventory hostId", () => {
    const preset = mkPreset({ hostId: "host-a" });
    const inventory = mkInventory("host-b", "2026-07-22T10:00:00.000Z", [
      mkModel("model-alpha", true, ["reasoning"]),
      mkModel("model-gamma", true, ["coding"], "medium"),
      mkModel("model-epsilon", true, ["review"], "high"),
    ]);

    const result = resolveRoles(preset, inventory, {}, freshnessOk, testDelegationId);
    expect(result.outcome).toBe("failure");
    if (result.outcome !== "failure") return;
    expect(result.reason.toLowerCase()).toContain("host");
    expect(result.detail).toContain("host-a");
    expect(result.detail).toContain("host-b");
  });

  it("succeeds when hostIds match", () => {
    const preset = mkPreset({ hostId: "test-host" });
    const result = resolveRoles(preset, healthyInventory, {}, freshnessOk, testDelegationId);
    expect(result.outcome).toBe("success");
  });
});

// ── AC9: Stale inventory ──────────────────────────────────────────────────────

describe("US-DELTA-002 AC9 — Stale inventory", () => {
  it("fails when inventory age exceeds maxInventoryAgeMs", () => {
    const preset = mkPreset();
    const staleParams: InventoryFreshnessParams = {
      nowMs: Date.parse("2026-07-22T11:00:00.000Z"), // 1 hour later
      maxInventoryAgeMs: 600_000, // 10 minutes — inventory is 1h old
    };

    const result = resolveRoles(preset, healthyInventory, {}, staleParams);
    expect(result.outcome).toBe("failure");
    if (result.outcome !== "failure") return;
    expect(result.reason.toLowerCase()).toContain("stale");
  });

  it("succeeds when inventory is within age limit", () => {
    const preset = mkPreset();
    const result = resolveRoles(preset, healthyInventory, {}, freshnessOk, testDelegationId);
    expect(result.outcome).toBe("success");
  });

  it("rejects inventory with invalid observedAt timestamp", () => {
    const preset = mkPreset();
    const badInventory = mkInventory("test-host", "not-a-date", [
      mkModel("model-alpha", true, ["reasoning"]),
      mkModel("model-gamma", true, ["coding"], "medium"),
      mkModel("model-epsilon", true, ["review"], "high"),
    ]);

    const result = resolveRoles(preset, badInventory, {}, freshnessOk, testDelegationId);
    expect(result.outcome).toBe("failure");
    if (result.outcome !== "failure") return;
    expect(result.reason).toContain("timestamp");
  });
});

// ── AC10: Exclusion filter ────────────────────────────────────────────────────

describe("US-DELTA-002 AC10 — Exclusion filter", () => {
  it("removes explicitly excluded models from candidates", () => {
    const preset = mkPreset({
      roles: {
        designer: {
          preferredModelIds: ["model-alpha", "model-beta"],
          requiredTags: ["reasoning"],
          diversity: "prefer",
        },
        builder: {
          preferredModelIds: ["model-gamma", "model-delta"],
          requiredTags: ["coding"],
          preferredCostClass: "medium",
          diversity: "prefer",
        },
        evaluator: {
          preferredModelIds: ["model-epsilon", "model-zeta"],
          requiredTags: ["review"],
          diversity: "require",
        },
      },
    });
    // Exclude model-alpha, so designer must pick model-beta
    const result = resolveRoles(preset, healthyInventory, {
      exclusions: { designer: ["model-alpha"] },
    }, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    const designer = result.assignments.find(a => a.role === "designer");
    expect(designer!.modelId).toBe("model-beta");
  });

  it("blocks when all candidates are excluded", () => {
    const preset = mkPreset();
    const result = resolveRoles(preset, healthyInventory, {
      exclusions: { designer: ["model-alpha", "model-beta", "model-gamma", "model-delta", "model-epsilon", "model-zeta"] },
    }, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("failure");
    if (result.outcome !== "failure") return;
    expect(result.reason).toContain("designer");
    expect(result.reason).toContain("candidate");
  });
});

// ── AC11: Hard cost cap ───────────────────────────────────────────────────────

describe("US-DELTA-002 AC11 — Hard cost cap", () => {
  it("removes candidates above the maxCostClass", () => {
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-reasoning", true, ["reasoning"], "medium"),
      mkModel("model-low", true, ["coding"], "low"),
      mkModel("model-high", true, ["coding"], "high"),
      mkModel("model-reviewer", true, ["review"], "medium"),
    ]);
    const preset = mkPreset({
      roles: {
        designer: {
          preferredModelIds: ["model-reasoning"],
          requiredTags: ["reasoning"],
          diversity: "allow",
        },
        builder: {
          preferredModelIds: ["model-low", "model-high"],
          requiredTags: ["coding"],
          preferredCostClass: "low",
          diversity: "allow",
        },
        evaluator: {
          preferredModelIds: ["model-reviewer"],
          requiredTags: ["review"],
          diversity: "allow",
        },
      },
    });

    const result = resolveRoles(preset, inventory, {
      maxCostClass: "medium",
    }, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    const builder = result.assignments.find(a => a.role === "builder");
    // model-high (cost: high) should be excluded; model-low stays
    expect(builder!.modelId).toBe("model-low");
  });

  it("blocks when all candidates exceed the cost cap", () => {
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-high", true, ["reasoning"], "high"),
      mkModel("model-gamma", true, ["coding"], "medium"),
      mkModel("model-epsilon", true, ["review"], "high"),
    ]);
    const preset = mkPreset();
    const result = resolveRoles(preset, inventory, {
      maxCostClass: "low",
    }, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("failure");
    if (result.outcome !== "failure") return;
    expect(result.reason.toLowerCase()).toContain("designer");
    expect(result.detail.toLowerCase()).toContain("cost");
  });
});

// ── AC12: Full delegation resolution ──────────────────────────────────────────

describe("US-DELTA-002 AC12 — Full delegation with all three roles", () => {
  it("resolves designer, builder, and evaluator with distinct models", () => {
    const result = resolveRoles(mkPreset(), healthyInventory, {}, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    expect(result.assignments).toHaveLength(3);

    const roles = result.assignments.map(a => a.role).sort();
    expect(roles).toEqual(["builder", "designer", "evaluator"]);

    const modelIds = result.assignments.map(a => a.modelId);
    // Designer gets model-alpha, Builder gets model-gamma or model-delta, Evaluator gets model-epsilon or model-zeta
    expect(modelIds).toContain("model-alpha"); // designer first pref
    // Evaluator requires diversity → must be different from designer and builder
    expect(new Set(modelIds).size).toBe(3);
  });

  it("roleInstanceIds are all non-empty and unique", () => {
    const result = resolveRoles(mkPreset(), healthyInventory, {}, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    const ids = result.assignments.map(a => a.roleInstanceId);
    expect(ids.every(id => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(3);
  });

  it("all assignments reference the correct hostId", () => {
    const result = resolveRoles(mkPreset(), healthyInventory, {}, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    expect(result.assignments.every(a => a.hostId === "test-host")).toBe(true);
  });

  it("each assignment has reasons", () => {
    const result = resolveRoles(mkPreset(), healthyInventory, {}, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    for (const a of result.assignments) {
      expect(a.reasons.length).toBeGreaterThan(0);
    }
  });
});

// ── AC13: Peer resolution ─────────────────────────────────────────────────────

describe("US-DELTA-002 AC13 — Peer resolution", () => {
  it("resolves peer role when peer preference is defined", () => {
    const preset = mkPreset({
      peer: {
        preferredModelIds: ["model-zeta"],
        requiredTags: ["review"],
        preferredCostClass: "medium",
        diversity: "prefer",
      },
    });

    const result = resolveRoles(preset, healthyInventory, {}, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    const peer = result.assignments.find(a => a.role === "peer");
    expect(peer).toBeDefined();
    expect(peer!.modelId).toBe("model-zeta");
    expect(peer!.source).toBe("preset-preference");
  });

  it("omits peer when peer preference is undefined", () => {
    const preset = mkPreset({ peer: undefined });
    const result = resolveRoles(preset, healthyInventory, {}, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    expect(result.assignments.some(a => a.role === "peer")).toBe(false);
  });
});

// ── AC14: Combined constraints ────────────────────────────────────────────────

describe("US-DELTA-002 AC14 — Combined constraints", () => {
  it("applies pin, exclusion, cost cap, and diversity simultaneously", () => {
    const preset = mkPreset({
      roles: {
        designer: {
          preferredModelIds: ["model-alpha", "model-beta"],
          requiredTags: ["reasoning"],
          diversity: "require",
        },
        builder: {
          preferredModelIds: ["model-gamma"],
          requiredTags: [],
          diversity: "require",
        },
        evaluator: {
          preferredModelIds: ["model-alpha", "model-epsilon"],
          requiredTags: ["review"],
          diversity: "require",
        },
      },
    });
    // Pin builder, exclude model-alpha, require distinct
    const result = resolveRoles(preset, healthyInventory, {
      pins: { builder: "model-gamma" },
      exclusions: { designer: ["model-alpha"], evaluator: ["model-alpha"] },
      maxCostClass: "high",
    }, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;
    // Builder pinned to model-gamma
    const builder = result.assignments.find(a => a.role === "builder");
    expect(builder!.modelId).toBe("model-gamma");
    expect(builder!.source).toBe("user-pin");
    // Designer cannot use model-alpha (excluded), gets model-beta
    const designer = result.assignments.find(a => a.role === "designer");
    expect(designer!.modelId).toBe("model-beta");
    // Evaluator cannot use model-alpha (excluded), gets model-epsilon
    const evaluator = result.assignments.find(a => a.role === "evaluator");
    expect(evaluator!.modelId).toBe("model-epsilon");
  });
});

// ── AC15: Constraint diversity override ───────────────────────────────────────

describe("US-DELTA-002 AC15 — Constraint diversity override", () => {
  it("constraint-level diversity overrides per-role preset diversity", () => {
    const preset = mkPreset({
      roles: {
        designer: {
          preferredModelIds: ["model-only"],
          requiredTags: [],
          diversity: "allow", // preset allows same model
        },
        builder: {
          preferredModelIds: ["model-only"],
          requiredTags: [],
          diversity: "allow",
        },
        evaluator: {
          preferredModelIds: ["model-only"],
          requiredTags: [],
          diversity: "allow",
        },
      },
    });
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-only", true, []),
    ]);

    // Override with require diversity
    const result = resolveRoles(preset, inventory, {
      diversity: "require",
    }, freshnessOk, testDelegationId);

    expect(result.outcome).toBe("failure");
    if (result.outcome !== "failure") return;
    expect(result.reason).toContain("diversity");
  });
});

// ── AC16: Audit — no Pi hardcoding in core fixtures + production source ──────

describe("US-DELTA-002 AC16 — Core audit for Pi hardcoding", () => {
  // Patterns for real provider/model IDs that must NOT appear in production source
  const realModelPatterns = [
    "claude",
    "sonnet",
    "opus",
    "gpt-4",
    "gpt-3.5",
    "gpt-5",
    "gemini",
    "llama",
    "mistral",
    "deepseek",
    "command",
    "nova",
    "titan",
    "inflection",
    "openai",
    "anthropic",
    "google",
    "meta",
    "a-proxy",
    "o-proxy",
    "a-proxy/",
    "o-proxy/",
    "deepseek/",
  ];

  it("fixture model IDs do not contain real provider/model names", () => {
    const pattern = new RegExp(realModelPatterns.join("|"), "i");
    for (const model of healthyInventory.models) {
      expect(model.id).not.toMatch(pattern);
    }
    // Also check that the preset fixture doesn't contain real model IDs
    const preset = mkPreset();
    for (const role of Object.values(preset.roles)) {
      for (const id of role.preferredModelIds) {
        expect(id).not.toMatch(pattern);
      }
    }
  });

  it("resolution results use only opaque model IDs", () => {
    const result = resolveRoles(mkPreset(), healthyInventory, {}, freshnessOk, testDelegationId);
    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;

    const pattern = new RegExp(realModelPatterns.join("|"), "i");
    for (const a of result.assignments) {
      expect(a.modelId).not.toMatch(pattern);
    }
  });

  it("production source packages/core/src/delta-team/model-resolution.ts has no Pi concrete/provider IDs", async () => {
    // AC16 requires actual production source audit, not just fixture audit
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const prodSource = fs.readFileSync(
      path.resolve(__dirname, "../src/delta-team/model-resolution.ts"),
      "utf8",
    );

    // These patterns must NOT appear in production source at all
    const forbiddenPatterns = [
      /a-proxy[/]\w/i,       // a-proxy/provider
      /o-proxy[/]\w/i,       // o-proxy/provider
      /deepseek[/]\w/i,      // deepseek/model
      /claude[- ]?opus/i,     // claude opus
      /claude[- ]?sonnet/i,   // claude sonnet
      /gpt[- ]?[45]/i,        // gpt-4 or gpt-5
      /gemini/i,              // gemini
      /llama/i,               // llama
      /mistral/i,             // mistral
      /command[- ]?r/i,       // command-r
      /nova[- ]?/i,           // nova
      /titan[- ]?/i,          // titan
      /inflection/i,          // inflection
    ];

    for (const pattern of forbiddenPatterns) {
      // Construct a precise message
      const match = prodSource.match(pattern);
      expect(match).toBeNull();
    }
  });
});

// ── Delegation-unique roleInstanceId ──────────────────────────────────────────

describe("US-DELTA-002 — Delegation-unique roleInstanceId", () => {
  it("different delegationIds produce different roleInstanceIds", () => {
    const result1 = resolveRoles(mkPreset(), healthyInventory, {}, freshnessOk, "delta-aaa");
    const result2 = resolveRoles(mkPreset(), healthyInventory, {}, freshnessOk, "delta-bbb");

    expect(result1.outcome).toBe("success");
    expect(result2.outcome).toBe("success");
    if (result1.outcome !== "success" || result2.outcome !== "success") return;

    // Every role's instanceId must differ between the two delegations
    for (let i = 0; i < result1.assignments.length; i++) {
      expect(result1.assignments[i]!.roleInstanceId).not.toBe(
        result2.assignments[i]!.roleInstanceId,
      );
    }
  });

  it("roleInstanceIds contain the delegationId", () => {
    const result = resolveRoles(mkPreset(), healthyInventory, {}, freshnessOk, "my-delegation");
    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;

    for (const a of result.assignments) {
      expect(a.roleInstanceId).toContain("my-delegation");
    }
  });
});

// ── Ranking order regression — conflict cases ────────────────────────────────

describe("US-DELTA-002 — Ranking order: pin → preference → diversity → cost → lexical", () => {
  it("preference order beats diversity for prefer (conflict regression)", () => {
    // When two models have different preference indices, the higher-preference
    // model must win even if it is already used and the lower one is unused.
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-first", true, ["reasoning"]),
      mkModel("model-second", true, ["reasoning"]),
      mkModel("model-gamma", true, ["coding"], "medium"),
      mkModel("model-epsilon", true, ["review"], "high"),
    ]);
    const preset = mkPreset({
      roles: {
        designer: {
          preferredModelIds: ["model-first", "model-second"],
          requiredTags: ["reasoning"],
          diversity: "prefer",
        },
        builder: {
          preferredModelIds: ["model-first"],
          requiredTags: ["reasoning"],
          diversity: "prefer",
        },
        evaluator: {
          preferredModelIds: ["model-epsilon"],
          requiredTags: ["review"],
          diversity: "prefer",
        },
      },
    });

    const result = resolveRoles(preset, inventory, {}, freshnessOk, "rank-test");
    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;

    const designer = result.assignments.find(a => a.role === "designer");
    const builder = result.assignments.find(a => a.role === "builder");

    // Designer picks model-first (prefIndex 0)
    expect(designer!.modelId).toBe("model-first");

    // Builder's prefs: [model-first]. model-first is already used.
    // Builder can also use model-second (has reasoning tag) but it's not in prefs.
    // Since model-first is the only preferred model, builder picks it (used but preferred).
    // This proves preference beats diversity.
    expect(builder!.modelId).toBe("model-first");
    expect(builder!.source).toBe("availability-fallback");
  });

  it("same preference tier: unused beats used (diversity secondary)", () => {
    // When two models have the SAME preference index (both first preference),
    // the unused one should win.
    // The only way to get same prefIndex is for both to be unlisted (MAX_SAFE_INTEGER).
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-a", true, []),
      mkModel("model-b", true, []),
      mkModel("model-c", true, []),
    ]);
    const preset = mkPreset({
      roles: {
        designer: {
          preferredModelIds: ["model-a"],
          requiredTags: [],
          diversity: "prefer",
        },
        builder: {
          preferredModelIds: [],
          requiredTags: [],
          diversity: "prefer",
        },
        evaluator: {
          preferredModelIds: [],
          requiredTags: [],
          diversity: "prefer",
        },
      },
    });

    const result = resolveRoles(preset, inventory, {}, freshnessOk, "rank-test-2");
    expect(result.outcome).toBe("success");
    if (result.outcome !== "success") return;

    const designer = result.assignments.find(a => a.role === "designer");
    const builder = result.assignments.find(a => a.role === "builder");
    const evaluator = result.assignments.find(a => a.role === "evaluator");

    // Designer gets model-a (only pref)
    expect(designer!.modelId).toBe("model-a");
    // Builder and evaluator have no preferences. All have same prefIndex=MAX.
    // With diversity:prefer, builder picks model-b (unused, lexical first of unused)
    // evaluator picks model-c (unused). model-a is used, gets diversity penalty.
    expect(builder!.modelId).not.toBe("model-a");
    expect(evaluator!.modelId).not.toBe("model-a");
  });

  it("require diversity is a hard block, not just ranking", () => {
    // With require diversity, no amount of preference can override the hard block.
    const inventory = mkInventory("test-host", "2026-07-22T10:00:00.000Z", [
      mkModel("model-only", true, []),
    ]);
    const preset = mkPreset({
      roles: {
        designer: {
          preferredModelIds: ["model-only"],
          requiredTags: [],
          diversity: "require",
        },
        builder: {
          preferredModelIds: ["model-only"],
          requiredTags: [],
          diversity: "require",
        },
        evaluator: {
          preferredModelIds: ["model-only"],
          requiredTags: [],
          diversity: "require",
        },
      },
    });

    const result = resolveRoles(preset, inventory, {}, freshnessOk, "rank-hard");
    expect(result.outcome).toBe("failure");
    if (result.outcome !== "failure") return;
    expect(result.reason.toLowerCase()).toContain("diversity");
  });
});
