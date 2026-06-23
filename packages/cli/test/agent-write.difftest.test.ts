/**
 * Frozen-expectation tests for the TS-owned `roll agent` write surface.
 *
 * US-PORT-018 removes the command-level bash fallback: view/list/use/set/unknown
 * all run in TS. These tests use an injected AgentEnv and temp project dirs, so
 * they never spawn `bin/roll` and never inspect the real machine's installed
 * agents.
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { AgentEnv } from "@roll/core";
import { repoRoot } from "../src/bridge.js";
import { agentCommand } from "../src/commands/agent.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tempProject(): string {
  const d = mkdtempSync(join(tmpdir(), "roll-agent-write-"));
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
    readLine?: () => string | undefined;
    listCommand?: (args: string[]) => number;
    before?: (cwd: string) => void;
    refreshAggregates?: (cwd: string) => void;
  } = {},
): { code: number; stdout: string; stderr: string; cwd: string } {
  const cwd = tempProject();
  const saveCwd = process.cwd();
  const saveEnv: Record<string, string | undefined> = {};
  for (const key of ["NO_COLOR", "ROLL_LANG", "ROLL_AGENTS_CONFIG"]) saveEnv[key] = process.env[key];
  process.env["NO_COLOR"] = "1";
  process.env["ROLL_LANG"] = "en";
  delete process.env["ROLL_AGENTS_CONFIG"];
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
      readLine: opts.readLine,
      listCommand: opts.listCommand,
      refreshAggregates: opts.refreshAggregates ?? (() => {}),
    });
  } finally {
    process.chdir(saveCwd);
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    for (const [key, value] of Object.entries(saveEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return { code, stdout: out.join(""), stderr: err.join(""), cwd };
}

describe("roll agent write surface", () => {
  it("delegates list without fallback", () => {
    let seen: string[] = [];
    const r = run(["list", "--x"], {
      listCommand: (args) => {
        seen = args;
        return 44;
      },
    });
    expect(r.code).toBe(44);
    expect(seen).toEqual(["--x"]);
  });

  it("bare view renders the no-config state in TS", () => {
    expect(run([])).toMatchObject({
      code: 0,
      stderr: "",
      stdout: `
  Complexity routing (.roll/agents.yaml)

    No .roll/agents.yaml yet — routing falls back to the first installed agent.
    Set up routing: roll agent set <slot> <agent>  (or migrate from a legacy config)

`,
    });
  });

  it("use locks easy/default/hard and syncs local.yaml", () => {
    const r = run(["use", "kimi"], { installed: ["kimi"] });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("[roll] easy/default/hard all locked to kimi  (fallback unchanged)\n");
    expect(readFileSync(join(r.cwd, ".roll", "agents.yaml"), "utf8")).toBe(
      "schema: v3\neasy: { agent: kimi }\ndefault: { agent: kimi }\nhard: { agent: kimi }\n",
    );
    expect(readFileSync(join(r.cwd, ".roll", "local.yaml"), "utf8")).toBe("agent: kimi\n");
  });

  it("US-AGENT-045 AC1: use silently migrates provider aliases to canonical agents", () => {
    const r = run(["use", "openai"], { installed: ["codex"] });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("[roll] easy/default/hard all locked to codex  (fallback unchanged)\n");
    expect(readFileSync(join(r.cwd, ".roll", "agents.yaml"), "utf8")).toBe(
      "schema: v3\neasy: { agent: codex }\ndefault: { agent: codex }\nhard: { agent: codex }\n",
    );
    expect(readFileSync(join(r.cwd, ".roll", "local.yaml"), "utf8")).toBe("agent: codex\n");
  });

  it("use rejects known but uninstalled agents", () => {
    expect(run(["use", "qwen"])).toMatchObject({
      code: 1,
      stdout: "",
      stderr: "[roll] 'qwen' is no longer supported. Use one of: claude, kimi, codex, pi, agy, reasonix\n",
    });
  });

  it("use without a name prints usage", () => {
    expect(run(["use"])).toMatchObject({
      code: 1,
      stdout: "",
      stderr: "[roll] Usage: roll agent use <name>   (locks easy/default/hard to one agent)\n",
    });
  });

  it("set writes a single slot and does not require the agent to be installed", () => {
    const r = run(["set", "fallback", "pi"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("[roll] fallback → pi  saved\n");
    expect(readFileSync(join(r.cwd, ".roll", "agents.yaml"), "utf8")).toBe(
      "schema: v3\nfallback: { agent: pi }\n",
    );
  });

  it("US-AGENT-045 AC1: set silently migrates provider aliases to canonical agents", () => {
    const r = run(["set", "easy", "deepseek"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("[roll] easy → pi  saved\n");
    expect(readFileSync(join(r.cwd, ".roll", "agents.yaml"), "utf8")).toBe(
      "schema: v3\neasy: { agent: pi }\n",
    );
  });

  it("set rejects unknown slots and unknown agents", () => {
    expect(run(["set", "bogus", "claude"])).toMatchObject({
      code: 1,
      stdout: "",
      stderr: "[roll] Unknown slot 'bogus' (expected easy|default|hard|fallback)\n",
    });
    expect(run(["set", "easy", "qwen"])).toMatchObject({
      code: 1,
      stdout: "",
      stderr: "[roll] 'qwen' is no longer supported. Use one of: claude, kimi, codex, pi, agy, reasonix\n",
    });
  });

  it("unknown subcommand is TS-owned", () => {
    expect(run(["bogus"])).toMatchObject({
      code: 1,
      stdout: "Usage: roll agent [set <slot> <agent>|use <name>|list]\n",
      stderr: "[roll] Unknown subcommand: bogus\n",
    });
  });

  it("agent registry no longer has a bash fallback branch", () => {
    const src = readFileSync(`${repoRoot()}/packages/cli/src/commands/index.ts`, "utf8");
    expect(src).not.toContain('fallbackToBash(["agent"');
  });

  it("use removes the legacy root .roll.yaml agent line", () => {
    const r = run(["use", "kimi"], {
      installed: ["kimi"],
      before: (cwd) => {
        rmSync(join(cwd, ".roll.yaml"), { force: true });
        // Include another key so the file is preserved after the agent line is removed.
        writeFileSync(join(cwd, ".roll.yaml"), "agent: pi\nother: kept\n", "utf8");
      },
    });
    const legacy = join(r.cwd, ".roll.yaml");
    expect(existsSync(legacy)).toBe(true);
    expect(readFileSync(legacy, "utf8")).toBe("other: kept\n");
  });

  it("FIX-378 AC1: use refreshes dossier aggregates after successful slot writes", () => {
    let refreshedCwd = "";
    const r = run(["use", "kimi"], {
      installed: ["kimi"],
      refreshAggregates: (cwd) => {
        refreshedCwd = cwd;
        expect(readFileSync(join(cwd, ".roll", "agents.yaml"), "utf8")).toContain("default: { agent: kimi }");
      },
    });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(realpathSync(refreshedCwd)).toBe(realpathSync(r.cwd));
  });

  it("FIX-378 AC2: set refreshes dossier aggregates after a successful slot write", () => {
    let refreshedCwd = "";
    const r = run(["set", "fallback", "pi"], {
      refreshAggregates: (cwd) => {
        refreshedCwd = cwd;
        expect(readFileSync(join(cwd, ".roll", "agents.yaml"), "utf8")).toContain("fallback: { agent: pi }");
      },
    });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(realpathSync(refreshedCwd)).toBe(realpathSync(r.cwd));
  });

  it("FIX-378 AC3: refresh failures warn but keep the committed slot write successful", () => {
    let called = false;
    const r = run(["set", "easy", "pi"], {
      refreshAggregates: () => {
        called = true;
        throw new Error("disk full");
      },
    });
    expect(r.code).toBe(0);
    expect(called).toBe(true);
    expect(r.stdout).toBe("[roll] easy → pi  saved\n");
    expect(r.stderr).toContain("[roll] WARN dossier refresh failed after agent slot update");
    expect(r.stderr).toContain("Error: disk full");
    expect(readFileSync(join(r.cwd, ".roll", "agents.yaml"), "utf8")).toContain("easy: { agent: pi }");
  });

  it("FIX-378 AC3: read-only view and list do not refresh dossier aggregates", () => {
    let calls = 0;
    const refreshAggregates = (): void => {
      calls += 1;
    };
    const view = run([], { refreshAggregates });
    const list = run(["list"], {
      refreshAggregates,
      listCommand: () => 0,
    });
    expect(view.code).toBe(0);
    expect(list.code).toBe(0);
    expect(calls).toBe(0);
  });

  it("FIX-378: failed write commands do not refresh dossier aggregates", () => {
    let calls = 0;
    const refreshAggregates = (): void => {
      calls += 1;
    };
    expect(run(["use", "qwen"], { refreshAggregates }).code).toBe(1);
    expect(run(["set", "bogus", "claude"], { refreshAggregates }).code).toBe(1);
    expect(run(["set", "easy", "qwen"], { refreshAggregates }).code).toBe(1);
    expect(calls).toBe(0);
  });

  it("FIX-378 AC4: every agent command setSlot mutation is paired with the refresh helper", () => {
    const src = readFileSync(`${repoRoot()}/packages/cli/src/commands/agent.ts`, "utf8");
    expect([...src.matchAll(/reg\.setSlot\(/g)]).toHaveLength(2);
    expect([...src.matchAll(/refreshAgentDossier\(deps\);/g)]).toHaveLength(2);
    expect(src).not.toContain("writeFileSync(\".roll/agents.yaml\"");
  });
});
