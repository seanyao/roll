/**
 * FIX-238/239/240 — the ONE help contract.
 *
 * Smoke audit 2026-06-11 found the contract in pieces: `roll update --help`
 * EXECUTED the upgrade (network + global writes on a cry for help), init/setup
 * swallowed the flag name from their errors, five commands ignored --help and
 * ran their normal logic, agent/alert errored politely but exited 0, dream
 * called itself an unknown command, and `roll loop` advertised retired
 * monitor/attach subcommands.
 *
 * Contract: `roll <cmd> --help|-h` → usage on STDOUT, exit 0, NO side effects.
 * Unknown subcommand → stderr + non-zero. The bridge enforces the help half
 * centrally (table-driven below); commands keep richer internal help for
 * deeper flags.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { dispatch, registeredHelp, usage } from "../src/bridge.js";
import { registerAll } from "../src/commands/index.js";
import { loopUnknownSubcommand } from "../src/commands/loop-cycle-gates.js";
import { publicCommands, requireAllClassified, COMMAND_SURFACE } from "../src/lib/command-surface.js";

let out = "";
let err = "";
let ow: typeof process.stdout.write;
let oe: typeof process.stderr.write;
beforeEach(() => {
  registerAll();
  out = "";
  err = "";
  ow = process.stdout.write.bind(process.stdout);
  oe = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture
  process.stdout.write = (s: string): boolean => ((out += String(s)), true);
  // @ts-expect-error capture
  process.stderr.write = (s: string): boolean => ((err += String(s)), true);
});
afterEach(() => {
  process.stdout.write = ow;
  process.stderr.write = oe;
});

/** FIX-239 AC3 — table-driven: every command with registered help honors the contract. */
describe("help contract — table-driven across registered commands", () => {
  it("registers help for every smoke-audit offender", () => {
    const helped = registeredHelp();
    for (const cmd of ["update", "init", "setup", "backlog", "status", "doctor", "tune", "agent", "dream", "loop"]) {
      expect(helped, `${cmd} must register bridge help`).toContain(cmd);
    }
  });

  it("`roll <cmd> --help` → usage on stdout, exit 0, stderr silent — for EVERY helped command", async () => {
    for (const cmd of registeredHelp()) {
      out = "";
      err = "";
      const r = await dispatch([cmd, "--help"]);
      expect(r.status, `${cmd} --help must exit 0`).toBe(0);
      expect(out, `${cmd} --help must print usage to stdout`).toMatch(/usage|Usage|用法/);
      expect(err, `${cmd} --help must not write stderr`).toBe("");
    }
  });

  it("-h behaves identically", async () => {
    const r = await dispatch(["update", "-h"]);
    expect(r.status).toBe(0);
    expect(out).toMatch(/Usage/i);
  });
});

describe("FIX-238 — update never upgrades on a cry for help; init/setup name the bad flag", () => {
  it("update --help prints usage and performs NO upgrade", async () => {
    const r = await dispatch(["update", "--help"]);
    expect(r.status).toBe(0);
    expect(out).toContain("update");
    expect(out).not.toMatch(/npm install|Current version/i); // no side-effect path entered
  });

  it("init reports the offending flag BY NAME", async () => {
    const r = await dispatch(["init", "--bogus"]);
    expect(r.status).toBe(1);
    expect(err).toContain("--bogus");
  });

  it("setup reports the offending argument BY NAME", async () => {
    const r = await dispatch(["setup", "--wat"]);
    expect(r.status).toBe(1);
    expect(err).toContain("--wat");
  });
});

describe("FIX-239 — unknown subcommands are errors (stderr + non-zero)", () => {
  it("agent unknown subcommand → exit 1", async () => {
    const r = await dispatch(["agent", "frobnicate"]);
    expect(r.status).toBe(1);
    expect(err).toContain("frobnicate");
  });

  it("loop alert unknown subcommand → exit 1", async () => {
    const r = await dispatch(["loop", "alert", "frobnicate"]);
    expect(r.status).toBe(1);
  });

  it("dream unknown subcommand names the SUBCOMMAND, not itself", async () => {
    const r = await dispatch(["dream", "frobnicate"]);
    expect(r.status).toBe(1);
    expect(err).not.toContain("Unknown command: dream");
    expect(err).toContain("frobnicate");
  });
});

describe("FIX-240 — loop usage advertises only live subcommands", () => {
  it("usage carries the live set, not retired monitor/attach", () => {
    let captured = "";
    const real = process.stderr.write.bind(process.stderr);
    // @ts-expect-error capture
    process.stderr.write = (s: string): boolean => ((captured += String(s)), true);
    try {
      loopUnknownSubcommand("bogus");
    } finally {
      process.stderr.write = real;
    }
    expect(captured).not.toContain("monitor");
    expect(captured).not.toContain("attach");
    for (const live of ["on", "off", "now", "status", "runs", "eval", "signals", "pause", "resume", "gc"]) {
      expect(captured).toContain(live);
    }
  });
});

// ── REFACTOR-056: command-surface truth source ─────────────────────────

describe("REFACTOR-056 — command-surface truth source", () => {
  it("public command list matches the approved contract", () => {
    const expected = [
      "agent",
      "backlog",
      "config",
      "design",
      "doctor",
      "help",
      "idea",
      "init",
      "loop",
      "next",
      "release",
      "setup",
      "status",
      "test",
      "update",
    ];
    expect(publicCommands()).toEqual(expected);
  });

  it("roll --help lists only the approved public commands from the registry", () => {
    const helpText = usage();
    const cmdLine = helpText.split("\n").find((l) => l.startsWith("Commands:"));
    expect(cmdLine).toBeDefined();
    const cmds = cmdLine!
      .replace("Commands: ", "")
      .split(", ")
      .map((c) => c.trim())
      .filter(Boolean);
    expect(cmds).toEqual(publicCommands());
  });

  it("non-public commands do not leak into roll --help", () => {
    const helpText = usage();
    const cmdLine = helpText.split("\n").find((l) => l.startsWith("Commands:"));
    expect(cmdLine).toBeDefined();
    const displayed = new Set(
      cmdLine!
        .replace("Commands: ", "")
        .split(", ")
        .map((c) => c.trim())
        .filter(Boolean),
    );
    const nonPublic = ["doc", "attest", "truth", "story", "gc", "dream", "version",
      "cast", "ci", "cycle", "cycles", "ls", "offboard", "pair", "peer",
      "prices", "pulse", "showcase", "skills", "supervisor", "tool", "tune",
      "alert", "index"];
    for (const cmd of nonPublic) {
      expect(displayed.has(cmd), `${cmd} must not appear in roll --help`).toBe(false);
    }
  });

  it("every ported command is classified in the registry", () => {
    const ported = ["agent", "alert", "attest", "backlog", "cast", "ci", "config", "cycle", "cycles",
      "design", "doc", "doctor", "dream", "gc", "idea", "index", "init", "loop", "ls", "next",
      "offboard", "pair", "peer", "prices", "pulse", "release", "setup", "showcase", "skills",
      "status", "story", "supervisor", "test", "tool", "truth", "tune", "update", "version"];
    expect(() => requireAllClassified(ported)).not.toThrow();
  });

  it("registry has all expected command-surface decisions", () => {
    const entries = COMMAND_SURFACE.map((d) => d.current);
    expect(entries).toContain("agent");
    expect(entries).toContain("help");
    expect(entries).toContain("doc");
    for (const entry of COMMAND_SURFACE) {
      expect(entry.current).toBeTruthy();
      expect(entry.owner).toBeTruthy();
      expect(entry.disposition).toBeTruthy();
      expect(entry.rationale).toBeTruthy();
      expect(["public", "nested", "internal", "remove"]).toContain(entry.disposition);
      expect(["human", "internal", "hidden"]).toContain(entry.audience);
    }
  });
});
