/**
 * CLI bridge — TS-native routing (US-PORT-021). The bash `bin/roll` fallback is
 * retired: every command is ported, so an unregistered command prints the usage
 * rather than shelling to bash. (The old bash-oracle diff-tests are gone with
 * the engine; routing is asserted natively here.)
 */
import { describe, expect, it } from "vitest";
import { dispatch, isPorted, portedCommands, registerPorted, repoRoot, usage } from "../src/bridge.js";
import { registerAll } from "../src/index.js";

describe("repoRoot", () => {
  it("locates the package root via the conventions/ (or bin/roll) marker", () => {
    const root = repoRoot();
    expect(typeof root).toBe("string");
    expect(root.length).toBeGreaterThan(0);
    expect(root.toLowerCase().includes("roll")).toBe(true);
  });
});

describe("ported routing (no bash fallback)", () => {
  it("routes a registered command to its TS handler with args after the command", async () => {
    let got: string[] | undefined;
    registerPorted("__test_cmd", (args) => {
      got = args;
      return 42;
    });
    const res = await dispatch(["__test_cmd", "a b", "--flag"]);
    expect(res.status).toBe(42);
    expect(got).toEqual(["a b", "--flag"]);
    expect(isPorted("__test_cmd")).toBe(true);
    expect(portedCommands()).toContain("__test_cmd");
  });

  it("REFACTOR-048: one-shot migration commands are retired; the user upgrade path stays", () => {
    registerAll();
    // internal one-time migrations (card-skeleton backfill, old attest-layout
    // port) completed long ago — off the command surface.
    expect(isPorted("migrate-features")).toBe(false);
    expect(isPorted("archive")).toBe(false);
    // `roll migrate` STAYS: it is the live pre-2.0 → 2.0 user-project upgrade
    // path that `roll init` directs users to (recorded deviation on the card).
    expect(isPorted("migrate")).toBe(true);
  });

  it("REFACTOR-049: version/gc stay callable but are hidden from the main usage; lang is gone", () => {
    registerAll();
    expect(isPorted("lang")).toBe(false); // moved into `roll config lang`
    expect(isPorted("version")).toBe(true); // alias for --version
    expect(isPorted("gc")).toBe(true); // emergency manual entry (auto-runs per cycle)
    const listed = usage().split("Commands:")[1] ?? "";
    expect(listed).not.toMatch(/\bversion\b/);
    expect(listed).not.toMatch(/\bgc\b/);
    expect(listed).not.toMatch(/\blang\b/);
  });

  it("help / --help / -h / empty → usage, exit 0", async () => {
    for (const argv of [[], ["help"], ["--help"], ["-h"]]) {
      const res = await dispatch(argv);
      expect(res.status).toBe(0);
    }
  });

  it("an unknown command → exit 1 (usage, not a bash spawn)", async () => {
    const res = await dispatch(["definitely-not-a-roll-command"]);
    expect(res.status).toBe(1);
  });

  it("usage() lists the registered commands", () => {
    registerPorted("__usage_cmd", () => 0);
    const u = usage();
    expect(u).toContain("__usage_cmd");
    expect(u).toContain("roll <command>");
  });
});
