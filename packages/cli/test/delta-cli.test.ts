/**
 * US-DELTA-003 — CLI unit tests: help, parser, flag/enum validation, snapshots.
 *
 * RED phase: tests are demanding enough that they fail on the stub.
 */
import { describe, expect, it } from "vitest";
import { deltaCommand } from "../src/commands/delta.js";
import { renderState } from "../src/render.js";

// ── tsRun helper ─────────────────────────────────────────────────────────────

function tsRun(argv: string[]): { stdout: string; stderr: string; code: number } {
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only override
  process.stdout.write = (c: string | Uint8Array): boolean => {
    out.push(typeof c === "string" ? c : Buffer.from(c).toString("utf8"));
    return true;
  };
  // @ts-expect-error capture-only override
  process.stderr.write = (c: string | Uint8Array): boolean => {
    err.push(typeof c === "string" ? c : Buffer.from(c).toString("utf8"));
    return true;
  };
  let code: number;
  try {
    code = deltaCommand(argv);
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    renderState.useColor = true;
  }
  return { stdout: out.join(""), stderr: err.join(""), code };
}

// ── Scrubbing ────────────────────────────────────────────────────────────────

function scrub(output: string): string {
  return output
    .replace(/\/[^\s:"']*\/delta-[a-f0-9-]+/g, "<PROJECT>/delta-<DELEGATION_ID>")
    .replace(/delta-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, "delta-<DELEGATION_ID>")
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, "<DELEGATION_ID>")
    .replace(/[a-f0-9]{64}/gi, "<SHA256>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<TS>")
    .replace(/\b\d{13}\b/g, "<TS>")
    .replace(/\/tmp\/[^\s:"')\]]*/g, "<TMP>")
    .replace(/\/var\/folders\/[^\s:"')\]]*/g, "<TMP>")
    .replace(/\/private\/tmp\/[^\s:"')\]]*/g, "<TMP>");
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("US-DELTA-003 — delta CLI parser and help", () => {
  it("roll delta help prints EN usage with all subcommands and exits 0", () => {
    const r = tsRun(["help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("prepare");
    expect(r.stdout).toContain("validate");
    expect(r.stdout).toContain("conclude");
    expect(r.stdout).toContain("status");
    expect(r.stdout).toContain("help");
    expect(r.stderr).toBe("");
    expect(scrub(r.stdout)).toMatchSnapshot();
  });

  it("roll delta help is localized to zh when ROLL_LANG=zh", () => {
    const prev = process.env["ROLL_LANG"];
    try {
      process.env["ROLL_LANG"] = "zh";
      const r = tsRun(["help"]);
      expect(r.code).toBe(0);
      // Chinese output contains CJK characters
      expect(r.stdout).not.toBe("");
      expect(/[\u4e00-\u9fff]/.test(r.stdout)).toBe(true);
      expect(scrub(r.stdout)).toMatchSnapshot();
    } finally {
      if (prev !== undefined) process.env["ROLL_LANG"] = prev;
      else delete process.env["ROLL_LANG"];
    }
  });

  it("roll delta with no subcommand prints usage (same as help)", () => {
    const r = tsRun([]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("prepare");
    expect(r.stdout).toContain("validate");
  });

  it("roll delta unknown subcommand exits 1 with structured error", () => {
    const r = tsRun(["unknown-cmd"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unknown");
    expect(r.stderr).toContain("unknown-cmd");
    // Should suggest valid subcommands
    expect(r.stderr).toContain("prepare");
  });

  it("roll delta prepare rejects unknown flag", () => {
    const r = tsRun(["prepare", "US-TEST", "--nonexistent"]);
    expect(r.code).toBe(1);
    expect(r.stderr).not.toBe("");
  });

  it("roll delta prepare with --cycle rejected (host-guided has no cycle)", () => {
    const r = tsRun([
      "prepare", "US-TEST",
      "--trigger", "host-guided",
      "--topology", "delta-team",
      "--profile", "standard",
      "--preset", "local-preset",
      "--resolution", "/nonexistent.json",
      "--cycle", "some-cycle",
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("cycle");
  });

  it("roll delta prepare missing required flag returns error", () => {
    const r = tsRun(["prepare", "US-TEST"]);
    // Missing --trigger/--topology/--profile/--preset/--resolution
    expect(r.code).toBe(1);
    expect(r.stderr).not.toBe("");
  });

  it("roll delta validate rejects unknown stage", () => {
    const r = tsRun(["validate", "--delegation", "d-123", "--stage", "nonexistent"]);
    expect(r.code).toBe(1);
    expect(r.stderr).not.toBe("");
  });

  it("roll delta conclude rejects unknown disposition", () => {
    const r = tsRun(["conclude", "--delegation", "d-123", "--delivery-disposition", "bad_value"]);
    expect(r.code).toBe(1);
    expect(r.stderr).not.toBe("");
  });

  it("roll delta status without --story or --delegation shows error", () => {
    const r = tsRun(["status"]);
    expect(r.code).toBe(1);
    expect(r.stderr).not.toBe("");
  });

  it("roll delta validate missing --delegation returns error", () => {
    const r = tsRun(["validate", "--stage", "designer"]);
    expect(r.code).toBe(1);
    expect(r.stderr).not.toBe("");
  });

  it("roll delta conclude missing --delegation returns error", () => {
    const r = tsRun(["conclude", "--delivery-disposition", "owner_continue"]);
    expect(r.code).toBe(1);
    expect(r.stderr).not.toBe("");
  });

  it("roll delta --json error format is precise {ok:false,error,detail} on stderr, stdout empty", () => {
    const r = tsRun(["prepare", "US-TEST", "--json"]);
    expect(r.code).toBe(1);
    // stdout must be empty under --json error
    expect(r.stdout).toBe("");
    // stderr must be valid JSON envelope { ok: false, error, detail }
    expect(() => JSON.parse(r.stderr)).not.toThrow();
    const err = JSON.parse(r.stderr);
    expect(err.ok).toBe(false);
    expect(typeof err.error).toBe("string");
    expect(typeof err.detail).toBe("string");
    expect(err.error.length).toBeGreaterThan(0);
    expect(err.detail.length).toBeGreaterThan(0);
  });
});

// ── Architectural negative guard ────────────────────────────────────────────

describe("US-DELTA-003 — import audit", () => {
  it("delta CLI files exist and do not import agentSpawn, cycle, or host API (fail-closed)", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");

    const deltaDir = path.resolve(__dirname, "..", "src", "commands");
    const libDir = path.resolve(__dirname, "..", "src", "lib");

    const filesToCheck = [
      path.join(deltaDir, "delta.ts"),
      path.join(libDir, "delta-allocation.ts"),
      path.join(libDir, "delta-artifacts.ts"),
    ];

    // FAIL-CLOSED: every required file must exist
    for (const file of filesToCheck) {
      if (!fs.existsSync(file)) {
        throw new Error(`Audit FAIL-CLOSED: required file missing: ${file}`);
      }
    }

    const forbidden = [
      "agentSpawn",
      "@anthropic",
      "openai",
      "cycleAllocator",
      "allocCycle",
      "runs.jsonl",
      "createPR",
      "DeliveryRecord",
      "cycle:terminal",
      "upsertRun",
      "artifact-protocol",
    ];

    for (const file of filesToCheck) {
      const content = fs.readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        const lines = content.split("\n");
        const offending = lines.filter((l: string) => {
          const t = l.trim();
          if (t.startsWith("//") || t.startsWith("*") || t === "*") return false;
          return l.includes(pattern);
        });
        if (offending.length > 0) {
          throw new Error(`Audit FAIL-CLOSED: ${file} contains forbidden pattern "${pattern}"`);
        }
      }
    }
  });
});
