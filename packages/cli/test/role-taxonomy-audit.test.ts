import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const SCRIPT = join(ROOT, "scripts/audit-role-taxonomy.mjs");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "roll-role-taxonomy-"));
  dirs.push(dir);
  return dir;
}

function run(root: string): { ok: boolean; output: string } {
  try {
    return {
      ok: true,
      output: execFileSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    };
  } catch (error) {
    const e = error as { stdout?: Buffer | string; stderr?: Buffer | string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("role taxonomy no-tail audit", () => {
  it("fails on retired active terms in active docs", () => {
    const root = tmpRoot();
    writeFileSync(join(root, "README.md"), "Prime Agent is active here\n");

    const result = run(root);

    expect(result.ok).toBe(false);
    expect(result.output).toContain("retired active role: Prime Agent");
  });

  it("fails on default role-identity exclusions in active config examples", () => {
    const root = tmpRoot();
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts/example.md"), "avoid: [supervise]\n");

    const result = run(root);

    expect(result.ok).toBe(false);
    expect(result.output).toContain("default role exclusion: avoid supervise");
  });

  it("allows intentional migration examples and fail-loud legacy errors", () => {
    const root = tmpRoot();
    mkdirSync(join(root, "docs/migration"), { recursive: true });
    mkdirSync(join(root, "packages/core/src/agent"), { recursive: true });
    writeFileSync(join(root, "docs/migration/role-taxonomy-v4.md"), "`planned` and planner-contract.md are shown only as old config examples\n");
    writeFileSync(
      join(root, "packages/core/src/agent/config-v4.ts"),
      'errors.push("execution_profiles.planned: legacy profile key removed; use execution_profiles.designed");\n',
    );

    const result = run(root);

    expect(result.ok).toBe(true);
    expect(result.output).toContain("role-taxonomy audit: ok");
  });
});
