/**
 * diff-test: TS i18n output == bash `msg` output (v2 oracle).
 * Spawns real bash sourcing the frozen lib/i18n.sh + catalogs and compares
 * byte-for-byte (msg appends a trailing newline; we compare t() + "\n").
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveLang, t, type Lang } from "../src/i18n/index.js";
import { v2Catalog } from "../src/i18n/catalog.js";

const REPO = resolve(__dirname, "../../..");

/** Run bash `msg` for many (key, args) under one spawn; NUL-separated output. */
function bashMsgBatch(lang: Lang, cases: ReadonlyArray<[string, ...string[]]>): string[] {
  const calls = cases
    .map(([key, ...args]) => {
      const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
      return `msg ${q(key)} ${args.map(q).join(" ")}; printf '\\0'`;
    })
    .join("\n");
  const script = [
    `source lib/i18n.sh`,
    `for f in lib/i18n/*.sh lib/i18n/skills/*.sh; do source "$f"; done`,
    calls,
  ].join("\n");
  const out = execFileSync("bash", ["-c", script], {
    cwd: REPO,
    env: { ...process.env, ROLL_LANG: lang, HOME: process.env["HOME"] ?? "" },
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  const parts = out.split("\0");
  parts.pop(); // trailing empty after final NUL
  return parts;
}

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

describe("diff-test: t() == bash msg (frozen v2 oracle)", () => {
  for (const lang of ["en", "zh"] as const) {
    it(`matches byte-for-byte under ROLL_LANG=${lang}`, () => {
      const bashOut = bashMsgBatch(lang, SAMPLE);
      expect(bashOut).toHaveLength(SAMPLE.length);
      SAMPLE.forEach(([key, ...args], i) => {
        const ts = t(v2Catalog, lang, key, ...args) + "\n";
        expect(ts, `key=${key} lang=${lang}`).toBe(bashOut[i]);
      });
    });
  }
});

describe("diff-test: resolveLang == bash _i18n_resolve_lang", () => {
  function bashResolve(env: Record<string, string>, configLang?: string): string {
    const dir = mkdtempSync(join(tmpdir(), "roll-i18n-"));
    const cfg = join(dir, "config.yaml");
    if (configLang !== undefined) writeFileSync(cfg, `lang: ${configLang}\n`);
    return execFileSync(
      "bash",
      ["-c", `source lib/i18n.sh; ROLL_CONFIG='${cfg}' _i18n_resolve_lang`],
      {
        cwd: REPO,
        // Start from a minimal env so host LANG/LC_ALL don't leak in.
        env: { PATH: process.env["PATH"] ?? "", HOME: "/nonexistent", ...env },
        encoding: "utf8",
      },
    ).trim();
  }

  it("ROLL_LANG beats config; config beats LC_ALL; LC_ALL beats LANG", () => {
    expect(bashResolve({ ROLL_LANG: "zh", LC_ALL: "en_US" }, "en")).toBe(
      resolveLang({ rollLang: "zh", lcAll: "en_US", configLang: "en" }),
    );
    expect(bashResolve({ LC_ALL: "en_US.UTF-8" }, "zh")).toBe(
      resolveLang({ lcAll: "en_US.UTF-8", configLang: "zh" }),
    );
    expect(bashResolve({ LC_ALL: "zh_CN.UTF-8", LANG: "en_US" })).toBe(
      resolveLang({ lcAll: "zh_CN.UTF-8", lang: "en_US" }),
    );
  });

  it("non-zh first source terminates the chain as en", () => {
    expect(bashResolve({ ROLL_LANG: "fr_FR" }, "zh")).toBe(
      resolveLang({ rollLang: "fr_FR", configLang: "zh" }),
    );
  });
});
