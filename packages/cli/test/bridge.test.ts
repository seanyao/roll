/**
 * CLI bridge — TS-native routing (US-PORT-021). The bash `bin/roll` fallback is
 * retired: every command is ported, so an unregistered command prints the usage
 * rather than shelling to bash. (The old bash-oracle diff-tests are gone with
 * the engine; routing is asserted natively here.)
 */
import { describe, expect, it } from "vitest";
import { dispatch, isPorted, portedCommands, registerPorted, repoRoot, usage } from "../src/bridge.js";

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
