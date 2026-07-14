/**
 * US-BROW-014 — Device emulation diagnostic profiles tests.
 *
 * Covers: unknown-profile denial, profile normalization (case-insensitive
 * matching), and profile data integrity.
 */
import { describe, expect, it } from "vitest";
import {
  DEVICE_PROFILES,
  isKnownDeviceProfile,
  resolveDeviceProfile,
} from "../src/browser-operations/device-profiles.js";

// ── Unknown-profile denial (AC1) ────────────────────────────────────────────

describe("resolveDeviceProfile", () => {
  it("rejects an unknown profile name with structured denial", () => {
    const result = resolveDeviceProfile("Nokia 3310");
    expect("code" in result).toBe(true);
    if ("code" in result) {
      expect(result.code).toBe("unknown_device_profile");
      expect(result.message).toContain("Unknown device profile");
      expect(result.message).toContain("Nokia 3310");
      expect(result.detail).toEqual({
        requested: "Nokia 3310",
        known: ["Pixel 7", "iPhone 14", "iPad Pro"],
      });
    }
  });

  it("rejects an empty string", () => {
    const result = resolveDeviceProfile("");
    expect("code" in result).toBe(true);
  });

  it("rejects whitespace-only", () => {
    const result = resolveDeviceProfile("   ");
    expect("code" in result).toBe(true);
  });

  it("rejects arbitrary DevTools emulation parameters disguised as profile names", () => {
    const result = resolveDeviceProfile('{"width":1920,"height":1080}');
    expect("code" in result).toBe(true);
  });

  // ── Profile normalization (AC2) ──────────────────────────────────────────

  it("resolves a known profile by exact name", () => {
    const result = resolveDeviceProfile("Pixel 7");
    expect("name" in result).toBe(true);
    if ("name" in result) {
      expect(result.name).toBe("Pixel 7");
      expect(result.width).toBe(412);
      expect(result.height).toBe(915);
      expect(result.deviceScaleFactor).toBe(2.625);
      expect(result.mobile).toBe(true);
    }
  });

  it("resolves case-insensitively", () => {
    const result = resolveDeviceProfile("pixel 7");
    expect("name" in result).toBe(true);
    if ("name" in result) {
      expect(result.name).toBe("Pixel 7");
    }
  });

  it("resolves with trailing whitespace", () => {
    const result = resolveDeviceProfile("  iPhone 14  ");
    expect("name" in result).toBe(true);
    if ("name" in result) {
      expect(result.name).toBe("iPhone 14");
      expect(result.width).toBe(390);
      expect(result.height).toBe(844);
      expect(result.deviceScaleFactor).toBe(3);
      expect(result.mobile).toBe(true);
    }
  });

  it("resolves all known profiles", () => {
    for (const name of ["Pixel 7", "iPhone 14", "iPad Pro"] as const) {
      const result = resolveDeviceProfile(name);
      expect("name" in result, `Profile "${name}" should resolve`).toBe(true);
    }
  });

  it("resolves iPad Pro (tablet, not mobile)", () => {
    const result = resolveDeviceProfile("iPad Pro");
    expect("name" in result).toBe(true);
    if ("name" in result) {
      expect(result.mobile).toBe(false);
      expect(result.width).toBe(1024);
      expect(result.height).toBe(1366);
    }
  });
});

// ── isKnownDeviceProfile guard ──────────────────────────────────────────────

describe("isKnownDeviceProfile", () => {
  it("returns true for known profile names", () => {
    expect(isKnownDeviceProfile("Pixel 7")).toBe(true);
    expect(isKnownDeviceProfile("iPhone 14")).toBe(true);
    expect(isKnownDeviceProfile("iPad Pro")).toBe(true);
  });

  it("returns false for unknown names", () => {
    expect(isKnownDeviceProfile("Unknown Device")).toBe(false);
    expect(isKnownDeviceProfile("")).toBe(false);
  });

  it("returns true for case-insensitive matches", () => {
    expect(isKnownDeviceProfile("pixel 7")).toBe(true);
    expect(isKnownDeviceProfile("IPHONE 14")).toBe(true);
  });
});

// ── DEVICE_PROFILES data integrity ──────────────────────────────────────────

describe("DEVICE_PROFILES allowlist integrity", () => {
  it("contains exactly three profiles", () => {
    expect(Object.keys(DEVICE_PROFILES)).toHaveLength(3);
  });

  it("every profile has a matching name property", () => {
    for (const [key, profile] of Object.entries(DEVICE_PROFILES)) {
      expect(profile.name).toBe(key);
    }
  });

  it("every profile has valid viewport dimensions", () => {
    for (const profile of Object.values(DEVICE_PROFILES)) {
      expect(profile.width).toBeGreaterThan(0);
      expect(profile.height).toBeGreaterThan(0);
      expect(profile.deviceScaleFactor).toBeGreaterThan(0);
    }
  });

  it("iPhone and Pixel are mobile; iPad Pro is not", () => {
    expect(DEVICE_PROFILES["Pixel 7"].mobile).toBe(true);
    expect(DEVICE_PROFILES["iPhone 14"].mobile).toBe(true);
    expect(DEVICE_PROFILES["iPad Pro"].mobile).toBe(false);
  });

  it("no profile has code, message, or detail properties (denial shape)", () => {
    for (const profile of Object.values(DEVICE_PROFILES)) {
      expect(profile).not.toHaveProperty("code");
      expect(profile).not.toHaveProperty("message");
      expect(profile).not.toHaveProperty("detail");
    }
  });
});
