/**
 * US-EVID-023 — harness-owned capture binding + failure surfacing.
 * Reads the harness's own evidence.json (taken/skipped shape) + screenshots/;
 * real captures become bindable refs, declared-but-failed captures surface.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { capturedEvidenceRefs, capturedReceiptRefs, captureFailures } from "../src/runner/captured-evidence.js";

function runDir(manifest: unknown, screenshots: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "roll-evid023-"));
  if (manifest !== undefined) writeFileSync(join(dir, "evidence.json"), JSON.stringify(manifest), "utf8");
  if (screenshots.length > 0) {
    mkdirSync(join(dir, "screenshots"), { recursive: true });
    for (const f of screenshots) writeFileSync(join(dir, "screenshots", f), "img", "utf8");
  }
  return dir;
}

describe("capturedEvidenceRefs — real harness artifacts only", () => {
  it("binds a taken:true capture (by href) and skips taken:false", () => {
    const dir = runDir({
      captures: [
        { taken: true, kind: "screenshot", href: "screenshots/web.png", label: "web" },
        { taken: false, skipped: "roll-capture unavailable", kind: "screenshot", label: "hud" },
      ],
    });
    const refs = capturedEvidenceRefs(dir);
    expect(refs).toEqual([{ kind: "capture", ref: "screenshots/web.png", label: "web" }]);
  });

  it("binds actual image files physically under screenshots/", () => {
    const dir = runDir({ captures: [] }, ["web.png", "notes.txt", "hud.jpeg"]);
    const refs = capturedEvidenceRefs(dir).filter((r) => r.kind === "screenshot").map((r) => r.ref).sort();
    expect(refs).toEqual([join("screenshots", "hud.jpeg"), join("screenshots", "web.png")]); // notes.txt excluded
  });

  it("binds texts[] refs (string or object)", () => {
    const dir = runDir({ texts: ["evidence/out.txt", { textFile: "evidence/log.txt", label: "log" }] });
    const refs = capturedEvidenceRefs(dir).filter((r) => r.kind === "text").map((r) => r.ref).sort();
    expect(refs).toEqual(["evidence/log.txt", "evidence/out.txt"]);
  });

  it("no evidence.json ⇒ [] (never throws)", () => {
    expect(capturedEvidenceRefs(mkdtempSync(join(tmpdir(), "roll-evid023-empty-")))).toEqual([]);
  });

  it("corrupt evidence.json ⇒ [] (never throws)", () => {
    const dir = mkdtempSync(join(tmpdir(), "roll-evid023-bad-"));
    writeFileSync(join(dir, "evidence.json"), "{not json", "utf8");
    expect(capturedEvidenceRefs(dir)).toEqual([]);
  });

  it("an HONEST machine-skip (taken:false + skipped) is NOT bound as a captured ref", () => {
    const dir = runDir({ captures: [{ taken: false, skipped: "no visual surface", label: "x" }] });
    expect(capturedEvidenceRefs(dir)).toEqual([]);
  });
});

describe("capturedReceiptRefs — US-EVID-030 v2 CaptureSet receipts (read-only)", () => {
  it("surfaces BOTH taken physical and rendered receipts, each labelled by source", () => {
    const dir = runDir({
      capture_receipts: [
        { state: "taken", source: "roll-capture-window", captureClass: "physical", surfaceId: "http://localhost:3000/team", screenshotPath: "screenshots/team-physical.png" },
        { state: "taken", source: "playwright-rendered", captureClass: "rendered", surfaceId: "http://localhost:3000/team", screenshotPath: "screenshots/team-rendered.png" },
      ],
    });
    const refs = capturedReceiptRefs(dir);
    expect(refs).toEqual([
      { kind: "screenshot", ref: "screenshots/team-physical.png", label: "Roll Capture · physical · http://localhost:3000/team" },
      { kind: "screenshot", ref: "screenshots/team-rendered.png", label: "Playwright · rendered · http://localhost:3000/team" },
    ]);
  });

  it("excludes non-taken receipts and those without a screenshot path", () => {
    const dir = runDir({
      capture_receipts: [
        { state: "failed", source: "roll-capture-window", captureClass: "physical", surfaceId: "s", reason: "app not running" },
        { state: "taken", source: "playwright-rendered", captureClass: "rendered", surfaceId: "s" }, // no path
      ],
    });
    expect(capturedReceiptRefs(dir)).toEqual([]);
  });

  it("no evidence.json / no capture_receipts ⇒ [] (never throws)", () => {
    expect(capturedReceiptRefs(mkdtempSync(join(tmpdir(), "roll-evid030-none-")))).toEqual([]);
    expect(capturedReceiptRefs(runDir({ captures: [] }))).toEqual([]);
  });
});

describe("captureFailures — declared-but-FAILED captures surface (not honest skips)", () => {
  it("returns a capture that was ATTEMPTED and FAILED (failed:true), never an honest skip", () => {
    const dir = runDir({
      captures: [
        { taken: true, kind: "screenshot", href: "screenshots/web.png" }, // success — not a failure
        { taken: false, skipped: "no visual surface" }, // honest machine-skip — PASSES, not a failure
        { taken: false, failed: true, error: "headless timeout", kind: "screenshot", label: "web" }, // real failure
      ],
    });
    const fails = captureFailures(dir);
    expect(fails.length).toBe(1);
    expect(fails[0]?.error).toContain("headless timeout");
    expect(fails[0]?.label).toBe("web");
  });

  it("no evidence.json ⇒ [] (never throws)", () => {
    expect(captureFailures(mkdtempSync(join(tmpdir(), "roll-evid023-nof-")))).toEqual([]);
  });

  it("a pure honest-skip corpus yields no failures (skip is not fail)", () => {
    const dir = runDir({ captures: [{ taken: false, skipped: "roll-capture unavailable" }] });
    expect(captureFailures(dir)).toEqual([]);
  });

  it("a SUCCEEDED capture (taken:true) is never a failure even if a stray failed flag rides along", () => {
    // taken:true means the artifact was produced — a stray failed:true must not
    // raise a false alarm on a good capture.
    const dir = runDir({ captures: [{ taken: true, failed: true, href: "screenshots/web.png", label: "web" }] });
    expect(captureFailures(dir)).toEqual([]);
  });

  it("preserves every real failure, in manifest order", () => {
    const dir = runDir({
      captures: [
        { taken: false, failed: true, error: "roll-capture crashed", label: "hud" },
        { taken: false, skipped: "no surface" }, // honest skip between failures — dropped
        { taken: false, failed: true, error: "headless timeout", label: "web" },
      ],
    });
    expect(captureFailures(dir).map((f) => f.label)).toEqual(["hud", "web"]);
  });
});
