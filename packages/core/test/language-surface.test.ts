import { describe, expect, it } from "vitest";
import {
  auditLanguageSurfaceText,
  assertSingleLanguageOutput,
  renderLocalePair,
  resolveLanguageSurfacePolicy,
} from "../src/index.js";

describe("US-LANG-002 language surface policy", () => {
  describe("resolveLanguageSurfacePolicy", () => {
    it("maps guide/en to docs_page/en", () => {
      const p = resolveLanguageSurfacePolicy("guide/en/conventions.md");
      expect(p.kind).toBe("docs_page");
      expect(p.renderLanguage).toBe("en");
    });

    it("maps guide/zh to docs_page/zh", () => {
      const p = resolveLanguageSurfacePolicy("guide/zh/conventions.md");
      expect(p.kind).toBe("docs_page");
      expect(p.renderLanguage).toBe("zh");
    });

    it("maps skills to agent_contract/en", () => {
      const p = resolveLanguageSurfacePolicy("skills/roll-design/SKILL.md");
      expect(p.kind).toBe("agent_contract");
      expect(p.renderLanguage).toBe("en");
    });

    it("maps conventions to agent_contract/en", () => {
      const p = resolveLanguageSurfacePolicy("conventions/global/AGENTS.md");
      expect(p.kind).toBe("agent_contract");
      expect(p.renderLanguage).toBe("en");
    });

    it("maps AGENTS.md to backlog_spec/zh", () => {
      const p = resolveLanguageSurfacePolicy("AGENTS.md");
      expect(p.kind).toBe("backlog_spec");
      expect(p.renderLanguage).toBe("zh");
    });

    it("honours the hint override", () => {
      const p = resolveLanguageSurfacePolicy("AGENTS.md", "cli_output");
      expect(p.kind).toBe("cli_output");
    });
  });

  describe("auditLanguageSurfaceText", () => {
    it("passes a clean Chinese docs page", () => {
      const text = "# 约定\n\nCLI 输出跟随当前语言设置。\n";
      expect(auditLanguageSurfaceText("guide/zh/conventions.md", text)).toHaveLength(0);
    });

    it("flags English prose in a Chinese docs page", () => {
      const text = "# 约定\n\nThis paragraph is English prose in a Chinese page.\n";
      const f = auditLanguageSurfaceText("guide/zh/conventions.md", text);
      expect(f.some((x) => x.line === 3 && x.message === "English prose in Chinese surface")).toBe(true);
      expect(f.some((x) => x.message === "Bilingual adjacent lines")).toBe(true);
    });

    it("allows command names in Chinese docs", () => {
      const text = "运行 `roll doctor language` 检查语言规则。\n";
      expect(auditLanguageSurfaceText("guide/zh/conventions.md", text)).toHaveLength(0);
    });

    it("allows file paths and model names in Chinese docs", () => {
      const text = "编辑 packages/cli/src/commands/doctor.ts，或在 claude 中查看。\n";
      expect(auditLanguageSurfaceText("guide/zh/conventions.md", text)).toHaveLength(0);
    });

    it("flags Chinese prose in an English agent contract", () => {
      const text = "# Skill\n\n这条规则是中文说明。\n";
      const f = auditLanguageSurfaceText("skills/roll-design/SKILL.md", text);
      expect(f.some((x) => x.message === "Chinese prose in English surface")).toBe(true);
      expect(f.some((x) => x.message === "Bilingual adjacent lines")).toBe(true);
    });

    it("allows quoted Chinese in an English contract", () => {
      const text = 'User said: "帮我看一下 roll design 为什么输出这么多"\n';
      expect(auditLanguageSurfaceText("skills/roll-design/SKILL.md", text)).toHaveLength(0);
    });

    it("flags bilingual adjacent lines", () => {
      const text = "This is an English line.\n这是一条中文行。\n";
      const f = auditLanguageSurfaceText("skills/roll-design/SKILL.md", text);
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f.some((x) => x.message === "Bilingual adjacent lines")).toBe(true);
    });

    it("ignores fenced code blocks", () => {
      const text = "# Skill\n\n```\n这里可以是中文 code sample。\n```\n\nEnglish prose.\n";
      const f = auditLanguageSurfaceText("skills/roll-design/SKILL.md", text);
      expect(f).toHaveLength(0);
    });

    it("returns empty for owner_conversation surfaces", () => {
      expect(auditLanguageSurfaceText("random.txt", "mixed 中文 and English.\n")).toHaveLength(0);
    });
  });

  describe("assertSingleLanguageOutput", () => {
    it("throws on Chinese in English output", () => {
      expect(() => assertSingleLanguageOutput("hello 世界", "en")).toThrow();
    });

    it("throws on English words in Chinese output", () => {
      expect(() => assertSingleLanguageOutput("你好 hello", "zh")).toThrow();
    });

    it("passes single-language output", () => {
      expect(() => assertSingleLanguageOutput("hello world", "en")).not.toThrow();
      expect(() => assertSingleLanguageOutput("你好世界", "zh")).not.toThrow();
    });
  });

  describe("renderLocalePair", () => {
    it("selects the requested language", () => {
      const pair = { en: "hello", zh: "你好" };
      expect(renderLocalePair(pair, "en")).toBe("hello");
      expect(renderLocalePair(pair, "zh")).toBe("你好");
    });
  });
});
