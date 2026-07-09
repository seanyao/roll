/**
 * US-EVID-023 attack: the failure signal must come from the PRODUCER's explicit
 * `shot.failed` flag, NOT from re-parsing the human `skipped` text. Parsing the
 * skip reason re-introduces exactly the fragility this card removes:
 *   - false POSITIVE: an honest skip whose reason merely contains a word like
 *     "failed" gets mis-flagged as a capture failure (false alarm on every such card);
 *   - false NEGATIVE: a real failure phrased without the magic keywords
 *     ("chromium crashed") is missed and silently becomes an empty shell again.
 * So captureFactFromShot must set `failed` iff `shot.failed === true`.
 */
import { describe, expect, it } from "vitest";
import { captureFactFromShot } from "../src/commands/attest.js";

describe("captureFactFromShot — failure comes from the explicit flag, not skip-text parsing", () => {
  it("an HONEST skip whose reason merely contains 'failed' is NOT a capture failure", () => {
    const fact = captureFactFromShot({
      kind: "screenshot",
      out: "screenshots/x.png",
      taken: false,
      skipped: "no visual surface; upstream feature build failed so nothing to shoot",
    });
    expect(fact.failed).toBeFalsy();
  });

  it("a real failure the producer flagged (failed:true) IS marked, even with an off-keyword reason", () => {
    const fact = captureFactFromShot({
      kind: "screenshot",
      out: "screenshots/x.png",
      taken: false,
      failed: true,
      skipped: "chromium crashed",
      error: "chromium crashed",
    });
    expect(fact.failed).toBe(true);
    expect(fact.error).toContain("chromium crashed");
  });

  it("a plain honest machine-skip (no failed flag) is never a failure", () => {
    const fact = captureFactFromShot({
      kind: "screenshot",
      out: "screenshots/x.png",
      taken: false,
      skipped: "no deliverable_url declared",
    });
    expect(fact.failed).toBeFalsy();
  });

  it("a taken:true success is never a failure", () => {
    const fact = captureFactFromShot({ kind: "screenshot", out: "screenshots/x.png", taken: true });
    expect(fact.failed).toBeFalsy();
  });
});
