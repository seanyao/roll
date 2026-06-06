/**
 * Frozen-expectation test: TS `roll lang`.
 *
 * `langCommand` was proven byte-equal to the bash oracle `bin/roll lang` under
 * diff-test (fabricated HOME/ROLL_HOME, separate homes per leg). Per US-PORT-009c
 * the oracle is retired: the `bin/roll lang` spawn is dropped and each case
 * freezes the TS `{status, stdout, stderr}` as an inline snapshot plus, for write
 * cases, the resulting config.yaml bytes as a literal (zero engine spawn). The
 * source=config display echoes the absolute ROLL_HOME path, scrubbed to `<HOME>`
 * so the frozen value stays portable (macOS `/var/folders` vs Linux CI `/tmp`).
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { langCommand } from "../src/commands/lang.js";
import { seedUpdateCheckCache } from "./helpers.js";

const dirs: string[] = [];

function freshHome(seedConfig?: string): string {
  const home = mkdtempSync(join(tmpdir(), "roll-lang-home-"));
  dirs.push(home);
  mkdirSync(join(home, ".roll"), { recursive: true });
  seedUpdateCheckCache(join(home, ".roll"));
  if (seedConfig !== undefined) writeFileSync(join(home, ".roll", "config.yaml"), seedConfig);
  return home;
}

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

const LANG_ENV_KEYS = ["ROLL_LANG", "LANG", "LC_ALL", "NO_COLOR", "HOME", "ROLL_HOME"];

function tsLang(args: string[], home: string, env: Record<string, string>): Run {
  const save: Record<string, string | undefined> = {};
  for (const k of LANG_ENV_KEYS) save[k] = process.env[k];
  for (const k of LANG_ENV_KEYS) delete process.env[k];
  process.env["HOME"] = home;
  process.env["ROLL_HOME"] = join(home, ".roll");
  process.env["NO_COLOR"] = "1";
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (outChunks.push(String(c)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (c: string | Uint8Array): boolean => (errChunks.push(String(c)), true);
  let status: number;
  try {
    status = langCommand(args);
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    for (const k of LANG_ENV_KEYS) {
      const v = save[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  // The source=config display echoes the absolute ROLL_HOME path → scrub to a
  // placeholder so the frozen value stays portable across machines.
  const scrub = (s: string): string => s.split(home).join("<HOME>");
  return { status, stdout: scrub(outChunks.join("")), stderr: scrub(errChunks.join("")) };
}

function cfgBytes(home: string): string | null {
  const p = join(home, ".roll", "config.yaml");
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

describe("frozen: roll lang", () => {
  it("no-arg display, source=default (no env, no config)", () => {
    const t = tsLang([], freshHome(), { LANG: "", LC_ALL: "" });
    // The default-resolved language is platform-dependent (macOS reads
    // AppleLanguages → zh here; Linux CI falls to the "en" default) → scrub the
    // language token; `source: default` is the deterministic contract here.
    const stdout = t.stdout.replace(/current: \w+/, "current: <LANG>");
    expect({ status: t.status, stdout, stderr: t.stderr }).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "current: <LANG>, source: default
      ",
      }
    `);
  });

  it("no-arg display, source=ROLL_LANG env (zh)", () => {
    expect(tsLang([], freshHome(), { ROLL_LANG: "zh" })).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "current: zh, source: ROLL_LANG env
      ",
      }
    `);
  });

  it("no-arg display, source=config (source string embeds scrubbed path)", () => {
    expect(tsLang([], freshHome("lang: zh\n"), { LANG: "", LC_ALL: "" })).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "current: zh, source: config (<HOME>/.roll/config.yaml)
      ",
      }
    `);
  });

  it("no-arg display, source=LC_ALL/LANG", () => {
    expect(tsLang([], freshHome(), { LANG: "en_US.UTF-8", LC_ALL: "" })).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "current: en, source: LC_ALL/LANG
      ",
      }
    `);
  });

  it("set zh (no env) writes config + zh confirmation", () => {
    const ht = freshHome();
    expect(tsLang(["zh"], ht, { LANG: "", LC_ALL: "" })).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "[roll] 语言已设置为 zh
      ",
      }
    `);
    expect(cfgBytes(ht)).toBe("lang: zh\n");
  });

  it("set en into a config with other keys (preserve + atomic swap)", () => {
    const ht = freshHome("primary_agent: claude\nai_kimi: ~/.kimi\n");
    expect(tsLang(["en"], ht, { LANG: "", LC_ALL: "" })).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "[roll] Language set to en
      ",
      }
    `);
    expect(cfgBytes(ht)).toBe("primary_agent: claude\nai_kimi: ~/.kimi\nlang: en\n");
  });

  it("set zh with ROLL_LANG=en env → confirmation stays EN", () => {
    const ht = freshHome();
    const t = tsLang(["zh"], ht, { ROLL_LANG: "en" });
    expect(t.stdout).toContain("Language set to zh");
    expect(t).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "[roll] Language set to zh
      ",
      }
    `);
    expect(cfgBytes(ht)).toBe("lang: zh\n");
  });

  it("set zh replaces a pre-existing lang line", () => {
    const ht = freshHome("lang: en\nprimary_agent: claude\n");
    expect(tsLang(["zh"], ht, { LANG: "", LC_ALL: "" })).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "[roll] 语言已设置为 zh
      ",
      }
    `);
    expect(cfgBytes(ht)).toMatchInlineSnapshot(`
      "primary_agent: claude
      lang: zh
      "
    `);
  });

  it("--reset strips the lang line", () => {
    const ht = freshHome("primary_agent: claude\nlang: zh\n");
    // Pin ROLL_LANG so the confirmation message language is deterministic — after
    // --reset removes the config key the message would otherwise fall to the
    // platform locale (macOS AppleLanguages vs Linux "en"). --reset still strips
    // the lang line regardless of ROLL_LANG.
    expect(tsLang(["--reset"], ht, { ROLL_LANG: "en" })).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "[roll] Language preference cleared (will follow locale)
      ",
      }
    `);
    expect(cfgBytes(ht)).toMatchInlineSnapshot(`
      "primary_agent: claude
      "
    `);
  });

  it("invalid arg → bilingual error, exit 1 (en)", () => {
    expect(tsLang(["fr"], freshHome(), { ROLL_LANG: "en" })).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] Unknown language: fr
      ",
        "stdout": "  Valid values: zh, en, --reset
      Options: zh, en, --reset
      ",
      }
    `);
  });

  it("invalid arg → bilingual error, exit 1 (zh)", () => {
    expect(tsLang(["fr"], freshHome(), { ROLL_LANG: "zh" })).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] 未知语言: fr
      ",
        "stdout": "  Valid values: zh, en, --reset
        可选值: zh, en, --reset
      ",
      }
    `);
  });
});
