/**
 * FIX-202 regression: the version probe is package.json-first (single source of
 * truth), with bin/roll's `VERSION="…"` literal only as last-resort fallback —
 * proven identically on the TS probe and the bash oracle.
 *
 * The bug: bash `$VERSION` and the TS `runningVersion()` both read the fossil
 * `VERSION="3.0.0"` baked into bin/roll, which v3 stopped bumping (only
 * package.json moves on release). That made `roll version` show 3.0.0, made
 * `roll update`'s self-check cry "installed 3.0.0, expected <real>", and made
 * the upgrade nag never clear. All three share this probe.
 *
 * We fabricate an install tree (copied bin/roll + lib, plus a package.json with
 * a sentinel version) and assert:
 *   - package.json wins over the fossil bin/roll literal (TS `treeVersion` and
 *     bash `roll version` both report the sentinel, not 3.0.0)
 *   - with no package.json, both fall back to the bin/roll literal
 *
 * Hermetic: fabricated ROLL_PKG_DIR/ROLL_HOME, seeded update-check cache (writer
 * == resolved VERSION → nag stays silent, no GitHub fetch). No network, no
 * launchd. Locale + NO_COLOR pinned.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { treeVersion } from "../src/commands/version.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/**
 * A fabricated install tree: real bin/roll + lib copied in, optionally a
 * package.json with `version`. ROLL_HOME seeded so the bash nag stays silent.
 */
function buildTree(pkgVersion: string | null): { tree: string; home: string } {
  const tree = realpathSync(mkdtempSync(join(tmpdir(), "roll-ver-tree-")));
  dirs.push(tree);
  mkdirSync(join(tree, "bin"), { recursive: true });
  cpSync(join(REPO, "bin", "roll"), join(tree, "bin", "roll"));
  cpSync(join(REPO, "lib"), join(tree, "lib"), { recursive: true });
  if (pkgVersion !== null) {
    writeFileSync(join(tree, "package.json"), JSON.stringify({ name: "@seanyao/roll", version: pkgVersion }) + "\n");
  }
  const home = realpathSync(mkdtempSync(join(tmpdir(), "roll-ver-home-")));
  dirs.push(home);
  mkdirSync(join(home, ".roll"), { recursive: true });
  // Resolve the version the bin/roll will report so we can seed a writer-matched
  // cache (writer == VERSION + fresh ts → _check_update_async early-returns,
  // _notify_update stays silent — deterministic, offline).
  const v = pkgVersion ?? "3.0.0";
  writeFileSync(join(home, ".roll", ".update-check"), `${Math.floor(Date.now() / 1000)} ${v} ${v}\n`);
  return { tree, home };
}

/** Run the fabricated tree's bin/roll `version` and return its stdout. */
function bashVersion(tree: string, home: string): string {
  return execFileSync(join(tree, "bin", "roll"), ["version"], {
    cwd: tree,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: home,
      ROLL_HOME: join(home, ".roll"),
      NO_COLOR: "1",
      ROLL_LANG: "en",
      ROLL_SKIP_STRUCTURE_CHECK: "1",
    },
  });
}

describe("FIX-202: version probe is package.json-first, bin/roll literal is fallback", () => {
  it("package.json version wins over the fossil bin/roll VERSION literal (TS + bash agree)", () => {
    const { tree, home } = buildTree("7.7.7");
    // TS probe.
    expect(treeVersion(tree)).toBe("7.7.7");
    // Bash oracle: the running version is read from the tree's package.json, not
    // the copied bin/roll's VERSION="3.0.0" fossil.
    expect(bashVersion(tree, home)).toBe("roll v7.7.7\n");
  });

  it("falls back to the bin/roll VERSION literal when no package.json is present", () => {
    const { tree, home } = buildTree(null);
    const fossil = "3.0.0"; // matches bin/roll's frozen literal
    expect(treeVersion(tree)).toBe(fossil);
    expect(bashVersion(tree, home)).toBe(`roll v${fossil}\n`);
  });
});
