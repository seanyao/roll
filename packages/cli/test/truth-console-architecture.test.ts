import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../../..");

const DIRECT_PANEL_COLLECTORS = [
  { field: "skills", collector: "collectSkillsPanel" },
  { field: "charter", collector: "collectCharter" },
  { field: "casting", collector: "collectCasting" },
  { field: "gitHooks", collector: "collectGitHooks" },
  { field: "liveFeed", collector: "collectLoopLiveFeed" },
] as const;

function renderTruthConsoleObjects(source: string): string[] {
  const out: string[] = [];
  const call = "renderTruthConsole(";
  let searchFrom = 0;
  while (true) {
    const callIndex = source.indexOf(call, searchFrom);
    if (callIndex < 0) return out;
    const open = source.indexOf("{", callIndex + call.length);
    if (open < 0) return out;
    let depth = 0;
    let quote: "\"" | "'" | "`" | undefined;
    let escaped = false;
    for (let i = open; i < source.length; i++) {
      const ch = source[i]!;
      if (quote !== undefined) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === quote) {
          quote = undefined;
        }
        continue;
      }
      if (ch === "\"" || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          out.push(source.slice(open, i + 1));
          searchFrom = i + 1;
          break;
        }
      }
    }
    if (searchFrom <= callIndex) return out;
  }
}

function snapshotProjectionViolations(source: string): string[] {
  return renderTruthConsoleObjects(source).flatMap((objectSource) =>
    DIRECT_PANEL_COLLECTORS.flatMap(({ field, collector }) => {
      const pattern = new RegExp(`\\b${field}\\s*:\\s*${collector}\\s*\\(`);
      return pattern.test(objectSource) ? [`${field}:${collector}`] : [];
    }),
  );
}

function projectConsoleRenderSource(source: string): string {
  const marker = "join(featuresDir, \"index.html\"),";
  const start = source.indexOf(marker);
  if (start < 0) return "";
  return renderTruthConsoleObjects(source.slice(start))[0] ?? "";
}

describe("US-OBS-030 — truth console architecture guard", () => {
  it("AC1/AC3: index-gen renders project panels only from snapshot-derived inputs", () => {
    const source = readFileSync(resolve(REPO_ROOT, "packages/cli/src/commands/index-gen.ts"), "utf8");

    expect(snapshotProjectionViolations(projectConsoleRenderSource(source))).toEqual([]);
  });

  it("AC2: the guard fails on a direct panel collector red sample", () => {
    const redSample = `
      writeFileSync("index.html", renderTruthConsole({
        snapshot,
        snapshotJson,
        skills: collectSkillsPanel(cwd),
        charter: collectCharter(defaultCharterDeps(cwd, renderMarkdown)),
        casting: collectCasting(defaultCastingDeps(cwd)),
        gitHooks: collectGitHooks(defaultGitHooksDeps(cwd)),
        liveFeed: collectLoopLiveFeed(cwd)
      }));
    `;

    expect(snapshotProjectionViolations(redSample)).toEqual([
      "skills:collectSkillsPanel",
      "charter:collectCharter",
      "casting:collectCasting",
      "gitHooks:collectGitHooks",
      "liveFeed:collectLoopLiveFeed",
    ]);
  });
});
