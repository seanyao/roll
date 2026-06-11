/**
 * FIX-241 AC2 — the README-vs-registry drift guard (the "评估生成式防漂" verdict:
 * full table GENERATION from the registry was rejected — descriptions carry
 * editorial judgment a registry can't hold — but COVERAGE is mechanical: every
 * visible registered command must appear in both READMEs, and neither may
 * advertise a command the registry doesn't know. This test is that guard;
 * docs drift now reds CI instead of waiting for the next smoke audit.)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { portedCommands, repoRoot } from "../src/bridge.js";
import { registerAll } from "../src/commands/index.js";

/** Hidden manual/machine entry points stay callable but unlisted (REFACTOR-049/052). */
const HIDDEN = new Set([
  "alert",
  "attest",
  "changelog",
  "consistency",
  "dream",
  "gc",
  "index",
  "skills",
  "version",
]);

let en = "";
let cn = "";
beforeAll(() => {
  registerAll();
  const root = repoRoot();
  en = readFileSync(join(root, "README.md"), "utf8");
  cn = readFileSync(join(root, "README_CN.md"), "utf8");
});

describe("FIX-241 — README command tables track the live registry", () => {
  it("every visible registered command appears in BOTH READMEs", () => {
    const visible = portedCommands().filter((c) => !c.startsWith("-") && !HIDDEN.has(c));
    const missingEn = visible.filter((c) => !en.includes(`\`roll ${c}`) && !en.includes(`roll ${c} `));
    const missingCn = visible.filter((c) => !cn.includes(`\`roll ${c}`) && !cn.includes(`roll ${c} `));
    expect(missingEn, `README.md missing: ${missingEn.join(", ")} — update the Commands table`).toEqual([]);
    expect(missingCn, `README_CN.md missing: ${missingCn.join(", ")} — update the 命令 table`).toEqual([]);
  });

  it("neither README advertises an unregistered top-level command", () => {
    const known = new Set(portedCommands());
    for (const [name, body] of [["README.md", en], ["README_CN.md", cn]] as const) {
      const advertised = [...body.matchAll(/^\| `roll ([a-z-]+)[ <`]/gm)].map((m) => m[1] ?? "");
      const ghosts = advertised.filter((c) => c !== "" && !known.has(c));
      expect(ghosts, `${name} advertises unknown commands: ${ghosts.join(", ")}`).toEqual([]);
    }
  });
});
