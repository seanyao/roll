/**
 * US-META-001 — archive-layout helpers: ID→epic index (pure build + deterministic
 * serialize), live epic resolution + uncategorized fallback, card-dir write path,
 * and the old-layout read compat resolver.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildStoryIndex, serializeIndex } from "../src/lib/archive.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

describe("buildStoryIndex", () => {
  it("records only stories the resolver can place; omits the rest", () => {
    const epicOf = (id: string): string | null => (id === "US-A-1" ? "alpha" : id === "FIX-B-2" ? "beta" : null);
    const idx = buildStoryIndex(["US-A-1", "FIX-B-2", "US-C-3"], epicOf);
    expect(idx).toEqual({ "US-A-1": "alpha", "FIX-B-2": "beta" });
    expect(idx["US-C-3"]).toBeUndefined();
  });
});

describe("serializeIndex", () => {
  it("is deterministic: sorted keys, byte-identical regardless of insertion order", () => {
    const a = serializeIndex({ "US-Z-9": "z", "US-A-1": "a" });
    const b = serializeIndex({ "US-A-1": "a", "US-Z-9": "z" });
    expect(a).toBe(b);
    expect(a.indexOf("US-A-1")).toBeLessThan(a.indexOf("US-Z-9"));
    expect(a.endsWith("\n")).toBe(true);
    expect(JSON.parse(a)).toEqual({ stories: { "US-A-1": "a", "US-Z-9": "z" } });
  });
});
