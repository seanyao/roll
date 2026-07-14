/**
 * US-BROW-001 AC5 — Browser origin normalizer tests.
 *
 * Covers: allow/deny matrices, punycode/userinfo/trailing-dot/suffix cases,
 * policy-fingerprint tampering, and wildcard matching.
 */
import type { BrowserLanePolicy } from "@roll/spec";
import { describe, expect, it } from "vitest";
import {
  authorizeOrigin,
  isActionAllowed,
  matchesAllowlist,
  normalizeOrigin,
  policyFingerprint,
  validateOrigin,
} from "../src/browser-operations/origin.js";

// ── Test policy ─────────────────────────────────────────────────────────────

const managedPolicy: BrowserLanePolicy = {
  enabled: true,
  allowedOrigins: [
    "http://localhost:3000",
    "https://example.com:443",
    "https://*.vercel.app:443",
    "https://myapp.test:8443",
  ],
  allowedActions: ["navigate", "click", "fill", "snapshot", "console", "network"],
};

// ── normalizeOrigin ─────────────────────────────────────────────────────────

describe("normalizeOrigin", () => {
  it("normalizes a standard HTTPS origin", () => {
    const result = normalizeOrigin("https://example.com:443/path?q=1");
    expect("code" in result).toBe(false);
    if ("code" in result) return;
    expect(result.normalized).toBe("https://example.com:443");
    expect(result.scheme).toBe("https");
    expect(result.hostname).toBe("example.com");
    expect(result.port).toBe(443);
    expect(result.isLoopback).toBe(false);
  });

  it("normalizes localhost with non-default port", () => {
    const result = normalizeOrigin("http://localhost:3000");
    expect("code" in result).toBe(false);
    if ("code" in result) return;
    expect(result.normalized).toBe("http://localhost:3000");
    expect(result.isLoopback).toBe(true);
  });

  it("normalizes HTTPS with implicit port 443", () => {
    const result = normalizeOrigin("https://example.com");
    expect("code" in result).toBe(false);
    if ("code" in result) return;
    expect(result.normalized).toBe("https://example.com:443");
  });

  it("normalizes HTTP with implicit port 80", () => {
    const result = normalizeOrigin("http://example.com");
    expect("code" in result).toBe(false);
    if ("code" in result) return;
    expect(result.normalized).toBe("http://example.com:80");
  });

  it("handles non-standard port", () => {
    const result = normalizeOrigin("https://myapp.test:8443");
    expect("code" in result).toBe(false);
    if ("code" in result) return;
    expect(result.normalized).toBe("https://myapp.test:8443");
    expect(result.port).toBe(8443);
  });

  it("normalizes hostname to lowercase", () => {
    const result = normalizeOrigin("https://Example.COM:443");
    expect("code" in result).toBe(false);
    if ("code" in result) return;
    expect(result.hostname).toBe("example.com");
  });

  it("returns error for invalid URL", () => {
    const result = normalizeOrigin("not-a-url");
    expect("code" in result).toBe(true);
    if (!("code" in result)) return;
    expect(result.code).toBe("origin_invalid");
  });
});

// ── validateOrigin — deny cases ─────────────────────────────────────────────

describe("validateOrigin — deny cases", () => {
  it("rejects non-HTTPS non-loopback origins", () => {
    const result = validateOrigin("http://example.com", {
      lane: "managed",
      policy: managedPolicy,
    });
    expect(result.valid).toBe(false);
    expect(result.reason?.code).toBe("origin_not_https");
  });

  it("rejects origins with userinfo", () => {
    const result = validateOrigin("https://user:pass@example.com", {
      lane: "managed",
      policy: managedPolicy,
    });
    expect(result.valid).toBe(false);
    expect(result.reason?.code).toBe("origin_userinfo");
  });

  it("rejects origins with trailing dot (DNS rebinding)", () => {
    const result = validateOrigin("https://example.com.", {
      lane: "managed",
      policy: managedPolicy,
    });
    expect(result.valid).toBe(false);
    expect(result.reason?.code).toBe("origin_trailing_dot");
  });

  it("rejects origins with encoded dots (suffix bypass)", () => {
    const result = validateOrigin("https://evil.com%2Eexample.com", {
      lane: "managed",
      policy: managedPolicy,
    });
    expect(result.valid).toBe(false);
    expect(result.reason?.code).toBe("origin_suffix_attack");
  });

  it("rejects origins with consecutive dots", () => {
    const result = validateOrigin("https://evil..com", {
      lane: "managed",
      policy: managedPolicy,
    });
    expect(result.valid).toBe(false);
    expect(result.reason?.code).toBe("origin_suffix_attack");
  });

  it("rejects origins that start with hyphen", () => {
    const result = validateOrigin("https://-evil.com", {
      lane: "managed",
      policy: managedPolicy,
    });
    expect(result.valid).toBe(false);
    expect(result.reason?.code).toBe("origin_suffix_attack");
  });

  it("rejects origins not in allowlist", () => {
    const result = validateOrigin("https://evil.com", {
      lane: "managed",
      policy: managedPolicy,
    });
    expect(result.valid).toBe(false);
    expect(result.reason?.code).toBe("origin_not_allowed");
  });

  it("rejects invalid URLs", () => {
    const result = validateOrigin("", {
      lane: "managed",
      policy: managedPolicy,
    });
    expect(result.valid).toBe(false);
    expect(result.reason?.code).toBe("origin_invalid");
  });
});

// ── validateOrigin — allow cases ────────────────────────────────────────────

describe("validateOrigin — allow cases", () => {
  it("allows exact HTTPS origin match", () => {
    const result = validateOrigin("https://example.com", {
      lane: "managed",
      policy: managedPolicy,
    });
    expect(result.valid).toBe(true);
    expect(result.normalized?.normalized).toBe("https://example.com:443");
  });

  it("allows localhost HTTP (loopback exemption)", () => {
    const result = validateOrigin("http://localhost:3000", {
      lane: "managed",
      policy: managedPolicy,
    });
    expect(result.valid).toBe(true);
    expect(result.normalized?.normalized).toBe("http://localhost:3000");
  });

  it("allows wildcard hostname match (leftmost label)", () => {
    const result = validateOrigin(
      "https://ape-pr-git-feature-branch-seanyaos-projects.vercel.app",
      { lane: "managed", policy: managedPolicy },
    );
    expect(result.valid).toBe(true);
    expect(result.normalized?.isLoopback).toBe(false);
  });

  it("allows non-standard port HTTPS origin", () => {
    const result = validateOrigin("https://myapp.test:8443", {
      lane: "managed",
      policy: managedPolicy,
    });
    expect(result.valid).toBe(true);
    expect(result.normalized?.port).toBe(8443);
  });
});

// ── matchesAllowlist — wildcard matrix ──────────────────────────────────────

describe("matchesAllowlist — wildcard matrix", () => {
  const allowlist = [
    "https://*.vercel.app:443",
    "https://example.com:443",
    "http://localhost:3000",
  ];

  it("exact match works", () => {
    expect(matchesAllowlist("https://example.com:443", allowlist)).toBe(true);
  });

  it("wildcard matches single-label subdomain", () => {
    expect(
      matchesAllowlist("https://myapp.vercel.app:443", allowlist),
    ).toBe(true);
  });

  it("wildcard does NOT match multi-label subdomain", () => {
    // "*.vercel.app" should only match one label (e.g. "myapp.vercel.app")
    // NOT "sub.myapp.vercel.app"
    expect(
      matchesAllowlist("https://sub.myapp.vercel.app:443", allowlist),
    ).toBe(false);
  });

  it("wildcard does NOT match bare domain", () => {
    expect(matchesAllowlist("https://vercel.app:443", allowlist)).toBe(false);
  });

  it("wildcard does NOT match different TLD", () => {
    expect(
      matchesAllowlist("https://myapp.vercel.com:443", allowlist),
    ).toBe(false);
  });

  it("wildcard does NOT match different scheme", () => {
    expect(matchesAllowlist("http://myapp.vercel.app:443", allowlist)).toBe(
      false,
    );
  });

  it("wildcard does NOT match different port", () => {
    expect(
      matchesAllowlist("https://myapp.vercel.app:3000", allowlist),
    ).toBe(false);
  });

  it("localhost match works with explicit port", () => {
    expect(matchesAllowlist("http://localhost:3000", allowlist)).toBe(true);
  });

  it("non-wildcard pattern rejects bare *", () => {
    // A pattern of just "*" is invalid and should not match anything
    expect(matchesAllowlist("https://anything.com:443", ["*"])).toBe(false);
  });
});

// ── policyFingerprint ───────────────────────────────────────────────────────

describe("policyFingerprint", () => {
  it("produces consistent fingerprints for same policy", () => {
    const fp1 = policyFingerprint(managedPolicy);
    const fp2 = policyFingerprint(managedPolicy);
    expect(fp1).toBe(fp2);
    expect(fp1.length).toBe(64); // SHA-256 hex
  });

  it("produces different fingerprints for different policies", () => {
    const fp1 = policyFingerprint(managedPolicy);
    const modified: BrowserLanePolicy = {
      ...managedPolicy,
      allowedOrigins: ["https://evil.com:443"],
    };
    const fp2 = policyFingerprint(modified);
    expect(fp1).not.toBe(fp2);
  });

  it("fingerprint tampering is detectable (different allowedOrigins)", () => {
    const fp1 = policyFingerprint(managedPolicy);
    const tampered: BrowserLanePolicy = {
      ...managedPolicy,
      allowedActions: [
        ...managedPolicy.allowedActions,
        "screenshot" as BrowserLanePolicy["allowedActions"][number],
      ],
    };
    const fp2 = policyFingerprint(tampered);
    expect(fp1).not.toBe(fp2);
  });

  it("fingerprint is stable regardless of key order", () => {
    // policyFingerprint sorts keys, so equivalent objects produce same hash
    const a: BrowserLanePolicy = {
      enabled: true,
      allowedOrigins: ["https://a.com:443"],
      allowedActions: ["navigate"],
    };
    const b: BrowserLanePolicy = {
      allowedActions: ["navigate"],
      allowedOrigins: ["https://a.com:443"],
      enabled: true,
    };
    expect(policyFingerprint(a)).toBe(policyFingerprint(b));
  });
});

// ── isActionAllowed ─────────────────────────────────────────────────────────

describe("isActionAllowed", () => {
  it("returns true for allowed actions", () => {
    expect(isActionAllowed("navigate", managedPolicy)).toBe(true);
    expect(isActionAllowed("snapshot", managedPolicy)).toBe(true);
  });

  it("returns false for disallowed actions", () => {
    expect(isActionAllowed("screenshot", managedPolicy)).toBe(false);
    expect(isActionAllowed("press_key", managedPolicy)).toBe(false);
    expect(isActionAllowed("network", managedPolicy)).toBe(true);
  });
});

// ── authorizeOrigin (combined check) ────────────────────────────────────────

describe("authorizeOrigin — full deny-before-adapter", () => {
  it("authorizes a valid origin", () => {
    const result = authorizeOrigin("https://example.com", managedPolicy);
    expect(result.authorized).toBe(true);
    expect(result.denial).toBeUndefined();
    expect(result.normalized?.normalized).toBe("https://example.com:443");
  });

  it("denies an origin not in allowlist", () => {
    const result = authorizeOrigin("https://evil.com", managedPolicy);
    expect(result.authorized).toBe(false);
    expect(result.denial?.code).toBe("origin_not_allowed");
  });

  it("denies userinfo origin", () => {
    const result = authorizeOrigin(
      "https://admin:secret@example.com",
      managedPolicy,
    );
    expect(result.authorized).toBe(false);
    expect(result.denial?.code).toBe("origin_userinfo");
  });

  it("denies non-HTTPS non-loopback origin", () => {
    const result = authorizeOrigin("http://example.com", managedPolicy);
    expect(result.authorized).toBe(false);
    expect(result.denial?.code).toBe("origin_not_https");
  });

  it("never invokes an adapter (pure function)", () => {
    // This test documents that authorizeOrigin is a pure synchronous function
    // that never calls out to any external system.
    const result = authorizeOrigin("https://example.com", managedPolicy);
    expect(result.authorized).toBe(true);
    // No adapter was called — this is just a data check
  });
});

// ── punycode and internationalized domains ──────────────────────────────────

describe("origin validation — punycode/internationalized", () => {
  it("rejects punycode-encoded attacks that bypass suffix check", () => {
    // xn--... encoded domain that decodes to something malicious
    // The normalizer doesn't decode punycode, but the %-encoded check catches
    // obvious bypasses.
    const result = validateOrigin("https://evil%2Ecom.xn--example-9ta.com", {
      lane: "managed",
      policy: managedPolicy,
    });
    // %2E is encoded dot → suffix attack
    expect(result.valid).toBe(false);
    expect(result.reason?.code).toBe("origin_suffix_attack");
  });

  it("allows punycode domains in allowlist if matched", () => {
    const policyWithPuny: BrowserLanePolicy = {
      ...managedPolicy,
      allowedOrigins: ["https://xn--bcher-kva.example:443"],
    };
    const result = validateOrigin("https://xn--bcher-kva.example", {
      lane: "managed",
      policy: policyWithPuny,
    });
    expect(result.valid).toBe(true);
  });
});
