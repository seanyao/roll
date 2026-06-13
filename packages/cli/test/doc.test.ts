/**
 * US-DOSSIER-037 — `roll doc [--lang en|zh] [name]`: the terminal Charter/guide
 * viewer over the SAME `collectCharter()` collector the web Charter browser uses.
 * Tests: Charter render, guide tree selection by --lang, config-lang fallback
 * (the SAME resolver `roll lang` uses), and the unknown-lang bilingual error.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { docCommand, findDoc, markdownToText, renderDocTree } from "../src/commands/doc.js";
import { collectCharter, defaultCharterDeps } from "../src/lib/page-charter.js";
import { stripAnsi } from "../src/render.js";

const dirs: string[] = [];
let cwdSpy: ReturnType<typeof vi.spyOn> | undefined;

function capture(fn: () => number): { out: string; err: string; code: number } {
  let out = "";
  let err = "";
  const so = vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array) => {
    out += String(s);
    return true;
  });
  const se = vi.spyOn(process.stderr, "write").mockImplementation((s: string | Uint8Array) => {
    err += String(s);
    return true;
  });
  const code = fn();
  so.mockRestore();
  se.mockRestore();
  return { out: stripAnsi(out), err: stripAnsi(err), code };
}

/** A project tree with a Charter doc and an en/zh guide pair. */
function project(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-doc-"));
  dirs.push(p);
  mkdirSync(join(p, "docs"), { recursive: true });
  mkdirSync(join(p, "guide", "en"), { recursive: true });
  mkdirSync(join(p, "guide", "zh"), { recursive: true });
  writeFileSync(join(p, "docs", "manifesto.md"), "# Manifesto\n\nThe founding stance.\n\n- one\n- two\n");
  writeFileSync(join(p, "guide", "INDEX.md"), "# Documentation Index\n\nThe map.\n");
  writeFileSync(join(p, "guide", "en", "loop.md"), "# Loop\n\nThe English loop guide body.\n");
  writeFileSync(join(p, "guide", "zh", "loop.md"), "# Loop\n\n中文的 loop 指南正文。\n");
  return p;
}

beforeEach(() => {
  cwdSpy = undefined;
});

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env["ROLL_LANG"];
  delete process.env["ROLL_HOME"];
  delete process.env["LC_ALL"];
  delete process.env["LANG"];
  cwdSpy?.mockRestore();
  vi.restoreAllMocks();
});

function chdir(p: string): void {
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(p);
}

describe("markdownToText — readable terminal rendering", () => {
  it("strips heading hashes, bullets to •, and inline markers", () => {
    const t = markdownToText("# Title\n\nA **bold** word and `code`.\n\n- a\n- b\n");
    expect(t).toContain("Title");
    expect(t).not.toContain("# Title");
    expect(t).toContain("bold word and code");
    expect(t).toContain("• a");
    expect(t).toContain("• b");
  });
});

describe("findDoc — lookup by id / path / basename", () => {
  it("matches by basename with or without .md", () => {
    const vm = collectCharter(defaultCharterDeps(project(), markdownToText));
    expect(findDoc(vm, "manifesto")?.path).toBe("docs/manifesto.md");
    expect(findDoc(vm, "manifesto.md")?.path).toBe("docs/manifesto.md");
    expect(findDoc(vm, "docs/manifesto.md")?.path).toBe("docs/manifesto.md");
    expect(findDoc(vm, "no-such")).toBeUndefined();
  });
});

describe("docCommand — US-DOSSIER-037", () => {
  it("AC3: lists the Charter + Guide tree (no name argument)", () => {
    chdir(project());
    const { out, code } = capture(() => docCommand(["--no-color"]) as number);
    expect(code).toBe(0);
    expect(out).toContain("docs/manifesto.md");
    expect(out).toContain("guide/INDEX.md");
    expect(out).toContain("guide/en/loop.md");
  });

  it("AC3: renders the Charter doc body as readable text", () => {
    chdir(project());
    const { out, code } = capture(() => docCommand(["manifesto", "--no-color"]) as number);
    expect(code).toBe(0);
    expect(out).toContain("Manifesto");
    expect(out).toContain("The founding stance.");
    expect(out).toContain("• one");
  });

  it("AC3: --lang selects the guide tree body (en vs zh sibling)", () => {
    chdir(project());
    const en = capture(() => docCommand(["loop", "--lang", "en", "--no-color"]) as number);
    expect(en.out).toContain("The English loop guide body.");
    expect(en.out).not.toContain("中文的 loop 指南正文");
    const zh = capture(() => docCommand(["loop", "--lang", "zh", "--no-color"]) as number);
    expect(zh.out).toContain("中文的 loop 指南正文");
    expect(zh.out).not.toContain("The English loop guide body.");
  });

  it("AC3: omitted --lang falls back to the configured language (same resolver as roll lang)", () => {
    const p = project();
    chdir(p);
    // config-lang via ROLL_HOME/config.yaml — the SAME ladder resolveCurrent reads.
    const home = mkdtempSync(join(tmpdir(), "roll-home-"));
    dirs.push(home);
    writeFileSync(join(home, "config.yaml"), "lang: zh\n");
    process.env["ROLL_HOME"] = home;
    const { out } = capture(() => docCommand(["loop", "--no-color"]) as number);
    expect(out).toContain("中文的 loop 指南正文");
  });

  it("AC3: an unknown --lang value exits non-zero with a bilingual error", () => {
    chdir(project());
    const { err, code } = capture(() => docCommand(["--lang", "fr", "--no-color"]) as number);
    expect(code).toBe(1);
    // EN line and 中 line on SEPARATE lines (never inline)
    expect(err).toContain("unknown --lang value 'fr'");
    expect(err).toContain("--lang 取值无效 'fr'");
    const enLine = err.split("\n").find((l) => l.includes("unknown --lang value"));
    expect(enLine).not.toContain("取值无效");
  });

  it("an unknown doc name exits non-zero", () => {
    chdir(project());
    const { code, err } = capture(() => docCommand(["no-such-doc", "--no-color"]) as number);
    expect(code).toBe(1);
    expect(err).toContain("no doc matches");
  });

  it("--help exits 0 and prints the usage", () => {
    const { out, code } = capture(() => docCommand(["--help"]) as number);
    expect(code).toBe(0);
    expect(out).toContain("roll doc");
  });
});
