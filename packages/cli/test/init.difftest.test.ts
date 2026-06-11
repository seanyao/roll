/**
 * frozen: TS `roll init` output and side effects.
 *
 * The bash oracle spawn is retired for US-PORT-013. Every case calls the TS
 * command directly, freezes visible output, and asserts the scaffold/apply
 * filesystem side effects in sandboxed project + ROLL_HOME fixtures.
 */
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
import { initCommand } from "../src/commands/init.js";

const REPO = resolve(__dirname, "../../..");
const dirs: string[] = [];

interface Fixture {
  proj: string;
  home: string;
  bin: string;
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

function freshFixture(): Fixture {
  const bin = realpathSync(mkdtempSync(join(tmpdir(), "roll-init-bin-")));
  dirs.push(bin);
  return { proj: freshProj(), home: freshHome(), bin };
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

function legacyFixtureWithFakeClaude(): Fixture {
  const fx = freshFixture();
  writeFileSync(join(fx.proj, "package.json"), "{\"scripts\":{\"test\":\"vitest\"}}\n");
  writeFileSync(
    join(fx.home, "config.yaml"),
    "# Roll config\nlang: en\nai_claude: ~/.claude|CLAUDE.md|CLAUDE.md\n",
  );
  const claude = join(fx.bin, "claude");
  writeFileSync(
    claude,
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
  "ROLL_AGENT_ROUTES_TEMPLATE", "ROLL_ONBOARD_AGENT", "ROLL_ASSUME_TTY",
];

function envBase(fx: Fixture, extra: Record<string, string>): Record<string, string> {
  return {
    PATH: `${fx.bin}:${process.env["PATH"] ?? ""}`,
    HOME: fx.home,
    ROLL_HOME: fx.home,
    ROLL_PKG_DIR: REPO,
    NO_COLOR: "1",
    ROLL_LANG: "en",
    PWD: fx.proj,
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
  it("fresh init scaffolds an unknown project", () => {
    const fx = freshFixture();
    expect(norm(tsInit(fx, []), fx)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "  INIT  ·  项目初始化 <PROGRESS>  
      ────────────────────────────────────────────────────────────────────────────────

        1. ✓  Detect project type
        2. ✓  Create AGENTS.md
             +  AGENTS.md
        3. ✓  Create .roll/backlog.md
             +  .roll/backlog.md
        4. ✓  Create .roll/features/
             +  .roll/features/
        5. ↷  Merge existing CLAUDE.md
             not modified
        6. ✓  Link skills to AI clients
        7. ✓  Scaffold cross-agent pairing
             +  .roll/pairing.yaml

      ────────────────────────────────────────────────────────────────────────────────
        ✓ Initialized

        NEXT  ·  下一步
        1. Edit .roll/backlog.md
           open the backlog and add your first US
        2. Run roll loop now
           execute one cycle manually to test the flow
        3. Enable loop scheduling
           roll loop on  — let it run hourly
        4. Run roll pair status
           see the cross-agent pairing pool and what it cost
      ════════════════════════════════════════════════════════════════════════════════
      ",
      }
    `);
    assertScaffold(fx);
  });

  it("fresh cli project gets a CLAUDE.md template", () => {
    const fx = cliFixture();
    expect(norm(tsInit(fx, []), fx)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "  INIT  ·  项目初始化 <PROGRESS>  
      ────────────────────────────────────────────────────────────────────────────────

        1. ✓  Detect project type
        2. ✓  Create AGENTS.md
             +  AGENTS.md
        3. ✓  Create .roll/backlog.md
             +  .roll/backlog.md
        4. ✓  Create .roll/features/
             +  .roll/features/
        5. ✓  Merge existing CLAUDE.md
             +  .claude/CLAUDE.md
        6. ✓  Link skills to AI clients
        7. ✓  Scaffold cross-agent pairing
             +  .roll/pairing.yaml

      ────────────────────────────────────────────────────────────────────────────────
        ✓ Initialized

        NEXT  ·  下一步
        1. Edit .roll/backlog.md
           open the backlog and add your first US
        2. Run roll loop now
           execute one cycle manually to test the flow
        3. Enable loop scheduling
           roll loop on  — let it run hourly
        4. Run roll pair status
           see the cross-agent pairing pool and what it cost
      ════════════════════════════════════════════════════════════════════════════════
      ",
      }
    `);
    expect(read(fx.proj, ".claude/CLAUDE.md")).toContain("CLI");
    assertScaffold(fx);
  });

  it("re-init over existing AGENTS.md renders re-merge", () => {
    const fx = reinitFixture();
    expect(norm(tsInit(fx, []), fx)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "",
        "stdout": "  REINIT  ·  重新合并约定 <PROGRESS>  
      ────────────────────────────────────────────────────────────────────────────────

        1. ✓  Detect project type
        2. ↷  Create AGENTS.md
             ·  AGENTS.md
        3. ✓  Create .roll/backlog.md
             +  .roll/backlog.md
        4. ✓  Create .roll/features/
             +  .roll/features/
        5. ↷  Merge existing CLAUDE.md
             not modified
        6. ✓  Link skills to AI clients
        7. ✓  Scaffold cross-agent pairing
             +  .roll/pairing.yaml

      ────────────────────────────────────────────────────────────────────────────────
        ✓ Re-merged

        NEXT  ·  下一步
        1. Edit .roll/backlog.md
           open the backlog and add your first US
        2. Run roll loop now
           execute one cycle manually to test the flow
        3. Enable loop scheduling
           roll loop on  — let it run hourly
        4. Run roll pair status
           see the cross-agent pairing pool and what it cost
      ════════════════════════════════════════════════════════════════════════════════
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
    expect(norm(tsInit(fx, []), fx)).toMatchInlineSnapshot(`
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

  it("legacy project launches a selected agent then applies its plan", () => {
    const fx = legacyFixtureWithFakeClaude();
    expect(norm(tsInit(fx, []), fx)).toMatchInlineSnapshot(`
      {
        "status": 0,
        "stderr": "
      ",
        "stdout": "[roll] Detected: legacy project (no AGENTS.md, manifest: package.json)

        Onboarding
        Onboarding requires an AI agent to read your code. Detected:

          ✓ claude   (installed)

      The process will use your agent to call models. Token cost is on your own account.
        Onboarding uses your agent to call models — tokens are billed to your account.

      Code and conversations stay in your agent tool — Roll does not upload anything.
        Your code and conversation stay in your agent — Roll never uploads anything.


      [roll] Launching claude…
        Conversation ends with /exit (or Ctrl-C). On exit Roll will run apply for you.
      Use /exit to end (or Ctrl-C). Roll will auto-apply after exit.

      [roll] Plan written. Running apply…
      [roll] Applying onboard plan...

      Roll convention sync summary
        │  + created     AGENTS.md                     │
        │  + created     .roll/.version                │
        │  + created     .roll/backlog.md              │
        │  + created     .roll/features/               │
        │  + created     .roll/features.md             │
        └─────────────────────────────────────────────────────┘

      [roll] Syncing conventions to AI tools...

      [roll] Onboard apply complete.  Onboard
      ",
      }
    `);
    expect(read(fx.proj, ".roll/onboard-plan.yaml")).toContain("legacy cli");
    expect(read(fx.proj, ".roll/onboard-changeset.yaml")).toContain(".roll/backlog.md");
    expect(read(fx.proj, "AGENTS.md")).toContain("# Agent Conventions");
  });
});
