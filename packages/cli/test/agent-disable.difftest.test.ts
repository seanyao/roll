/**
 * US-AGENT-050 — CLI difftests for `roll agent disable/enable`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { AgentEnv } from "@roll/core";
import { agentCommand } from "../src/commands/agent.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tempProject(): string {
  const d = mkdtempSync(join(tmpdir(), "roll-agent-disable-"));
  dirs.push(d);
  return d;
}

function env(installed: string[]): AgentEnv {
  const bins = new Set(installed);
  return {
    home: "/home/tester",
    commandOnPath: (bin) => bins.has(bin),
    dirExists: () => false,
    fileExecutable: () => false,
  };
}

function run(
  args: string[],
  opts: {
    installed?: string[];
    before?: (cwd: string) => void;
    listCommand?: (args: string[]) => number;
  } = {},
): { code: number; stdout: string; stderr: string; cwd: string } {
  const cwd = tempProject();
  const saveCwd = process.cwd();
  const saveEnv: Record<string, string | undefined> = {};
  for (const key of ["NO_COLOR", "ROLL_LANG", "ROLL_AGENTS_CONFIG", "ROLL_HOME"]) saveEnv[key] = process.env[key];
  process.env["NO_COLOR"] = "1";
  process.env["ROLL_LANG"] = "en";
  delete process.env["ROLL_AGENTS_CONFIG"];
  process.env["ROLL_HOME"] = join(cwd, "home", ".roll");
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (out.push(String(c)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (c: string | Uint8Array): boolean => (err.push(String(c)), true);
  process.chdir(cwd);
  let code = 1;
  try {
    opts.before?.(cwd);
    code = agentCommand(args, {
      env: env(opts.installed ?? []),
      listCommand: opts.listCommand,
    });
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    process.chdir(saveCwd);
    for (const key of Object.keys(saveEnv)) process.env[key] = saveEnv[key];
  }
  return { code, stdout: out.join(""), stderr: err.join(""), cwd };
}

const VALID_AGENTS_YAML = `schema: roll-agents/v1
scope: project
agents:
  kimi:
    adapter: kimi
    capabilities: [execute, evaluate]
  claude:
    adapter: claude
    capabilities: [execute, evaluate]
roles:
  execute:
    kind: select
    from: [kimi, claude]
    strategy: first-available
  evaluate:
    kind: select
    from: [kimi, claude]
    strategy: first-available
`;

const KIMI_DISABLED_YAML = `schema: roll-agents/v1
scope: project
agents:
  kimi:
    adapter: kimi
    capabilities: [execute, evaluate]
    disabled: true
  claude:
    adapter: claude
    capabilities: [execute, evaluate]
roles:
  execute:
    kind: select
    from: [kimi, claude]
    strategy: first-available
  evaluate:
    kind: select
    from: [kimi, claude]
    strategy: first-available
`;

const CLAUDE_DISABLED_YAML = `schema: roll-agents/v1
scope: project
agents:
  kimi:
    adapter: kimi
    capabilities: [execute, evaluate]
  claude:
    adapter: claude
    capabilities: [execute, evaluate]
    disabled: true
roles:
  execute:
    kind: select
    from: [kimi, claude]
    strategy: first-available
  evaluate:
    kind: select
    from: [kimi, claude]
    strategy: first-available
`;

describe("roll agent disable", () => {
  it("fails when no agent name is given", () => {
    const result = run(["disable"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("missing agent name");
  });

  it("fails for unknown agent name", () => {
    const result = run(["disable", "nonexistent"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unknown agent");
  });

  it("fails when agents.yaml does not exist", () => {
    const result = run(["disable", "kimi"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("not found");
  });

  it("disables an agent in project scope", () => {
    const result = run(["disable", "kimi"], {
      before: (cwd) => {
        mkdirSync(join(cwd, ".roll"), { recursive: true });
        writeFileSync(join(cwd, ".roll/agents.yaml"), VALID_AGENTS_YAML, "utf8");
      },
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("disabled");
    // Verify the file was modified
    const newText = readFileSync(join(result.cwd, ".roll/agents.yaml"), "utf8");
    expect(newText).toContain("disabled: true");
    // disabled: true should be inside kimi's block, not elsewhere
    const afterKimi = newText.indexOf("disabled: true");
    const kimiPos = newText.indexOf("  kimi:");
    const claudePos = newText.indexOf("  claude:");
    expect(afterKimi).toBeGreaterThan(kimiPos);
    expect(afterKimi).toBeLessThan(claudePos);
  });

  it("is idempotent — disabling an already disabled agent succeeds", () => {
    const result = run(["disable", "kimi"], {
      before: (cwd) => {
        mkdirSync(join(cwd, ".roll"), { recursive: true });
        writeFileSync(join(cwd, ".roll/agents.yaml"), KIMI_DISABLED_YAML, "utf8");
      },
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("already disabled");
  });

  it("rejects when disabling would empty a role pool", () => {
    // Only one agent can execute
    const yaml = `schema: roll-agents/v1
scope: project
agents:
  kimi:
    adapter: kimi
    capabilities: [execute]
  claude:
    adapter: claude
    capabilities: [evaluate]
roles:
  execute:
    kind: fixed
    agent: kimi
`;
    const result = run(["disable", "kimi"], {
      before: (cwd) => {
        mkdirSync(join(cwd, ".roll"), { recursive: true });
        writeFileSync(join(cwd, ".roll/agents.yaml"), yaml, "utf8");
      },
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("would leave role");
  });

  it("allows --force to override pool protection", () => {
    const yaml = `schema: roll-agents/v1
scope: project
agents:
  kimi:
    adapter: kimi
    capabilities: [execute]
  claude:
    adapter: claude
    capabilities: [evaluate]
roles:
  execute:
    kind: fixed
    agent: kimi
`;
    const result = run(["disable", "kimi", "--force"], {
      before: (cwd) => {
        mkdirSync(join(cwd, ".roll"), { recursive: true });
        writeFileSync(join(cwd, ".roll/agents.yaml"), yaml, "utf8");
      },
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("disabled");
  });

  it("--machine targets ~/.roll/agents.yaml", () => {
    const result = run(["disable", "claude", "--machine"], {
      before: (cwd) => {
        const home = join(cwd, "home", ".roll");
        mkdirSync(home, { recursive: true });
        writeFileSync(join(home, "agents.yaml"), VALID_AGENTS_YAML, "utf8");
      },
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("disabled");
    const homePath = join(result.cwd, "home", ".roll", "agents.yaml");
    const newText = readFileSync(homePath, "utf8");
    expect(newText).toContain("disabled: true");
  });
});

describe("roll agent enable", () => {
  it("fails when no agent name is given", () => {
    const result = run(["enable"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("missing agent name");
  });

  it("fails for unknown agent name", () => {
    const result = run(["enable", "nonexistent"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unknown agent");
  });

  it("succeeds idempotently when file does not exist", () => {
    const result = run(["enable", "kimi"]);
    expect(result.code).toBe(0);
  });

  it("enables a disabled agent", () => {
    const result = run(["enable", "kimi"], {
      before: (cwd) => {
        mkdirSync(join(cwd, ".roll"), { recursive: true });
        writeFileSync(join(cwd, ".roll/agents.yaml"), KIMI_DISABLED_YAML, "utf8");
      },
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("enabled");
    const newText = readFileSync(join(result.cwd, ".roll/agents.yaml"), "utf8");
    expect(newText).not.toContain("disabled: true");
  });

  it("is idempotent — enabling an already enabled agent succeeds", () => {
    const result = run(["enable", "kimi"], {
      before: (cwd) => {
        mkdirSync(join(cwd, ".roll"), { recursive: true });
        writeFileSync(join(cwd, ".roll/agents.yaml"), VALID_AGENTS_YAML, "utf8");
      },
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("already enabled");
  });

  it("--machine targets ~/.roll/agents.yaml", () => {
    const result = run(["enable", "claude", "--machine"], {
      before: (cwd) => {
        const home = join(cwd, "home", ".roll");
        mkdirSync(home, { recursive: true });
        writeFileSync(join(home, "agents.yaml"), CLAUDE_DISABLED_YAML, "utf8");
      },
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("enabled");
    const homePath = join(result.cwd, "home", ".roll", "agents.yaml");
    const newText = readFileSync(homePath, "utf8");
    expect(newText).not.toContain("disabled: true");
  });
});
