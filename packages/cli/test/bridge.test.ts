import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  dispatch,
  fallbackToBash,
  isPorted,
  portedCommands,
  registerPorted,
  repoRoot,
} from "../src/bridge.js";
import { seedUpdateCheckCache } from "./helpers.js";

const ROOT = repoRoot();
// Isolated ROLL_HOME with a seeded update-check cache: CI runners have no
// ~/.roll, so the oracle's async checker would spray stderr noise otherwise.
const ROLL_HOME = join(mkdtempSync(join(tmpdir(), "roll-bridge-home-")), ".roll");
seedUpdateCheckCache(ROLL_HOME);
let savedRollHome: string | undefined;
beforeAll(() => {
  savedRollHome = process.env["ROLL_HOME"];
  process.env["ROLL_HOME"] = ROLL_HOME; // fallbackToBash inherits process.env
});
afterAll(() => {
  if (savedRollHome === undefined) delete process.env["ROLL_HOME"];
  else process.env["ROLL_HOME"] = savedRollHome;
});

/** Run the frozen bash CLI directly — the oracle side of the diff-tests. */
function bashDirect(argv: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(join(ROOT, "bin", "roll"), argv, {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, ROLL_HOME },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("repoRoot", () => {
  it("locates the repo containing bin/roll", () => {
    expect(ROOT.endsWith("roll-v3") || ROOT.includes("roll")).toBe(true);
  });
});

describe("ported routing", () => {
  afterEach(() => {
    // test isolation: the registry is module state; re-register nothing real here
  });

  it("routes registered commands to the TS handler, not bash", async () => {
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

  it("unregistered commands are not marked ported", () => {
    // `help` stays a bash fallback (never registered in registerAll); `version`
    // is now TS-ported (FIX-202), so it is no longer a valid "unported" example.
    expect(isPorted("help")).toBe(false);
  });
});

describe("diff-test: bash fallback == bash direct (frozen v2 oracle)", () => {
  it("`help` passes through byte-for-byte with exit 0", async () => {
    const bridge = await dispatch(["help"], { capture: true, cwd: ROOT });
    const direct = bashDirect(["help"]);
    expect(bridge.status).toBe(direct.status);
    expect(bridge.stdout).toBe(direct.stdout);
    expect(bridge.stderr).toBe(direct.stderr);
    expect(bridge.status).toBe(0);
  });

  it("unknown command parity: same output, same non-zero exit", async () => {
    const argv = ["definitely-not-a-roll-command"];
    const bridge = await dispatch(argv, { capture: true, cwd: ROOT });
    const direct = bashDirect(argv);
    expect(bridge.status).toBe(direct.status);
    expect(bridge.stdout).toBe(direct.stdout);
    expect(bridge.stderr).toBe(direct.stderr);
  });

  it("args with spaces survive passthrough unmangled", () => {
    // bash `roll alert` requires args; compare its usage-error path verbatim.
    const argv = ["definitely-not-a-roll-command", "arg with spaces", "--x=1 2"];
    const bridge = fallbackToBash(argv, { capture: true, cwd: ROOT });
    const direct = bashDirect(argv);
    expect(bridge.status).toBe(direct.status);
    expect(bridge.stdout).toBe(direct.stdout);
  });
});
