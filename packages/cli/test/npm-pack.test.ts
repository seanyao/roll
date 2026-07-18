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
 *      bundles its Playwright runtime closure, so the install never reaches the
 *      registry.
 *   3. Run the INSTALLED bin shim for one TS command that reads packaged data
 *      (`prices show` → lib/prices/*.json), one pure-TS command (`config
 *      --list`), and one public utility command (`help`, `--version`). Assert each
 *      produces sane output — proving the repoRoot() walk resolves from the
 *      installed layout, not just from the dev checkout.
 *
 * Runtime: a few seconds (incremental tsc + a local-tarball install). The
 * generous `it` timeout is headroom for a cold CI build, not the expected cost.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../../..");
const NPM_CACHE = join(tmpdir(), "roll-pack-npm-cache");

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
function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    // The bash fallback's async update-checker would otherwise spray GitHub
    // fetch noise; point ROLL_HOME at a throwaway dir to keep it quiet/offline.
    env: envFor(cwd),
  });
}

function runCapture(cmd: string, args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: envFor(cwd),
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function envFor(cwd: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ROLL_HOME: join(cwd, ".roll-home"),
    ROLL_SKIP_CAPTURE_INSTALL: "1",
    npm_config_cache: NPM_CACHE,
  };
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
      const pkgRoot = join(prefix, "node_modules", "@seanyao", "roll");
      expect(existsSync(bin), `installed bin shim missing at ${bin}`).toBe(true);
      expect(existsSync(join(pkgRoot, "dist", "postinstall.mjs")), "postinstall bundle missing from package").toBe(true);
      expect(existsSync(join(pkgRoot, "scripts", "postinstall-roll-capture.mjs")), "postinstall wrapper missing from package").toBe(true);
      expect(existsSync(join(pkgRoot, "node_modules", "playwright-core", "index.js")), "Playwright runtime missing from package").toBe(true);
      expect(
        existsSync(join(pkgRoot, "node_modules", "chromium-bidi", "lib", "cjs", "bidiMapper", "BidiMapper.js")),
        "Playwright BiDi runtime missing from package",
      ).toBe(true);

      const postinstallBundle = join(pkgRoot, "dist", "postinstall.mjs");
      renameSync(postinstallBundle, `${postinstallBundle}.missing`);
      const postinstall = runCapture("node", [join(pkgRoot, "scripts", "postinstall-roll-capture.mjs")], prefix);
      expect(postinstall.code).toBe(0);
      expect(postinstall.stdout + postinstall.stderr).toContain("postinstall skipped:");

      // 3a. TS-native `--version` (FIX-202): prints the install tree's package.json
      //     version (single source of truth), not the fossil bin/roll literal.
      const version = run(bin, ["--version"], prefix);
      expect(version).toMatch(/^roll v\d+\.\d+\.\d+/);

      // 3b. Bash fallback: `help` renders the banner (proves spawn of bin/roll
      //     resolves from the installed package root).
      const help = run(bin, ["help"], prefix);
      expect(help.toLowerCase()).toContain("roll");

      // 3c. Pure-TS handler: `config --list` emits the key table.
      const config = run(bin, ["config", "--list"], prefix);
      expect(config).toContain("loop_active_start");

      // 3d. TS handler that reads PACKAGED data: `config prices show` loads the
      //     lib/prices/*.json snapshots via the repoRoot() walk from the
      //     installed dist/roll.mjs. This is the load-bearing assertion.
      const prices = run(bin, ["config", "prices", "show"], prefix);
      expect(prices).toMatch(/snapshots\s+\d+ loaded/);
    },
    120_000,
  );
});
