import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  classifyInitState,
  collectInitFacts,
  renderStateMatrixFixture,
  type InitFacts,
} from "../src/lib/init-diagnosis.js";
import { renderInitRecommendation } from "../src/lib/init-diagnosis-render.js";

const dirs: string[] = [];

function project(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `roll-init-diagnosis-${name}-`));
  dirs.push(dir);
  return dir;
}

function write(dir: string, rel: string, text = "x\n"): void {
  const path = join(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function mkdir(dir: string, rel: string): void {
  mkdirSync(join(dir, rel), { recursive: true });
}

function facts(overrides: Partial<InitFacts>): InitFacts {
  return {
    root: "<fixture>",
    git: { present: false, commits: 0 },
    roll: { dotRoll: false, backlog: false, features: false, agentsDoc: false, oldMarkers: [] },
    codebase: { manifests: [], sourceDirs: [], testDirs: [], sourceFileCount: 0 },
    docs: { hasContent: false, prdFiles: [], readmeFiles: [], designDocs: [], extractedSignals: [] },
    ambiguityReasons: [],
    ...overrides,
  };
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("collectInitFacts", () => {
  it("records git-free empty state, docs, codebase signals, and content-scan fields", () => {
    const dir = project("signals");
    write(dir, "package.json", "{\"scripts\":{\"test\":\"vitest\"}}\n");
    write(dir, "src/index.ts", "export const x = 1;\n");
    mkdir(dir, "tests");
    write(dir, "docs/intel-radar-PRD.md", "# Product Requirements\n\nBuild an intelligence radar product.\n");
    write(dir, "README.md", "# Intel Radar\n\nA product for tracking intelligence signals.\n");

    const result = collectInitFacts(dir, {
      contentScan: () => ({ hasContent: true, extractedSignals: ["docs/intel-radar-PRD.md"] }),
    });

    expect(result.roll).toEqual({
      dotRoll: false,
      backlog: false,
      features: false,
      agentsDoc: false,
      oldMarkers: [],
    });
    expect(result.git.present).toBe(false);
    expect(result.codebase.manifests).toEqual(["package.json"]);
    expect(result.codebase.sourceDirs).toEqual(["src"]);
    expect(result.codebase.testDirs).toEqual(["tests"]);
    expect(result.codebase.sourceFileCount).toBe(1);
    expect(result.docs.prdFiles).toEqual(["docs/intel-radar-PRD.md"]);
    expect(result.docs.readmeFiles).toEqual(["README.md"]);
    expect(result.docs.hasContent).toBe(true);
    expect(result.docs.extractedSignals).toEqual(["docs/intel-radar-PRD.md"]);
  });

  it("short-circuits content scans for current Roll marker states", () => {
    const ready = project("ready-short-circuit");
    mkdir(ready, ".roll/features");
    write(ready, ".roll/backlog.md", "# Backlog\n");
    write(ready, "AGENTS.md", "# Agents\n");
    mkdir(ready, "src");

    const readyResult = collectInitFacts(ready, {
      contentScan: () => {
        throw new Error("content scan should not run for complete Roll projects");
      },
    });
    expect(classifyInitState(readyResult).kind).toBe("roll-ready");

    const partial = project("partial-short-circuit");
    write(partial, ".roll/backlog.md", "# Backlog\n");
    mkdir(partial, "src");

    const partialResult = collectInitFacts(partial, {
      contentScan: () => {
        throw new Error("content scan should not run for partial Roll projects");
      },
    });
    expect(classifyInitState(partialResult).kind).toBe("roll-partial");
  });

  it("short-circuits content scans for pre-v2 Roll layout markers", () => {
    const dir = project("legacy-short-circuit");
    write(dir, "BACKLOG.md", "# Old backlog\n");
    mkdir(dir, "docs/features");

    const result = collectInitFacts(dir, {
      contentScan: () => {
        throw new Error("content scan should not run for old Roll layout markers");
      },
    });

    expect(classifyInitState(result).kind).toBe("roll-legacy-layout");
  });

  it("detects pre-v2 Roll layout markers separately from business codebase markers", () => {
    const dir = project("legacy-roll");
    write(dir, "BACKLOG.md", "# Old backlog\n");
    mkdir(dir, "docs/features");

    const result = collectInitFacts(dir);

    expect(result.roll.oldMarkers).toEqual(["BACKLOG.md", "docs/features/"]);
    expect(result.codebase.manifests).toEqual([]);
    expect(result.codebase.sourceFileCount).toBe(0);
  });

  it("does not treat empty source/test dirs or git history as codebase signals", () => {
    const dir = project("empty-shell");
    mkdir(dir, "src");
    mkdir(dir, "tests");

    const result = collectInitFacts(dir);

    expect(result.codebase.sourceDirs).toEqual(["src"]);
    expect(result.codebase.testDirs).toEqual(["tests"]);
    expect(result.codebase.sourceFileCount).toBe(0);
    expect(classifyInitState(result).kind).toBe("empty");
    expect(classifyInitState(facts({ git: { present: true, commits: 1 } })).kind).toBe("empty");
  });

  it("does not treat ordinary design/domain docs as pre-v2 Roll layout markers", () => {
    const dir = project("ordinary-design-docs");
    write(dir, "docs/design/api.md", "# API Design\n\nDesign notes for this product service.\n");
    write(dir, "docs/domain/model.md", "# Domain Model\n\nProduct domain notes and requirements.\n");

    const result = collectInitFacts(dir);

    expect(result.roll.oldMarkers).toEqual([]);
    expect(classifyInitState(result).kind).toBe("prd-only");
  });

  it("caps large source and document candidate scans before reading entire directories", () => {
    const dir = project("large-candidate-caps");
    for (let i = 0; i < 520; i += 1) write(dir, `src/empty-${String(i).padStart(3, "0")}.ts`, "");
    for (let i = 0; i < 70; i += 1) write(dir, `docs/note-${String(i).padStart(3, "0")}.md`, "short\n");

    const result = collectInitFacts(dir, {
      contentScan: () => ({ hasContent: false, extractedSignals: [] }),
    });

    expect(result.ambiguityReasons).toContain("source directory scan capped at 512 entries: src/");
    expect(result.ambiguityReasons).toContain("document candidate scan capped at 64 entries: docs/");
    expect(classifyInitState(result).kind).toBe("ambiguous");
  });
});

describe("classifyInitState", () => {
  it("covers the full init state matrix", () => {
    const matrix = [
      [
        "roll-ready",
        facts({ roll: { dotRoll: true, backlog: true, features: true, agentsDoc: true, oldMarkers: [] } }),
        "already-ready",
      ],
      [
        "roll-partial",
        facts({ roll: { dotRoll: true, backlog: true, features: false, agentsDoc: false, oldMarkers: [] } }),
        "repair-roll",
      ],
      [
        "roll-legacy-layout",
        facts({ roll: { dotRoll: false, backlog: false, features: false, agentsDoc: false, oldMarkers: ["BACKLOG.md"] } }),
        "migrate-roll-layout",
      ],
      [
        "codebase-no-roll",
        facts({ codebase: { manifests: ["package.json"], sourceDirs: ["src"], testDirs: ["test"], sourceFileCount: 3 } }),
        "agentic-onboard",
      ],
      [
        "prd-only",
        facts({ docs: { hasContent: true, prdFiles: ["docs/PRD.md"], readmeFiles: [], designDocs: [], extractedSignals: ["docs/PRD.md"] } }),
        "scaffold-from-prd",
      ],
      ["empty", facts({}), "guided-brief"],
      ["ambiguous", facts({ ambiguityReasons: ["README.md exists but has no project intent"] }), "agentic-onboard"],
    ] as const;

    for (const [kind, input, path] of matrix) {
      const diagnosis = classifyInitState(input);
      expect(diagnosis.kind).toBe(kind);
      expect(diagnosis.recommendedPath).toBe(path);
    }
  });

  it("classifies PRD/spec/docs-only workspaces as prd-only, never legacy or codebase", () => {
    const diagnosis = classifyInitState(
      facts({
        docs: {
          hasContent: true,
          prdFiles: ["docs/intel-radar-PRD.md"],
          readmeFiles: [],
          designDocs: [],
          extractedSignals: ["docs/intel-radar-PRD.md"],
        },
      }),
    );

    expect(diagnosis.kind).toBe("prd-only");
    expect(diagnosis.recommendedPath).toBe("scaffold-from-prd");
    expect(diagnosis.reasons.join("\n")).not.toMatch(/legacy|codebase/i);
  });

  it("detects Roll-ready and partial Roll projects before fresh scaffold paths", () => {
    expect(
      classifyInitState(
        facts({
          roll: { dotRoll: true, backlog: false, features: false, agentsDoc: false, oldMarkers: [] },
          docs: { hasContent: true, prdFiles: ["docs/PRD.md"], readmeFiles: [], designDocs: [], extractedSignals: ["docs/PRD.md"] },
        }),
      ).kind,
    ).toBe("roll-partial");
  });
});

describe("init diagnosis rendering", () => {
  it("renders the ready, partial, and legacy routes without applying anything", () => {
    const ready = renderInitRecommendation(
      classifyInitState(facts({ roll: { dotRoll: true, backlog: true, features: true, agentsDoc: true, oldMarkers: [] } })),
      "en",
    );
    const partial = renderInitRecommendation(
      classifyInitState(facts({ roll: { dotRoll: true, backlog: true, features: false, agentsDoc: false, oldMarkers: [] } })),
      "en",
    );
    const legacy = renderInitRecommendation(
      classifyInitState(facts({ roll: { dotRoll: false, backlog: false, features: false, agentsDoc: false, oldMarkers: ["BACKLOG.md"] } })),
      "en",
    );

    expect(ready).toContain("Already initialized");
    expect(ready).toContain("Next: roll status");
    expect(partial).toContain("Recommended path: repair-roll");
    expect(partial).toContain("No files changed");
    expect(legacy).toContain("Recommended path: migrate-roll-layout");
    expect(legacy).toContain("No files changed");
  });

  it("renders the hidden state-matrix fixture deterministically", () => {
    expect(renderStateMatrixFixture("en")).toMatchSnapshot();
  });
});
