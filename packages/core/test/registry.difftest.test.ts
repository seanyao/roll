/**
 * Frozen-expectation test: TS AgentRegistry.
 *
 * The registry helpers were proven byte-equal to the bash oracle (bin/roll)
 * under diff-test (sed-slice + eval each `_fn()`). Per US-PORT-009b the oracle is
 * retired: the `bash`/`sed` spawns are dropped and each case asserts against the
 * frozen value captured while the oracle agreed. Identity + slot inputs are
 * fixed strings → portable literals; the installed-by-name cases drive a real
 * fabricated PATH/HOME (project I/O, never the v2 engine) and assert the frozen
 * boolean verdict.
 *
 * Functions mirrored (bin/roll line ranges): _canonical_agent_name (~115),
 * _agent_display_name (~125), _agents_config_set_slot (~309),
 * _agents_config_slot (~237), _agent_installed_by_name (~137).
 */
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import {
  agentDisplayName,
  agentInstalledByName,
  canonicalAgentName,
  readSlotFromText,
  setSlotInText,
  type AgentEnv,
} from "../src/index.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execFileSync("rm", ["-rf", d]);
});

describe("frozen: identity helpers == bash", () => {
  // Overseas agents + their aliases were removed from the pool, so
  // canonicalAgentName / agentDisplayName are now no-ops: every name (including
  // unknowns) is returned verbatim.
  const names = ["kimi", "pi", "reasonix", "deepseek", "weird"];
  const VERBATIM = ["kimi", "pi", "reasonix", "deepseek", "weird"];
  it("canonicalAgentName", () => {
    expect(names.map((n) => canonicalAgentName(n))).toEqual(VERBATIM);
  });
  it("agentDisplayName", () => {
    expect(names.map((n) => agentDisplayName(n))).toEqual(VERBATIM);
  });
});

describe("frozen: slot write bytes + round-trip read == bash", () => {
  const CASES: Array<{
    name: string;
    initial: string | null;
    slot: "easy" | "default" | "hard";
    agent: string;
    bytes: string;
    read: string;
  }> = [
    { name: "seed fresh file", initial: null, slot: "easy", agent: "kimi", bytes: "schema: v3\neasy: { agent: kimi }\n", read: "kimi" },
    {
      name: "rewrite inline slot, preserve others",
      initial: "schema: v3\neasy: { agent: kimi }\ndefault: { agent: claude }\n",
      slot: "easy",
      agent: "qwen",
      bytes: "schema: v3\neasy: { agent: qwen }\ndefault: { agent: claude }\n",
      read: "qwen",
    },
    {
      name: "rewrite nested slot to inline, drop old line",
      initial: "easy:\n  agent: kimi\nhard:\n  agent: claude\n",
      slot: "easy",
      agent: "qwen",
      bytes: "easy: { agent: qwen }\nhard:\n  agent: claude\n",
      read: "qwen",
    },
    {
      name: "append absent slot",
      initial: "schema: v3\neasy: { agent: kimi }\n",
      slot: "hard",
      agent: "claude",
      bytes: "schema: v3\neasy: { agent: kimi }\nhard: { agent: claude }\n",
      read: "claude",
    },
  ];

  for (const c of CASES) {
    it(`${c.name}: bytes + round-trip read`, () => {
      const bytes = setSlotInText(c.initial ?? "", c.slot, c.agent);
      expect(bytes).toBe(c.bytes);
      expect(readSlotFromText(bytes, c.slot)?.agent ?? "").toBe(c.read);
    });
  }

  it("read of an unknown-agent slot still returns the value", () => {
    expect(readSlotFromText("schema: v3\neasy: { agent: bogusagent }\n", "easy")?.agent ?? "").toBe("bogusagent");
  });
});

describe("frozen: installed-by-name under a fabricated PATH/HOME", () => {
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

  it("binary on a fabricated PATH → installed (pi), others absent", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "roll-path-"));
    dirs.push(sandbox);
    const binDir = join(sandbox, "bin");
    const home = join(sandbox, "home");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(home, { recursive: true });
    const pi = join(binDir, "pi");
    writeFileSync(pi, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    execFileSync("chmod", ["+x", pi]);

    const env = tsEnv(binDir, home);
    // pi binary present → installed; kimi/reasonix binaries absent.
    const FROZEN: Record<string, boolean> = { pi: true, kimi: false, reasonix: false };
    for (const [a, expected] of Object.entries(FROZEN)) {
      expect(agentInstalledByName(env, a)).toBe(expected);
    }
  });
});
