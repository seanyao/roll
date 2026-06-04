import { describe, expect, it } from "vitest";
import {
  classifyLocale,
  formatTemplate,
  resolveLang,
  t,
  type Catalog,
} from "../src/i18n/index.js";

describe("classifyLocale", () => {
  it("classifies zh variants to zh", () => {
    expect(classifyLocale("zh")).toBe("zh");
    expect(classifyLocale("zh_CN.UTF-8")).toBe("zh");
    expect(classifyLocale("zh-Hans")).toBe("zh");
  });
  it("classifies everything else to en", () => {
    expect(classifyLocale("en_US.UTF-8")).toBe("en");
    expect(classifyLocale("fr_FR")).toBe("en");
    expect(classifyLocale("C")).toBe("en");
  });
});

describe("resolveLang precedence (mirrors _i18n_resolve_lang)", () => {
  it("ROLL_LANG wins over everything", () => {
    expect(resolveLang({ rollLang: "zh", configLang: "en", lcAll: "en" })).toBe("zh");
  });
  it("non-zh ROLL_LANG still terminates the chain as en", () => {
    expect(resolveLang({ rollLang: "fr", configLang: "zh" })).toBe("en");
  });
  it("config beats LC_ALL/LANG", () => {
    expect(resolveLang({ configLang: "zh", lcAll: "en_US", lang: "en_US" })).toBe("zh");
  });
  it("LC_ALL beats LANG; LANG beats apple; default en", () => {
    expect(resolveLang({ lcAll: "zh_CN", lang: "en_US" })).toBe("zh");
    expect(resolveLang({ lang: "zh_CN.UTF-8" })).toBe("zh");
    expect(resolveLang({ appleLang: "zh-Hans" })).toBe("zh");
    expect(resolveLang({})).toBe("en");
  });
  it("empty strings are skipped, not classified", () => {
    expect(resolveLang({ rollLang: "", configLang: "zh" })).toBe("zh");
  });
});

describe("formatTemplate (printf %s/%d/%% subset)", () => {
  it("substitutes %s in order", () => {
    expect(formatTemplate("a %s c %s", ["b", "d"])).toBe("a b c d");
  });
  it("%d truncates numbers", () => {
    expect(formatTemplate("n=%d", [3.9])).toBe("n=3");
  });
  it("missing args render empty like bash printf", () => {
    expect(formatTemplate("x %s y %s", ["only"])).toBe("x only y ");
  });
  it("%% renders a literal percent and consumes no arg", () => {
    expect(formatTemplate("100%% %s", ["done"])).toBe("100% done");
  });
});

describe("t lookup (mirrors msg fallback chain)", () => {
  const cat: Catalog = {
    greet: { en: "Hello, %s!", zh: "你好，%s！" },
    "en.only": { en: "english only %s" },
  };
  it("zh returns zh entry", () => {
    expect(t(cat, "zh", "greet", "roll")).toBe("你好，roll！");
  });
  it("zh falls back to en when zh missing — single language, no mixing", () => {
    expect(t(cat, "zh", "en.only", "x")).toBe("english only x");
  });
  it("en returns en entry", () => {
    expect(t(cat, "en", "greet", "roll")).toBe("Hello, roll!");
  });
  it("unknown key falls back to the key itself", () => {
    expect(t(cat, "en", "no.such.key")).toBe("no.such.key");
  });
});
