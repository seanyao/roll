import { describe, expect, it } from "vitest";
import { CHROME_CSS, CHROME_SCRIPT, bi } from "../src/index.js";

type LangState = "none" | "en" | "zh";

function visibleLanguages(state: LangState): { en: boolean; zh: boolean } {
  const hidesZhByDefault = CHROME_CSS.includes("html:not([data-lang]) .lang-zh { display:none; }");
  const hidesZhForEnglish = CHROME_CSS.includes('[data-lang="en"] .lang-zh { display:none; }');
  const hidesEnForChinese = CHROME_CSS.includes('[data-lang="zh"] .lang-en { display:none; }');

  if (state === "none") {
    return { en: true, zh: !hidesZhByDefault };
  }
  if (state === "en") {
    return { en: true, zh: !hidesZhForEnglish };
  }
  return { en: !hidesEnForChinese, zh: true };
}

describe("US-LANG-004 shared HTML chrome language visibility", () => {
  it("keeps every page language state mutually exclusive", () => {
    expect(visibleLanguages("none")).toEqual({ en: true, zh: false });
    expect(visibleLanguages("en")).toEqual({ en: true, zh: false });
    expect(visibleLanguages("zh")).toEqual({ en: false, zh: true });
  });

  it("persists explicit language selection without removing locale resources", () => {
    expect(CHROME_SCRIPT).toContain('set("roll-lang", l)');
    expect(CHROME_SCRIPT).toContain('d.setAttribute("data-lang", lang)');
    expect(bi("Ready", "就绪")).toBe('<span class="lang-en">Ready</span><span class="lang-zh">就绪</span>');
  });
});
