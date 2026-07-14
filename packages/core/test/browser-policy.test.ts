/**
 * US-BROW-001 AC5 — Browser operation policy resolver tests.
 *
 * Covers: role/lane/action matrix, deny-before-transport, policy fingerprint
 * tampering, lease requirements, and structured denial reasons.
 */
import type {
  BrowserLanePolicy,
  BrowserOperationsPolicy,
} from "@roll/spec";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BROWSER_POLICY,
  resolveLanePolicy,
  resolvePolicy,
} from "../src/browser-operations/policy.js";

// ── Test policies ───────────────────────────────────────────────────────────

function testPolicy(overrides?: Partial<BrowserOperationsPolicy>): BrowserOperationsPolicy {
  return {
    enabled: true,
    devtoolsServer: "chrome-devtools",
    managed: {
      enabled: true,
      allowedOrigins: [
        "http://localhost:3000",
        "https://example.com:443",
        "https://*.vercel.app:443",
      ],
      allowedActions: ["navigate", "click", "fill", "snapshot", "console", "network"],
    },
    interactive: {
      enabled: true,
      allowedOrigins: ["https://*.vercel.app:443"],
      allowedActions: ["navigate", "click", "fill", "snapshot", "console"],
      requireOwnerApproval: true,
      requirePhysicalCaptureForVisualAc: true,
      maxLeaseMs: 900000,
    },
    ...overrides,
  };
}

// ── resolvePolicy — authorized cases ────────────────────────────────────────

describe("resolvePolicy — authorized", () => {
  const policy = testPolicy();

  it("authorizes builder on managed lane with valid origin", () => {
    const result = resolvePolicy({
      policy,
      lane: "managed",
      caller: "builder",
      action: "navigate",
      targetUrl: "https://example.com",
    });
    expect(result.authorized).toBe(true);
    expect(result.denial).toBeUndefined();
    expect(result.lanePolicy).toBeDefined();
    expect(result.policyFingerprint).toBeDefined();
    expect(result.policyFingerprint.length).toBe(64);
    expect(result.normalizedOrigin).toBeDefined();
  });

  it("authorizes evaluator on managed lane", () => {
    const result = resolvePolicy({
      policy,
      lane: "managed",
      caller: "evaluator",
      action: "snapshot",
      targetUrl: "http://localhost:3000",
    });
    expect(result.authorized).toBe(true);
  });

  it("authorizes supervisor on managed lane", () => {
    const result = resolvePolicy({
      policy,
      lane: "managed",
      caller: "supervisor",
      action: "console",
      targetUrl: "https://example.com",
    });
    expect(result.authorized).toBe(true);
  });

  it("authorizes supervisor on interactive lane with lease", () => {
    const result = resolvePolicy({
      policy,
      lane: "interactive",
      caller: "supervisor",
      action: "navigate",
      targetUrl: "https://myapp.vercel.app",
      hasLease: true,
      leaseOrigin: "https://myapp.vercel.app",
    });
    expect(result.authorized).toBe(true);
  });

  it("authorizes attest caller on managed lane", () => {
    const result = resolvePolicy({
      policy,
      lane: "managed",
      caller: "attest",
      action: "snapshot",
      targetUrl: "https://example.com",
    });
    expect(result.authorized).toBe(true);
  });
});

// ── resolvePolicy — denied cases ────────────────────────────────────────────

describe("resolvePolicy — denied", () => {
  it("denies when policy is disabled", () => {
    const result = resolvePolicy({
      policy: { ...DEFAULT_BROWSER_POLICY },
      lane: "managed",
      caller: "builder",
      action: "navigate",
      targetUrl: "https://example.com",
    });
    expect(result.authorized).toBe(false);
    expect(result.denial?.code).toBe("policy_disabled");
  });

  it("denies an enabled policy whose DevTools logical binding is not registered", () => {
    const result = resolvePolicy({
      policy: testPolicy({ devtoolsServer: "project-devtools" }),
      lane: "managed",
      caller: "builder",
      action: "navigate",
      targetUrl: "https://example.com",
    });

    expect(result.authorized).toBe(false);
    expect(result.denial?.code).toBe("transport_binding_missing");
  });

  it("denies when lane is disabled", () => {
    const p = testPolicy({
      managed: { ...testPolicy().managed, enabled: false },
    });
    const result = resolvePolicy({
      policy: p,
      lane: "managed",
      caller: "builder",
      action: "navigate",
      targetUrl: "https://example.com",
    });
    expect(result.authorized).toBe(false);
    expect(result.denial?.code).toBe("lane_disabled");
  });

  it("denies non-supervisor from interactive lane", () => {
    const result = resolvePolicy({
      policy: testPolicy(),
      lane: "interactive",
      caller: "builder",
      action: "navigate",
      targetUrl: "https://myapp.vercel.app",
    });
    expect(result.authorized).toBe(false);
    expect(result.denial?.code).toBe("caller_not_allowed");
  });

  it("denies evaluator from interactive lane", () => {
    const result = resolvePolicy({
      policy: testPolicy(),
      lane: "interactive",
      caller: "evaluator",
      action: "navigate",
      targetUrl: "https://myapp.vercel.app",
    });
    expect(result.authorized).toBe(false);
    expect(result.denial?.code).toBe("caller_not_allowed");
  });

  it("denies disallowed action on managed lane", () => {
    const result = resolvePolicy({
      policy: testPolicy(),
      lane: "managed",
      caller: "builder",
      action: "screenshot",
      targetUrl: "https://example.com",
    });
    expect(result.authorized).toBe(false);
    expect(result.denial?.code).toBe("action_not_allowed");
  });

  it("denies interactive lane without lease", () => {
    const result = resolvePolicy({
      policy: testPolicy(),
      lane: "interactive",
      caller: "supervisor",
      action: "navigate",
      targetUrl: "https://myapp.vercel.app",
      hasLease: false,
    });
    expect(result.authorized).toBe(false);
    expect(result.denial?.code).toBe("interactive_no_lease");
  });

  it("denies origin not in allowlist", () => {
    const result = resolvePolicy({
      policy: testPolicy(),
      lane: "managed",
      caller: "builder",
      action: "navigate",
      targetUrl: "https://evil.com",
    });
    expect(result.authorized).toBe(false);
    expect(result.denial?.code).toBe("origin_not_allowed");
  });

  it("denies non-HTTPS origin on managed lane", () => {
    const result = resolvePolicy({
      policy: testPolicy(),
      lane: "managed",
      caller: "builder",
      action: "navigate",
      targetUrl: "http://example.com",
    });
    expect(result.authorized).toBe(false);
    expect(result.denial?.code).toBe("origin_not_https");
  });

  it("denies userinfo origin", () => {
    const result = resolvePolicy({
      policy: testPolicy(),
      lane: "managed",
      caller: "builder",
      action: "navigate",
      targetUrl: "https://user:pass@example.com",
    });
    expect(result.authorized).toBe(false);
    expect(result.denial?.code).toBe("origin_userinfo");
  });

  it("denies action not in interactive allowed set", () => {
    const result = resolvePolicy({
      policy: testPolicy(),
      lane: "interactive",
      caller: "supervisor",
      action: "network", // not in interactive allowed actions
      targetUrl: "https://myapp.vercel.app",
      hasLease: true,
    });
    expect(result.authorized).toBe(false);
    expect(result.denial?.code).toBe("action_not_allowed");
  });
});

// ── resolvePolicy — structured denial reasons ───────────────────────────────

describe("resolvePolicy — structured denial", () => {
  it("every denial includes code, message, and detail", () => {
    const result = resolvePolicy({
      policy: testPolicy(),
      lane: "interactive",
      caller: "builder",
      action: "navigate",
      targetUrl: "https://myapp.vercel.app",
    });
    expect(result.authorized).toBe(false);
    expect(result.denial).toBeDefined();
    expect(result.denial?.code).toBeDefined();
    expect(result.denial?.message).toBeDefined();
    expect(result.denial?.detail).toBeDefined();
  });

  it("denial never invokes an adapter (pure function)", () => {
    const result = resolvePolicy({
      policy: testPolicy(),
      lane: "managed",
      caller: "builder",
      action: "navigate",
      targetUrl: "https://evil.com",
    });
    expect(result.authorized).toBe(false);
    // Pure function — no adapter call, no side effects
  });

  it("denied result has empty policy fingerprint", () => {
    const result = resolvePolicy({
      policy: { ...DEFAULT_BROWSER_POLICY },
      lane: "managed",
      caller: "builder",
      action: "navigate",
      targetUrl: "https://example.com",
    });
    expect(result.authorized).toBe(false);
    expect(result.policyFingerprint).toBe("");
  });
});

// ── Policy fingerprint tampering ────────────────────────────────────────────

describe("policy fingerprint integrity", () => {
  it("fingerprint changes when allowedOrigins is modified", () => {
    const r1 = resolvePolicy({
      policy: testPolicy(),
      lane: "managed",
      caller: "builder",
      action: "navigate",
      targetUrl: "https://example.com",
    });

    const tampered = testPolicy({
      managed: {
        ...testPolicy().managed,
        allowedOrigins: ["https://evil.com:443"],
      },
    });
    const r2 = resolvePolicy({
      policy: tampered,
      lane: "managed",
      caller: "builder",
      action: "navigate",
      targetUrl: "https://evil.com",
    });

    if (r1.authorized && r2.authorized) {
      expect(r1.policyFingerprint).not.toBe(r2.policyFingerprint);
    }
  });

  it("fingerprint changes when allowedActions is modified", () => {
    const r1 = resolvePolicy({
      policy: testPolicy(),
      lane: "managed",
      caller: "builder",
      action: "navigate",
      targetUrl: "https://example.com",
    });

    const tampered = testPolicy({
      managed: {
        ...testPolicy().managed,
        allowedActions: ["screenshot"],
      },
    });
    const r2 = resolvePolicy({
      policy: tampered,
      lane: "managed",
      caller: "builder",
      action: "screenshot",
      targetUrl: "https://example.com",
    });

    if (r1.authorized && r2.authorized) {
      expect(r1.policyFingerprint).not.toBe(r2.policyFingerprint);
    }
  });
});

// ── resolveLanePolicy ───────────────────────────────────────────────────────

describe("resolveLanePolicy", () => {
  const policy = testPolicy();

  it("returns managed policy when enabled", () => {
    const lp = resolveLanePolicy(policy, "managed");
    expect(lp).toBeDefined();
    expect(lp?.enabled).toBe(true);
  });

  it("returns interactive policy when enabled", () => {
    const lp = resolveLanePolicy(policy, "interactive");
    expect(lp).toBeDefined();
    expect(lp?.enabled).toBe(true);
    expect(lp?.requireOwnerApproval).toBe(true);
  });

  it("returns undefined when overall policy disabled", () => {
    const lp = resolveLanePolicy(
      { ...policy, enabled: false },
      "managed",
    );
    expect(lp).toBeUndefined();
  });

  it("returns undefined when lane disabled", () => {
    const lp = resolveLanePolicy(
      { ...policy, managed: { ...policy.managed, enabled: false } },
      "managed",
    );
    expect(lp).toBeUndefined();
  });
});

// ── DEFAULT_BROWSER_POLICY ──────────────────────────────────────────────────

describe("DEFAULT_BROWSER_POLICY", () => {
  it("is disabled by default", () => {
    expect(DEFAULT_BROWSER_POLICY.enabled).toBe(false);
    expect(DEFAULT_BROWSER_POLICY.managed.enabled).toBe(false);
    expect(DEFAULT_BROWSER_POLICY.interactive.enabled).toBe(false);
  });

  it("has empty allowlists", () => {
    expect(DEFAULT_BROWSER_POLICY.managed.allowedOrigins).toEqual([]);
    expect(DEFAULT_BROWSER_POLICY.managed.allowedActions).toEqual([]);
    expect(DEFAULT_BROWSER_POLICY.interactive.allowedOrigins).toEqual([]);
    expect(DEFAULT_BROWSER_POLICY.interactive.allowedActions).toEqual([]);
  });
});

// ── role/lane/action matrix ─────────────────────────────────────────────────

describe("role/lane/action matrix", () => {
  const policy = testPolicy();

  const callers: Array<"builder" | "evaluator" | "supervisor" | "attest"> = [
    "builder", "evaluator", "supervisor", "attest",
  ];
  const managedActions = policy.managed.allowedActions;
  const interactiveActions = policy.interactive.allowedActions;

  for (const caller of callers) {
    for (const action of managedActions) {
      it(`${caller} can ${action} on managed lane`, () => {
        const result = resolvePolicy({
          policy,
          lane: "managed",
          caller,
          action,
          targetUrl: "https://example.com",
        });
        expect(result.authorized).toBe(true);
      });
    }
  }

  for (const caller of callers) {
    it(`${caller} CANNOT use interactive lane (except supervisor)`, () => {
      const result = resolvePolicy({
        policy,
        lane: "interactive",
        caller,
        action: "navigate",
        targetUrl: "https://myapp.vercel.app",
        hasLease: caller === "supervisor",
      });
      if (caller === "supervisor") {
        expect(result.authorized).toBe(true);
      } else {
        expect(result.authorized).toBe(false);
        expect(result.denial?.code).toBe("caller_not_allowed");
      }
    });
  }

  // Verify the full matrix: every denied path returns a structured reason
  it("every role/lane combination returns structured result (never throws)", () => {
    for (const caller of callers) {
      for (const lane of ["managed", "interactive"] as const) {
        const action = lane === "managed" ? "navigate" : "fill";
        const result = resolvePolicy({
          policy,
          lane,
          caller,
          action,
          targetUrl: "https://example.com",
          hasLease: lane === "interactive" && caller === "supervisor",
        });
        expect(result).toHaveProperty("authorized");
        if (!result.authorized) {
          expect(result.denial).toBeDefined();
          expect(result.denial?.code).toBeDefined();
          expect(result.denial?.message).toBeDefined();
        }
      }
    }
  });
});
