/**
 * Frozen-expectation test: TS `treeVersion` version probe (FIX-202).
 *
 * `treeVersion` was proven byte-equal to the bash oracle `bin/roll version`
 * under diff-test (fabricated install tree + seeded nag cache). Per US-PORT-009c
 * the oracle is retired: the `bin/roll version` spawn (and the ROLL_HOME nag
 * seeding that only existed to silence it) is dropped. The probe's contract is
 * already a frozen literal — package.json-first, bin/roll `VERSION="…"` literal
 * as last-resort fallback — so each case asserts the fixed sentinel directly.
 *
 * FIX-202 background: bash `$VERSION` and TS `runningVersion()` both read the
 * fossil `VERSION="3.0.0"` baked into bin/roll, which v3 stopped bumping (only
 * package.json moves on release). The fix makes both package.json-first.
 *
 * Hermetic: fabricated ROLL_PKG_DIR tree, fixed sentinel versions, no network,
 * no launchd, no oracle spawn.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
 * A fabricated install tree: a lib/ copy, optionally a package.json with
 * `version`. US-PORT-021: bin/roll is retired, so it is no longer copied in —
 * package.json is the sole version source.
 */
function buildTree(pkgVersion: string | null): string {
  const tree = realpathSync(mkdtempSync(join(tmpdir(), "roll-ver-tree-")));
  dirs.push(tree);
  cpSync(join(REPO, "lib"), join(tree, "lib"), { recursive: true });
  if (pkgVersion !== null) {
    writeFileSync(join(tree, "package.json"), JSON.stringify({ name: "@seanyao/roll", version: pkgVersion }) + "\n");
  }
  return tree;
}

describe("frozen: version probe is package.json-only (bin/roll fallback retired)", () => {
  it("reads the version from package.json", () => {
    expect(treeVersion(buildTree("7.7.7"))).toBe("7.7.7");
  });

  it("no package.json → empty (US-PORT-021: the bin/roll VERSION fallback is gone)", () => {
    expect(treeVersion(buildTree(null))).toBe("");
  });
});
