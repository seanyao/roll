/**
 * US-EVID-023 — harness-owned capture binding + failure surfacing.
 * Reads the harness's own evidence.json (taken/skipped shape) + screenshots/;
 * real captures become bindable refs, declared-but-failed captures surface.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { capturedEvidenceRefs } from "../src/runner/captured-evidence.js";

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
