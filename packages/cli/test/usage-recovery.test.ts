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
import { piSessionsDirFor, recoverPiUsage } from "../src/runner/usage-recovery.js";

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
