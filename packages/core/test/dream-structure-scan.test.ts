import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildStaticProjectGraph,
  rankDreamFindings,
  renderDreamStructureLog,
  renderRefactorRows,
  scanDreamStructure,
} from "../src/dream/structure-scan.js";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "roll-dream-structure-"));
  dirs.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
      },
      include: ["src/**/*.ts"],
    }),
    "utf8",
  );
  writeFileSync(
    join(root, "src", "index.ts"),
    [
      "export { liveHelper } from './live.js';",
      "import { liveHelper } from './live.js';",
      "export const current = liveHelper(' Dream ');",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(root, "src", "live.ts"),
    "export function liveHelper(value: string): string { return value.trim(); }\n",
    "utf8",
  );
  writeFileSync(
    join(root, "src", "unused.ts"),
    [
      "export function unusedHelper(value: string): string { return value.toLowerCase(); }",
      "export function impossible(): string {",
      "  if (false) {",
      "    return 'never';",
      "  }",
      "  return 'ok';",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(root, "src", "env.ts"),
    [
      "const dreamAgent = process.env.ROLL_DREAM_AGENT;",
      "export const a = process.env['ROLL_DREAM_AGENT'];",
      "export const b = process?.env?.ROLL_DREAM_AGENT;",
      "const { ROLL_DREAM_AGENT } = process.env;",
      "export const c = `${dreamAgent}:${ROLL_DREAM_AGENT}`;",
      "",
    ].join("\n"),
    "utf8",
  );
  for (const name of ["a", "b", "c"]) {
    writeFileSync(
      join(root, "src", `dup-${name}.ts`),
      [
        `export async function step${name.toUpperCase()}(): Promise<void> {`,
        "  try {",
        "    await runDreamStep();",
        "  } catch (error) {",
        "    appendAlert('dream', error);",
        "  }",
        "}",
        "declare function runDreamStep(): Promise<void>;",
        "declare function appendAlert(scope: string, error: unknown): void;",
        "",
      ].join("\n"),
      "utf8",
    );
  }
  writeFileSync(
    join(root, "src", "port.ts"),
    [
      "interface DreamScannerPort {",
      "  scan(root: string): Promise<string>;",
      "}",
      "export class TypeScriptDreamScanner implements DreamScannerPort {",
      "  async scan(root: string): Promise<string> {",
      "    return root;",
      "  }",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  return root;
}

describe("Dream structure scan", () => {
  it("builds a deterministic TS graph and finds structural Dream candidates", () => {
    const root = fixture();
    const graph = buildStaticProjectGraph({ root });
    const result = scanDreamStructure(graph, {
      envReferenceThreshold: 3,
      duplicateMinimumOccurrences: 3,
      duplicateMinimumNodes: 8,
    });

    expect(result.schema).toBe("dream-structure.v1");
    expect(result.errors).toEqual([]);
    expect(result.graphStats.files).toBeGreaterThanOrEqual(7);
    expect(result.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining([
        "dead_export",
        "unreachable_branch",
        "undocumented_env",
        "duplicate_ast",
        "single_implementation_abstraction",
      ]),
    );
    expect(
      result.findings
        .filter((finding) => finding.kind === "dead_export")
        .map((finding) => finding.title)
        .join("\n"),
    ).toContain("unusedHelper");
    expect(result.findings.find((finding) => finding.kind === "undocumented_env")?.title).toContain("ROLL_DREAM_AGENT");
    expect(result.findings.find((finding) => finding.kind === "unreachable_branch")?.rationale).toContain("literal false");
    expect(result.findings.every((finding) => finding.stableKey.startsWith("dream-structure:"))).toBe(true);

    const ranked = rankDreamFindings(result.findings, 2);
    expect(ranked).toHaveLength(2);

    const log = renderDreamStructureLog(result);
    expect(log).toContain("## Code structure static analysis");
    expect(log).toContain("schema: dream-structure.v1");
    expect(log).toContain("dead_export");

    const rows = renderRefactorRows({ result, existingBacklog: "", date: "2026-06-19" });
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(rows.join("\n")).toContain("dream-structure:");
  });

  it("does not flag a barrel-reexported symbol that has a real consumer", () => {
    const root = fixture();
    const graph = buildStaticProjectGraph({ root });
    const result = scanDreamStructure(graph, { envReferenceThreshold: 99 });

    const deadTitles = result.findings
      .filter((finding) => finding.kind === "dead_export")
      .map((finding) => finding.title)
      .join("\n");
    expect(deadTitles).not.toContain("liveHelper");
  });

  it("degrades loudly when no tsconfig can be found", () => {
    const root = mkdtempSync(join(tmpdir(), "roll-dream-no-tsconfig-"));
    dirs.push(root);

    const graph = buildStaticProjectGraph({ root });
    const result = scanDreamStructure(graph);

    expect(graph.files).toEqual([]);
    expect(result.errors[0]?.message).toContain("tsconfig");
    expect(result.findings).toEqual([]);
  });

  it("deduplicates backlog rows by stable marker", () => {
    const root = fixture();
    const result = scanDreamStructure(buildStaticProjectGraph({ root }), { envReferenceThreshold: 3 });
    const first = renderRefactorRows({ result, existingBacklog: "", date: "2026-06-19" });
    const second = renderRefactorRows({
      result,
      existingBacklog: first.join("\n"),
      date: "2026-06-19",
    });

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
  });

  it("writes valid JSON artifacts without absolute path instability in stable keys", () => {
    const root = fixture();
    const result = scanDreamStructure(buildStaticProjectGraph({ root }), { envReferenceThreshold: 3 });
    const encoded = JSON.stringify(result, null, 2);
    const decoded = JSON.parse(encoded) as typeof result;

    expect(decoded.findings.map((finding) => finding.stableKey)).toEqual(
      result.findings.map((finding) => finding.stableKey),
    );
    expect(readFileSync(join(root, "tsconfig.json"), "utf8")).toContain("src/**/*.ts");
  });
});
