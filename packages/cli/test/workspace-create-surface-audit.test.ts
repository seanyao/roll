import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const textExtensions = new Set([".json", ".md", ".mjs", ".sh", ".ts", ".txt", ".yaml", ".yml"]);
const publicRoots = [
  "README.md",
  "README_CN.md",
  "docs",
  "guide",
  "template",
  "packages/spec/src/i18n/catalog-v3.ts",
  "packages/cli/test/fixtures",
] as const;
const legacyEvidenceAllowlist = new Set([
  "packages/cli/test/fixtures/workspace/us-ws-023-terminal-evidence/transcript.txt",
]);

function files(path: string): readonly string[] {
  const absolute = join(repoRoot, path);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [path];
  const entries = readdirSync(absolute, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? files(child) : [child];
  });
}

function textFiles(paths: readonly string[]): readonly string[] {
  return paths.flatMap(files).filter((path) => textExtensions.has(extname(path)));
}

describe("US-WS-023 public create-only surface audit", () => {
  it("keeps help, docs, fixtures and templates free of the retired create-entry init language", () => {
    const offenders = textFiles(publicRoots).flatMap((path) => {
      if (legacyEvidenceAllowlist.has(path)) return [];
      const text = readFileSync(join(repoRoot, path), "utf8");
      return /roll workspace init|roll\.workspace-init\/v1/u.test(text) ? [path] : [];
    });

    expect(offenders).toEqual([]);
    expect([...legacyEvidenceAllowlist]).toEqual([
      "packages/cli/test/fixtures/workspace/us-ws-023-terminal-evidence/transcript.txt",
    ]);
  });

  it("records that this repository has no shell-completion source to migrate", () => {
    const completionRoots = ["scripts", "packages/cli/src", "template", "conventions"] as const;
    const completionSources = textFiles(completionRoots).filter((path) => {
      const name = path.split("/").at(-1) ?? "";
      return /^(?:_?roll|completion|completions)\.(?:bash|fish|zsh)$/u.test(name) || /^(?:completion|completions)$/u.test(name);
    });

    expect(completionSources, "No completion generator/source is shipped; help and command registries are the canonical discoverability surfaces.")
      .toEqual([]);
  });

  it("keeps the installed skill gitlink on a create-only route manifest", () => {
    const skillsRoot = join(repoRoot, "skills");
    const routes = JSON.parse(readFileSync(join(skillsRoot, "route-cases", "skills.json"), "utf8")) as {
      readonly skills: Readonly<Record<string, unknown>>;
    };
    const skillNames = readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("roll-ws-"))
      .map((entry) => entry.name)
      .sort();

    expect(relative(repoRoot, skillsRoot)).toBe("skills");
    expect(skillNames).toEqual(["roll-ws-create"]);
    expect(routes.skills).toHaveProperty("roll-ws-create");
    expect(routes.skills).not.toHaveProperty("roll-ws-init");
  });
});
