/**
 * frozen: TS `roll init` output and side effects.
 *
 * The bash oracle spawn is retired for US-PORT-013. Every case calls the TS
 * command directly, freezes visible output, and asserts the scaffold/apply
 * filesystem side effects in sandboxed project + ROLL_HOME fixtures.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { confirmInitProjectForTest, initCommand } from "../src/commands/init.js";
import { collectProjectsRegistry } from "../src/lib/projects-registry.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];

interface Fixture {
  proj: string;
  home: string;
  bin: string;
  pkg?: string;
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function freshHome(): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "roll-init-home-")));
  dirs.push(home);
  cpSync(join(REPO, "conventions"), join(home, "conventions"), { recursive: true });
  cpSync(join(REPO, "templates", "agent-routes"), join(home, "conventions", "templates", "agent-routes"), {
    recursive: true,
  });
  writeFileSync(join(home, "config.yaml"), "# Roll config\nlang: en\n");
  return home;
}

function noTemplateHome(): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "roll-init-home-")));
  dirs.push(home);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "config.yaml"), "# Roll config\nlang: en\n");
  return home;
}

function freshProj(): string {
  const proj = realpathSync(mkdtempSync(join(tmpdir(), "roll-init-proj-")));
  dirs.push(proj);
  return proj;
}

// FIX-283 (AC4): a project root OUTSIDE the OS temp dir — the unconditional
// tmp-skip (AC3) means a cwd under tmpdir() is never self-registered, so to
// exercise the `roll init` registration we need a "real" path. REPO_ROOT is not
// under tmpdir(); cleaned up with the other fixtures.
function realProj(): string {
  const proj = realpathSync(mkdtempSync(join(REPO, "roll-init-realproj-")));
  dirs.push(proj);
  return proj;
}
function realFixture(): Fixture {
  const bin = realpathSync(mkdtempSync(join(tmpdir(), "roll-init-bin-")));
  dirs.push(bin);
  return { proj: realProj(), home: freshHome(), bin };
}

function freshFixture(): Fixture {
  const bin = realpathSync(mkdtempSync(join(tmpdir(), "roll-init-bin-")));
  dirs.push(bin);
  return { proj: freshProj(), home: freshHome(), bin };
}

function fakePkgWithOnboardSkill(): string {
  const pkg = realpathSync(mkdtempSync(join(tmpdir(), "roll-init-pkg-")));
  dirs.push(pkg);
  cpSync(join(REPO, "lib"), join(pkg, "lib"), { recursive: true });
  mkdirSync(join(pkg, "skills", "roll-onboard"), { recursive: true });
  writeFileSync(
    join(pkg, "skills", "roll-onboard", "SKILL.md"),
    "---\nname: roll-onboard\ndescription: Onboard a project.\n---\n# roll-onboard\n\nWrite .roll/onboard-plan.yaml.\n",
  );
  return pkg;
}

function noTemplateFixture(): Fixture {
  const bin = realpathSync(mkdtempSync(join(tmpdir(), "roll-init-bin-")));
  dirs.push(bin);
  return { proj: freshProj(), home: noTemplateHome(), bin };
}

function cliFixture(): Fixture {
  const fx = freshFixture();
  mkdirSync(join(fx.proj, "bin"), { recursive: true });
  writeFileSync(join(fx.proj, "bin", "tool"), "#!/bin/sh\n");
  return fx;
}

function reinitFixture(): Fixture {
  const fx = freshFixture();
  cpSync(join(fx.home, "conventions", "global", "AGENTS.md"), join(fx.proj, "AGENTS.md"));
  return fx;
}

function applyFixture(planBody: string): Fixture {
  const fx = freshFixture();
  mkdirSync(join(fx.proj, ".roll"), { recursive: true });
  writeFileSync(join(fx.proj, ".roll", "onboard-plan.yaml"), planBody);
  return fx;
}

function existingCodebaseFixtureWithFakeAgent(): Fixture {
  const fx = freshFixture();
  fx.pkg = fakePkgWithOnboardSkill();
  writeFileSync(join(fx.proj, "package.json"), "{\"scripts\":{\"test\":\"vitest\"}}\n");
  writeFileSync(
    join(fx.home, "config.yaml"),
    "# Roll config\nlang: en\nai_kimi: ~/.kimi|AGENTS.md|AGENTS.md\n",
  );
  const kimi = join(fx.bin, "kimi");
  writeFileSync(
    kimi,
    [
      "#!/bin/sh",
      "mkdir -p .roll",
      "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)",
      "cat > .roll/onboard-plan.yaml <<EOF",
      "version: 1",
      "generated_at: \"$ts\"",
      "project_understanding:",
      "  type: cli",
      "  description: legacy cli",
      "scope:",
      "  approved: [backlog, features]",
      "  declined: []",
      "privacy:",
      "  gitignore_dot_roll: false",
      "agent_routes_template: skip",
      "EOF",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return fx;
}

function docsOnlyFixtureWithFakeAgent(): Fixture {
  const fx = freshFixture();
  fx.pkg = fakePkgWithOnboardSkill();
  mkdirSync(join(fx.proj, "docs"), { recursive: true });
  writeFileSync(
    join(fx.proj, "README.md"),
    "# SoloGo\n\nSoloGo is a Go score tracking app for offline SGF review and tournament notes.\n",
  );
  writeFileSync(
    join(fx.proj, "docs", "spec.md"),
    "# Product spec\n\nPlayers record games, annotate reviews, and sync tournament summaries.\n",
  );
  writeFileSync(
    join(fx.home, "config.yaml"),
    "# Roll config\nlang: en\nai_kimi: ~/.kimi|AGENTS.md|AGENTS.md\n",
  );
  const kimi = join(fx.bin, "kimi");
  writeFileSync(
    kimi,
    [
      "#!/bin/sh",
      "printf '%s' \"$1\" > prompt.txt",
      "mkdir -p .roll",
      "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)",
      "cat > .roll/onboard-plan.yaml <<EOF",
      "version: 1",
      "generated_at: \"$ts\"",
      "project_understanding:",
      "  type: cli",
      "  description: SoloGo Go score tracking app",
      "scope:",
      "  approved: [backlog, features]",
      "  declined: []",
      "privacy:",
      "  gitignore_dot_roll: false",
      "agent_routes_template: skip",
      "EOF",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return fx;
}

function validPlan(extra = ""): string {
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return `version: 1
generated_at: "${ts}"
project_understanding:
  type: cli
  description: test cli
  domains: []
  key_modules: []
scope:
  approved: [backlog, features, domain, briefs]
  declined: []
include_existing: []
privacy:
  gitignore_dot_roll: true
sync_targets: []
enable_loop: false
agent_routes_template: default
${extra}`;
}

function planWithPhase2(): string {
  return validPlan(`domain_model:
  bounded_contexts:
    - name: Delivery
      aggregates: [Story]
      ubiquitous_language:
        - term: Done
          definition: merged and evidenced
tech_analysis:
  stack: [TypeScript]
  dependencies: [Vitest]
  architecture_notes: [Uses Roll harness]
  risks:
    - description: no release smoke
      severity: HIGH
      evidence: detected
test_assessment:
  current_layers:
    - claim: unit tests exist
      evidence: detected
  gaps:
    - claim: no smoke test
      evidence: detected
  recommended_actions:
    - claim: add release smoke test
      evidence: inferred
`);
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const ENV_KEYS = [
  "PATH", "HOME", "ROLL_HOME", "ROLL_PKG_DIR", "NO_COLOR", "ROLL_LANG", "LC_ALL", "LANG", "PWD",
  "ROLL_AGENT_ROUTES_TEMPLATE", "ROLL_ONBOARD_AGENT", "ROLL_ASSUME_TTY", "ROLL_BRAND_NAME",
  "ROLL_ATTEST_NO_BROWSER",
];

function envBase(fx: Fixture, extra: Record<string, string>): Record<string, string> {
  return {
    PATH: `${fx.bin}:${process.env["PATH"] ?? ""}`,
    HOME: fx.home,
    ROLL_HOME: fx.home,
    ROLL_PKG_DIR: fx.pkg ?? REPO,
    NO_COLOR: "1",
    ROLL_LANG: "en",
    PWD: fx.proj,
    // FIX-394: init does a best-effort silent Chromium pre-install. The
    // difftest fixtures use an empty HOME, so without this the test would
    // trigger a real `npx playwright install` (a multi-minute network
    // subprocess) and risk hanging CI. The difftest does not exercise the
    // browser tool, so opting out keeps it deterministic and fast.
    ROLL_ATTEST_NO_BROWSER: "1",
    ...extra,
  };
}

function tsInit(fx: Fixture, args: string[], extra: Record<string, string> = {}): Run {
  const target = envBase(fx, extra);
  const save: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) save[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(target)) process.env[k] = v;
  const saveCwd = process.cwd();
  process.chdir(fx.proj);
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
    status = initCommand(args);
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

function norm(run: Run, fx: Fixture): Run {
  let stdout = run.stdout;
  let stderr = run.stderr;
  for (const path of [fx.proj, fx.home, REPO]) {
    const token = path === REPO ? "<repo>" : "X".repeat(path.length);
    stdout = stdout.split(path).join(token);
    stderr = stderr.split(path).join(token);
  }
  stdout = stdout
    .replace(/(  INIT  ·  项目初始化 )[^\n]*(  \n)/, "$1<PROGRESS>$2")
    .replace(/(  REINIT  ·  重新合并约定 )[^\n]*(  \n)/, "$1<PROGRESS>$2");
  return { status: run.status, stdout, stderr };
}

function read(relBase: string, rel: string): string {
  const path = join(relBase, rel);
  return existsSync(path) ? readFileSync(path, "utf8") : "<MISSING>";
}

function assertScaffold(fx: Fixture): void {
  expect(read(fx.proj, "AGENTS.md")).toContain("# Agent Conventions");
  expect(read(fx.proj, ".roll/backlog.md")).toContain("# Project Backlog");
  expect(existsSync(join(fx.proj, ".roll", "features"))).toBe(true);
  expect(read(fx.proj, ".roll/features.md")).toContain("# Features");
  expect(read(fx.proj, ".roll/.version")).toContain("roll_version:");
  expect(read(fx.proj, ".roll/pairing.yaml")).toContain("# .roll/pairing.yaml");
}

describe("frozen: roll init", () => {
  it("FIX-307: registers a real project under its derived git remote name", () => {
    const fx = realFixture();
    execFileSync("git", ["init", "-q"], { cwd: fx.proj });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:seanyao/APE-PR.git"], { cwd: fx.proj });
    expect(tsInit(fx, ["--auto"]).status).toBe(0);
    expect(collectProjectsRegistry(fx.home)[0]).toMatchObject({
      name: "APE-PR",
      slug: expect.stringContaining("ape-pr-"),
      path: fx.proj,
    });
  });

  it("fresh init --auto scaffolds an unknown project with a placeholder brief", () => {
    const fx = freshFixture();
    expect(norm(tsInit(fx, ["--auto"]), fx)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "
        Project setup
        ────────────────────────────────────────────────────────────────────────────────
        Detected project type: unknown
        Roll will scaffold AGENTS.md, .roll/backlog.md, .roll/features/, .roll/pairing.yaml, and .claude/CLAUDE.md.
        Non-interactive mode — proceeding automatically. Use \`roll init --auto\` to suppress this notice.
        ════════════════════════════════════════════════════════════════════════════════
        INIT  ·  项目初始化 <PROGRESS>  
      ────────────────────────────────────────────────────────────────────────────────

        1. ✓  Detect project type
        2. ✓  Create AGENTS.md
             +  AGENTS.md
        3. ✓  Create .roll/backlog.md
             +  .roll/backlog.md
        4. ✓  Create .roll/brief.md
             +  .roll/brief.md
        5. ✓  Create .roll/features/
             +  .roll/features/
        6. ↷  Merge existing CLAUDE.md
             not modified
        7. ✓  Link skills to AI clients
        8. ✓  Scaffold cross-agent pairing
             +  .roll/pairing.yaml

      ────────────────────────────────────────────────────────────────────────────────
        ✓ Initialized

        NEXT  ·  下一步
        1. roll design
           turn the project brief into Roll stories
      ════════════════════════════════════════════════════════════════════════════════
      ",
      }
    `);
    assertScaffold(fx);
  });

  it("fresh cli project gets a CLAUDE.md template with --auto", () => {
    const fx = cliFixture();
    expect(norm(tsInit(fx, ["--auto"]), fx)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "
        Project setup
        ────────────────────────────────────────────────────────────────────────────────
        Detected project type: cli
        Roll will scaffold AGENTS.md, .roll/backlog.md, .roll/features/, .roll/pairing.yaml, and .claude/CLAUDE.md.
        Non-interactive mode — proceeding automatically. Use \`roll init --auto\` to suppress this notice.
        ════════════════════════════════════════════════════════════════════════════════
        INIT  ·  项目初始化 <PROGRESS>  
      ────────────────────────────────────────────────────────────────────────────────

        1. ✓  Detect project type
        2. ✓  Create AGENTS.md
             +  AGENTS.md
        3. ✓  Create .roll/backlog.md
             +  .roll/backlog.md
        4. ✓  Create .roll/brief.md
             +  .roll/brief.md
        5. ✓  Create .roll/features/
             +  .roll/features/
        6. ✓  Merge existing CLAUDE.md
             +  .claude/CLAUDE.md
        7. ✓  Link skills to AI clients
        8. ✓  Scaffold cross-agent pairing
             +  .roll/pairing.yaml

      ────────────────────────────────────────────────────────────────────────────────
        ✓ Initialized

        NEXT  ·  下一步
        1. roll design
           turn the project brief into Roll stories
      ════════════════════════════════════════════════════════════════════════════════
      ",
      }
    `);
    expect(read(fx.proj, ".claude/CLAUDE.md")).toContain("CLI");
    assertScaffold(fx);
  });

  it("US-INIT-005: fresh PRD-only init scaffolds a new project brief without onboarding", () => {
    const fx = freshFixture();
    writeFileSync(join(fx.proj, "prd.md"), "# Product Requirements\n\nFeature list.");
    expect(norm(tsInit(fx, []), fx)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "
        Project setup
        ────────────────────────────────────────────────────────────────────────────────
        Detected project type: unknown
        Roll will scaffold AGENTS.md, .roll/backlog.md, .roll/features/, .roll/pairing.yaml, and .claude/CLAUDE.md.
        Non-interactive mode — proceeding automatically. Use \`roll init --auto\` to suppress this notice.
        ════════════════════════════════════════════════════════════════════════════════
        INIT  ·  项目初始化 <PROGRESS>  
      ────────────────────────────────────────────────────────────────────────────────

        1. ✓  Detect project type
        2. ✓  Create AGENTS.md
             +  AGENTS.md
        3. ✓  Create .roll/backlog.md
             +  .roll/backlog.md
        4. ✓  Create .roll/brief.md
             +  .roll/brief.md
        5. ✓  Create .roll/features/
             +  .roll/features/
        6. ↷  Merge existing CLAUDE.md
             not modified
        7. ✓  Link skills to AI clients
        8. ✓  Scaffold cross-agent pairing
             +  .roll/pairing.yaml

      ────────────────────────────────────────────────────────────────────────────────
        ✓ Initialized

        NEXT  ·  下一步
        1. roll design --from-file prd.md
           turn the product brief into Roll stories
      ════════════════════════════════════════════════════════════════════════════════
      ",
      }
    `);
    expect(existsSync(join(fx.proj, "AGENTS.md"))).toBe(true);
    expect(read(fx.proj, ".roll/brief.md")).toContain("Feature list.");
  });

  it("US-INIT-004: AGENTS-only project with PRD is partial Roll, not fresh scaffold", () => {
    const fx = reinitFixture();
    writeFileSync(join(fx.proj, "prd.md"), "# Product Requirements\n\nFeature list.");
    expect(norm(tsInit(fx, []), fx)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "Detected: roll-partial
      Recommended path: repair-roll
      Reasons:
        - Roll markers are present but incomplete; repair before scaffolding.
      Next: roll init --repair
      No files changed.
      ",
      }
    `);
  });

  it("US-INIT-005: empty non-interactive init without --auto does not mutate", () => {
    const fx = freshFixture();
    expect(norm(tsInit(fx, []), fx)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "Detected: empty
      Recommended path: guided-brief
      Reasons:
        - No Roll, codebase, or product-document signals found.
      Next: roll design
      No files changed.
      ",
      }
    `);
  });

  it("US-INIT-004: AGENTS-only project renders partial Roll repair route", () => {
    const fx = reinitFixture();
    expect(norm(tsInit(fx, []), fx)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "Detected: roll-partial
      Recommended path: repair-roll
      Reasons:
        - Roll markers are present but incomplete; repair before scaffolding.
      Next: roll init --repair
      No files changed.
      ",
      }
    `);
    expect(read(fx.proj, "AGENTS.md")).toContain("# Agent Conventions");
  });

  it("unknown flag is owned by TS", () => {
    const fx = freshFixture();
    expect(norm(tsInit(fx, ["--bogus"]), fx)).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] Unknown flag: --bogus
      ",
        "stdout": "",
      }
    `);
  });

  it("missing templates guard is owned by TS", () => {
    const fx = noTemplateFixture();
    expect(norm(tsInit(fx, ["--auto"]), fx)).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] No templates found. Run 'roll setup' first.
      ",
        "stdout": "",
      }
    `);
  });

  it("--apply without onboard plan is owned by TS", () => {
    const fx = freshFixture();
    expect(norm(tsInit(fx, ["--apply"]), fx)).toMatchInlineSnapshot(`
      {
        "status": 1,
        "stderr": "[roll] No onboard plan found at .roll/onboard-plan.yaml

        Run $roll-onboard in your AI agent first to generate the plan.
      [EN:  请先在 AI agent 里运行 \\$roll-onboard 生成 plan，再回来执行 ap...]
      ",
        "stdout": "",
      }
    `);
  });

  it("--apply consumes a valid plan and records offboard changeset", () => {
    const fx = applyFixture(validPlan());
    expect(norm(tsInit(fx, ["--apply"]), fx)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "[roll] Applying onboard plan...

      Roll convention sync summary
        │  + created     AGENTS.md                     │
        │  + created     .roll/.version                │
        │  + created     .roll/backlog.md              │
        │  + created     .roll/agent-routes.yaml       │
        │  + created     .roll/features/               │
        │  + created     .roll/features.md             │
        └─────────────────────────────────────────────────────┘
      [roll] Added .roll/ to .gitignore

      [roll] Syncing conventions to AI tools...

      [roll] Onboard apply complete.  Onboard
      ",
      }
    `);
    expect(read(fx.proj, ".roll/onboard-changeset.yaml")).toContain("scope_approved:");
    expect(read(fx.proj, ".roll/onboard-changeset.yaml")).toContain(".roll/backlog.md");
    expect(read(fx.proj, ".gitignore")).toContain(".roll/");
    expect(read(fx.proj, "AGENTS.md")).toContain("# Agent Conventions");
    expect(read(fx.proj, ".roll/backlog.md")).toContain("# Project Backlog");
    expect(existsSync(join(fx.proj, ".roll", "features"))).toBe(true);
    expect(read(fx.proj, ".roll/features.md")).toContain("# Features");
    expect(read(fx.proj, ".roll/.version")).toContain("roll_version:");
    expect(existsSync(join(fx.proj, ".roll", "domain"))).toBe(true);
    expect(existsSync(join(fx.proj, ".roll", "briefs"))).toBe(true);
  });

  it("--apply renders Phase 2 markdown and skips seed in non-interactive mode", () => {
    const fx = applyFixture(planWithPhase2());
    expect(norm(tsInit(fx, ["--apply"]), fx)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "
      [roll] About to seed 1 candidate stories to BACKLOG:
          US-SEED-001  add release smoke test

      Non-interactive stdin — skipping BACKLOG seeding (markdown still generated).

      [roll] About to seed 1 HIGH-severity risks as FIX entries:
          FIX-SEED-001  no release smoke

      Non-interactive stdin — skipping BACKLOG seeding (markdown still generated).
      ",
        "stdout": "[roll] Applying onboard plan...
      [roll] Rendered: .roll/domain/context-map.md
      [roll] Rendered: .roll/tech-analysis.md
      [roll] Rendered: .roll/test-assessment.md
      [roll] Seeding cancelled. The analysis markdown was still generated.
      [roll] Seeding cancelled. The analysis markdown was still generated.

      Roll convention sync summary
        │  + created     AGENTS.md                     │
        │  + created     .roll/.version                │
        │  + created     .roll/backlog.md              │
        │  + created     .roll/agent-routes.yaml       │
        │  + created     .roll/features/               │
        │  + created     .roll/features.md             │
        └─────────────────────────────────────────────────────┘
      [roll] Added .roll/ to .gitignore

      [roll] Syncing conventions to AI tools...

      [roll] Onboard apply complete.  Onboard
      ",
      }
    `);
    expect(read(fx.proj, ".roll/domain/context-map.md")).toContain("## Delivery");
    expect(read(fx.proj, ".roll/tech-analysis.md")).toContain("no release smoke");
    expect(read(fx.proj, ".roll/test-assessment.md")).toContain("add release smoke test");
    expect(read(fx.proj, ".roll/backlog.md")).not.toContain("US-SEED-001");
  });

  it("existing codebase recommends agentic onboarding without mutating", () => {
    const fx = existingCodebaseFixtureWithFakeAgent();
    expect(norm(tsInit(fx, []), fx)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "Detected: existing codebase without Roll
      Recommended path: agentic-onboard
      Facts:
        - manifests: package.json
        - source dirs: none
        - test dirs: none
        - source files: 0
        - Roll markers: none
      Next: $roll-onboard
      Agent status: available: kimi
      Run \`$roll-onboard\` with an available agent, then run \`roll init --apply\` when the plan is ready.
      No files changed.
      ",
      }
    `);
    expect(existsSync(join(fx.proj, ".roll"))).toBe(false);
    expect(existsSync(join(fx.proj, "AGENTS.md"))).toBe(false);
  });

  it("US-INIT-005: docs-only project initializes from the detected document instead of onboard", () => {
    const fx = docsOnlyFixtureWithFakeAgent();
    const run = tsInit(fx, []);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("INIT");
    expect(run.stdout).toContain("Initialized");
    expect(run.stdout).toContain("roll design --from-file docs/spec.md");
    expect(run.stdout).not.toContain("Onboarding");
    expect(read(fx.proj, "prompt.txt")).toBe("<MISSING>");
    expect(read(fx.proj, ".roll/onboard-plan.yaml")).toBe("<MISSING>");
    expect(read(fx.proj, "AGENTS.md")).toContain("# Agent Conventions");
    expect(read(fx.proj, ".roll/brief.md")).toContain("docs/spec.md");
  });

  it("FIX-1029: fresh init confirmation reads through the tty-confirm seam", () => {
    const fx = freshFixture();
    expect(confirmInitProjectForTest(fx.proj, false, () => "yes")).toBe(true);
    expect(confirmInitProjectForTest(fx.proj, false, () => "no")).toBe(false);
  });

  // FIX-283 (AC4): `roll init` registers the (real) project into the
  // cross-project registry the switcher reads. tsInit sets ROLL_HOME=fx.home, so
  // the row lands in the sandbox registry — never the real ~/.roll/projects.json.
  // A real (non-tmp) project root is required because the shared tmp-skip (AC3)
  // would otherwise skip the write.
  it("AC4: fresh init registers the project into ~/.roll/projects.json (one row, path = project)", () => {
    const fx = realFixture();
    const run = tsInit(fx, ["--auto"]);
    expect(run.status).toBe(0);
    const rows = collectProjectsRegistry(fx.home);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.path).toBe(fx.proj);
    expect(rows[0]?.name).toBe("roll");
    expect(typeof rows[0]?.lastIndexedAt).toBe("string");
  });

  // FIX-283 (AC3): init on a tmp-dir project never registers, even with
  // ROLL_HOME set — the freshFixture project is under tmpdir(), so the sandbox
  // registry stays empty (belt-and-suspenders against fixture leakage).
  it("AC3: init on a tmp project writes NO registry row (tmp-skip, sandbox empty)", () => {
    const fx = freshFixture();
    const run = tsInit(fx, []);
    expect(run.status).toBe(0);
    expect(collectProjectsRegistry(fx.home)).toEqual([]);
  });
});
