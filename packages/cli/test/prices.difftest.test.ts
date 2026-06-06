/**
 * Frozen-expectation test: TS `roll prices` render.
 *
 * `pricesCommand` was proven byte-equal to the bash oracle `bin/roll prices`
 * under diff-test (show renders the frozen lib/prices snapshots). Per
 * US-PORT-009c the oracle is retired: the `bin/roll prices` spawn is dropped and
 * each case freezes the TS `{status, stdout, stderr}` as an inline snapshot
 * (zero engine spawn). show/help/bilingual-error are fully deterministic and
 * path-free (portable); the `refresh` route still just asserts the null fallback.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pricesCommand } from "../src/commands/prices.js";
import { seedUpdateCheckCache } from "./helpers.js";

// Isolated ROLL_HOME with a seeded update-check cache — keeps the async upgrade
// nag out of stdout (deterministic render).
const ROLL_HOME = join(mkdtempSync(join(tmpdir(), "roll-prices-home-")), ".roll");
seedUpdateCheckCache(ROLL_HOME);

function tsPrices(args: string[], env: Record<string, string> = {}): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const keys = ["NO_COLOR", "ROLL_LANG"];
  const save: Record<string, string | undefined> = {};
  for (const k of keys) save[k] = process.env[k];
  process.env["NO_COLOR"] = "1";
  process.env["ROLL_LANG"] = "en";
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (outChunks.push(String(c)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (c: string | Uint8Array): boolean => (errChunks.push(String(c)), true);
  let status: number | null;
  try {
    status = pricesCommand(args);
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    for (const k of keys) {
      const v = save[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return { status: status ?? -1, stdout: outChunks.join(""), stderr: errChunks.join("") };
}

describe("frozen: roll prices render", () => {
  it("show renders the snapshot table", () => {
    expect(tsPrices(["show"])).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "price snapshot  价格快照
        version        2026-06-02
        effective_at   2026-06-02
        snapshots      3 loaded  已加载
          anthropic     USD  https://platform.claude.com/docs/en/about-claude/pricing
          deepseek      CNY  https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
          kimi          CNY  https://platform.kimi.com/docs/pricing/chat

        model                    cur        in       out        cw        cr
        claude-haiku-4-5         USD    1.0000    5.0000    1.2500    0.1000
        claude-opus-4-6          USD    5.0000   25.0000    6.2500    0.5000
        claude-opus-4-7          USD    5.0000   25.0000    6.2500    0.5000
        claude-sonnet-4-5        USD    3.0000   15.0000    3.7500    0.3000
        claude-sonnet-4-6        USD    3.0000   15.0000    3.7500    0.3000
        deepseek-v4-flash        CNY    1.0000    2.0000    1.0000    0.0200
        deepseek-v4-pro          CNY    3.0000    6.0000    3.0000    0.0250
        kimi-for-coding          CNY    6.5000   27.0000    6.5000    1.1000
        kimi-k2.5                CNY    4.0000   21.0000    4.0000    0.7000
        kimi-k2.6                CNY    6.5000   27.0000    6.5000    1.1000

      rates per million tokens  每百万 token 单价
      ",
      }
    `);
  });

  it("bare renders usage", () => {
    expect(tsPrices([])).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "Usage: roll prices <subcommand> [--url URL] [--vendor VENDOR]
            roll prices <子命令> [--url 网址] [--vendor 厂商]

      Subcommands:
        show     Print the current price snapshot table.
                 显示当前价格快照表。
        refresh  Fetch the official pricing docs, diff against the latest snapshot,
                 and write a new snapshot only when rates have changed.
                 拉取官方价格文档与最新快照对比，有变化才落新快照。

      Options:
        --vendor anthropic|deepseek|kimi  Target vendor for refresh (default: anthropic).
                                          指定拉取价格的厂商（默认：anthropic）。
      ",
      }
    `);
  });
  it("--help renders usage", () => {
    expect(tsPrices(["--help"])).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "Usage: roll prices <subcommand> [--url URL] [--vendor VENDOR]
            roll prices <子命令> [--url 网址] [--vendor 厂商]

      Subcommands:
        show     Print the current price snapshot table.
                 显示当前价格快照表。
        refresh  Fetch the official pricing docs, diff against the latest snapshot,
                 and write a new snapshot only when rates have changed.
                 拉取官方价格文档与最新快照对比，有变化才落新快照。

      Options:
        --vendor anthropic|deepseek|kimi  Target vendor for refresh (default: anthropic).
                                          指定拉取价格的厂商（默认：anthropic）。
      ",
      }
    `);
  });
  it("help renders usage", () => {
    expect(tsPrices(["help"])).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "Usage: roll prices <subcommand> [--url URL] [--vendor VENDOR]
            roll prices <子命令> [--url 网址] [--vendor 厂商]

      Subcommands:
        show     Print the current price snapshot table.
                 显示当前价格快照表。
        refresh  Fetch the official pricing docs, diff against the latest snapshot,
                 and write a new snapshot only when rates have changed.
                 拉取官方价格文档与最新快照对比，有变化才落新快照。

      Options:
        --vendor anthropic|deepseek|kimi  Target vendor for refresh (default: anthropic).
                                          指定拉取价格的厂商（默认：anthropic）。
      ",
      }
    `);
  });

  it("unknown subcommand: bilingual stderr + help + exit 1 (en)", () => {
    expect(tsPrices(["bogus"], { ROLL_LANG: "en" })).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] Unknown subcommand: bogus
      Usage: roll prices <subcommand> [--url URL] [--vendor VENDOR]
            roll prices <子命令> [--url 网址] [--vendor 厂商]

      Subcommands:
        show     Print the current price snapshot table.
                 显示当前价格快照表。
        refresh  Fetch the official pricing docs, diff against the latest snapshot,
                 and write a new snapshot only when rates have changed.
                 拉取官方价格文档与最新快照对比，有变化才落新快照。

      Options:
        --vendor anthropic|deepseek|kimi  Target vendor for refresh (default: anthropic).
                                          指定拉取价格的厂商（默认：anthropic）。
      ",
        "stdout": "",
      }
    `);
  });
  it("unknown subcommand: bilingual stderr + help + exit 1 (zh)", () => {
    expect(tsPrices(["bogus"], { ROLL_LANG: "zh" })).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] 未知子命令：bogus
      Usage: roll prices <subcommand> [--url URL] [--vendor VENDOR]
            roll prices <子命令> [--url 网址] [--vendor 厂商]

      Subcommands:
        show     Print the current price snapshot table.
                 显示当前价格快照表。
        refresh  Fetch the official pricing docs, diff against the latest snapshot,
                 and write a new snapshot only when rates have changed.
                 拉取官方价格文档与最新快照对比，有变化才落新快照。

      Options:
        --vendor anthropic|deepseek|kimi  Target vendor for refresh (default: anthropic).
                                          指定拉取价格的厂商（默认：anthropic）。
      ",
        "stdout": "",
      }
    `);
  });

  it("refresh routes to bash fallback (returns null)", () => {
    expect(pricesCommand(["refresh", "--url", "x"])).toBeNull();
  });
});
