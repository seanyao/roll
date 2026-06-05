/**
 * diff-test: TS `roll lang` == bash `bin/roll lang` (frozen v2 oracle), under
 * fabricated HOME/ROLL_HOME so locale + config writes are deterministic.
 * Each case runs bash and TS against SEPARATE fresh HOMEs, then compares
 * stdout/stderr/exit AND the resulting config.yaml bytes for write cases.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { langCommand } from "../src/commands/lang.js";
import { seedUpdateCheckCache } from "./helpers.js";

const REPO = resolve(__dirname, "../../..");
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

function bashLang(args: string[], home: string, env: Record<string, string>): Run {
  // A clean env: drop the test runner's own locale so only `env` controls it.
  const base: Record<string, string> = {
    PATH: process.env["PATH"] ?? "",
    HOME: home,
    ROLL_HOME: join(home, ".roll"),
    NO_COLOR: "1",
  };
  try {
    const stdout = execFileSync(join(REPO, "bin", "roll"), ["lang", ...args], {
      encoding: "utf8",
      env: { ...base, ...env },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

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
  return { status, stdout: outChunks.join(""), stderr: errChunks.join("") };
}

function cfgBytes(home: string): string | null {
  const p = join(home, ".roll", "config.yaml");
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

describe("diff-test: roll lang == bash oracle", () => {
  it("no-arg display, source=default (no env, no config)", () => {
    const hb = freshHome();
    const ht = freshHome();
    expect(tsLang([], ht, { LANG: "", LC_ALL: "" })).toEqual(bashLang([], hb, { LANG: "", LC_ALL: "" }));
  });

  it("no-arg display, source=ROLL_LANG env (zh)", () => {
    const hb = freshHome();
    const ht = freshHome();
    expect(tsLang([], ht, { ROLL_LANG: "zh" })).toEqual(bashLang([], hb, { ROLL_LANG: "zh" }));
  });

  it("no-arg display, source=config (shared home: source string embeds path)", () => {
    // Read-only path, no mutation → share one home so the printed config path
    // matches byte-for-byte between bash and TS.
    const h = freshHome("lang: zh\n");
    expect(tsLang([], h, { LANG: "", LC_ALL: "" })).toEqual(bashLang([], h, { LANG: "", LC_ALL: "" }));
  });

  it("no-arg display, source=LC_ALL/LANG", () => {
    const hb = freshHome();
    const ht = freshHome();
    expect(tsLang([], ht, { LANG: "en_US.UTF-8", LC_ALL: "" })).toEqual(
      bashLang([], hb, { LANG: "en_US.UTF-8", LC_ALL: "" }),
    );
  });

  it("set zh (no env) writes config + zh confirmation", () => {
    const hb = freshHome();
    const ht = freshHome();
    expect(tsLang(["zh"], ht, { LANG: "", LC_ALL: "" })).toEqual(
      bashLang(["zh"], hb, { LANG: "", LC_ALL: "" }),
    );
    expect(cfgBytes(ht)).toBe(cfgBytes(hb));
    expect(cfgBytes(ht)).toBe("lang: zh\n");
  });

  it("set en into a config with other keys (preserve + atomic swap)", () => {
    const seed = "primary_agent: claude\nai_kimi: ~/.kimi\n";
    const hb = freshHome(seed);
    const ht = freshHome(seed);
    expect(tsLang(["en"], ht, { LANG: "", LC_ALL: "" })).toEqual(
      bashLang(["en"], hb, { LANG: "", LC_ALL: "" }),
    );
    expect(cfgBytes(ht)).toBe(cfgBytes(hb));
    expect(cfgBytes(ht)).toBe("primary_agent: claude\nai_kimi: ~/.kimi\nlang: en\n");
  });

  it("set zh with ROLL_LANG=en env → confirmation stays EN", () => {
    const hb = freshHome();
    const ht = freshHome();
    const b = bashLang(["zh"], hb, { ROLL_LANG: "en" });
    const t = tsLang(["zh"], ht, { ROLL_LANG: "en" });
    expect(t).toEqual(b);
    expect(t.stdout).toContain("Language set to zh");
    expect(cfgBytes(ht)).toBe(cfgBytes(hb));
  });

  it("set zh replaces a pre-existing lang line", () => {
    const seed = "lang: en\nprimary_agent: claude\n";
    const hb = freshHome(seed);
    const ht = freshHome(seed);
    expect(tsLang(["zh"], ht, { LANG: "", LC_ALL: "" })).toEqual(
      bashLang(["zh"], hb, { LANG: "", LC_ALL: "" }),
    );
    expect(cfgBytes(ht)).toBe(cfgBytes(hb));
  });

  it("--reset strips the lang line", () => {
    const seed = "primary_agent: claude\nlang: zh\n";
    const hb = freshHome(seed);
    const ht = freshHome(seed);
    expect(tsLang(["--reset"], ht, { LANG: "", LC_ALL: "" })).toEqual(
      bashLang(["--reset"], hb, { LANG: "", LC_ALL: "" }),
    );
    expect(cfgBytes(ht)).toBe(cfgBytes(hb));
  });

  it("invalid arg → bilingual error, exit 1 (en)", () => {
    const hb = freshHome();
    const ht = freshHome();
    expect(tsLang(["fr"], ht, { ROLL_LANG: "en" })).toEqual(bashLang(["fr"], hb, { ROLL_LANG: "en" }));
  });

  it("invalid arg → bilingual error, exit 1 (zh)", () => {
    const hb = freshHome();
    const ht = freshHome();
    expect(tsLang(["fr"], ht, { ROLL_LANG: "zh" })).toEqual(bashLang(["fr"], hb, { ROLL_LANG: "zh" }));
  });
});
