/**
 * Integration test for the US-LOOP-006 parallel-verification harness
 * (scripts/parallel-verify.sh). Shells the script in SHIM mode (default — no
 * real `claude`, no network) and asserts:
 *   - the script exits 0 (all compared keys PASS),
 *   - a verdict table is printed,
 *   - the table shows PASS for every compared key (no DIVERGE),
 *   - both legs reached the normalized `success` terminal,
 *   - the dry-run prints the planned commands for both legs without executing.
 *
 * Runtime budget: < 120s (a single shim round is ~5-10s on this machine).
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "../../..");
const SCRIPT = resolve(REPO, "scripts/parallel-verify.sh");

function runScript(args: string[]): { stdout: string; code: number } {
  try {
    const stdout = execFileSync("bash", [SCRIPT, ...args], {
      cwd: REPO,
      encoding: "utf8",
      timeout: 110_000,
    });
    return { stdout, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { stdout: (err.stdout ?? "") + (err.stderr ?? ""), code: err.status ?? 1 };
  }
}

describe("parallel-verify.sh (shim mode)", () => {
  it("--dry-run prints both legs' planned commands without executing (exit 0)", () => {
    const { stdout, code } = runScript(["--dry-run"]);
    expect(code).toBe(0);
    expect(stdout).toContain("v2 leg (frozen bash oracle, one cycle)");
    expect(stdout).toContain("v3 leg (TS run-once, one cycle)");
    expect(stdout).toContain("loop run-once");
    expect(stdout).toContain("nothing executed");
  });

  it(
    "--rounds 1 runs both legs end-to-end and the verdict is all-PASS (exit 0)",
    () => {
      const { stdout, code } = runScript(["--rounds", "1"]);
      // The script exits 0 iff every compared key PASSED in every round.
      expect(code, `harness output:\n${stdout}`).toBe(0);

      // A verdict table was printed.
      expect(stdout).toContain("Round 1 verdict");
      expect(stdout).toMatch(/key\s+v2 \(bash oracle\)\s+v3 \(TS run-once\)\s+result/);

      // Every compared key PASSED — there must be no DIVERGE rows.
      expect(stdout).not.toContain("DIVERGE");
      expect(stdout).toContain("ALL ROUNDS PASS");

      // Both legs reached the normalized `success` terminal and committed a tcr.
      expect(stdout).toMatch(/outcome\s+success\s+success\s+PASS/);
      expect(stdout).toMatch(/tcr_present\s+true\s+true\s+PASS/);
      expect(stdout).toMatch(/story_id\s+US-PV-001\s+US-PV-001\s+PASS/);
    },
    115_000,
  );
});
