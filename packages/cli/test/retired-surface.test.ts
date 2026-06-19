/**
 * FIX-356d — the final retired-surface regression gate. Fails if any ACTIVE
 * doc / site / help / skill-catalog surface re-advertises the retired immature
 * capabilities: `$roll-sentinel` / `roll-sentinel` (production patrol) or
 * `$roll-brief` / `roll-brief` / `roll brief` (owner digest). FIX-356a/b removed
 * the code + skill catalog; FIX-356c rewrote the docs; this gate stops any of it
 * quietly coming back.
 *
 * Scoped fixture list, NOT a global tree walk — historical archives are
 * deliberately allowed: migration guides, CHANGELOG, versioned/unlinked slide
 * decks, `.roll/briefs/`, and generic `sentinel`/`brief` English words and guard
 * markers (screenshot sentinels, PAUSE sentinel files, sentinel default values).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");

// Retired skill/command tokens that must NOT appear as active capabilities.
// Specific tokens only — the generic English words "sentinel"/"brief" are fine.
const RETIRED = [
  /\$?roll-sentinel\b/,
  /\$?roll-brief\b/,
  /\broll brief\b/,
  /\bbrief-time\b/,
  /\bloop_brief/,
];

// The active public surfaces the product advertises today. Archives + versioned
// snapshots (slides, migration-2.0, CHANGELOG) are intentionally excluded.
const ACTIVE_DOCS = [
  "README.md",
  "guide/skills.md",
  "guide/en/overview.md", "guide/zh/overview.md",
  "guide/en/methodology.md", "guide/zh/methodology.md",
  "guide/en/skills.md", "guide/zh/skills.md",
  "guide/en/loop.md", "guide/zh/loop.md",
  "guide/en/faq.md", "guide/zh/faq.md",
  "guide/en/testing.md", "guide/zh/testing.md",
  "guide/en/loop-data-layout.md", "guide/zh/loop-data-layout.md",
  "guide/en/patterns/graft-pattern.md", "guide/zh/patterns/graft-pattern.md",
  "guide/en/practices/engineering-common-sense.md", "guide/zh/practices/engineering-common-sense.md",
  "site/roll-data.js",
  "site/index.html",
  // help / front-door source — where the CLI's advertised command surface lives.
  "packages/cli/src/lib/front-door.ts",
  "packages/cli/src/lib/skills-panel.ts",
];

function firstHit(text: string): { line: number; token: string } | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    for (const re of RETIRED) {
      if (re.test(lines[i] ?? "")) return { line: i + 1, token: (lines[i] ?? "").trim().slice(0, 120) };
    }
  }
  return null;
}

describe("FIX-356d — retired sentinel/brief surface regression gate", () => {
  for (const rel of ACTIVE_DOCS) {
    it(`active surface ${rel} does not re-advertise the retired sentinel/brief capability`, () => {
      const p = join(ROOT, rel);
      if (!existsSync(p)) return; // optional file (e.g. README_CN) tolerated if absent
      const hit = firstHit(readFileSync(p, "utf8"));
      expect(hit, `${rel}:${hit?.line} re-advertises a retired surface → ${hit?.token}`).toBeNull();
    });
  }

  it("the active skill catalog (skills/) exposes neither roll-sentinel nor roll-brief", () => {
    const skillsDir = join(ROOT, "skills");
    if (!existsSync(skillsDir)) return; // submodule not checked out in this env
    const dirs = readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    expect(dirs).not.toContain("roll-sentinel");
    expect(dirs).not.toContain("roll-brief");
  });

  it("`roll brief` is absent from active CLI dispatch (retired by absence)", () => {
    // FIX-356a retired `roll brief` to the unknown-command path — index.ts must
    // not register an active `args[0] === "brief"` dispatch case.
    const index = readFileSync(join(ROOT, "packages/cli/src/commands/index.ts"), "utf8");
    expect(index).not.toMatch(/args\[0\]\s*===\s*"brief"/);
  });

  it("ALLOWS historical archives + generic guard markers (does not over-delete)", () => {
    // Generic `sentinel` guard markers are unrelated to the retired patrol skill
    // and MUST survive (screenshot/PAUSE/default sentinels).
    const score = readFileSync(join(ROOT, "packages/core/src/cost/prices.ts"), "utf8");
    expect(score).toMatch(/sentinel/i); // the sentinel default-currency marker
    // A migration guide may still narrate the retirement (history is preserved).
    const mig = join(ROOT, "guide/en/migration-2.0.md");
    if (existsSync(mig)) expect(readFileSync(mig, "utf8").length).toBeGreaterThan(0);
  });
});
