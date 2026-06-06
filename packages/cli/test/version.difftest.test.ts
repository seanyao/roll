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
 * package.json with `version`.
 */
function buildTree(pkgVersion: string | null): string {
  const tree = realpathSync(mkdtempSync(join(tmpdir(), "roll-ver-tree-")));
  dirs.push(tree);
  mkdirSync(join(tree, "bin"), { recursive: true });
  cpSync(join(REPO, "bin", "roll"), join(tree, "bin", "roll"));
  cpSync(join(REPO, "lib"), join(tree, "lib"), { recursive: true });
  if (pkgVersion !== null) {
    writeFileSync(join(tree, "package.json"), JSON.stringify({ name: "@seanyao/roll", version: pkgVersion }) + "\n");
  }
  return tree;
}

describe("frozen: version probe is package.json-first, bin/roll literal is fallback", () => {
  it("package.json version wins over the fossil bin/roll VERSION literal", () => {
    expect(treeVersion(buildTree("7.7.7"))).toBe("7.7.7");
  });

  it("falls back to the bin/roll VERSION literal when no package.json is present", () => {
    // "3.0.0" matches bin/roll's frozen VERSION="…" literal.
    expect(treeVersion(buildTree(null))).toBe("3.0.0");
  });
});
