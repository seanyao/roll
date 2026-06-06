/**
 * diff-test (frozen): t() / resolveLang reproduce the v2 `msg` and
 * `_i18n_resolve_lang` oracles.
 *
 * Per the US-PORT-009a freeze paradigm (docs/difftest-freeze-paradigm.md): the
 * v2 oracle outputs were captured once — while `lib/i18n.sh` + catalogs were
 * still present and proven byte-for-byte equal — and frozen below. The test no
 * longer sources `lib/i18n.sh`; it locks the proven behavior as a regression
 * snapshot. Every sampled key is a pure catalog lookup (no volatile substrings),
 * so the frozen literals are portable across machines/CI.
 */
import { describe, expect, it } from "vitest";
import { resolveLang, t, type Lang } from "../src/i18n/index.js";
import { v2Catalog } from "../src/i18n/catalog.js";

// Deterministic sample: plain keys, %s keys, the %d keys, quote-bearing keys,
// the single-quoted entries, zh-missing keys (EN fallback path).
const SAMPLE: ReadonlyArray<[string, ...string[]]> = [
  ["status.loop_overview", "==="],
  ["status.in_sync", "G", "X", "proj", "/tmp/p"],
  ["update.current_version", "2.604.2"],
  ["update.upgrading_via_npm"],
  ["lang.usage"],
  ["loop.usage"],
  ["agent.unknown_agent_1", "ghost"],
  ["prices_show.header"],
  ["backlog.no_backlog_found"],
  ["doctor.all_checks_passed"],
  ["slides_delete.prompt", "deck-a"],
  ["setup.unknown_argument_1"],
  ["no.such.key.fallback", "x"],
];

// Frozen v2 `msg` outputs, captured at conversion time (== bash byte-for-byte).
const FROZEN: Record<Lang, readonly string[]> = {
  en: [
    "===Loop Overview:",
    "  G=X proj: /tmp/p (in sync /",
    "Current version: roll v2.604.2",
    "Upgrading via npm...",
    "lang.usage",
    "loop.usage",
    "agent.unknown_agent_1",
    "prices_show.header",
    "backlog.no_backlog_found",
    "doctor.all_checks_passed",
    'Delete deck "deck-a"? (y/N)',
    "Unknown argument: ",
    "no.such.key.fallback",
  ],
  zh: [
    "所有项目 loop 状态===",
    "已同步)",
    "当前版本: roll v2.604.2",
    "正在通过 npm 升级...",
    "lang.usage",
    "loop.usage",
    "agent.unknown_agent_1",
    "prices_show.header",
    "backlog.no_backlog_found",
    "doctor.all_checks_passed",
    '删除幻灯片 "deck-a"？(y/N)',
    "未知参数: ",
    "no.such.key.fallback",
  ],
};

describe("diff-test: t() == frozen v2 msg oracle", () => {
  for (const lang of ["en", "zh"] as const) {
    it(`matches the frozen oracle under ROLL_LANG=${lang}`, () => {
      expect(FROZEN[lang]).toHaveLength(SAMPLE.length);
      SAMPLE.forEach(([key, ...args], i) => {
        expect(t(v2Catalog, lang, key, ...args), `key=${key} lang=${lang}`).toBe(FROZEN[lang][i]);
      });
    });
  }
});

describe("diff-test: resolveLang == frozen v2 _i18n_resolve_lang", () => {
  it("ROLL_LANG beats config; config beats LC_ALL; LC_ALL beats LANG", () => {
    expect(resolveLang({ rollLang: "zh", lcAll: "en_US", configLang: "en" })).toBe("zh");
    expect(resolveLang({ lcAll: "en_US.UTF-8", configLang: "zh" })).toBe("zh");
    expect(resolveLang({ lcAll: "zh_CN.UTF-8", lang: "en_US" })).toBe("zh");
  });

  it("non-zh first source terminates the chain as en", () => {
    expect(resolveLang({ rollLang: "fr_FR", configLang: "zh" })).toBe("en");
  });
});
