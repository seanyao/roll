import { describe, expect, it } from "vitest";
import { v3Catalog } from "../src/i18n/catalog-v3.js";
import { t } from "../src/i18n/index.js";

describe("v3Catalog", () => {
  const keys = ["briefv3.full_hint", "briefv3.all_clear", "briefv3.queue_breakdown"];

  it("every v3 key carries both en and zh (no mixed-language gap)", () => {
    for (const k of keys) {
      const e = v3Catalog[k];
      expect(e, k).toBeDefined();
      expect(e?.en, k).toBeTruthy();
      expect(e?.zh, k).toBeTruthy();
    }
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
