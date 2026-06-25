/**
 * FIX-1018: pending-publish runtime marker tests.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  addPendingPublish,
  readPendingPublish,
  removePendingPublish,
} from "../src/runner/pending-publish.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ok */
    }
  }
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "roll-pending-publish-"));
  dirs.push(d);
  return d;
}

describe("pending-publish", () => {
  it("starts empty when no file exists", () => {
    const rt = tmp();
    expect(readPendingPublish(rt)).toEqual(new Set());
  });

  it("adds and removes story ids idempotently", () => {
    const rt = tmp();
    addPendingPublish(rt, "US-FOO-001");
    addPendingPublish(rt, "US-FOO-002");
    expect(readPendingPublish(rt)).toEqual(new Set(["US-FOO-001", "US-FOO-002"]));

    addPendingPublish(rt, "US-FOO-001"); // idempotent
    expect(readPendingPublish(rt)).toEqual(new Set(["US-FOO-001", "US-FOO-002"]));

    removePendingPublish(rt, "US-FOO-001");
    expect(readPendingPublish(rt)).toEqual(new Set(["US-FOO-002"]));

    removePendingPublish(rt, "US-FOO-999"); // no-op
    expect(readPendingPublish(rt)).toEqual(new Set(["US-FOO-002"]));
  });

  it("stores JSON array in .roll/loop/pending-publish.json", () => {
    const rt = tmp();
    addPendingPublish(rt, "US-BAR-001");
    const path = join(rt, "pending-publish.json");
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, "utf8")) as string[];
    expect(parsed).toContain("US-BAR-001");
  });
});
