/**
 * Frozen-expectation test: TS `roll prices` render.
 *
 * `pricesCommand` was proven byte-equal to the bash oracle `bin/roll prices`
 * under diff-test (show renders the frozen lib/prices snapshots). Per
 * US-PORT-009c the oracle is retired: the `bin/roll prices` spawn is dropped and
 * each case freezes the TS `{status, stdout, stderr}` as an inline snapshot
 * (zero engine spawn). show/help/bilingual-error are fully deterministic and
 * path-free (portable). `refresh` is TS-owned as of US-PORT-017; tests inject
 * HTML/network/date/temp snapshot dirs, so no `bin/roll` or live network is used.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pricesCommand } from "../src/commands/prices.js";
import { repoRoot } from "../src/bridge.js";
import { seedUpdateCheckCache } from "./helpers.js";

// Isolated ROLL_HOME with a seeded update-check cache — keeps the async upgrade
// nag out of stdout (deterministic render).
const ROLL_HOME = join(mkdtempSync(join(tmpdir(), "roll-prices-home-")), ".roll");
seedUpdateCheckCache(ROLL_HOME);
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function tsPrices(args: string[], env: Record<string, string> = {}, deps = {}): Promise<{
  status: number;
  stdout: string;
  stderr: string;
}> {
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
  let status: number | Promise<number>;
  try {
    status = pricesCommand(args, deps);
    status = await status;
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

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "roll-prices-refresh-"));
  dirs.push(d);
  return d;
}

const CLAUDE_HTML = `
<table>
  <tr>
    <td>Claude Sonnet 4.7</td>
    <td>claude-sonnet-4-7</td>
    <td>$3</td>
    <td>$3.75</td>
    <td>$0.30</td>
    <td>$15</td>
  </tr>
</table>
`;

function writeSnapshot(dir: string, prices: Record<string, unknown>): void {
  writeFileSync(
    join(dir, "snapshot-2026-01-01.json"),
    `${JSON.stringify(
      {
        version: "2026-01-01",
        effective_at: "2026-01-01",
        source_url: "fixture",
        vendor: "anthropic",
        currency: "USD",
        default_model: "claude-sonnet-4-7",
        prices,
      },
      null,
      2,
    )}\n`,
  );
}

describe("frozen: roll prices render", () => {
  it("show renders the snapshot table", async () => {
    expect(await tsPrices(["show"])).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "price snapshot  价格快照
        version        2026-06-14
        effective_at   2026-06-14
        snapshots      4 loaded  已加载
          anthropic     USD  https://platform.claude.com/docs/en/about-claude/pricing
          deepseek      CNY  https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
          kimi          CNY  https://platform.kimi.com/docs/pricing/chat
          openai        USD  https://openrouter.ai/openai/gpt-5.5

        model                    cur        in       out        cw        cr
        claude-haiku-4-5         USD    1.0000    5.0000    1.2500    0.1000
        claude-opus-4-6          USD    5.0000   25.0000    6.2500    0.5000
        claude-opus-4-7          USD    5.0000   25.0000    6.2500    0.5000
        claude-sonnet-4-5        USD    3.0000   15.0000    3.7500    0.3000
        claude-sonnet-4-6        USD    3.0000   15.0000    3.7500    0.3000
        deepseek-v4-flash        CNY    1.0000    2.0000    1.0000    0.0200
        deepseek-v4-pro          CNY    3.0000    6.0000    3.0000    0.0250
        gpt-4o                   USD    2.5000   10.0000    2.5000    1.2500
        gpt-5                    USD    2.5000   15.0000    2.5000    0.2500
        gpt-5.5                  USD    5.0000   30.0000    5.0000    0.5000
        kimi-for-coding          CNY    6.5000   27.0000    6.5000    1.1000
        kimi-k2.5                CNY    4.0000   21.0000    4.0000    0.7000
        kimi-k2.6                CNY    6.5000   27.0000    6.5000    1.1000

      rates per million tokens  每百万 token 单价
      ",
      }
    `);
  });

  it("bare renders usage", async () => {
    expect(await tsPrices([])).toMatchInlineSnapshot(`
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
  it("--help renders usage", async () => {
    expect(await tsPrices(["--help"])).toMatchInlineSnapshot(`
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
  it("help renders usage", async () => {
    expect(await tsPrices(["help"])).toMatchInlineSnapshot(`
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

  it("unknown subcommand: bilingual stderr + help + exit 1 (en)", async () => {
    expect(await tsPrices(["bogus"], { ROLL_LANG: "en" })).toMatchInlineSnapshot(`
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
  it("unknown subcommand: bilingual stderr + help + exit 1 (zh)", async () => {
    expect(await tsPrices(["bogus"], { ROLL_LANG: "zh" })).toMatchInlineSnapshot(`
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

  it("refresh unknown flag freezes v2's missing-argument message", async () => {
    expect(await tsPrices(["refresh", "--bogus"])).toEqual({
      status: 1,
      stdout: "",
      stderr: "[roll] Unknown flag: \n",
    });
  });

  it("refresh unknown vendor freezes v2's heredoc-literal bug", async () => {
    expect(await tsPrices(["refresh", "--vendor", "bogus"])).toEqual({
      status: 1,
      stdout: "",
      stderr:
        "$(msg prices_refresh.roll_unknown_vendor_vendor)\n$(msg prices_refresh.roll_known_vendors_join_sorted_vendor)\n",
    });
  });

  it("refresh reports fetch failure and preserves the existing snapshot", async () => {
    const dir = tmp();
    const r = await tsPrices(["refresh", "--url", "https://example.invalid/pricing"], {}, {
      refresh: {
        snapshotDir: dir,
        fetchHtml: () => {
          throw new Error("network down");
        },
      },
    });
    expect(r).toEqual({
      status: 2,
      stdout: "",
      stderr:
        "[roll] fetch failed: network down\n[roll] keeping existing snapshot, no changes written  保留旧快照，未写入新文件\n",
    });
  });

  it("refresh reports parse failure and writes nothing", async () => {
    const dir = tmp();
    const r = await tsPrices(["refresh"], {}, {
      refresh: {
        snapshotDir: dir,
        fetchHtml: () => "<html></html>",
      },
    });
    expect(r.status).toBe(3);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("[roll] parse failed: no price rows found in HTML; page layout may have changed");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("refresh exits 0 unchanged when parsed rates equal the latest snapshot", async () => {
    const dir = tmp();
    writeSnapshot(dir, {
      "claude-sonnet-4-7": { in: 3, out: 15, cache_create: 3.75, cache_read: 0.3 },
    });
    const r = await tsPrices(["refresh"], {}, {
      refresh: {
        snapshotDir: dir,
        fetchHtml: () => CLAUDE_HTML,
      },
    });
    expect(r).toEqual({ status: 0, stdout: "[roll] up to date  价格快照已是最新\n", stderr: "" });
    expect(readdirSync(dir).filter((name) => name.endsWith(".json"))).toEqual(["snapshot-2026-01-01.json"]);
  });

  it("refresh writes a baseline snapshot when no vendor snapshot exists", async () => {
    const dir = tmp();
    const r = await tsPrices(["refresh", "--url", "https://example.test/prices"], {}, {
      refresh: {
        snapshotDir: dir,
        today: () => "2026-06-08",
        fetchHtml: () => CLAUDE_HTML,
        stdoutIsTTY: () => false,
      },
    });
    expect(r.stdout).toContain("[roll] baseline snapshot written  写入首份基线快照\n");
    expect(r.stdout).toContain("+ claude-sonnet-4-7 in = 3.0");
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    const written = join(dir, "snapshot-2026-06-08.json");
    expect(existsSync(written)).toBe(true);
    const body = readFileSync(written, "utf8");
    expect(body).toContain('"source_url": "https://example.test/prices"');
    expect(body).toContain('"in": 3.0');
  });

  it("refresh writes a new snapshot and prints a diff when rates changed", async () => {
    const dir = tmp();
    writeSnapshot(dir, {
      "claude-sonnet-4-7": { in: 2, out: 15, cache_create: 3.75, cache_read: 0.3 },
    });
    const r = await tsPrices(["refresh"], {}, {
      refresh: {
        snapshotDir: dir,
        today: () => "2026-06-08",
        fetchHtml: () => CLAUDE_HTML,
        stdoutIsTTY: () => false,
      },
    });
    expect(r).toEqual({
      status: 0,
      stderr: "",
      stdout: "[roll] new snapshot written  写入新版价格快照\n~ claude-sonnet-4-7 in 2 → 3.0\n",
    });
    expect(existsSync(join(dir, "snapshot-2026-06-08.json"))).toBe(true);
  });

  it("prices registry no longer falls back to bash for refresh", () => {
    const src = readFileSync(`${repoRoot()}/packages/cli/src/commands/index.ts`, "utf8");
    expect(src).not.toContain('fallbackToBash(["prices"');
  });
});
