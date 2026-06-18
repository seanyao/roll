/**
 * FIX-356c — Public docs and site copy no longer describe retired
 * production-patrol / owner-briefing surfaces.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");

function doc(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

const GUIDE_FILES = [
  "guide/en/overview.md",
  "guide/zh/overview.md",
  "guide/en/methodology.md",
  "guide/zh/methodology.md",
  "guide/en/skills.md",
  "guide/zh/skills.md",
  "guide/en/loop.md",
  "guide/zh/loop.md",
  "guide/en/faq.md",
  "guide/zh/faq.md",
  "guide/en/testing.md",
  "guide/zh/testing.md",
];

const RETIRED_EN = [
  /roll brief\b/,
  /\$roll-brief\b/,
  /\$roll-sentinel\b/,
  /sentinel\.yml/,
  /production patrol/i,
  /owner briefing/i,
  /Owner brief/,
];

const RETIRED_ZH = [
  /roll brief\b/,
  /\$roll-brief\b/,
  /\$roll-sentinel\b/,
  /sentinel\.yml/,
  /生产巡检/,
  /面向负责人的简报/,
  /Owner 简报/,
  /运行时巡逻/,
  /每日简报/,
  /早晨简报/,
];

const RETIRED_SITE = [
  /roll-brief/,
  /roll-sentinel/,
  /\$roll-sentinel/,
  /Owner brief/,
  /Owner 简报/,
  /patrol/i,
  /生产巡检/,
  /运行时巡逻/,
];

describe("FIX-356c — retired surfaces are gone from public docs", () => {
  for (const file of GUIDE_FILES) {
    it(`${file} has no retired EN strings`, () => {
      const text = doc(file);
      for (const re of RETIRED_EN) {
        expect(text).not.toMatch(re);
      }
    });
  }

  for (const file of GUIDE_FILES) {
    it(`${file} has no retired ZH strings`, () => {
      const text = doc(file);
      for (const re of RETIRED_ZH) {
        expect(text).not.toMatch(re);
      }
    });
  }

  it("README.md has no retired strings", () => {
    const text = doc("README.md");
    for (const re of [...RETIRED_EN, ...RETIRED_ZH]) {
      expect(text).not.toMatch(re);
    }
  });

  it("README_CN.md has no retired strings", () => {
    const text = doc("README_CN.md");
    for (const re of [...RETIRED_EN, ...RETIRED_ZH]) {
      expect(text).not.toMatch(re);
    }
  });

  it("methodology.md keeps the three-loop explanation with Loop C reframed", () => {
    const en = doc("guide/en/methodology.md");
    expect(en).toMatch(/Loop C[:：]/i);
    expect(en).toMatch(/Observability/i);
    expect(en).toMatch(/Maintenance/i);

    const zh = doc("guide/zh/methodology.md");
    expect(zh).toMatch(/Loop C[:：]/);
    expect(zh).toMatch(/可观测性/);
    expect(zh).toMatch(/维护/);
  });
});

describe("FIX-356c — site roll-data.js reframes observability", () => {
  const site = doc("site/roll-data.js");

  it("preserves active loop/dream/pr model and goal mode", () => {
    expect(site).toContain("loop / pr / dream");
    expect(site).toContain("goal mode");
  });

  it("does not advertise retired sentinel/brief surfaces", () => {
    for (const re of RETIRED_SITE) {
      expect(site).not.toMatch(re);
    }
  });
});
