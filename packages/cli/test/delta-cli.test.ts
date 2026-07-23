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
    // delta- prefixed UUIDs → delta-<DELEGATION_ID>
    .replace(/delta-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, "delta-<DELEGATION_ID>")
    // Generic path segments with delta- prefix and dash-suffix
    .replace(/\/[^\s:"']*\/delta-[a-f0-9-]+/g, "<PROJECT>/delta-<DELEGATION_ID>")
    // Plain UUIDs = remaining random IDs only
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, "<UUID>")
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

describe("US-DELTA-003 — import closure audit (fail-closed recursive)", () => {
  it("recursive import closure from commands/index.ts: no forbidden patterns, fail-closed on missing files", () => {
    // Use dynamic ESM import for node modules in this audit
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");

    // Entry: commands/index.ts (the dispatch registration point)
    const entryFile = path.resolve(__dirname, "..", "src", "commands", "index.ts");

    // FAIL-CLOSED: entry must exist
    if (!fs.existsSync(entryFile)) {
      throw new Error(`Audit FAIL-CLOSED: entry file missing: ${entryFile}`);
    }

    // Verify index.ts registers delta
    const indexContent = fs.readFileSync(entryFile, "utf8");
    if (!indexContent.includes("deltaCommand") || !indexContent.includes('registerPorted("delta"')) {
      throw new Error("Audit FAIL-CLOSED: commands/index.ts must import and register deltaCommand");
    }

    // Collect all files in the Delta CLI closure starting from delta.ts
    const deltaEntry = path.resolve(__dirname, "..", "src", "commands", "delta.ts");
    const allocFile = path.resolve(__dirname, "..", "src", "lib", "delta-allocation.ts");
    const artifactsFile = path.resolve(__dirname, "..", "src", "lib", "delta-artifacts.ts");

    // Required files must exist
    for (const f of [deltaEntry, allocFile, artifactsFile]) {
      if (!fs.existsSync(f)) throw new Error(`Audit FAIL-CLOSED: required file missing: ${f}`);
    }

    const forbiddenTokens = [
      "agentSpawn", "@anthropic", "openai",
      "cycleAllocator", "allocCycle",
      "runs.jsonl", "createPR", "DeliveryRecord", "cycle:terminal", "upsertRun",
      "artifact-protocol", "attestation", "role-access", "manifest-v2",
    ];

    // Recursively resolve local relative imports
    const seen = new Set<string>();
    const queue = [deltaEntry, allocFile, artifactsFile];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current)) continue;
      seen.add(current);

      // FAIL-CLOSED: file must exist
      if (!fs.existsSync(current)) {
        throw new Error(`Audit FAIL-CLOSED: file not found during traversal: ${current}`);
      }

      const content = fs.readFileSync(current, "utf8");
      const dir = path.dirname(current);

      // Check for forbidden tokens (non-comment lines only)
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed === "*") continue;
        for (const pattern of forbiddenTokens) {
          if (trimmed.includes(pattern)) {
            throw new Error(`Audit FAIL-CLOSED: ${current} contains forbidden token "${pattern}"`);
          }
        }
        // Reject dynamic import() (runtime, not type annotation)
        if (/\bimport\s*\(/.test(trimmed) &&
            !/\b(as|typeof)\s+import\s*\(/.test(trimmed) &&
            !/:\s*import\s*\(/.test(trimmed)) {
          throw new Error(`Audit FAIL-CLOSED: ${current} contains dynamic import(): ${trimmed}`);
        }
        // Reject dynamic require() (non-node:)
        if (/\brequire\s*\(/.test(trimmed) && !trimmed.includes("node:")) {
          throw new Error(`Audit FAIL-CLOSED: ${current} contains dynamic require(): ${trimmed}`);
        }
      }

      // Parse local relative imports/re-exports: from "...", import "...", export ... from "..."
      // Match: from '<relative-path>', import '<relative-path>'
      const importRe = /(?:from\s+["']|import\s+["'])(\.[^"']+)["']/g;
      const exportFromRe = /export\s+(?:\{[^}]*\}\s+from\s+["']|\*\s+as\s+\w+\s+from\s+["'])(\.[^"']+)["']/g;

      const resolveAndEnqueue = (relPath: string) => {
        let resolved = relPath.replace(/\.js$/, ".ts");
        const fullPath = path.resolve(dir, resolved);

        // Check if the file exists; if not, try index.ts (directory resolution)
        if (!fs.existsSync(fullPath)) {
          const indexCandidate = path.resolve(dir, resolved, "index.ts");
          if (fs.existsSync(indexCandidate)) {
            if (!seen.has(indexCandidate)) queue.push(indexCandidate);
            return;
          }
          // Only fail-closed for local (non-scoped) paths within cli/src
          if (!resolved.startsWith("@") && fullPath.includes("/cli/src/")) {
            throw new Error(`Audit FAIL-CLOSED: cannot resolve local import "${relPath}" from ${current}`);
          }
          return;
        }
        if (!seen.has(fullPath)) queue.push(fullPath);
      };

      let match;
      const seenImports = new Set<string>();
      while ((match = importRe.exec(content)) !== null) {
        const relPath = match[1]!;
        if (!seenImports.has(relPath)) {
          seenImports.add(relPath);
          // Only follow into cli/src (not node_modules, not ../../packages)
          if (relPath.startsWith(".") && current.includes("/cli/src/")) {
            resolveAndEnqueue(relPath);
          }
        }
      }
      while ((match = exportFromRe.exec(content)) !== null) {
        const relPath = match[1]!;
        if (!seenImports.has(relPath)) {
          seenImports.add(relPath);
          if (relPath.startsWith(".") && current.includes("/cli/src/")) {
            resolveAndEnqueue(relPath);
          }
        }
      }
    }

    // Verify we traversed at least the entry files
    expect(seen.size).toBeGreaterThanOrEqual(3);
    // Must include all 3 core files
    expect(seen.has(deltaEntry)).toBe(true);
    expect(seen.has(allocFile)).toBe(true);
    expect(seen.has(artifactsFile)).toBe(true);
  });
});
