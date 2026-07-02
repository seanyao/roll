/**
 * FIX-241 AC2 — the README-vs-registry drift guard (the "评估生成式防漂" verdict:
 * full table GENERATION from the registry was rejected — descriptions carry
 * editorial judgment a registry can't hold — but COVERAGE is mechanical: every
 * visible registered command must appear in both READMEs, and neither may
 * advertise a command the registry doesn't know. This test is that guard;
 * docs drift now reds CI instead of waiting for the next smoke audit.)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { repoRoot, usage } from "../src/bridge.js";
import { registerAll } from "../src/commands/index.js";
import { publicCommands } from "../src/lib/command-surface.js";

const RETIRED_TOP_LEVEL = [
  "alert", "version", "skills", "gc", "index", "ls", "doc", "prices",
  "cast", "tool", "pulse", "ci", "cycles", "cycle", "tune", "showcase",
  "offboard", "pair", "peer",
];

let en = "";
let cn = "";
let root = "";
beforeAll(() => {
  registerAll();
  root = repoRoot();
  en = readFileSync(join(root, "README.md"), "utf8");
  cn = readFileSync(join(root, "README_CN.md"), "utf8");
});

function walkDocs(rel: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkDocs(child));
    else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".js"))) out.push(child);
  }
  return out;
}

function activeDocs(): string[] {
  return [
    "README.md",
    "README_CN.md",
    "site/roll-data.js",
    ...walkDocs("guide/en"),
    ...walkDocs("guide/zh"),
    ...walkDocs("docs"),
  ].sort();
}

describe("FIX-241 — README command tables track the live registry", () => {
  it("every approved public top-level command appears in BOTH READMEs", () => {
    const visible = publicCommands();
    const missingEn = visible.filter((c) => !en.includes(`\`roll ${c}`) && !en.includes(`roll ${c} `));
    const missingCn = visible.filter((c) => !cn.includes(`\`roll ${c}`) && !cn.includes(`roll ${c} `));
    expect(missingEn, `README.md missing: ${missingEn.join(", ")} — update the Commands table`).toEqual([]);
    expect(missingCn, `README_CN.md missing: ${missingCn.join(", ")} — update the 命令 table`).toEqual([]);
  });

  it("README command tables advertise only approved public top-level commands", () => {
    const known = new Set(publicCommands());
    for (const [name, body] of [["README.md", en], ["README_CN.md", cn]] as const) {
      const advertised = [...body.matchAll(/^\| `roll ([a-z-]+)[ <`]/gm)].map((m) => m[1] ?? "");
      const ghosts = advertised.filter((c) => c !== "" && c !== "--version" && !known.has(c));
      expect(ghosts, `${name} advertises unknown commands: ${ghosts.join(", ")}`).toEqual([]);
    }
  });

  it("roll --help and README expose the same public top-level command set", () => {
    const listed = (usage().split("Commands:")[1] ?? "").split("\n")[0]?.trim().split(/,\s*/) ?? [];
    expect(listed).toEqual(publicCommands());
  });

  it("site data carries the same public command list as roll --help", () => {
    const site = readFileSync(join(root, "site/roll-data.js"), "utf8");
    const block = site.match(/const PUBLIC_COMMAND_SURFACE = \[([\s\S]*?)\];/)?.[1] ?? "";
    const listed = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(listed).toEqual(publicCommands().map((c) => `roll ${c}`));
  });

  it("active docs and site data do not re-advertise retired top-level commands", () => {
    const hits: string[] = [];
    for (const rel of activeDocs()) {
      const body = readFileSync(join(root, rel), "utf8");
      const lines = body.split(/\r?\n/);
      for (const retired of RETIRED_TOP_LEVEL) {
        const re = new RegExp("(^|`)roll\\s+" + retired + "(?=$|[\\s`<])");
        for (let i = 0; i < lines.length; i += 1) {
          if (re.test(lines[i] ?? "")) hits.push(`${rel}:${i + 1}: roll ${retired}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
