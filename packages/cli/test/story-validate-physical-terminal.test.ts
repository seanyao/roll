/**
 * US-INIT-003a — `roll story validate` recognizes `physical_terminal:` frontmatter
 * as a declared terminal surface when paired with a visual-evidence AC.
 *
 * AC1: validate recognizes physical_terminal as a declared terminal surface.
 * AC2: physical_terminal with valid fields passes without screenshot_exempt.
 * AC3: existing web/read-only CLI cards continue to pass (regression corpus).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { storyValidateCommand } from "../src/commands/story-validate.js";
import { parsePhysicalTerminalSpec } from "../src/lib/physical-terminal.js";
import { renderState } from "../src/render.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

beforeEach(() => {
  renderState.useColor = false;
});

function project(id: string, epic: string, specText: string): string {
  const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-storyvalidate-physical-")));
  dirs.push(p);
  const dir = join(p, ".roll", "features", epic, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.md"), specText);
  return p;
}

function run(p: string, args: string[]): { code: number; out: string; err: string } {
  const save = process.cwd();
  process.chdir(p);
  let out = "";
  let err = "";
  const w = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture
  process.stdout.write = (s: string): boolean => ((out += String(s)), true);
  // @ts-expect-error capture
  process.stderr.write = (s: string): boolean => ((err += String(s)), true);
  try {
    return { code: storyValidateCommand(args), out, err };
  } finally {
    process.stdout.write = w;
    process.stderr.write = e;
    process.chdir(save);
  }
}

function physicalTerminalSpec(id: string): string {
  return [
    "---",
    `id: ${id}`,
    "physical_terminal:",
    "  app: Terminal.app",
    "  command: roll doctor --tools",
    "  evidence: screenshot",
    "---",
    "",
    `# ${id} — Physical Terminal evidence`,
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] [visual-evidence] real physical Terminal.app screenshot proves the CLI output",
    "",
  ].join("\n");
}

describe("US-INIT-003a — roll story validate recognizes physical_terminal", () => {
  // AC1: validate recognizes physical_terminal as a declared terminal surface
  it("AC1: a card with physical_terminal and [visual-evidence] AC passes validation (exit 0)", () => {
    const p = project("US-PHYS-OK", "init-onboard", physicalTerminalSpec("US-PHYS-OK"));
    const r = run(p, ["US-PHYS-OK"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/✓ story validate.*US-PHYS-OK/);
    expect(r.out).toMatch(/must-declare:\s+ok/);
    expect(r.out).toMatch(/visual-evidence:\s+ok.*surface.*terminal/);
  });

  // AC2: physical_terminal with valid fields passes without screenshot_exempt
  it("AC2: physical_terminal passes without screenshot_exempt — the terminal declaration suffices", () => {
    // No screenshot_exempt in the frontmatter; the physical_terminal block alone
    // must satisfy both must-declare and visual-evidence.
    const p = project("US-PHYS-NOEXEMPT", "init-onboard", physicalTerminalSpec("US-PHYS-NOEXEMPT"));
    const r = run(p, ["US-PHYS-NOEXEMPT"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/screenshot_exempt/);
    expect(r.out).toMatch(/✓ story validate.*US-PHYS-NOEXEMPT/);
    expect(r.out).toMatch(/must-declare:\s+ok/);
    expect(r.out).toMatch(/visual-evidence:\s+ok/);
  });

  it("AC2: invalid physical_terminal (missing command) fails validation", () => {
    const spec = [
      "---",
      "id: US-PHYS-BAD",
      "physical_terminal:",
      "  app: Terminal.app",
      "  evidence: screenshot",
      "---",
      "",
      "# US-PHYS-BAD",
      "",
      "## Acceptance Criteria",
      "",
      "- [ ] [visual-evidence] terminal screenshot",
      "",
    ].join("\n");
    const p = project("US-PHYS-BAD", "init-onboard", spec);
    const r = run(p, ["US-PHYS-BAD"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/physical-terminal-invalid/);
    expect(r.out).toMatch(/command is required/);
  });

  it("FIX-1263: scalar physical_terminal fails loud instead of becoming absent", () => {
    const spec = [
      "---",
      "id: US-PHYS-SCALAR",
      "physical_terminal: required",
      "---",
      "",
      "# US-PHYS-SCALAR",
      "",
      "## Acceptance Criteria",
      "",
      "- [ ] [visual-evidence] terminal screenshot",
      "",
    ].join("\n");
    expect(parsePhysicalTerminalSpec(spec)).toEqual({
      kind: "invalid",
      reason: "physical_terminal must be a mapping",
    });

    const p = project("US-PHYS-SCALAR", "init-onboard", spec);
    const r = run(p, ["US-PHYS-SCALAR"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/physical-terminal-invalid/);
    expect(r.out).toMatch(/must be a mapping/);
  });

  it("AC2: invalid physical_terminal (non-Terminal.app) fails validation", () => {
    const spec = [
      "---",
      "id: US-PHYS-BAD2",
      "physical_terminal:",
      "  app: iTerm.app",
      "  command: roll doctor --tools",
      "  evidence: screenshot",
      "---",
      "",
      "# US-PHYS-BAD2",
      "",
      "## Acceptance Criteria",
      "",
      "- [ ] [visual-evidence] terminal screenshot",
      "",
    ].join("\n");
    const p = project("US-PHYS-BAD2", "init-onboard", spec);
    const r = run(p, ["US-PHYS-BAD2"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/physical-terminal-invalid/);
    expect(r.out).toMatch(/Terminal\.app/);
  });

  it("AC2: physical_terminal with non-allowlisted command fails validation", () => {
    const spec = [
      "---",
      "id: US-PHYS-BAD3",
      "physical_terminal:",
      "  app: Terminal.app",
      "  command: rm -rf /",
      "  evidence: screenshot",
      "---",
      "",
      "# US-PHYS-BAD3",
      "",
      "## Acceptance Criteria",
      "",
      "- [ ] [visual-evidence] terminal screenshot",
      "",
    ].join("\n");
    const p = project("US-PHYS-BAD3", "init-onboard", spec);
    const r = run(p, ["US-PHYS-BAD3"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/deliverable-cmd-rejected/);
  });

  // AC3: existing web/read-only CLI cards continue to pass (regression)
  it("AC3: web card with deliverable_url still passes", () => {
    const spec = [
      "---",
      "id: US-WEB-OK",
      "deliverable_url: https://app.test/casting",
      "---",
      "",
      "# US-WEB-OK",
      "",
      "## Acceptance Criteria",
      "",
      "- [ ] the web page renders a screenshot of the casting view",
      "",
    ].join("\n");
    const p = project("US-WEB-OK", "web-features", spec);
    const r = run(p, ["US-WEB-OK"]);
    expect(r.code).toBe(0);
  });

  it("AC3: CLI card with deliverable_cmd still passes", () => {
    const spec = [
      "---",
      "id: US-CLI-OK",
      "deliverable_cmd: roll status",
      "---",
      "",
      "# US-CLI-OK",
      "",
      "## Acceptance Criteria",
      "",
      "- [ ] terminal screenshot of `roll status` CLI output shows correct state",
      "",
    ].join("\n");
    const p = project("US-CLI-OK", "cli-features", spec);
    const r = run(p, ["US-CLI-OK"]);
    expect(r.code).toBe(0);
  });

  it("AC3: screenshot_exempt card still passes", () => {
    const spec = [
      "---",
      "id: US-EXEMPT-OK",
      "screenshot_exempt: pure data migration, no visible surface; substitute evidence = migration checksum tests",
      "---",
      "",
      "# US-EXEMPT-OK",
      "",
      "## Acceptance Criteria",
      "",
      "- [ ] data migrated correctly",
      "",
    ].join("\n");
    const p = project("US-EXEMPT-OK", "data-migration", spec);
    const r = run(p, ["US-EXEMPT-OK"]);
    expect(r.code).toBe(0);
  });

  it("AC3: existing story-validate test parity — no false-negatives on known-good patterns", () => {
    // The same patterns from story-validate.test.ts must still pass.
    const p = project(
      "FIX-V1",
      "cli-visual",
      "---\nid: FIX-V1\ndeliverable_url: https://app.test/casting\n---\n# FIX-V1\n\n## Acceptance Criteria\n\n- [ ] the web page renders a screenshot of the casting view\n",
    );
    const r = run(p, ["FIX-V1"]);
    expect(r.code).toBe(0);
  });
});
