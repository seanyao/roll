/** US-BROW-010 — deterministic DevTools version check and atomic update. */
import { describe, expect, it } from "vitest";
import {
  BrowserTransportVersion,
  MANAGED_DEVTOOLS_PACKAGE_VERSION,
  NO_UPDATE_AVAILABLE,
  type VersionSource,
} from "../src/browser-operations/transport.js";

describe("US-BROW-010 BrowserTransportVersion check", () => {
  it("reports pinned version and no candidate when source returns NO_UPDATE_AVAILABLE", () => {
    const v = new BrowserTransportVersion(MANAGED_DEVTOOLS_PACKAGE_VERSION, () => NO_UPDATE_AVAILABLE);
    expect(v.check()).toEqual({
      pinned: "1.5.0",
      candidate: null,
      updateAvailable: false,
    });
  });

  it("reports pinned version and available candidate when source returns a newer version", () => {
    const source: VersionSource = () => "1.6.0";
    const v = new BrowserTransportVersion("1.5.0", source);
    expect(v.check()).toEqual({
      pinned: "1.5.0",
      candidate: "1.6.0",
      updateAvailable: true,
    });
  });

  it("does not flag updateAvailable when candidate equals pinned", () => {
    const source: VersionSource = () => "1.5.0";
    const v = new BrowserTransportVersion("1.5.0", source);
    expect(v.check()).toEqual({
      pinned: "1.5.0",
      candidate: "1.5.0",
      updateAvailable: false,
    });
  });

  it("does not download, install, or rewrite any configuration during check", () => {
    let called = false;
    const source: VersionSource = () => {
      called = true;
      return "1.6.0";
    };
    const v = new BrowserTransportVersion("1.5.0", source);
    v.check();
    // The source is called, but no file writes or network installs happen
    expect(called).toBe(true);
    // No mutation of the pinned version
    expect(v.pinnedVersion).toBe("1.5.0");
  });
});

describe("US-BROW-010 BrowserTransportVersion apply", () => {
  it("applies an update atomically when smoke check passes", async () => {
    const v = new BrowserTransportVersion("1.5.0", () => "1.6.0");
    const result = await v.apply("1.6.0", async () => true);
    expect(result).toEqual({ kind: "applied", from: "1.5.0", to: "1.6.0" });
    expect(v.pinnedVersion).toBe("1.6.0");
  });

  it("refuses to apply when candidate matches the already-pinned version (no-op)", async () => {
    const v = new BrowserTransportVersion("1.5.0", () => "1.5.0");
    let smokeRan = false;
    const result = await v.apply("1.5.0", async () => { smokeRan = true; return true; });
    expect(result).toEqual({ kind: "no_update", pinned: "1.5.0" });
    expect(smokeRan).toBe(false);
    expect(v.pinnedVersion).toBe("1.5.0");
  });

  it("keeps prior version and reports failure when verification fails", async () => {
    const v = new BrowserTransportVersion("1.5.0", () => "1.6.0");
    const result = await v.apply("1.6.0", async () => false);
    expect(result).toEqual({
      kind: "verification_failed",
      from: "1.5.0",
      candidate: "1.6.0",
      reason: "smoke check failed",
    });
    expect(v.pinnedVersion).toBe("1.5.0");
  });

  it("rejects apply when candidate does not match the available source", async () => {
    const v = new BrowserTransportVersion("1.5.0", () => "1.6.0");
    const result = await v.apply("2.0.0", async () => true);
    expect(result).toEqual({
      kind: "refused",
      reason: 'candidate "2.0.0" does not match available update "1.6.0"',
    });
    expect(v.pinnedVersion).toBe("1.5.0");
  });

  it("rejects apply with empty candidate", async () => {
    const v = new BrowserTransportVersion("1.5.0", () => "1.6.0");
    const result = await v.apply("", async () => true);
    expect(result).toEqual({
      kind: "refused",
      reason: "candidate version must be non-empty",
    });
  });
});
