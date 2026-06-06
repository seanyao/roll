import { describe, expect, it } from "vitest";
import { v3Catalog } from "../src/i18n/catalog-v3.js";
import { t } from "../src/i18n/index.js";

describe("v3Catalog", () => {
  const keys = [
    "briefv3.full_hint",
    "briefv3.all_clear",
    "briefv3.queue_breakdown",
    "ideav3.recorded",
    "ideav3.type",
    "ideav3.section",
    "ideav3.text",
    "ideav3.kind_bug",
    "ideav3.kind_idea",
    "ideav3.usage",
    "ideav3.empty",
    "ideav3.lint_failed",
    "ideav3.lint_hint",
    "releasev3.usage",
    "releasev3.title",
    "releasev3.current",
    "releasev3.next",
    "releasev3.tag",
    "releasev3.changelog",
    "releasev3.changelog_ready",
    "releasev3.changelog_empty",
    "releasev3.flow_title",
    "releasev3.step_bump",
    "releasev3.step_commit",
    "releasev3.step_merge",
    "releasev3.step_tag",
    "releasev3.gate_note",
    "releasev3.gate_preview",
    "releasev3.no_pkg",
  ];

  it("every v3 key carries both en and zh (no mixed-language gap)", () => {
    for (const k of keys) {
      const e = v3Catalog[k];
      expect(e, k).toBeDefined();
      expect(e?.en, k).toBeTruthy();
      expect(e?.zh, k).toBeTruthy();
    }
  });

  it("idea capture labels resolve single-language with no prose bleed", () => {
    // The interpolated %s carries diagnostic category tokens (path/filename/…),
    // so assert on the prose labels, which must be fully localized.
    expect(t(v3Catalog, "en", "ideav3.recorded", "FIX-001")).toContain("FIX-001");
    expect(t(v3Catalog, "zh", "ideav3.recorded", "FIX-001")).toContain("已记录");
    expect(t(v3Catalog, "zh", "ideav3.text")).not.toMatch(/[A-Za-z]/);
    expect(t(v3Catalog, "zh", "ideav3.lint_hint")).not.toMatch(/[A-Za-z]/);
  });

  it("t() resolves a v3 key to a single language with no cross-language bleed", () => {
    const en = t(v3Catalog, "en", "briefv3.all_clear");
    const zh = t(v3Catalog, "zh", "briefv3.all_clear");
    expect(en).not.toContain("一");
    expect(zh).not.toMatch(/[A-Za-z]{4,}/); // no English words leak into the zh form
    expect(en).not.toEqual(zh);
  });

  it("queue_breakdown formats three counts", () => {
    expect(t(v3Catalog, "en", "briefv3.queue_breakdown", 2, 3, 1)).toContain("2");
    expect(t(v3Catalog, "en", "briefv3.queue_breakdown", 2, 3, 1)).toContain("3");
  });
});
