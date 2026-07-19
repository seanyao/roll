import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ROLL_CAPTURE_PROTOCOL_V1, ROLL_CAPTURE_PROTOCOL_V2 } from "@roll/spec";
import {
  captureCapabilitiesPath,
  refreshCaptureCapabilities,
  resolveAdapterCapabilities,
  writeCaptureCapabilities,
} from "../src/attest/capture-capabilities.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function root(): string {
  const d = mkdtempSync(join(tmpdir(), "roll-caps-"));
  dirs.push(d);
  return d;
}

describe("US-PHYSICAL-012 resolveAdapterCapabilities (honest probe)", () => {
  it("advertises rendered v2 served + physical v1 when the renderer is present", () => {
    const adv = resolveAdapterCapabilities({
      rendererServed: true,
      physical: { protocol: ROLL_CAPTURE_PROTOCOL_V1, served: true, reason: "v1-only" },
      hostVersion: "roll-adapter",
    });
    expect(adv.sources?.["playwright-rendered"]).toEqual({ protocol: ROLL_CAPTURE_PROTOCOL_V2, served: true });
    expect(adv.sources?.["roll-capture-window"]).toEqual({ protocol: ROLL_CAPTURE_PROTOCOL_V1, served: true, reason: "v1-only" });
    expect(adv.protocols).toEqual([ROLL_CAPTURE_PROTOCOL_V1, ROLL_CAPTURE_PROTOCOL_V2]);
  });

  it("does NOT advertise rendered v2 as served when the renderer is absent", () => {
    const adv = resolveAdapterCapabilities({ rendererServed: false, rendererReason: "Chromium missing", hostVersion: "roll-adapter" });
    expect(adv.sources?.["playwright-rendered"]).toEqual({ protocol: ROLL_CAPTURE_PROTOCOL_V2, served: false, reason: "Chromium missing" });
    // v2 is NOT in the served-protocol union.
    expect(adv.protocols).not.toContain(ROLL_CAPTURE_PROTOCOL_V2);
  });

  it("omits the physical source entirely when no host is detected", () => {
    const adv = resolveAdapterCapabilities({ rendererServed: true, physical: null, hostVersion: "roll-adapter" });
    expect(adv.sources?.["roll-capture-window"]).toBeUndefined();
  });
});

describe("US-PHYSICAL-012 writeCaptureCapabilities (atomic + idempotent)", () => {
  it("writes capabilities.json and is byte-stable for identical content", () => {
    const r = root();
    const adv = resolveAdapterCapabilities({ rendererServed: true, hostVersion: "roll-adapter" });
    const p1 = writeCaptureCapabilities(r, adv);
    const first = readFileSync(p1, "utf8");
    const p2 = writeCaptureCapabilities(r, adv);
    expect(p2).toBe(p1);
    expect(readFileSync(p2, "utf8")).toBe(first);
    expect(p1).toBe(captureCapabilitiesPath(r));
    expect(JSON.parse(first).sources["playwright-rendered"].served).toBe(true);
  });

  it("refreshCaptureCapabilities probes → resolves → writes in one step", () => {
    const r = root();
    const { advertisement, path } = refreshCaptureCapabilities(r, { rendererServed: false, rendererReason: "no chromium", hostVersion: "roll-adapter" });
    expect(advertisement.sources?.["playwright-rendered"]?.served).toBe(false);
    expect(JSON.parse(readFileSync(path, "utf8")).sources["playwright-rendered"].served).toBe(false);
  });
});
