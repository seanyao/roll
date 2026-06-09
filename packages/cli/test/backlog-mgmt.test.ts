/**
 * US-PORT-019 — `roll backlog` write/maintenance arms (TS port off bin/roll).
 * Covers block/defer/unblock/promote (set-status) + lint.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backlogLintCommand,
  backlogSetStatusCommand,
  lintBacklogContent,
  statusFor,
} from "../src/commands/backlog-mgmt.js";
import { stripAnsi } from "../src/render.js";

let cwd0: string;
let dir: string;
const savedEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string): void {
  if (!(k in savedEnv)) savedEnv[k] = process.env[k];
  process.env[k] = v;
}
beforeEach(() => {
  cwd0 = process.cwd();
  dir = mkdtempSync(join(tmpdir(), "backlog-mgmt-"));
  process.chdir(dir);
  mkdirSync(".roll", { recursive: true });
  setEnv("ROLL_LANG", "en");
  setEnv("NO_COLOR", "1");
});
afterEach(() => {
  process.chdir(cwd0);
  rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
});

function capture(fn: () => number): { status: number; out: string; err: string } {
  const o: string[] = [];
  const e: string[] = [];
  const wo = process.stdout.write.bind(process.stdout);
  const we = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((x: string | Uint8Array) => (o.push(String(x)), true)) as typeof process.stdout.write;
  process.stderr.write = ((x: string | Uint8Array) => (e.push(String(x)), true)) as typeof process.stderr.write;
  try {
    const status = fn();
    return { status, out: stripAnsi(o.join("")), err: stripAnsi(e.join("")) };
  } finally {
    process.stdout.write = wo;
    process.stderr.write = we;
  }
}

const HEADER = "| ID | Description | Status |\n|----|----|----|\n";
function seedBacklog(rows: string): void {
  writeFileSync(join(".roll", "backlog.md"), HEADER + rows);
}
function statusOf(id: string): string {
  for (const line of readFileSync(join(".roll", "backlog.md"), "utf8").split("\n")) {
    if (line.startsWith("|") && line.includes(id)) {
      const parts = line.split("|");
      return (parts[parts.length - 2] ?? "").trim();
    }
  }
  return "";
}

describe("statusFor — US-PORT-019", () => {
  it("maps each set-status subcommand", () => {
    expect(statusFor("block", "")).toBe("🔒 Blocked");
    expect(statusFor("block", "waiting api")).toBe("🔒 Blocked [waiting api]");
    expect(statusFor("defer", "later")).toBe("⏸ Deferred [later]");
    expect(statusFor("unblock", "x")).toBe("📋 Todo");
    expect(statusFor("promote", "")).toBe("📋 Todo");
    expect(statusFor("nope", "")).toBeNull();
  });
});

describe("backlog block/defer/unblock/promote — US-PORT-019", () => {
  it("block sets 🔒 Blocked [reason] and reports the count", () => {
    seedBacklog("| [FIX-001](x) | fix a thing | 📋 Todo |\n");
    const r = capture(() => backlogSetStatusCommand("block", ["FIX-001", "waiting upstream"]));
    expect(r.status).toBe(0);
    expect(statusOf("FIX-001")).toBe("🔒 Blocked [waiting upstream]");
    expect(r.out).toContain("Updated 1 item");
  });

  it("defer then unblock round-trips a row back to Todo", () => {
    seedBacklog("| [US-002](x) | a story | 📋 Todo |\n");
    capture(() => backlogSetStatusCommand("defer", ["US-002", "next quarter"]));
    expect(statusOf("US-002")).toBe("⏸ Deferred [next quarter]");
    capture(() => backlogSetStatusCommand("unblock", ["US-002"]));
    expect(statusOf("US-002")).toBe("📋 Todo");
  });

  it("no match → 'No items matched', exit 0, file unchanged", () => {
    seedBacklog("| [FIX-001](x) | fix a thing | 📋 Todo |\n");
    const before = readFileSync(join(".roll", "backlog.md"), "utf8");
    const r = capture(() => backlogSetStatusCommand("block", ["NOPE-999"]));
    expect(r.status).toBe(0);
    expect(r.out).toContain("No items matched: NOPE-999");
    expect(readFileSync(join(".roll", "backlog.md"), "utf8")).toBe(before);
  });

  it("missing pattern → usage on stderr, exit 1", () => {
    seedBacklog("| [FIX-001](x) | x | 📋 Todo |\n");
    const r = capture(() => backlogSetStatusCommand("block", []));
    expect(r.status).toBe(1);
    expect(r.err).toContain("Usage: roll backlog block");
  });
});

describe("backlog lint — US-PORT-019", () => {
  it("flags length>120, code-fence, filename, path, function violations", () => {
    const longDesc = "x".repeat(130);
    const content =
      HEADER +
      `| [US-010](x) | ${longDesc} | 📋 Todo |\n` +
      "| [US-011](x) | run `roll loop on` to start | 📋 Todo |\n" +
      "| [US-012](x) | edit config.yaml then retry | 📋 Todo |\n" +
      "| [US-013](x) | touch src/foo/bar then build | 📋 Todo |\n" +
      "| [US-014](x) | call _helper() before exit | 📋 Todo |\n" +
      "| [US-015](x) | a perfectly clean human sentence | 📋 Todo |\n";
    const findings = lintBacklogContent(content);
    const byId = Object.fromEntries(findings.map((f) => [f.sid, f.issues]));
    expect(byId["US-010"]).toContain("length>130");
    expect(byId["US-011"]).toContain("code-fence");
    expect(byId["US-012"]).toContain("filename");
    expect(byId["US-013"]).toContain("path");
    expect(byId["US-014"]).toContain("function");
    expect(byId["US-015"]).toBeUndefined(); // clean row not flagged
  });

  it("clean backlog → no violations, exit 0", () => {
    seedBacklog("| [US-001](x) | a clean one line human description | 📋 Todo |\n");
    const r = capture(() => backlogLintCommand([]));
    expect(r.status).toBe(0);
    expect(r.out).toContain("No violations");
  });

  it("--gate flips a violation to exit 1", () => {
    seedBacklog("| [US-002](x) | uses `code` in the description | 📋 Todo |\n");
    const warn = capture(() => backlogLintCommand([]));
    expect(warn.status).toBe(0);
    expect(warn.out).toContain("warn-only");
    const gated = capture(() => backlogLintCommand(["--gate"]));
    expect(gated.status).toBe(1);
    expect(gated.out).toContain("exiting 1");
  });
});
