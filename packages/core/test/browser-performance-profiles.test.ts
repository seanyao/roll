/**
 * US-BROW-012 — Performance diagnostic profile tests.
 *
 * Covers: opt-in policy denial, unknown-profile denial, name normalization,
 * summary bounds + redaction (data minimization), and profile integrity.
 */
import { describe, expect, it } from "vitest";
import {
  authorizePerformanceProfile,
  degradedPerformanceSummary,
  isKnownPerformanceProfile,
  PERFORMANCE_PROFILES,
  resolvePerformanceProfile,
  summarizePerformanceMetrics,
} from "../src/browser-operations/performance-profiles.js";

// ── Opt-in policy gate (AC1) ────────────────────────────────────────────────

describe("authorizePerformanceProfile", () => {
  it("denies when the lane policy has not enabled performanceDiagnostics", () => {
    const result = authorizePerformanceProfile("web-vitals-lite", {});
    expect("code" in result).toBe(true);
    if ("code" in result) {
      expect(result.code).toBe("performance_profile_denied");
    }
  });

  it("denies when performanceDiagnostics is explicitly false", () => {
    const result = authorizePerformanceProfile("web-vitals-lite", { performanceDiagnostics: false });
    expect("code" in result).toBe(true);
    if ("code" in result) {
      expect(result.code).toBe("performance_profile_denied");
    }
  });

  it("does NOT resolve the name while disabled (cannot probe the allowlist)", () => {
    // A disabled lane returns performance_profile_denied even for a bogus name —
    // it never falls through to unknown_performance_profile.
    const result = authorizePerformanceProfile("Nonexistent Profile", {});
    expect("code" in result).toBe(true);
    if ("code" in result) {
      expect(result.code).toBe("performance_profile_denied");
    }
  });

  it("resolves the profile when policy enables it and the name is known", () => {
    const result = authorizePerformanceProfile("web-vitals-lite", { performanceDiagnostics: true });
    expect("name" in result).toBe(true);
    if ("name" in result) {
      expect(result.name).toBe("web-vitals-lite");
    }
  });

  it("denies an unknown name even when policy is enabled", () => {
    const result = authorizePerformanceProfile("lighthouse-full", { performanceDiagnostics: true });
    expect("code" in result).toBe(true);
    if ("code" in result) {
      expect(result.code).toBe("unknown_performance_profile");
    }
  });
});

// ── Unknown-profile denial + normalization ──────────────────────────────────

describe("resolvePerformanceProfile", () => {
  it("rejects an unknown profile with a structured denial", () => {
    const result = resolvePerformanceProfile("crux-upload");
    expect("code" in result).toBe(true);
    if ("code" in result) {
      expect(result.code).toBe("unknown_performance_profile");
      expect(result.message).toContain("Unknown performance profile");
      expect(result.detail).toEqual({ requested: "crux-upload", known: ["web-vitals-lite"] });
    }
  });

  it("rejects empty and whitespace-only names", () => {
    expect("code" in resolvePerformanceProfile("")).toBe(true);
    expect("code" in resolvePerformanceProfile("   ")).toBe(true);
  });

  it("resolves the known profile by exact name", () => {
    const result = resolvePerformanceProfile("web-vitals-lite");
    expect("name" in result).toBe(true);
  });

  it("resolves case-insensitively and trims whitespace", () => {
    const result = resolvePerformanceProfile("  WEB-VITALS-LITE  ");
    expect("name" in result).toBe(true);
    if ("name" in result) {
      expect(result.name).toBe("web-vitals-lite");
    }
  });
});

describe("isKnownPerformanceProfile", () => {
  it("recognizes the known profile (case-insensitive) and rejects others", () => {
    expect(isKnownPerformanceProfile("web-vitals-lite")).toBe(true);
    expect(isKnownPerformanceProfile("Web-Vitals-Lite")).toBe(true);
    expect(isKnownPerformanceProfile("unknown")).toBe(false);
    expect(isKnownPerformanceProfile("")).toBe(false);
  });
});

// ── Summary bounds + redaction (AC2, AC3) ───────────────────────────────────

describe("summarizePerformanceMetrics", () => {
  const profile = PERFORMANCE_PROFILES["web-vitals-lite"];

  it("keeps only allowlisted numeric metrics and drops everything else", () => {
    const summary = summarizePerformanceMetrics(
      [
        { name: "LayoutDuration", value: 1.5 },
        { name: "NotAllowedCounter", value: 999 },
        { name: "ScriptDuration", value: 2.25 },
      ],
      profile,
    );
    const names = summary.metrics.map((m) => m.name);
    expect(names).toContain("LayoutDuration");
    expect(names).toContain("ScriptDuration");
    expect(names).not.toContain("NotAllowedCounter");
    expect(summary.degraded).toBe(false);
  });

  it("drops URL-bearing / non-numeric values (data minimization — no trace leaves)", () => {
    const summary = summarizePerformanceMetrics(
      [
        { name: "NavigationUrl", value: "https://crux.example.test/upload" },
        { name: "LayoutDuration", value: 1.0 },
      ],
      profile,
    );
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("http");
    expect(serialized).not.toContain("crux");
    // Only the allowlisted numeric metric survives.
    expect(summary.metrics).toEqual([{ name: "LayoutDuration", value: 1.0 }]);
  });

  it("drops non-finite values", () => {
    const summary = summarizePerformanceMetrics(
      [
        { name: "LayoutDuration", value: Number.POSITIVE_INFINITY },
        { name: "ScriptDuration", value: Number.NaN },
        { name: "TaskDuration", value: 3 },
      ],
      profile,
    );
    expect(summary.metrics).toEqual([{ name: "TaskDuration", value: 3 }]);
  });

  it("rounds values to a bounded precision", () => {
    const summary = summarizePerformanceMetrics([{ name: "ScriptDuration", value: 1.23456789 }], profile);
    expect(summary.metrics[0].value).toBe(1.235);
  });

  it("caps the number of entries at profile.maxEntries", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ name: `Metric${i}`, value: i }));
    // Even if all were allowlisted, the count is bounded. Use a profile whose
    // allowlist is the generated names to isolate the cap behavior.
    const wideProfile = { name: "web-vitals-lite" as const, metrics: many.map((m) => m.name), maxEntries: 5 };
    const summary = summarizePerformanceMetrics(many, wideProfile);
    expect(summary.metrics).toHaveLength(5);
  });

  it("de-duplicates repeated metric names", () => {
    const summary = summarizePerformanceMetrics(
      [
        { name: "LayoutDuration", value: 1 },
        { name: "LayoutDuration", value: 2 },
      ],
      profile,
    );
    expect(summary.metrics).toHaveLength(1);
    expect(summary.metrics[0].value).toBe(1);
  });

  it("produces an empty summary from empty input (not a crash)", () => {
    const summary = summarizePerformanceMetrics([], profile);
    expect(summary.metrics).toEqual([]);
    expect(summary.degraded).toBe(false);
  });
});

describe("degradedPerformanceSummary", () => {
  it("marks the summary degraded with no metrics", () => {
    const s = degradedPerformanceSummary("web-vitals-lite");
    expect(s.degraded).toBe(true);
    expect(s.metrics).toEqual([]);
    expect(s.profile).toBe("web-vitals-lite");
  });
});

// ── Allowlist integrity ─────────────────────────────────────────────────────

describe("PERFORMANCE_PROFILES integrity", () => {
  it("contains exactly one profile", () => {
    expect(Object.keys(PERFORMANCE_PROFILES)).toHaveLength(1);
  });

  it("every profile name matches its key and every metric name is a plain counter", () => {
    for (const [key, profile] of Object.entries(PERFORMANCE_PROFILES)) {
      expect(profile.name).toBe(key);
      expect(profile.maxEntries).toBeGreaterThan(0);
      for (const metric of profile.metrics) {
        // No metric name can carry a URL or scheme.
        expect(metric).not.toMatch(/https?:|\/\//);
      }
    }
  });
});
