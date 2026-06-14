/**
 * FIX-249 — pi session-file usage recovery (the cli adapter over core's pure
 * `sumPiSession`/`aggregateSessions`, which had NO live caller).
 *
 * pi's text-mode stdout carries no usage (piExtract is an always-null stub),
 * so v3 runs rows for pi cycles had no tokens/cost/model — dashboards read
 * "—"/$0 and budget guardrails were blind. pi DOES write authoritative
 * per-message usage into `~/.pi/agent/sessions/<encoded-cwd>/*.jsonl`; this
 * adapter scopes the read to the cycle (worktree cwd + mtime ≥ cycle start).
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, it } from "vitest";
import {
  piSessionsDirFor,
  recoverCodexUsage,
  recoverKimiUsage,
  recoverPiUsage,
} from "../src/runner/usage-recovery.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function tmp(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `roll-249-${tag}-`)));
  dirs.push(d);
  return d;
}

const piLine = (model: string, input: number, output: number, cacheRead = 0, cacheWrite = 0): string =>
  JSON.stringify({
    type: "message",
    message: { role: "assistant", model, usage: { input, output, cacheRead, cacheWrite, cost: { total: 0.01 } } },
  });

describe("piSessionsDirFor", () => {
  it("encodes the worktree cwd the way pi names its session dirs", () => {
    expect(piSessionsDirFor("/root", "/Users/x/Workspace/proj/.roll/loop/worktrees/cycle-1")).toBe(
      join("/root", "--Users-x-Workspace-proj-.roll-loop-worktrees-cycle-1--"),
    );
  });
});

describe("recoverPiUsage", () => {
  it("sums this cycle's session files into an AgentUsage (model + tokens + cache split)", () => {
    const root = tmp("root");
    const cwd = "/w/t";
    const dir = piSessionsDirFor(root, cwd);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "s1.jsonl"), [piLine("deepseek-v4-pro", 100, 50, 1000, 200)].join("\n") + "\n");
    writeFileSync(join(dir, "s2.jsonl"), [piLine("deepseek-v4-pro", 10, 5)].join("\n") + "\n");
    const u = recoverPiUsage(cwd, undefined, root);
    expect(u).not.toBeNull();
    expect(u).toMatchObject({
      model: "deepseek-v4-pro",
      input_tokens: 110,
      output_tokens: 55,
      cache_read_tokens: 1000,
      cache_creation_tokens: 200,
    });
  });

  it("ignores session files older than the cycle start (stale sessions never bleed in)", () => {
    const root = tmp("stale");
    const cwd = "/w/t2";
    const dir = piSessionsDirFor(root, cwd);
    mkdirSync(dir, { recursive: true });
    const old = join(dir, "old.jsonl");
    writeFileSync(old, piLine("deepseek-v4-pro", 999, 999) + "\n");
    utimesSync(old, 1000, 1000); // epoch-old
    const fresh = join(dir, "fresh.jsonl");
    writeFileSync(fresh, piLine("deepseek-v4-pro", 7, 3) + "\n");
    const u = recoverPiUsage(cwd, Math.floor(Date.now() / 1000) - 3600, root);
    expect(u).toMatchObject({ input_tokens: 7, output_tokens: 3 });
  });

  it("no session dir / no usage → null (n/a, never fake zeros)", () => {
    const root = tmp("none");
    expect(recoverPiUsage("/no/such/cwd", undefined, root)).toBeNull();
    const dir = piSessionsDirFor(root, "/w/t3");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "empty.jsonl"), "\n");
    expect(recoverPiUsage("/w/t3", undefined, root)).toBeNull();
  });
});


// ── kimi session-file recovery (FIX-303) ─────────────────────────────────────

const kimiWireLine = (model: string, input: number, output: number, cacheRead = 0, cacheCreate = 0): string =>
  JSON.stringify({
    type: "usage.record",
    model,
    usage: { inputOther: input, output, inputCacheRead: cacheRead, inputCacheCreation: cacheCreate },
    usageScope: "turn",
  });

describe("recoverKimiUsage", () => {
  it("sums this cycle's wire files into the 4-component model", () => {
    const root = tmp("kimi-root");
    const cwd = "/w/roll-cycle-abc";
    // kimi-code: <root>/wd_<basename>_<hash>/session_<uuid>/agents/main/wire.jsonl
    const wd = join(root, "wd_roll-cycle-abc_deadbeef", "session_1", "agents", "main");
    mkdirSync(wd, { recursive: true });
    writeFileSync(
      join(wd, "wire.jsonl"),
      [kimiWireLine("kimi-for-coding", 100, 50, 1000, 200), kimiWireLine("kimi-for-coding", 10, 5)].join("\n") + "\n",
    );
    const u = recoverKimiUsage(cwd, undefined, root);
    expect(u).not.toBeNull();
    expect(u).toMatchObject({
      model: "kimi-for-coding",
      input_tokens: 110,
      output_tokens: 55,
      cache_read_tokens: 1000,
      cache_creation_tokens: 200,
    });
  });

  it("ignores wire files older than the cycle start", () => {
    const root = tmp("kimi-stale");
    const cwd = "/w/roll-cycle-stale";
    const wd = join(root, "wd_roll-cycle-stale_aa", "session_1", "agents", "main");
    mkdirSync(wd, { recursive: true });
    const oldf = join(wd, "wire.jsonl");
    writeFileSync(oldf, kimiWireLine("kimi-k2.6", 999, 999) + "\n");
    utimesSync(oldf, 1000, 1000);
    const u = recoverKimiUsage(cwd, Math.floor(Date.now() / 1000) - 3600, root);
    expect(u).toBeNull();
  });

  it("no matching session dir → null (n/a, never fake zeros)", () => {
    const root = tmp("kimi-none");
    mkdirSync(root, { recursive: true });
    expect(recoverKimiUsage("/w/no-such", undefined, root)).toBeNull();
  });
});

// ── codex session-file recovery (FIX-303) ────────────────────────────────────

const codexMeta = (model: string, cwd: string): string =>
  JSON.stringify({ type: "session_meta", payload: { model, cwd } });
const codexTokenCount = (input: number, cached: number, output: number): string =>
  JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output } },
    },
  });

describe("recoverCodexUsage", () => {
  it("recovers a rollout whose session_meta cwd matches the worktree (4 components)", () => {
    const root = tmp("codex-root");
    const cwd = "/w/roll-cycle-codex";
    const day = join(root, "2026", "06", "14");
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, "rollout-2026-06-14T20-00-00-abc.jsonl"),
      [codexMeta("gpt-5.5", cwd), codexTokenCount(1000, 800, 30), codexTokenCount(1500, 1200, 50)].join("\n") + "\n",
    );
    const u = recoverCodexUsage(cwd, undefined, root);
    expect(u).not.toBeNull();
    expect(u).toMatchObject({
      model: "gpt-5.5",
      input_tokens: 300, // 1500 − 1200 cached
      output_tokens: 50,
      cache_read_tokens: 1200,
      cache_creation_tokens: 0,
    });
  });

  it("does not pick a rollout for a different worktree cwd", () => {
    const root = tmp("codex-other");
    const day = join(root, "2026", "06", "14");
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, "rollout-other.jsonl"),
      [codexMeta("gpt-5.5", "/w/some-OTHER-cycle"), codexTokenCount(9, 0, 9)].join("\n") + "\n",
    );
    expect(recoverCodexUsage("/w/roll-cycle-codex", undefined, root)).toBeNull();
  });

  it("ignores rollouts older than the cycle start", () => {
    const root = tmp("codex-stale");
    const cwd = "/w/roll-cycle-old";
    const day = join(root, "2026", "06", "14");
    mkdirSync(day, { recursive: true });
    const f = join(day, "rollout-old.jsonl");
    writeFileSync(f, [codexMeta("gpt-5.5", cwd), codexTokenCount(99, 0, 99)].join("\n") + "\n");
    utimesSync(f, 1000, 1000);
    expect(recoverCodexUsage(cwd, Math.floor(Date.now() / 1000) - 3600, root)).toBeNull();
  });

  it("no sessions root → null", () => {
    expect(recoverCodexUsage("/w/x", undefined, join(tmpdir(), "roll-303-no-codex-root-xyz"))).toBeNull();
  });
});
