/**
 * Frozen-expectation test: TS `roll consistency`.
 *
 * `consistencyCommand` was proven byte-equal to the bash oracle `bin/roll
 * consistency` (which shelled lib/consistency_check.py) under diff-test, both
 * reading a fabricated --project-dir fixture per dimension (code/docs/i18n/tests/
 * site). Per US-PORT-009c the oracle is retired: the `bin/roll consistency` spawn
 * is dropped and each case freezes the TS `{status, stdout, stderr}` as an inline
 * snapshot (zero engine spawn). Fixtures are fixed file trees → every dimension
 * verdict is deterministic; the random --project-dir path is scrubbed to `<PROJ>`
 * so the frozen value stays portable (macOS `/var/folders` vs Linux CI `/tmp`).
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consistencyCommand } from "../src/commands/consistency.js";
import { seedUpdateCheckCache } from "./helpers.js";

const dirs: string[] = [];
let home = "";
let cwd = ""; // an empty dir the commands run *in* (project-dir is explicit)

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "roll-cn-home-"));
  cwd = mkdtempSync(join(tmpdir(), "roll-cn-cwd-"));
  dirs.push(home, cwd);
  mkdirSync(join(home, ".roll"), { recursive: true });
  seedUpdateCheckCache(join(home, ".roll"));
});

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function mk(): string {
  const p = mkdtempSync(join(tmpdir(), "roll-cn-proj-"));
  dirs.push(p);
  return p;
}
function w(base: string, rel: string, content: string): void {
  const full = join(base, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

// ── Fixture builders (one per scenario) ──────────────────────────────────────
function healthy(): string {
  const p = mk();
  w(p, ".roll/backlog.md", "# Backlog\n\n### Feature: widget\n\n| [US-W-001] | thing | ✅ Done |\n");
  w(p, ".roll/features.md", "# Features\n\n- widget — does widget things\n");
  w(p, "guide/en/intro.md", "intro\n");
  w(p, "guide/zh/intro.md", "介绍\n");
  w(p, "lib/i18n/x.sh", "_i18n_set en a.b hi\n_i18n_set zh a.b 你好\n");
  w(p, "tests/cmd_widget.bats", "@test widget {\n  true\n}\n");
  w(p, "site/roll-data.js", 'const FEATURE_GROUPS = [{ name: "widget" }];\n');
  return p;
}

function codeViolation(): string {
  const p = mk();
  // Done feature 'orphan' not present in features.md → code gap.
  w(p, ".roll/backlog.md", "# Backlog\n\n### Feature: orphan\n\n| [US-O-001] | x | ✅ Done |\n");
  w(p, ".roll/features.md", "# Features\n\n- something-else\n");
  return p;
}

function i18nViolation(): string {
  const p = mk();
  // guide/en/extra.md has no zh; i18n key only-en and only-zh.
  w(p, "guide/en/intro.md", "intro\n");
  w(p, "guide/en/extra.md", "extra\n");
  w(p, "guide/zh/intro.md", "介绍\n");
  w(p, "lib/i18n/x.sh", "_i18n_set en only.en hi\n_i18n_set zh only.zh 你\n_i18n_set en both.k a\n_i18n_set zh both.k b\n");
  return p;
}

function testsViolation(): string {
  const p = mk();
  // Done feature 'authentication' with no matching test; a stale test file.
  w(p, ".roll/backlog.md", "# Backlog\n\n### Feature: authentication\n\n| [US-A-001] | x | ✅ Done |\n");
  w(p, "tests/stalefeature.bats", "@test x {\n  true\n}\n");
  return p;
}

function siteViolation(): string {
  const p = mk();
  // Done feature 'dashboard' not mentioned on the site (site lists only 'widget').
  w(p, ".roll/backlog.md", "# Backlog\n\n### Feature: dashboard\n\n| [US-D-001] | x | ✅ Done |\n");
  w(p, "site/roll-data.js", 'const FEATURE_GROUPS = [{ name: "widget" }];\n');
  return p;
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function envBase(extra: Record<string, string>): Record<string, string> {
  return {
    PATH: process.env["PATH"] ?? "",
    HOME: home,
    ROLL_HOME: join(home, ".roll"),
    NO_COLOR: "1",
    ...extra,
  };
}

const ENV_KEYS = ["PATH", "HOME", "ROLL_HOME", "NO_COLOR", "ROLL_LANG", "LC_ALL", "LANG"];

function tsCn(args: string[], extra: Record<string, string>): Run {
  const save: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) save[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(envBase(extra))) process.env[k] = v;
  const saveCwd = process.cwd();
  process.chdir(cwd);
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (outChunks.push(String(c)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (c: string | Uint8Array): boolean => (errChunks.push(String(c)), true);
  let status: number;
  try {
    status = consistencyCommand(args);
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    process.chdir(saveCwd);
    for (const k of ENV_KEYS) {
      const v = save[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return { status, stdout: outChunks.join(""), stderr: errChunks.join("") };
}

/** Run the TS command and scrub the random --project-dir path → portable. */
function cn(args: string[], proj: string, extra: Record<string, string> = {}): Run {
  const t = tsCn(args, extra);
  const scrub = (s: string): string => (proj ? s.split(proj).join("<PROJ>") : s);
  return { status: t.status, stdout: scrub(t.stdout), stderr: scrub(t.stderr) };
}

// Unrolled (inline snapshots are keyed by call site — a loop can't hold distinct
// per-case frozen values).
describe("frozen: roll consistency", () => {
  it("check (human) — healthy (all pass)", () => {
    const p = healthy();
    expect(cn(["check", "--project-dir", p], p)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "Consistency Report
      ==================================================
      ✅ code: pass
      ✅ docs: pass
         ℹ placeholder — will be implemented in US-CONSIST-002
      ✅ i18n: pass
      ✅ tests: pass
      ✅ site: pass
      --------------------------------------------------
      Overall: pass
      ",
      }
    `);
  });
  it("check --json — healthy (all pass)", () => {
    const p = healthy();
    expect(cn(["check", "--json", "--project-dir", p], p)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "{
        "overall": "pass",
        "dimensions": {
          "code": {
            "status": "pass",
            "gaps": []
          },
          "docs": {
            "status": "pass",
            "gaps": [],
            "note": "placeholder — will be implemented in US-CONSIST-002"
          },
          "i18n": {
            "status": "pass",
            "gaps": []
          },
          "tests": {
            "status": "pass",
            "gaps": []
          },
          "site": {
            "status": "pass",
            "gaps": []
          }
        }
      }
      ",
      }
    `);
  });

  it("check (human) — code dimension gap", () => {
    const p = codeViolation();
    expect(cn(["check", "--project-dir", p], p)).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "",
        "stdout": "Consistency Report
      ==================================================
      ❌ code: fail
         • Feature 'orphan' has Done stories but is missing from features.md catalog
      ✅ docs: pass
         ℹ placeholder — will be implemented in US-CONSIST-002
      ✅ i18n: pass
      ✅ tests: pass
      ✅ site: pass
      --------------------------------------------------
      Overall: fail
      ",
      }
    `);
  });
  it("check --json — code dimension gap", () => {
    const p = codeViolation();
    expect(cn(["check", "--json", "--project-dir", p], p)).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "",
        "stdout": "{
        "overall": "fail",
        "dimensions": {
          "code": {
            "status": "fail",
            "gaps": [
              "Feature 'orphan' has Done stories but is missing from features.md catalog"
            ]
          },
          "docs": {
            "status": "pass",
            "gaps": [],
            "note": "placeholder — will be implemented in US-CONSIST-002"
          },
          "i18n": {
            "status": "pass",
            "gaps": []
          },
          "tests": {
            "status": "pass",
            "gaps": []
          },
          "site": {
            "status": "pass",
            "gaps": []
          }
        }
      }
      ",
      }
    `);
  });

  it("check (human) — i18n dimension gaps (guide parity + key parity)", () => {
    const p = i18nViolation();
    expect(cn(["check", "--project-dir", p], p)).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "",
        "stdout": "Consistency Report
      ==================================================
      ✅ code: pass
      ✅ docs: pass
         ℹ placeholder — will be implemented in US-CONSIST-002
      ❌ i18n: fail
         • guide/en/extra.md has no corresponding guide/zh/extra.md
         • i18n key 'only.en' has EN but is missing ZH translation
         • i18n key 'only.zh' has ZH but is missing EN translation
      ✅ tests: pass
      ✅ site: pass
      --------------------------------------------------
      Overall: fail
      ",
      }
    `);
  });
  it("check --json — i18n dimension gaps (guide parity + key parity)", () => {
    const p = i18nViolation();
    expect(cn(["check", "--json", "--project-dir", p], p)).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "",
        "stdout": "{
        "overall": "fail",
        "dimensions": {
          "code": {
            "status": "pass",
            "gaps": []
          },
          "docs": {
            "status": "pass",
            "gaps": [],
            "note": "placeholder — will be implemented in US-CONSIST-002"
          },
          "i18n": {
            "status": "fail",
            "gaps": [
              "guide/en/extra.md has no corresponding guide/zh/extra.md",
              "i18n key 'only.en' has EN but is missing ZH translation",
              "i18n key 'only.zh' has ZH but is missing EN translation"
            ]
          },
          "tests": {
            "status": "pass",
            "gaps": []
          },
          "site": {
            "status": "pass",
            "gaps": []
          }
        }
      }
      ",
      }
    `);
  });

  it("check (human) — tests dimension gaps (coverage + stale)", () => {
    const p = testsViolation();
    expect(cn(["check", "--project-dir", p], p)).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "",
        "stdout": "Consistency Report
      ==================================================
      ✅ code: pass
      ✅ docs: pass
         ℹ placeholder — will be implemented in US-CONSIST-002
      ✅ i18n: pass
      ❌ tests: fail
         • Feature 'authentication' has Done stories but no test file appears to cover it (heuristic: no test file name matches keywords ['authentication'])
         • Test file 'stalefeature.bats' appears to reference feature 'stalefeature' which does not exist in backlog — may be stale
      ✅ site: pass
      --------------------------------------------------
      Overall: fail
      ",
      }
    `);
  });
  it("check --json — tests dimension gaps (coverage + stale)", () => {
    const p = testsViolation();
    expect(cn(["check", "--json", "--project-dir", p], p)).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "",
        "stdout": "{
        "overall": "fail",
        "dimensions": {
          "code": {
            "status": "pass",
            "gaps": []
          },
          "docs": {
            "status": "pass",
            "gaps": [],
            "note": "placeholder — will be implemented in US-CONSIST-002"
          },
          "i18n": {
            "status": "pass",
            "gaps": []
          },
          "tests": {
            "status": "fail",
            "gaps": [
              "Feature 'authentication' has Done stories but no test file appears to cover it (heuristic: no test file name matches keywords ['authentication'])",
              "Test file 'stalefeature.bats' appears to reference feature 'stalefeature' which does not exist in backlog — may be stale"
            ]
          },
          "site": {
            "status": "pass",
            "gaps": []
          }
        }
      }
      ",
      }
    `);
  });

  it("check (human) — site dimension gap", () => {
    const p = siteViolation();
    expect(cn(["check", "--project-dir", p], p)).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "",
        "stdout": "Consistency Report
      ==================================================
      ✅ code: pass
      ✅ docs: pass
         ℹ placeholder — will be implemented in US-CONSIST-002
      ✅ i18n: pass
      ✅ tests: pass
      ❌ site: fail
         • Feature 'dashboard' has Done stories but is not mentioned on the landing page — site may be missing this capability
      --------------------------------------------------
      Overall: fail
      ",
      }
    `);
  });
  it("check --json — site dimension gap", () => {
    const p = siteViolation();
    expect(cn(["check", "--json", "--project-dir", p], p)).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "",
        "stdout": "{
        "overall": "fail",
        "dimensions": {
          "code": {
            "status": "pass",
            "gaps": []
          },
          "docs": {
            "status": "pass",
            "gaps": [],
            "note": "placeholder — will be implemented in US-CONSIST-002"
          },
          "i18n": {
            "status": "pass",
            "gaps": []
          },
          "tests": {
            "status": "pass",
            "gaps": []
          },
          "site": {
            "status": "fail",
            "gaps": [
              "Feature 'dashboard' has Done stories but is not mentioned on the landing page — site may be missing this capability"
            ]
          }
        }
      }
      ",
      }
    `);
  });

  it("check on an empty project-dir → all pass", () => {
    const p = mk();
    expect(cn(["check", "--project-dir", p], p)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "Consistency Report
      ==================================================
      ✅ code: pass
      ✅ docs: pass
         ℹ placeholder — will be implemented in US-CONSIST-002
      ✅ i18n: pass
      ✅ tests: pass
      ✅ site: pass
      --------------------------------------------------
      Overall: pass
      ",
      }
    `);
  });

  it("help output (long)", () => {
    expect(cn(["--help"], "")).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "Usage: roll consistency <subcommand>

        check [--json] [--project-dir DIR]    逐维度跑一致性检查
          Run checks across five dimensions (code, docs, i18n, tests, site)
          and produce a structured pass/gap report.

        roll consistency check                # human-readable report
        roll consistency check --json         # machine-readable JSON
      ",
      }
    `);
  });

  it("unknown subcommand → exit 1 (en)", () => {
    expect(cn(["bogus"], "", { ROLL_LANG: "en" })).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] Unknown consistency subcommand: bogus
      [roll] Try: roll consistency check
      ",
        "stdout": "",
      }
    `);
  });
  it("unknown subcommand → exit 1 (zh)", () => {
    expect(cn(["bogus"], "", { ROLL_LANG: "zh" })).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] 未知的一致性子命令: bogus
      [roll] Try: roll consistency check
      ",
        "stdout": "",
      }
    `);
  });
});
