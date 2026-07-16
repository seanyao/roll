/**
 * US-BROW-021 — the browser-operations guides must quote the REAL CLI renderer,
 * not an invented one, and must not resurrect retired fixture-era claims.
 *
 * The evaluator on cycle 20260716-120215 caught the guides carrying "frozen"
 * transcripts that diverged from the actual `roll browser run` output and a
 * policy key (`browser.managed.lane`) that no loader has ever read. These
 * assertions lock the corrected rewrite to the renderer's verbatim strings.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GUIDES = [
  join(REPO_ROOT, "guide", "en", "browser-operations.md"),
  join(REPO_ROOT, "guide", "zh", "browser-operations.md"),
];

describe("US-BROW-021 browser guide transcripts", () => {
  for (const path of GUIDES) {
    const name = path.includes("/en/") ? "en" : "zh";
    const text = readFileSync(path, "utf8");

    it(`${name}: quotes the real renderer header, not an invented variant`, () => {
      // The real renderer prints exactly this header (browser.ts renderManagedReport).
      expect(text).toContain("Managed browser operation — real MCP");
      expect(text).not.toContain("Managed browser operation — real MCP lane");
    });

    it(`${name}: policy examples use the real browser_operations schema`, () => {
      // `browser.managed.lane` was never a key any loader read; the real opt-in
      // is the browser_operations block with managed.enabled + allowed_origins.
      expect(text).not.toContain("browser.managed.lane");
      // Nor the same retired key spelled as a YAML block (`lane: enabled/disabled`)
      // — the second evaluator round found it lingering in troubleshooting.
      expect(text).not.toMatch(/lane:\s*(enabled|disabled)/);
      expect(text).toContain("browser_operations:");
      expect(text).toContain("allowed_origins");
    });

    it(`${name}: the denied transcript matches the real fail-closed output`, () => {
      expect(text).toContain("Browser operations are disabled in project policy");
    });

    it(`${name}: keeps the diagnostic-only boundary statement`, () => {
      expect(text).toContain("Diagnostic success is not visual acceptance evidence.");
    });
  }
});
