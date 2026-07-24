import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const skillPath = join(repoRoot, "skills", "roll-ws-init", "SKILL.md");
const routeCasesPath = join(repoRoot, "skills", "route-cases", "skills.json");

function shellBlocks(text: string): readonly string[] {
  return [...text.matchAll(/```(?:bash|sh)\n([\s\S]*?)```/gu)].map((match) => match[1]?.trim() ?? "");
}

describe("US-WS-006 roll-ws-init static mutation contract", () => {
  it("delegates preview and apply to the CLI without executable filesystem or Git fallbacks", () => {
    const skill = readFileSync(skillPath, "utf8");
    const commands = shellBlocks(skill);

    expect(commands).toContain("roll workspace init ws-demo --config /absolute/path/workspace-init.yaml --check --json");
    expect(commands).toContain("roll workspace init ws-demo --config /absolute/path/workspace-init.yaml --json");
    expect(commands.join("\n")).not.toMatch(/(?:^|\n)\s*(?:mkdir|touch|cp|git\s+(?:clone|init|worktree))\b/u);

    expect(skill).toMatch(/Never create Workspace directories or files with `mkdir`, `touch`, `cp`,/u);
    expect(skill).toMatch(/Never run `git clone`, `git init`, `git worktree`, or edit cache paths/u);
    expect(skill).toMatch(/Never edit `\$ROLL_HOME\/workspaces\.json`, lifecycle events, cache identity\s+files, locks, or repair journals directly\./u);
    expect(skill).toMatch(/Never fall back to hand-written layout creation when the CLI rejects or fails\./u);
  });

  it("keeps lifecycle, Issue worktrees and historical migration outside the init skill", () => {
    const skill = readFileSync(skillPath, "utf8");
    const commands = shellBlocks(skill);

    expect(skill).toContain("Initialization creates Workspace authorities and repository bindings; it does not activate the Workspace.");
    expect(skill).toContain("Use `roll workspace issue init` after initialization for Story repository worktrees.");
    expect(skill).toContain("Use `roll workspace migrate` for a historical repository-local Roll project.");
    expect(commands.join("\n")).not.toMatch(/roll workspace (?:activate|issue|migrate)/u);
  });

  it("routes multi-repository init to roll-ws-init and rejects neighboring responsibilities", () => {
    const routes = JSON.parse(readFileSync(routeCasesPath, "utf8")) as {
      readonly skills: Record<string, { readonly positive: readonly string[]; readonly negative: readonly string[] }>;
    };
    const cases = routes.skills["roll-ws-init"];

    expect(cases?.positive).toContain("preview and initialize a multi-repository Roll Workspace from versioned bindings");
    expect(cases?.negative).toContain("migrate a historical repository-local Roll project into Workspace scope");
    expect(cases?.negative).toContain("activate pause or archive an already registered Workspace");
  });
});
