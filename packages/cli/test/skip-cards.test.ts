/**
 * FIX-363 (loop resilience) — the runtime poison-pill skip-list: a card that
 * fails K times is parked so the loop keeps delivering OTHER cards instead of
 * auto-PAUSING the whole loop. Runtime-only; never mutates backlog truth.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clearCardFailure, readSkipCards, recordCardFailure } from "../src/runner/skip-cards.js";

function rt(): string {
  return mkdtempSync(join(tmpdir(), "roll-skipcards-"));
}

describe("skip-cards — FIX-363 poison-pill isolation", () => {
  it("a fresh runtime dir skips nothing (no file → empty set, no throw)", () => {
    const dir = rt();
    expect(readSkipCards(dir).size).toBe(0);
    expect(existsSync(join(dir, "skip-cards.json"))).toBe(false);
  });

  it("records per-card failures and skip-lists the card only on crossing the threshold", () => {
    const dir = rt();
    expect(recordCardFailure(dir, "FIX-356b", 3)).toEqual({ count: 1, nowSkipped: false });
    expect(readSkipCards(dir).has("FIX-356b")).toBe(false);
    expect(recordCardFailure(dir, "FIX-356b", 3)).toEqual({ count: 2, nowSkipped: false });
    expect(recordCardFailure(dir, "FIX-356b", 3)).toEqual({ count: 3, nowSkipped: true });
    expect(readSkipCards(dir).has("FIX-356b")).toBe(true);
    // a further failure does NOT re-flag (idempotent skip), count keeps climbing
    expect(recordCardFailure(dir, "FIX-356b", 3)).toEqual({ count: 4, nowSkipped: false });
  });

  it("tracks distinct cards independently (one poison pill never skip-lists another)", () => {
    const dir = rt();
    recordCardFailure(dir, "FIX-A", 3);
    recordCardFailure(dir, "FIX-A", 3);
    recordCardFailure(dir, "FIX-A", 3); // FIX-A skip-listed
    recordCardFailure(dir, "FIX-B", 3); // FIX-B just one fail
    const skip = readSkipCards(dir);
    expect(skip.has("FIX-A")).toBe(true);
    expect(skip.has("FIX-B")).toBe(false);
  });

  it("clears a card's tally + skip entry (a recovered/re-armed card)", () => {
    const dir = rt();
    recordCardFailure(dir, "FIX-X", 2);
    recordCardFailure(dir, "FIX-X", 2); // skip-listed
    expect(readSkipCards(dir).has("FIX-X")).toBe(true);
    clearCardFailure(dir, "FIX-X");
    expect(readSkipCards(dir).has("FIX-X")).toBe(false);
    // and its tally resets — a fresh failure starts from 1 again
    expect(recordCardFailure(dir, "FIX-X", 2)).toEqual({ count: 1, nowSkipped: false });
  });

  it("an empty storyId is a no-op (never parks a blank id)", () => {
    const dir = rt();
    expect(recordCardFailure(dir, "", 3)).toEqual({ count: 0, nowSkipped: false });
    expect(readSkipCards(dir).size).toBe(0);
  });

  it("ignores env, harness, and unknown failures so only real card attempts enter card accounting", () => {
    const dir = rt();
    expect(recordCardFailure(dir, "US-CAPTURE-006", 3, "env")).toEqual({ count: 0, nowSkipped: false });
    expect(recordCardFailure(dir, "US-CAPTURE-006", 3, "harness")).toEqual({ count: 0, nowSkipped: false });
    expect(recordCardFailure(dir, "US-CAPTURE-006", 3, "unknown")).toEqual({ count: 0, nowSkipped: false });
    expect(readSkipCards(dir).size).toBe(0);

    expect(recordCardFailure(dir, "US-CAPTURE-006", 3, "card")).toEqual({ count: 1, nowSkipped: false });
  });
});
