/**
 * diff-test: TS AgentRegistry vs the frozen bash oracle (bin/roll). Extraction
 * follows the store/picker difftest harness: `sed`-slice each `_fn()` body,
 * `eval` it, run against fabricated inputs, byte/value-compare to the TS port.
 *
 * Functions mirrored (bin/roll line ranges):
 *   _canonical_agent_name (~115), _agent_display_name (~125),
 *   _agent_bin_names (~98), _agent_is_known (~178),
 *   _agents_line_agent_value (~222), _agents_config_path (~205),
 *   _agents_config_slot (~237), _agents_config_set_slot (~309),
 *   _agent_installed_by_name (~137).
 *
 * `_agents_config_slot` calls `warn` on an unknown agent; the harness stubs
 * `warn` to a no-op so the stdout value stays clean (the TS port emits no
 * warning string from readSlotFromText — warnings are a caller concern).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  agentDisplayName,
  agentInstalledByName,
  canonicalAgentName,
  readSlotFromText,
  setSlotInText,
  type AgentEnv,
} from "../src/index.js";

const REPO = resolve(__dirname, "../../..");
const ROLLBIN = `${REPO}/bin/roll`;
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

/** Slice a `_fn()` body out of bin/roll for `eval`. */
function extract(fn: string): string {
  return `eval "$(sed -n '/^${fn}()/,/^}$/p' "${ROLLBIN}")"`;
}

function runBash(script: string, env: Record<string, string> = {}): string {
  return execFileSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, ROLLBIN, ...env },
  }).trim();
}

describe("diff-test: identity helpers == bash", () => {
  const names = ["antigravity", "gemini", "agy", "claude", "codex", "kimi", "weird"];
  it("canonicalAgentName", () => {
    for (const n of names) {
      const bash = runBash(`${extract("_canonical_agent_name")}\n_canonical_agent_name '${n}'`);
      expect(canonicalAgentName(n)).toBe(bash);
    }
  });
  it("agentDisplayName", () => {
    for (const n of names) {
      const bash = runBash(
        `${extract("_canonical_agent_name")}\n${extract("_agent_display_name")}\n_agent_display_name '${n}'`,
      );
      expect(agentDisplayName(n)).toBe(bash);
    }
  });
});

describe("diff-test: slot read after slot write == bash file bytes", () => {
  /** Write a slot via the bash oracle into a temp agents.yaml; return file bytes. */
  function bashWrite(initial: string | null, slot: string, agent: string): string {
    const proj = mkdtempSync(join(tmpdir(), "roll-agents-"));
    dirs.push(proj);
    mkdirSync(join(proj, ".roll"), { recursive: true });
    const path = join(proj, ".roll", "agents.yaml");
    if (initial !== null) writeFileSync(path, initial, "utf8");
    const script = [
      extract("_agents_config_path"),
      extract("_agents_line_agent_value"),
      extract("_agents_config_set_slot"),
      `_agents_config_set_slot "$1" "$2" "$3"`,
    ].join("\n");
    execFileSync("bash", ["-c", script, "bash", slot, agent, path], {
      cwd: proj,
      encoding: "utf8",
      env: { ...process.env, ROLLBIN },
    });
    return readFileSync(path, "utf8");
  }

  /** Read a slot via the bash oracle from given file bytes; return the value. */
  function bashRead(content: string, slot: string): string {
    const proj = mkdtempSync(join(tmpdir(), "roll-agents-r-"));
    dirs.push(proj);
    const path = join(proj, "agents.yaml");
    writeFileSync(path, content, "utf8");
    const script = [
      "warn() { :; }",
      extract("_canonical_agent_name"),
      extract("_agent_bin_names"),
      extract("_agent_is_known"),
      extract("_agents_line_agent_value"),
      extract("_agents_config_path"),
      extract("_agents_config_slot"),
      `_agents_config_slot "$1" "$2" || true`,
    ].join("\n");
    return execFileSync("bash", ["-c", script, "bash", slot, path], {
      encoding: "utf8",
      env: { ...process.env, ROLLBIN },
    }).trim();
  }

  const CASES: Array<{ name: string; initial: string | null; slot: string; agent: string }> = [
    { name: "seed fresh file", initial: null, slot: "easy", agent: "kimi" },
    {
      name: "rewrite inline slot, preserve others",
      initial: "schema: v3\neasy: { agent: kimi }\ndefault: { agent: claude }\n",
      slot: "easy",
      agent: "qwen",
    },
    {
      name: "rewrite nested slot to inline, drop old line",
      initial: "easy:\n  agent: kimi\nhard:\n  agent: claude\n",
      slot: "easy",
      agent: "qwen",
    },
    {
      name: "append absent slot",
      initial: "schema: v3\neasy: { agent: kimi }\n",
      slot: "hard",
      agent: "claude",
    },
  ];

  for (const c of CASES) {
    it(`${c.name}: TS bytes == bash bytes`, () => {
      const bashBytes = bashWrite(c.initial, c.slot, c.agent);
      const tsBytes = setSlotInText(c.initial ?? "", c.slot as "easy" | "default" | "hard", c.agent);
      expect(tsBytes).toBe(bashBytes);
      // And the round-trip read of the bash-written file agrees on both sides.
      const bashVal = bashRead(bashBytes, c.slot);
      const tsVal = readSlotFromText(bashBytes, c.slot as "easy" | "default" | "hard") ?? "";
      expect(tsVal).toBe(bashVal);
    });
  }

  it("read of an unknown-agent slot: value still returned (warn suppressed)", () => {
    const content = "schema: v3\neasy: { agent: bogusagent }\n";
    const bashVal = bashRead(content, "easy");
    const tsVal = readSlotFromText(content, "easy") ?? "";
    expect(tsVal).toBe("bogusagent");
    expect(tsVal).toBe(bashVal);
  });
});

describe("diff-test: installed-by-name under fabricated PATH/HOME == bash", () => {
  /** Run the bash oracle's _agent_installed_by_name with a fabricated PATH+HOME. */
  function bashInstalled(agent: string, binDir: string, home: string): boolean {
    const script = [
      extract("_agent_bin_names"),
      extract("_agent_installed_by_name"),
      `_agent_installed_by_name "$1" && echo yes || echo no`,
    ].join("\n");
    // PATH = sandbox binDir + the minimal system dirs (so `bash` itself is
    // found) but NOT the user dirs where a real codex/claude might live — the
    // fabricated binary is then the only agent on PATH, matching the TS env.
    const out = execFileSync("bash", ["-c", script, "bash", agent], {
      encoding: "utf8",
      env: { ...process.env, ROLLBIN, PATH: `${binDir}:/bin:/usr/bin`, HOME: home },
    }).trim();
    return out === "yes";
  }

  /** A TS AgentEnv backed by the same fabricated PATH+HOME the bash sees. */
  function tsEnv(binDir: string, home: string): AgentEnv {
    const isFile = (p: string): boolean => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    };
    return {
      home,
      commandOnPath: (bin) => isFile(join(binDir, bin)),
      dirExists: (p) => {
        try {
          return statSync(p).isDirectory();
        } catch {
          return false;
        }
      },
      fileExecutable: isFile,
    };
  }

  it("binary on a fabricated PATH → installed on both sides", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "roll-path-"));
    dirs.push(sandbox);
    const binDir = join(sandbox, "bin");
    const home = join(sandbox, "home");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(home, { recursive: true });
    // Provide a fake `codex` binary (executable file) on PATH.
    const codex = join(binDir, "codex");
    writeFileSync(codex, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    execFileSync("chmod", ["+x", codex]);

    const env = tsEnv(binDir, home);
    for (const a of ["codex", "openai", "claude", "kimi"]) {
      expect(agentInstalledByName(env, a)).toBe(bashInstalled(a, binDir, home));
    }
    // codex/openai both resolve to the codex binary → installed; others absent.
    expect(agentInstalledByName(env, "codex")).toBe(true);
    expect(agentInstalledByName(env, "claude")).toBe(false);
  });

  it("trae dir under fabricated HOME → installed on both sides", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "roll-home-"));
    dirs.push(sandbox);
    const binDir = join(sandbox, "bin");
    const home = join(sandbox, "home");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(join(home, ".config", "Trae"), { recursive: true });
    const env = tsEnv(binDir, home);
    expect(agentInstalledByName(env, "trae")).toBe(true);
    expect(agentInstalledByName(env, "trae")).toBe(bashInstalled("trae", binDir, home));
  });
});
