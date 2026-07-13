/**
 * US-DELIV-010 — degraded/terminal observability through the CLI adapter.
 *
 * Evaluation contract expected_evidence (item 2): every degraded/terminal
 * verdict carries reason + dwell and is READABLE — these tests prove the
 * `roll loop reconcile` command path surfaces them in stdout and --json,
 * and never fabricates a merge attempt or a delivered for a stuck PR.
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EventBus } from "@roll/core";
import type { PrCloudState, PrStatusProvider } from "@roll/core";
import { loopReconcileCommand, runReconcileTick, type LoopReconcileDeps } from "../src/commands/loop-reconcile.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GIT_VARS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_CEILING_DIRECTORIES", "GIT_COMMON_DIR", "GIT_INDEX_FILE"];

function withoutGitEnv<T>(fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of GIT_VARS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of GIT_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

/**
 * Async variant — the command under test spawns git, and a leaked GIT_DIR
 * (from the outer cycle worktree) would make offline L1/L2 probe the REAL
 * repo instead of the temp project. Strip the env for the whole await.
 */
async function withoutGitEnvAsync<T>(fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of GIT_VARS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of GIT_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

/** Create a temp project with a git repo + GitHub remote (never fetched). */
function project(): string {
  return withoutGitEnv(() => {
    const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-deliv010-")));
    dirs.push(p);
    mkdirSync(join(p, ".roll", "loop"), { recursive: true });
    execSync("git init -q", { cwd: p });
    execSync("git config user.email test@roll.local && git config user.name Test", { cwd: p });
    execSync("git checkout -q -b main && git commit -q --allow-empty -m init", { cwd: p });
    execSync("git remote add origin https://github.com/owner/repo.git", { cwd: p });
    return p;
  });
}

const CYCLE = "20260711-220000-99999";
/** Fixed published ts (2026-05-17) — always past CI_STUCK_DWELL_MS by construction. */
const PUBLISHED_TS = 1_779_000_000_000;

function seed(p: string, prNumber = 42): void {
  withoutGitEnv(() => {
    writeFileSync(
      join(p, ".roll", "loop", "events.ndjson"),
      [
        { type: "cycle:start", cycleId: CYCLE, storyId: "US-DELIV-010", ts: PUBLISHED_TS },
        {
          type: "delivery:published",
          cycleId: CYCLE,
          storyId: "US-DELIV-010",
          branch: `loop/${CYCLE}`,
          prNumber,
          ts: PUBLISHED_TS + 1,
        },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n",
    );
    execSync(`git checkout -q -b loop/${CYCLE}`, { cwd: p });
  });
}

function readEvents(p: string): Record<string, unknown>[] {
  return readFileSync(join(p, ".roll", "loop", "events.ndjson"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function fakeProvider(states: Record<number, PrCloudState>): PrStatusProvider {
  return {
    name: "fake",
    async pollPrStatus(_slug: string, prNumber: number): Promise<PrCloudState> {
      const state = states[prNumber];
      if (state === undefined) throw new Error(`no fake state for PR #${prNumber}`);
      return state;
    },
  };
}

function deps(p: string, provider?: PrStatusProvider): LoopReconcileDeps & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    cwd: p,
    provider,
    bus: new EventBus(),
    stdout: { write: (s: string) => out.push(s) },
    stderr: { write: (s: string) => err.push(s) },
    out,
    err,
  };
}

function jsonReport(out: string[]): Record<string, unknown>[] {
  const text = out.join("");
  const start = text.indexOf("[");
  expect(start).toBeGreaterThanOrEqual(0);
  return JSON.parse(text.slice(start)) as Record<string, unknown>[];
}

describe("US-DELIV-010 — degraded/terminal observable through reconcile", () => {
  it("draft PR → degraded(draft) with dwell, no merge attempt", async () => {
    const p = project();
    seed(p);
    const d = deps(p, fakeProvider({
      42: { kind: "open", ci: "green", draft: true, checkedAt: "2026-07-13T00:00:00Z" },
    }));
    const code = await withoutGitEnvAsync(() => loopReconcileCommand(["--json"], d));
    expect(code).toBe(0);

    const [item] = jsonReport(d.out);
    expect(item!.kind).toBe("degraded");
    expect(item!.reason).toBe("draft");
    expect(typeof item!.dwellMs).toBe("number");
    expect(item!.dwellMs as number).toBeGreaterThan(0);

    // A draft is never merge_now: no merge_attempt event may be emitted.
    const evs = readEvents(p);
    expect(evs.find((e) => e.type === "delivery:merge_attempt")).toBeUndefined();
    expect(evs.find((e) => e.type === "delivery:reconciled")).toBeUndefined();
  });

  it("merge conflict → degraded(merge_conflict), no merge attempt despite green CI", async () => {
    const p = project();
    seed(p);
    const d = deps(p, fakeProvider({
      42: { kind: "open", ci: "green", mergeable: "CONFLICTING", checkedAt: "2026-07-13T00:00:00Z" },
    }));
    const code = await withoutGitEnvAsync(() => loopReconcileCommand(["--json"], d));
    expect(code).toBe(0);

    const [item] = jsonReport(d.out);
    expect(item!.kind).toBe("degraded");
    expect(item!.reason).toBe("merge_conflict");
    const evs = readEvents(p);
    expect(evs.find((e) => e.type === "delivery:merge_attempt")).toBeUndefined();
  });

  it("CI long-red (dwell past threshold) → degraded(ci_stuck) with dwell", async () => {
    const p = project();
    seed(p);
    const d = deps(p, fakeProvider({
      42: { kind: "open", ci: "red", checkedAt: "2026-07-13T00:00:00Z" },
    }));
    const code = await withoutGitEnvAsync(() => loopReconcileCommand(["--json"], d));
    expect(code).toBe(0);

    const [item] = jsonReport(d.out);
    expect(item!.kind).toBe("degraded");
    expect(item!.reason).toBe("ci_stuck");
    // dwell is measured from delivery:published and is readable.
    expect(item!.dwellMs as number).toBeGreaterThan(24 * 60 * 60 * 1000);
  });

  it("PR closed unmerged → terminal(pr_closed_unmerged), never delivered", async () => {
    const p = project();
    seed(p);
    const d = deps(p, fakeProvider({
      42: { kind: "closed_unmerged", closedAt: "2026-07-13T00:00:00Z", checkedAt: "2026-07-13T00:00:00Z" },
    }));
    const code = await withoutGitEnvAsync(() => loopReconcileCommand(["--json"], d));
    expect(code).toBe(0);

    const [item] = jsonReport(d.out);
    expect(item!.kind).toBe("terminal");
    expect(item!.reason).toBe("pr_closed_unmerged");
    const evs = readEvents(p);
    expect(evs.find((e) => e.type === "delivery:reconciled")).toBeUndefined();
  });

  it("gh unreachable auth → degraded(no_permission)", async () => {
    const p = project();
    seed(p);
    const d = deps(p, fakeProvider({
      42: { kind: "unreachable", reason: "auth", checkedAt: "2026-07-13T00:00:00Z" },
    }));
    const code = await withoutGitEnvAsync(() => loopReconcileCommand(["--json"], d));
    expect(code).toBe(0);

    const [item] = jsonReport(d.out);
    expect(item!.kind).toBe("degraded");
    expect(item!.reason).toBe("no_permission");
  });

  it("gh unreachable provider_error → wait (transient, no verdict)", async () => {
    const p = project();
    seed(p);
    const d = deps(p, fakeProvider({
      42: { kind: "unreachable", reason: "provider_error", checkedAt: "2026-07-13T00:00:00Z" },
    }));
    const code = await withoutGitEnvAsync(() => loopReconcileCommand(["--json"], d));
    expect(code).toBe(0);

    const [item] = jsonReport(d.out);
    expect(item!.kind).toBe("wait");
  });

  it("reconcile tick summary counts degraded and terminal cycles", async () => {
    const p = project();
    seed(p, 42);
    withoutGitEnv(() => {
      const second = "20260711-220000-99998";
      const path = join(p, ".roll", "loop", "events.ndjson");
      const lines = readFileSync(path, "utf8");
      writeFileSync(
        path,
        lines +
          [
            { type: "cycle:start", cycleId: second, storyId: "US-DELIV-010", ts: PUBLISHED_TS },
            {
              type: "delivery:published",
              cycleId: second,
              storyId: "US-DELIV-010",
              branch: `loop/${second}`,
              prNumber: 43,
              ts: PUBLISHED_TS + 1,
            },
          ]
            .map((e) => JSON.stringify(e))
            .join("\n") + "\n",
      );
      execSync(`git checkout -q -b loop/${second}`, { cwd: p });
    });

    // One PR long-red (→ degraded ci_stuck), one closed unmerged (→ terminal).
    const result = await withoutGitEnvAsync(() =>
      runReconcileTick(p, {
        silent: true,
        provider: fakeProvider({
          42: { kind: "open", ci: "red", checkedAt: "2026-07-13T00:00:00Z" },
          43: { kind: "closed_unmerged", closedAt: "2026-07-13T00:00:00Z", checkedAt: "2026-07-13T00:00:00Z" },
        }),
      }),
    );
    expect(result.cyclesProcessed).toBe(2);
    expect(result.degraded).toBe(1);
    expect(result.terminal).toBe(1);
  });
});
