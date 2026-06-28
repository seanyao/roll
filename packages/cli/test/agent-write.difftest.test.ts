/**
 * Frozen-expectation tests for the TS-owned `roll agent` write surface (v4).
 *
 * US-V4-002 separates the GLOBAL machine default (`primary_agent` in
 * `~/.roll/config.yaml`) from the PROJECT route profile (`.roll/agents.yaml`):
 *   - `roll agent default <agent>` sets the machine default and only rewrites
 *     project routes that still FOLLOW the old default (customized profiles are
 *     preserved);
 *   - `roll agent set <route> <agent>` overrides one project route;
 *   - `roll agent use` is RETIRED — it fails loudly with migration guidance.
 *
 * These tests inject an AgentEnv + in-memory default store and temp project
 * dirs, so they never spawn `bin/roll` and never touch the real machine config.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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
    initialDefault?: string | null;
  } = {},
): { code: number; stdout: string; stderr: string; cwd: string; finalDefault: string | null } {
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
  // In-memory global machine default (US-V4-002 seam — never touches real ~/.roll).
  let defaultAgent: string | null = opts.initialDefault ?? null;
  let code = 1;
  try {
    opts.before?.(cwd);
    code = agentCommand(args, {
      env: env(opts.installed ?? []),
      readLine: opts.readLine,
      listCommand: opts.listCommand,
      readDefaultAgent: () => defaultAgent,
      writeDefaultAgent: (n) => {
        defaultAgent = n;
      },
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
  return { code, stdout: out.join(""), stderr: err.join(""), cwd, finalDefault: defaultAgent };
}

/** Seed a project route profile (.roll/agents.yaml) in canonical inline form. */
function seedRoutes(cwd: string, lines: Record<string, string>): void {
  mkdirSync(join(cwd, ".roll"), { recursive: true });
  const body = ["schema: v3", ...Object.entries(lines).map(([slot, agent]) => `${slot}: { agent: ${agent} }`)].join("\n");
  writeFileSync(join(cwd, ".roll", "agents.yaml"), body + "\n", "utf8");
}

describe("roll agent write surface (v4)", () => {
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

  it("bare view shows the default-agent section and the project-route section", () => {
    const r = run([]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    // Two distinct concerns are surfaced.
    expect(r.stdout).toContain("Default agent (~/.roll/config.yaml)");
    expect(r.stdout).toContain("No machine default agent set yet");
    expect(r.stdout).toContain("Project routes (.roll/agents.yaml)");
    expect(r.stdout).toContain("No .roll/agents.yaml yet");
    // v4 help: default + set, no `use`.
    expect(r.stdout).toContain("roll agent default <agent>");
    expect(r.stdout).toContain("roll agent set <route> <agent>");
    expect(r.stdout).not.toContain("roll agent use");
  });

  it("bare view renders the configured default and project routes", () => {
    const r = run([], {
      installed: ["codex"],
      initialDefault: "codex",
      before: (cwd) => seedRoutes(cwd, { default: "codex", hard: "kimi" }),
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("codex"); // machine default shown
    expect(r.stdout).toContain("kimi"); // a project route override shown
  });

  // ── roll agent default ───────────────────────────────────────────
  it("default <agent> sets the machine default (no project routes to rewrite)", () => {
    const r = run(["default", "codex"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.finalDefault).toBe("codex");
    expect(r.stdout).toContain("Machine default agent set to");
    // No agents.yaml is created by a default change.
    expect(existsSync(join(r.cwd, ".roll", "agents.yaml"))).toBe(false);
  });

  it("default with no arg prints the current default", () => {
    const r = run(["default"], { initialDefault: "kimi" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Machine default agent:");
    expect(r.stdout).toContain("kimi");
  });

  it("default with no arg and no configured default says so", () => {
    const r = run(["default"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("No machine default agent set yet");
  });

  it("default rewrites project routes that still FOLLOW the old default", () => {
    const r = run(["default", "codex"], {
      initialDefault: "claude",
      before: (cwd) => seedRoutes(cwd, { easy: "claude", default: "claude", hard: "claude" }),
    });
    expect(r.code).toBe(0);
    expect(r.finalDefault).toBe("codex");
    expect(r.stdout).toContain("updated to"); // routes-followed message
    const yaml = readFileSync(join(r.cwd, ".roll", "agents.yaml"), "utf8");
    expect(yaml).toContain("easy: { agent: codex }");
    expect(yaml).toContain("default: { agent: codex }");
    expect(yaml).toContain("hard: { agent: codex }");
  });

  it("default PRESERVES customized project routes (does not silently overwrite)", () => {
    const r = run(["default", "codex"], {
      initialDefault: "claude",
      before: (cwd) => seedRoutes(cwd, { easy: "kimi", default: "claude", hard: "claude" }),
    });
    expect(r.code).toBe(0);
    expect(r.finalDefault).toBe("codex");
    expect(r.stdout).toContain("preserved");
    // The customized profile is untouched.
    const yaml = readFileSync(join(r.cwd, ".roll", "agents.yaml"), "utf8");
    expect(yaml).toContain("easy: { agent: kimi }");
    expect(yaml).toContain("default: { agent: claude }");
  });

  it("default rejects a removed agent with directed guidance", () => {
    const r = run(["default", "qwen"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no longer supported");
    expect(r.finalDefault).toBeNull();
  });

  it("default rejects an unknown agent", () => {
    const r = run(["default", "bogus"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Unknown agent 'bogus'");
    expect(r.finalDefault).toBeNull();
  });

  // ── roll agent use (retired) ─────────────────────────────────────
  it("use is RETIRED — fails loudly with migration guidance, writes nothing", () => {
    const r = run(["use", "kimi"], { installed: ["kimi"] });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("retired");
    expect(r.stderr).toContain("roll agent default");
    expect(r.stderr).toContain("roll agent set");
    expect(existsSync(join(r.cwd, ".roll", "agents.yaml"))).toBe(false);
    expect(existsSync(join(r.cwd, ".roll", "local.yaml"))).toBe(false);
  });

  // ── roll agent set ───────────────────────────────────────────────
  it("set writes a single route and does not require the agent to be installed", () => {
    const r = run(["set", "fallback", "pi"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("[roll] fallback → pi  saved\n");
    expect(readFileSync(join(r.cwd, ".roll", "agents.yaml"), "utf8")).toBe("schema: v3\nfallback: { agent: pi }\n");
  });

  it("set silently migrates provider aliases to canonical agents", () => {
    const r = run(["set", "easy", "deepseek"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("[roll] easy → pi  saved\n");
    expect(readFileSync(join(r.cwd, ".roll", "agents.yaml"), "utf8")).toBe("schema: v3\neasy: { agent: pi }\n");
  });

  it("set does NOT change the machine default (project-local only)", () => {
    const r = run(["set", "easy", "pi"], { initialDefault: "claude" });
    expect(r.code).toBe(0);
    expect(r.finalDefault).toBe("claude"); // global default untouched
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

  it("unknown subcommand is TS-owned (v4 usage line)", () => {
    expect(run(["bogus"])).toMatchObject({
      code: 1,
      stdout: "Usage: roll agent [default <agent>|set <route> <agent>|list]\n",
      stderr: "[roll] Unknown subcommand: bogus\n",
    });
  });

  it("agent registry no longer has a bash fallback branch", () => {
    const src = readFileSync(`${repoRoot()}/packages/cli/src/commands/index.ts`, "utf8");
    expect(src).not.toContain('fallbackToBash(["agent"');
  });

  it("US-V4-002: agent writes no longer trigger a global dossier refresh", () => {
    const src = readFileSync(`${repoRoot()}/packages/cli/src/commands/agent.ts`, "utf8");
    expect(src).not.toContain("refreshAggregates");
    expect(src).not.toContain("refreshAgentDossier");
  });
});
