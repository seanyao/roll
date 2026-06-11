/**
 * Release packaging integration test — proves `npm i -g @seanyao/roll@3.0.0`
 * yields a working TS-first CLI with the bash fallback intact.
 *
 * Why this exists: the workspace packages depend on each other via
 * `workspace:*` + bare `@roll/*` imports that ONLY resolve through pnpm's
 * linked node_modules. A packed tarball carries no node_modules, so without
 * the esbuild bundle (`dist/roll.mjs`, wired as `bin.roll`) every `@roll/*`
 * import would be dead on an end-user install. And the bundle reads its data
 * dirs (bin/roll for the bash fallback, lib/prices snapshots) by walking up
 * from its own location to the package root — a walk that only succeeds if the
 * `files` array ships dist/ + bin/ + lib/. Both invariants are invisible to the
 * unit suites; this test is the only thing that exercises the real install.
 *
 * What it does (network-free):
 *   1. `npm pack` the repo root → triggers prepack (`pnpm -r build && pnpm
 *      bundle`) and emits the same tarball `npm publish` would.
 *   2. `npm install --offline <tarball>` into a throwaway prefix. The tarball
 *      has zero runtime deps (esbuild is a devDep, everything else is inlined),
 *      so the install never reaches the registry.
 *   3. Run the INSTALLED bin shim for one TS command that reads packaged data
 *      (`loop status` legacy cost calculation → lib/prices/*.json), one pure-TS
 *      command (`config --list`), and one bash-fallback command (`help`,
 *      `version`). Assert each produces sane output — proving the repoRoot()
 *      walk resolves from the installed layout, not just from the dev checkout.
 *
 * Runtime: a few seconds (incremental tsc + a local-tarball install). The
 * generous `it` timeout is headroom for a cold CI build, not the expected cost.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../../..");

const tmpDirs: string[] = [];
function tmp(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `roll-pack-${tag}-`));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

/** Run a command, capturing combined stdout/stderr; throws on non-zero exit. */
function run(cmd: string, args: string[], cwd: string, envExtra: Record<string, string> = {}): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    // The bash fallback's async update-checker would otherwise spray GitHub
    // fetch noise; point ROLL_HOME at a throwaway dir to keep it quiet/offline.
    env: { ...process.env, ROLL_HOME: join(cwd, ".roll-home"), ...envExtra },
  });
}

describe("npm pack → install → run (release packaging)", () => {
  it(
    "the packed tarball installs deps-free and the installed CLI runs TS + bash paths",
    () => {
      // 1. Pack the repo (prepack builds + bundles).
      const packDir = tmp("tgz");
      const packOut = run("npm", ["pack", "--pack-destination", packDir], REPO_ROOT);
      // `npm pack` prints the tarball name on the last non-empty line.
      const tgz = readdirSync(packDir).find((f) => f.endsWith(".tgz"));
      expect(tgz, `npm pack produced no .tgz (output: ${packOut})`).toBeDefined();
      const tarball = join(packDir, tgz as string);

      // 2. Install the tarball offline into a throwaway prefix. A zero-dep
      //    tarball install never reaches the registry, so --offline is safe and
      //    asserts the bundle is genuinely self-contained.
      const prefix = tmp("prefix");
      run("npm", ["install", "--prefix", prefix, "--offline", "--no-audit", "--no-fund", tarball], prefix);

      const bin = join(prefix, "node_modules", ".bin", "roll");
      expect(existsSync(bin), `installed bin shim missing at ${bin}`).toBe(true);

      // 3a. TS-native `version` (FIX-202): prints the install tree's package.json
      //     version (single source of truth), not the fossil bin/roll literal.
      const version = run(bin, ["version"], prefix);
      expect(version).toMatch(/^roll v\d+\.\d+\.\d+/);

      // 3b. Bash fallback: `help` renders the banner (proves spawn of bin/roll
      //     resolves from the installed package root).
      const help = run(bin, ["help"], prefix);
      expect(help.toLowerCase()).toContain("roll");

      // 3c. Pure-TS handler: `config --list` emits the key table.
      const config = run(bin, ["config", "--list"], prefix);
      expect(config).toContain("loop_active_start");

      // 3d. TS handler that reads PACKAGED data: a legacy usage event has no
      //     persisted cost, so `loop status` computes it from lib/prices/*.json
      //     via the repoRoot() walk from installed dist/roll.mjs. This is the
      //     load-bearing assertion now that `roll prices` is retired.
      const rt = join(prefix, "runtime");
      mkdirSync(rt, { recursive: true });
      writeFileSync(
        join(rt, "events.ndjson"),
        [
          {
            ts: "2026-06-11T09:30:00+00:00",
            stage: "cycle_start",
            label: "pack-cost-1",
            detail: "",
            outcome: "",
          },
          {
            ts: "2026-06-11T09:40:00+00:00",
            stage: "usage",
            label: "pack-cost-1",
            detail: {
              model: "claude-sonnet-4-6",
              input_tokens: 100000,
              output_tokens: 50000,
              cache_creation_tokens: 0,
              cache_read_tokens: 0,
              duration_ms: 600000,
            },
            outcome: "ok",
          },
          {
            ts: "2026-06-11T09:40:00+00:00",
            stage: "cycle_end",
            label: "pack-cost-1",
            detail: "",
            outcome: "done",
          },
        ]
          .map((e) => JSON.stringify(e))
          .join("\n") + "\n",
      );
      const status = run(bin, ["loop", "status", "--no-color", "--en", "--days", "1"], prefix, {
        NO_COLOR: "1",
        ROLL_MAIN_SLUG: "pack-abc123",
        ROLL_PROJECT_RUNTIME_DIR: rt,
        ROLL_RENDER_NOW: "2026-06-11T10:00:00Z",
        ROLL_SHARED_ROOT: join(prefix, "shared"),
      });
      expect(status).toContain("$1.05");
      expect(status).toContain("[legacy]");
    },
    120_000,
  );
});
