/**
 * US-DOSSIER-036 — `roll skills` first-class audit + sync surface.
 *
 * AC1: `roll skills audit` reports skills · violations · hub lines + the four
 *      invocation groups; `roll skills sync` writes the catalog; both appear in
 *      `roll skills --help`.
 * AC2: the legacy generate/gen + check callers still work, install-tree skip too.
 * AC5/AC7: `--json` emits the SAME computation as the human audit view.
 * AC6: `--json` on a subcommand that does not support it fails loud (exit 1).
 *
 * The audit/sync read a fabricated ROLL_PKG_DIR whose skills/ tree is fixed, so
 * the numbers are deterministic regardless of the repo's real skill catalog.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { skillsCommand } from "../src/commands/skills.js";
import type { SkillsPanelVM } from "../src/lib/skills-panel.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

const ENV_KEYS = ["NO_COLOR", "ROLL_LANG", "LC_ALL", "LANG", "ROLL_PKG_DIR"];

function run(args: string[], env: Record<string, string>): Run {
  const save: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) save[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  process.env["NO_COLOR"] = "1";
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const out: string[] = [];
  const errs: string[] = [];
  const so = process.stdout.write.bind(process.stdout);
  const se = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (out.push(String(c)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (c: string | Uint8Array): boolean => (errs.push(String(c)), true);
  let status: number;
  try {
    status = skillsCommand(args);
  } finally {
    process.stdout.write = so;
    process.stderr.write = se;
    for (const k of ENV_KEYS) {
      const v = save[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return { status, stdout: out.join(""), stderr: errs.join("") };
}

/** A pkg whose skills/ tree carries two skills (one clean, one with violations). */
function pkg(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-d036-skills-"));
  dirs.push(p);
  mkdirSync(join(p, "skills", "roll-build"), { recursive: true });
  // A clean-ish hub: load-trigger description, gotchas, when-not, route cases.
  writeFileSync(
    join(p, "skills", "roll-build", "SKILL.md"),
    [
      "---",
      "name: roll-build",
      "description: Load when shipping a story through delivery.",
      "---",
      "# roll-build",
      "## When Not to Use",
      "never",
      "## Gotchas",
      "watch out",
    ].join("\n") + "\n",
  );
  mkdirSync(join(p, "skills", "roll-doctor"), { recursive: true });
  // A hub missing the load-trigger + gotchas → violations.
  writeFileSync(join(p, "skills", "roll-doctor", "SKILL.md"), "---\nname: roll-doctor\ndescription: Diagnose health.\n---\nbody\n");
  // Route cases so coverage is partly satisfied (keeps the count deterministic).
  mkdirSync(join(p, "skills", "route-cases"), { recursive: true });
  writeFileSync(
    join(p, "skills", "route-cases", "skills.json"),
    JSON.stringify({ skills: { "roll-build": { positive: ["a", "b"], negative: ["c", "d"] } } }),
  );
  return p;
}

describe("roll skills audit — US-DOSSIER-036 AC1/AC5/AC7", () => {
  it("AC1: human audit reports skills · violations · hub lines + 4 groups", () => {
    const r = run(["audit"], { ROLL_PKG_DIR: pkg(), ROLL_LANG: "en" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/2 skills · \d+ violations · \d+ hub lines/);
    expect(r.stdout).toContain("delivery (");
    expect(r.stdout).toContain("quality (");
    expect(r.stdout).toContain("observe (");
    expect(r.stdout).toContain("lifecycle (");
  });

  it("AC1 zh: bilingual on separate lines, never inline", () => {
    const r = run(["audit"], { ROLL_PKG_DIR: pkg(), ROLL_LANG: "zh" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/技能 2 · 违规 \d+ · hub 行数 \d+/);
    // No EN/中 inline-mixed on one line (the summary line carries the zh word).
    expect(r.stdout).not.toMatch(/skills · .*违规/);
  });

  it("AC7: --json is the SAME computation as the human audit view", () => {
    const p = pkg();
    const human = run(["audit"], { ROLL_PKG_DIR: p, ROLL_LANG: "en" });
    const jsonRun = run(["audit", "--json"], { ROLL_PKG_DIR: p, ROLL_LANG: "en" });
    expect(jsonRun.status).toBe(0);
    const vm = JSON.parse(jsonRun.stdout) as SkillsPanelVM;
    // Field-by-field parity: the numbers the human view printed are the VM's.
    expect(human.stdout).toContain(`${vm.summary.skills} skills`);
    expect(human.stdout).toContain(`${String(vm.summary.violations)} violations`);
    expect(human.stdout).toContain(`${vm.summary.hubLines} hub lines`);
    expect(vm.groups.map((g) => g.key)).toEqual(["delivery", "quality", "observe", "lifecycle"]);
  });

  it("AC1: --strict exits non-zero when there are violations", () => {
    const r = run(["audit", "--strict"], { ROLL_PKG_DIR: pkg(), ROLL_LANG: "en" });
    // roll-doctor (no load-trigger, no gotchas, no route cases) yields violations.
    expect(r.status).toBe(1);
  });
});

describe("roll skills sync — US-DOSSIER-036 AC1", () => {
  it("writes the projected catalog to guide/skills.md", () => {
    const p = pkg();
    mkdirSync(join(p, "guide"), { recursive: true });
    const r = run(["sync"], { ROLL_PKG_DIR: p, ROLL_LANG: "en" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Synced skill catalog");
    const catalog = readFileSync(join(p, "guide", "skills.md"), "utf8");
    expect(catalog).toContain("# Roll Skill Catalog");
    expect(catalog).toContain("roll-build");
  });

  it("AC2: install tree (no guide/) skips with a notice, exit 0", () => {
    const p = pkg(); // no guide/ dir → install tree
    const r = run(["sync"], { ROLL_PKG_DIR: p, ROLL_LANG: "en" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("nothing to maintain");
    expect(existsSync(join(p, "guide", "skills.md"))).toBe(false);
  });
});

describe("roll skills --help / fail-loud — US-DOSSIER-036 AC1/AC6", () => {
  it("AC1: --help names both audit and sync", () => {
    const r = run(["--help"], { ROLL_LANG: "en" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("audit");
    expect(r.stdout).toContain("sync");
  });

  it("AC6: --json on a non-audit subcommand fails loud (exit 1)", () => {
    const r = run(["check", "--json"], { ROLL_PKG_DIR: pkg(), ROLL_LANG: "en" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("does not support --json");
    expect(r.stdout).toBe("");
  });

  it("AC6: --json on an unknown subcommand fails loud (exit 1)", () => {
    const r = run(["bogus", "--json"], { ROLL_LANG: "en" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("does not support --json");
  });
});
