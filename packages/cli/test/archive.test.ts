/**
 * US-META-001 — archive-layout helpers: ID→epic index (pure build + deterministic
 * serialize), live epic resolution + uncategorized fallback, card-dir write path,
 * and the old-layout read compat resolver.
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { indexCommand } from "../src/commands/index-gen.js";
import {
  buildStoryIndex,
  cardArchiveDir,
  epicForStory,
  generateIndex,
  liveEpicOf,
  readIndex,
  reportFileName,
  resolveReadArchiveDir,
  serializeIndex,
} from "../src/lib/archive.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function project(rows: string[], features: Array<[string, string]> = []): string {
  const proj = mkdtempSync(join(tmpdir(), "roll-archive-"));
  dirs.push(proj);
  mkdirSync(join(proj, ".roll"), { recursive: true });
  const head = ["| Story | Description | Status |", "|---|---|---|"];
  writeFileSync(join(proj, ".roll", "backlog.md"), [...head, ...rows].join("\n") + "\n");
  for (const [rel, body] of features) {
    const p = join(proj, ".roll", "features", rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
  }
  return proj;
}

describe("buildStoryIndex", () => {
  it("records only stories the resolver can place; omits the rest", () => {
    const epicOf = (id: string): string | null => (id === "US-A-1" ? "alpha" : id === "FIX-B-2" ? "beta" : null);
    const idx = buildStoryIndex(["US-A-1", "FIX-B-2", "US-C-3"], epicOf);
    expect(idx).toEqual({ "US-A-1": "alpha", "FIX-B-2": "beta" });
    expect(idx["US-C-3"]).toBeUndefined();
  });
});

describe("serializeIndex", () => {
  it("is deterministic: sorted keys, byte-identical regardless of insertion order", () => {
    const a = serializeIndex({ "US-Z-9": "z", "US-A-1": "a" });
    const b = serializeIndex({ "US-A-1": "a", "US-Z-9": "z" });
    expect(a).toBe(b);
    expect(a.indexOf("US-A-1")).toBeLessThan(a.indexOf("US-Z-9"));
    expect(a.endsWith("\n")).toBe(true);
    expect(JSON.parse(a)).toEqual({ stories: { "US-A-1": "a", "US-Z-9": "z" } });
  });
});

describe("reportFileName", () => {
  it("carries the card id", () => {
    expect(reportFileName("US-META-001")).toBe("US-META-001-report.html");
  });
});

describe("liveEpicOf", () => {
  it("resolves the epic from the feature file's directory", () => {
    const proj = project(["| US-A-1 | x | 📋 Todo |"], [["alpha/US-A-1.md", "# US-A-1\n"]]);
    expect(liveEpicOf(proj, "US-A-1")).toBe("alpha");
  });
  it("returns null when no feature file exists (→ uncategorized at call site)", () => {
    const proj = project(["| US-A-1 | x | 📋 Todo |"]);
    expect(liveEpicOf(proj, "US-A-1")).toBeNull();
  });
});

describe("generateIndex", () => {
  it("writes .roll/index.json from backlog, idempotent (byte-identical re-run)", () => {
    const proj = project(
      ["| US-A-1 | x | 📋 Todo |", "| FIX-B-2 | y | ✅ Done |", "| US-C-3 | z | 📋 Todo |"],
      [["alpha/US-A-1.md", "# US-A-1\n"], ["beta/FIX-B-2.md", "# FIX-B-2\n"]],
    );
    const first = generateIndex(proj);
    expect(first).toEqual({ "US-A-1": "alpha", "FIX-B-2": "beta" }); // US-C-3 unplaceable → omitted
    const onDisk1 = readFileSync(join(proj, ".roll", "index.json"), "utf8");
    generateIndex(proj);
    const onDisk2 = readFileSync(join(proj, ".roll", "index.json"), "utf8");
    expect(onDisk2).toBe(onDisk1); // idempotent
    expect(readIndex(proj)).toEqual({ "US-A-1": "alpha", "FIX-B-2": "beta" });
  });
});

describe("epicForStory", () => {
  it("prefers the authoritative index over a live walk", () => {
    const proj = project(["| US-A-1 | x | 📋 Todo |"], [["alpha/US-A-1.md", "# US-A-1\n"]]);
    writeFileSync(join(proj, ".roll", "index.json"), serializeIndex({ "US-A-1": "pinned" }));
    expect(epicForStory(proj, "US-A-1")).toBe("pinned");
  });
  it("falls back to the live walk when the index has no entry", () => {
    const proj = project(["| US-A-1 | x | 📋 Todo |"], [["alpha/US-A-1.md", "# US-A-1\n"]]);
    expect(epicForStory(proj, "US-A-1")).toBe("alpha");
  });
});

describe("cardArchiveDir", () => {
  it("places a resolved story under features/<epic>/<ID>", () => {
    const proj = project(["| US-A-1 | x | 📋 Todo |"], [["alpha/US-A-1.md", "# US-A-1\n"]]);
    expect(cardArchiveDir(proj, "US-A-1")).toBe(join(proj, ".roll", "features", "alpha", "US-A-1"));
  });
  it("falls back to features/uncategorized/<ID> when no epic resolves (never blocks)", () => {
    const proj = project(["| US-A-1 | x | 📋 Todo |"]);
    expect(cardArchiveDir(proj, "US-NOPE-9")).toBe(join(proj, ".roll", "features", "uncategorized", "US-NOPE-9"));
  });
});

describe("roll index command", () => {
  it("regenerates .roll/index.json from the cwd project", () => {
    const proj = project(["| US-A-1 | x | 📋 Todo |"], [["alpha/US-A-1.md", "# US-A-1\n"]]);
    const save = process.cwd();
    process.chdir(proj);
    const o = process.stdout.write.bind(process.stdout);
    // @ts-expect-error capture-only
    process.stdout.write = (): boolean => true;
    try {
      expect(indexCommand([])).toBe(0);
    } finally {
      process.stdout.write = o;
      process.chdir(save);
    }
    expect(existsSync(join(proj, ".roll", "index.json"))).toBe(true);
    expect(readIndex(proj)).toEqual({ "US-A-1": "alpha" });
  });
});

describe("resolveReadArchiveDir (US-META-002 retires this compat)", () => {
  it("prefers the new card folder when present", () => {
    const proj = project(["| US-A-1 | x | 📋 Todo |"], [["alpha/US-A-1.md", "# US-A-1\n"]]);
    mkdirSync(join(proj, ".roll", "features", "alpha", "US-A-1"), { recursive: true });
    expect(resolveReadArchiveDir(proj, "US-A-1")).toEqual({
      dir: join(proj, ".roll", "features", "alpha", "US-A-1"),
      layout: "card",
    });
  });
  it("falls back to the legacy verification/<ID> tree (already-delivered cards stay readable)", () => {
    const proj = project(["| US-A-1 | x | 📋 Todo |"], [["alpha/US-A-1.md", "# US-A-1\n"]]);
    mkdirSync(join(proj, ".roll", "verification", "US-A-1"), { recursive: true });
    expect(resolveReadArchiveDir(proj, "US-A-1")).toEqual({
      dir: join(proj, ".roll", "verification", "US-A-1"),
      layout: "legacy",
    });
  });
  it("null when neither layout exists", () => {
    const proj = project(["| US-A-1 | x | 📋 Todo |"]);
    expect(resolveReadArchiveDir(proj, "US-A-1")).toBeNull();
  });
});
