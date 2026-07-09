/**
 * FIX-339 (AC7) — `roll story validate <ID>`: the command-side self-check of the
 * must-declare + visual-evidence contract (the AC6 hard闸 prefilled for roll-design).
 * Exit 0 = ok / exempt / must-declare soft warning; non-zero = not ok (缺可视 AC).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { storyValidateCommand } from "../src/commands/story-validate.js";
import { renderState } from "../src/render.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

beforeEach(() => {
  renderState.useColor = false; // deterministic, ansi-free assertions
});

/** A project with one card spec under `features/<epic>/<id>/spec.md`. */
function project(id: string, epic: string, specText: string): string {
  const p = realpathSync(mkdtempSync(join(tmpdir(), "roll-storyvalidate-")));
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

describe("roll story validate — FIX-339 AC7", () => {
  it("a card with a declared deliverable_url + a web visual-evidence AC ⇒ ok (exit 0)", () => {
    const p = project(
      "FIX-V1",
      "cli-visual",
      "---\nid: FIX-V1\ndeliverable_url: https://app.test/casting\n---\n# FIX-V1\n\n## Acceptance Criteria\n\n- [ ] the web page renders a screenshot of the casting view\n",
    );
    const r = run(p, ["FIX-V1"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("✓");
    expect(r.out).toContain("must-declare:");
    expect(r.out).toContain("ok");
  });

  it("a card declaring deliverable_cmd + a terminal visual-evidence AC ⇒ ok (exit 0)", () => {
    const p = project(
      "FIX-V2",
      "cli-visual",
      "---\nid: FIX-V2\ndeliverable_cmd: roll backlog\n---\n# FIX-V2\n\n## Acceptance Criteria\n\n- [ ] terminal screenshot of `roll backlog` CLI output\n",
    );
    const r = run(p, ["FIX-V2"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("✓");
  });

  it("REFACTOR-076: a non-exempt terminal card declaring NO surface ⇒ WARN only (exit 0)", () => {
    const p = project("FIX-V3", "cli-visual", "# FIX-V3 — CLI polish\n\n## Acceptance Criteria\n\n- [ ] terminal screenshot of `roll status` shows the new summary line\n");
    const r = run(p, ["FIX-V3"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("✓");
    expect(r.out).toContain("缺声明面");
    expect(r.out).toContain("no deliverable surface declared");
    expect(r.out).toContain("warning");
  });

  it("a card with a declared web url but NO visual-evidence AC ⇒ FAIL (缺可视 AC)", () => {
    const p = project(
      "FIX-V4",
      "cli-visual",
      "---\nid: FIX-V4\ndeliverable_url: https://app.test/x\n---\n# FIX-V4\n\n## Acceptance Criteria\n\n- [ ] the data migrates correctly\n",
    );
    const r = run(p, ["FIX-V4"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("缺可视 AC");
  });

  it("an exempt card (per-card screenshot_exempt) ⇒ ok (exit 0), contract waived", () => {
    const p = project(
      "FIX-V5",
      "cli-visual",
      "---\nid: FIX-V5\nscreenshot_exempt: pure data migration; no rendered surface; substitute evidence = migration checksum tests\n---\n# FIX-V5\n\n## Acceptance Criteria\n\n- [ ] rows migrate\n",
    );
    const r = run(p, ["FIX-V5"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("exempt");
  });

  it("an epic-deny-list exempt card (no per-card frontmatter) ⇒ ok (epic-aware)", () => {
    const p = project("FIX-V6", "data-migration", "# FIX-V6 — migrate rows\n\n## Acceptance Criteria\n\n- [ ] rows migrate\n");
    writeFileSync(join(p, ".roll", "policy.yaml"), "acceptance:\n  screenshot_exempt_epics:\n    - data-migration\n");
    const r = run(p, ["FIX-V6"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("exempt");
  });

  it("an unknown story id (no spec) ⇒ exit 2", () => {
    const p = project("FIX-V7", "cli-visual", "# x\n");
    const r = run(p, ["US-MISSING-1"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("no spec found");
  });

  it("a malformed id ⇒ exit 2", () => {
    const p = project("FIX-V8", "cli-visual", "# x\n");
    const r = run(p, ["not-an-id"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("not a story id");
  });

  it("--help prints usage and exits 0", () => {
    const p = project("FIX-V9", "cli-visual", "# x\n");
    const r = run(p, ["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("roll story validate");
  });

  it("FIX-340 — a DUPLICATE id ⇒ exit 2 with a clean error (no stack trace, no silent wrong-spec)", () => {
    const p = project("US-DUP-001", "autonomous-evolution", "# legacy\n");
    // second home for the same id in a different epic ⇒ ambiguous resolution.
    const dir = join(p, ".roll", "features", "loop-engine", "US-DUP-001");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spec.md"), "# active\n");
    const r = run(p, ["US-DUP-001"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("duplicate story id");
    expect(r.err).toContain("US-DUP-001");
    expect(r.err).toContain("解析到多份 spec");
  });
});
