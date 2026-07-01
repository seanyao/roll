/**
 * US-LANG-002 — `roll doctor language` integration tests.
 *
 * Uses temp project fixtures so the audit result is deterministic and does not
 * depend on the real repo's current mixed-language state.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { languageAuditCommand } from "../src/commands/doctor.js";

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore cleanup failures */
    }
  }
});

function tempRoot(): string {
  const d = mkdtempSync(join(tmpdir(), "roll-lang-audit-"));
  dirs.push(d);
  return d;
}

function write(root: string, rel: string, text: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

interface Run {
  status: number;
  stdout: string;
}

function run(root: string, lang: "en" | "zh", args: string[] = []): Run {
  const saveLang = process.env["ROLL_LANG"];
  process.env["ROLL_LANG"] = lang;
  const chunks: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  // @ts-expect-error capture-only override
  process.stdout.write = (c: string | Uint8Array): boolean => (chunks.push(String(c)), true);
  let status: number;
  try {
    status = languageAuditCommand(args, { root });
  } finally {
    process.stdout.write = realWrite;
    if (saveLang === undefined) delete process.env["ROLL_LANG"];
    else process.env["ROLL_LANG"] = saveLang;
  }
  return { status, stdout: chunks.join("") };
}

describe("US-LANG-002 roll doctor language", () => {
  it("reports no findings for a clean fixture (en)", () => {
    const root = tempRoot();
    write(root, "guide/zh/conventions.md", "# 约定\n\n运行 `roll doctor language` 检查输出。\n");
    write(root, "guide/en/conventions.md", "# Conventions\n\nRun `roll doctor language` to check output.\n");
    write(root, "skills/roll-design/SKILL.md", "# Skill\n\nFollow the contract end-to-end.\n");
    write(root, "AGENTS.md", "# 约定\n\n只输出一种语言。\n");

    const { status, stdout } = run(root, "en");
    expect(status).toBe(0);
    expect(stdout).toContain("Language policy audit");
    expect(stdout).toContain("No mixed-language output rules found");
  });

  it("reports no findings for a clean fixture (zh)", () => {
    const root = tempRoot();
    write(root, "guide/zh/conventions.md", "# 约定\n\n运行 `roll doctor language` 检查输出。\n");
    write(root, "AGENTS.md", "# 约定\n\n只输出一种语言。\n");

    const { status, stdout } = run(root, "zh");
    expect(status).toBe(0);
    expect(stdout).toContain("语言政策审计");
    expect(stdout).toContain("未发现混排输出规则");
  });

  it("reports violations in a fixture with mixed-language drift", () => {
    const root = tempRoot();
    write(
      root,
      "guide/zh/conventions.md",
      "# 约定\n\nThis English paragraph should not appear in the Chinese guide.\n",
    );
    write(root, "skills/roll-design/SKILL.md", "# Skill\n\n这条中文说明不应出现在英文 contract 中。\n");

    const { status, stdout } = run(root, "en");
    expect(status).toBe(0);
    expect(stdout).toContain("[docs_page] English prose in Chinese surface");
    expect(stdout).toContain("[agent_contract] Chinese prose in English surface");
    expect(stdout).toContain("policy finding(s)");
  });

  it("flags bilingual adjacent lines", () => {
    const root = tempRoot();
    write(
      root,
      "AGENTS.md",
      "# 约定\n\nEnglish explanatory paragraph.\n中文解释段落。\n",
    );

    const { status, stdout } = run(root, "en");
    expect(status).toBe(0);
    expect(stdout).toContain("Bilingual adjacent lines");
    expect(stdout).toContain("AGENTS.md");
  });

  it("ignores .roll generated evidence by default", () => {
    const root = tempRoot();
    write(root, ".roll/features/i18n/US-LANG-001/spec.md", "# Spec\n\n中英 mixed line.\n");

    const { stdout } = run(root, "en");
    expect(stdout).toContain("No mixed-language output rules found");
  });

  it("scans .roll generated evidence with --include-generated", () => {
    const root = tempRoot();
    write(root, ".roll/features/i18n/US-LANG-001/spec.md", "# Spec\n\nEnglish line.\n中文行。\n");

    const { stdout } = run(root, "en", ["--include-generated"]);
    expect(stdout).toContain("Bilingual adjacent lines");
    expect(stdout).toContain(".roll/features/i18n/US-LANG-001/spec.md");
  });
});
