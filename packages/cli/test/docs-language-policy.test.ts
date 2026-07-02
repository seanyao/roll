import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "../../..");

const REQUIRED_DOCS = [
  "README.md",
  "README_CN.md",
  "guide/en/configuration.md",
  "guide/zh/configuration.md",
  "guide/en/conventions.md",
  "guide/zh/conventions.md",
  "guide/en/faq.md",
  "guide/zh/faq.md",
] as const;

const RETIRED_LANGUAGE_RULES = [
  /English and Chinese lines/i,
  /English and Chinese on separate lines/i,
  /English line and Chinese line/i,
  /add English and Chinese/i,
  /bilingual error/i,
  /bilingual notice/i,
  /bilingual output/i,
  /bilingual parity/i,
  /self-contained, bilingual/i,
  /中英双行/,
  /双语提示/,
  /双语输出/,
  /双语对等/,
  /每页自包含、双语/,
] as const;

function read(rel: string): string {
  return readFileSync(join(REPO, rel), "utf8");
}

function markdownFiles(rootRel: string): string[] {
  const root = join(REPO, rootRel);
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const name of readdirSync(root)) {
    const abs = join(root, name);
    const rel = `${rootRel}/${name}`;
    const stat = statSync(abs);
    if (stat.isDirectory()) found.push(...markdownFiles(rel));
    else if (name.endsWith(".md")) found.push(rel);
  }
  return found;
}

function activePolicyDocs(): string[] {
  return [
    "README.md",
    "README_CN.md",
    "AGENTS.md",
    ...markdownFiles("guide/en"),
    ...markdownFiles("guide/zh"),
    ...markdownFiles("conventions"),
    ...markdownFiles("template"),
  ];
}

describe("US-LANG-005 documentation language policy", () => {
  it("documents the language controls and their evidence surfaces in both locales", () => {
    for (const rel of REQUIRED_DOCS) {
      const text = read(rel);
      expect(text, rel).toContain("ROLL_LANG");
      expect(text, rel).toContain("roll config lang");
      expect(text, rel).toContain("roll doctor language");
    }

    for (const rel of ["README.md", "guide/en/configuration.md", "guide/en/conventions.md"]) {
      const text = read(rel);
      expect(text, rel).toContain("one visible language");
      expect(text, rel).toMatch(/Agent\s+contracts/);
      expect(text, rel).toContain("packages/cli/test/cli-language-surface.test.ts");
      expect(text, rel).toContain("packages/cli/test/__snapshots__/cli-language-surface.test.ts.snap");
      expect(text, rel).toContain("packages/cli/test/doctor-language.test.ts");
    }

    for (const rel of ["README_CN.md", "guide/zh/configuration.md", "guide/zh/conventions.md"]) {
      const text = read(rel);
      expect(text, rel).toContain("一次只显示一种语言");
      expect(text, rel).toContain("Agent 契约");
      expect(text, rel).toContain("packages/cli/test/cli-language-surface.test.ts");
      expect(text, rel).toContain("packages/cli/test/__snapshots__/cli-language-surface.test.ts.snap");
      expect(text, rel).toContain("packages/cli/test/doctor-language.test.ts");
    }
  });

  it("does not preserve retired adjacent-translation guidance in active docs", () => {
    const offenders: string[] = [];
    for (const rel of activePolicyDocs()) {
      const text = read(rel);
      for (const pattern of RETIRED_LANGUAGE_RULES) {
        if (pattern.test(text)) offenders.push(`${rel}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
