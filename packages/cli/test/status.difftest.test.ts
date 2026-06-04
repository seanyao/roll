/**
 * diff-test: TS `roll status` == python lib/roll-status.py (frozen v2 oracle).
 * Fixture render (deterministic) + live render in a fabricated HOME/project.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { statusCommand } from "../src/commands/status.js";

const REPO = resolve(__dirname, "../../..");
const PY = join(REPO, "lib", "roll-status.py");
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

/** Run the TS command in-process with env/cwd, capturing stdout. */
function tsStatus(env: Record<string, string | undefined>, cwd?: string): string {
  const saveEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saveEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const saveCwd = process.cwd();
  if (cwd !== undefined) process.chdir(cwd);
  const chunks: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  // @ts-expect-error — capture-only override
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  try {
    statusCommand(["--no-color"]);
  } finally {
    process.stdout.write = realWrite;
    process.chdir(saveCwd);
    for (const [k, v] of Object.entries(saveEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return chunks.join("");
}

function pyStatus(env: Record<string, string>, cwd?: string): string {
  return execFileSync("python3", [PY, "--no-color"], {
    cwd: cwd ?? REPO,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("diff-test: roll status == roll-status.py", () => {
  it("fixture render matches byte-for-byte", () => {
    const py = pyStatus({ ROLL_RENDER_FIXTURE: "1" });
    const ts = tsStatus({ ROLL_RENDER_FIXTURE: "1" }, REPO);
    expect(ts).toBe(py);
  });

  it("live render matches in a fabricated HOME + project", () => {
    const home = mkdtempSync(join(tmpdir(), "roll-status-home-"));
    const proj = mkdtempSync(join(tmpdir(), "roll-status-proj-"));
    dirs.push(home, proj);

    // ROLL_HOME with: 3/5 conventions, 2 templates, 2 skills, config with
    // one synced + one missing AI client.
    const rollHome = join(home, ".roll");
    const gd = join(rollHome, "conventions", "global");
    mkdirSync(gd, { recursive: true });
    for (const f of ["AGENTS.md", "CLAUDE.md", ".cursor-rules"]) {
      writeFileSync(join(gd, f), `# ${f}\n`);
    }
    const td = join(rollHome, "conventions", "templates");
    mkdirSync(join(td, "fullstack", "sub"), { recursive: true });
    writeFileSync(join(td, "fullstack", "a.md"), "a");
    writeFileSync(join(td, "fullstack", "sub", "b.md"), "b");
    mkdirSync(join(td, "cli"), { recursive: true });
    writeFileSync(join(td, "cli", "c.md"), "c");
    mkdirSync(join(rollHome, "skills", "roll-build"), { recursive: true });
    mkdirSync(join(rollHome, "skills", "roll-fix"), { recursive: true });

    // synced client: cfg file with @roll.md + roll.md identical to src
    const claudeDir = join(home, ".claude");
    mkdirSync(join(claudeDir, "skills", "roll-build"), { recursive: true });
    symlinkSync(join(rollHome, "skills", "roll-fix"), join(claudeDir, "skills", "roll-fix"));
    writeFileSync(join(claudeDir, "CLAUDE.md"), "hello\n@roll.md\n");
    writeFileSync(join(claudeDir, "roll.md"), "ROLL GLOBAL\n");
    writeFileSync(join(gd, "CLAUDE.md"), "ROLL GLOBAL\n"); // src == roll.md
    // missing client: dir exists but no cfg file
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      join(rollHome, "config.yaml"),
      [
        `ai_claude: ${claudeDir}|CLAUDE.md|CLAUDE.md`,
        `ai_cursor: ${join(home, ".cursor")}|AGENTS.md|AGENTS.md`,
        "",
      ].join("\n"),
    );

    // project dir: AGENTS.md + backlog + 2 feature docs, plain dir (no git)
    writeFileSync(join(proj, "AGENTS.md"), "x\n");
    mkdirSync(join(proj, ".roll", "features"), { recursive: true });
    writeFileSync(join(proj, ".roll", "backlog.md"), "b\n");
    writeFileSync(join(proj, ".roll", "features", "f1.md"), "f\n");
    writeFileSync(join(proj, ".roll", "features", "f2.md"), "f\n");

    const env = { HOME: home, ROLL_HOME: rollHome };
    const py = pyStatus(env, proj);
    const ts = tsStatus(env, proj);
    expect(ts).toBe(py);
  });
});
