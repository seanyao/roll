/**
 * US-LOOP-088 — post-cycle environment cleanup tests.
 *
 * Fixtures assert the cleanup contract:
 *   - scratch/toolchain artifacts created during a cycle are gone after cleanup;
 *   - source files and uncommitted work survive;
 *   - cleanup is idempotent;
 *   - failures are reported as warnings, not thrown.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyCleanupManifest,
  DEFAULT_CLEANUP_MANIFEST,
  parseCleanupManifest,
  resolveCleanupManifest,
  type CleanupManifest,
} from "../src/runner/environment-cleanup.js";

let worktree: string;

beforeEach(() => {
  worktree = mkdtempSync(join(tmpdir(), "roll-cleanup-"));
});

afterEach(() => {
  rmSync(worktree, { recursive: true, force: true });
});

function touch(path: string): void {
  mkdirSync(parentDir(path), { recursive: true });
  writeFileSync(path, "data", "utf8");
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : ".";
}

describe("DEFAULT_CLEANUP_MANIFEST", () => {
  it("targets only cache/scratch paths, never source roots", () => {
    const paths = DEFAULT_CLEANUP_MANIFEST.rules.flatMap((r) => r.paths);
    for (const p of paths) {
      expect(p).not.toMatch(/^src\b/);
      expect(p).not.toMatch(/^packages\b/);
      expect(p).not.toMatch(/\.(ts|js|tsx|jsx|py|swift)$/);
    }
  });
});

describe("parseCleanupManifest", () => {
  it("parses a project override manifest", () => {
    const text = `
rules:
  - name: custom-scratch
    kind: rm
    paths:
      - .custom-scratch
      - .cache
`;
    const parsed = parseCleanupManifest(text);
    expect(parsed).toEqual({
      version: 1,
      rules: [{ name: "custom-scratch", kind: "rm", paths: [".custom-scratch", ".cache"] }],
    });
  });

  it("returns undefined for an empty manifest", () => {
    expect(parseCleanupManifest("# just a comment\n")).toBeUndefined();
  });
});

describe("applyCleanupManifest", () => {
  it("AC1 — removes scratch directories created during the cycle", () => {
    touch(join(worktree, ".scratch", "leftover.tmp"));
    touch(join(worktree, "tmp", "build.log"));
    const results = applyCleanupManifest(worktree, "c1", DEFAULT_CLEANUP_MANIFEST);
    expect(existsSync(join(worktree, ".scratch"))).toBe(false);
    expect(existsSync(join(worktree, "tmp"))).toBe(false);
    const scratchResults = results.filter((r) => r.rule === "scratch-dirs");
    expect(scratchResults.every((r) => r.ok)).toBe(true);
  });

  it("AC2 — cleans known toolchain caches (node + python fixture)", () => {
    touch(join(worktree, "node_modules", ".cache", "esbuild", "abc"));
    touch(join(worktree, ".vite", "deps", "metadata"));
    touch(join(worktree, "src", "lib", "__pycache__", "mod.cpython-312.pyc"));
    const results = applyCleanupManifest(worktree, "c1", DEFAULT_CLEANUP_MANIFEST);
    expect(existsSync(join(worktree, "node_modules", ".cache"))).toBe(false);
    expect(existsSync(join(worktree, ".vite"))).toBe(false);
    expect(existsSync(join(worktree, "src", "lib", "__pycache__"))).toBe(false);
    expect(results.some((r) => r.rule === "node-tool-cache" && r.ok)).toBe(true);
    expect(results.some((r) => r.rule === "python-cache" && r.ok)).toBe(true);
  });

  it("AC3 — idempotent: re-running on a clean worktree is a no-op", () => {
    touch(join(worktree, ".scratch", "leftover.tmp"));
    applyCleanupManifest(worktree, "c1", DEFAULT_CLEANUP_MANIFEST);
    const second = applyCleanupManifest(worktree, "c1", DEFAULT_CLEANUP_MANIFEST);
    expect(second.every((r) => r.ok)).toBe(true);
    expect(existsSync(join(worktree, ".scratch"))).toBe(false);
  });

  it("AC4 — failures are captured as warnings, not thrown", () => {
    const badManifest: CleanupManifest = {
      version: 1,
      rules: [{ name: "escape", kind: "rm", paths: ["../outside"] }],
    };
    const results = applyCleanupManifest(worktree, "c1", badManifest);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ rule: "escape", ok: false, warning: expect.stringContaining("outside worktree") });
  });

  it("AC5 — source files and uncommitted changes survive", () => {
    const source = join(worktree, "src", "main.ts");
    const uncommitted = join(worktree, "src", "new-feature.ts");
    touch(source);
    touch(uncommitted);
    touch(join(worktree, ".scratch", "junk"));
    applyCleanupManifest(worktree, "c1", DEFAULT_CLEANUP_MANIFEST);
    expect(existsSync(source)).toBe(true);
    expect(existsSync(uncommitted)).toBe(true);
    expect(existsSync(join(worktree, ".scratch"))).toBe(false);
  });

  it("isolates a cache dir into the cycle-local cleanup root", () => {
    const manifest: CleanupManifest = {
      version: 1,
      rules: [{ name: "isolate-cache", kind: "isolate", paths: [".my-cache"] }],
    };
    touch(join(worktree, ".my-cache", "data.bin"));
    const results = applyCleanupManifest(worktree, "c1", manifest);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(existsSync(join(worktree, ".my-cache"))).toBe(false);
    expect(existsSync(join(worktree, ".roll-cleanup", "c1", "isolate-cache", ".my-cache", "data.bin"))).toBe(true);
  });
});

describe("resolveCleanupManifest", () => {
  it("uses the project override when present", () => {
    const manifestPath = join(worktree, "cleanup-manifest.yaml");
    writeFileSync(manifestPath, "rules:\n  - name: override\n    kind: rm\n    paths:\n      - .override\n", "utf8");
    const resolved = resolveCleanupManifest(worktree, manifestPath);
    expect(resolved.rules).toHaveLength(1);
    expect(resolved.rules[0]?.name).toBe("override");
  });

  it("falls back to the default manifest when override is missing", () => {
    const resolved = resolveCleanupManifest(worktree, join(worktree, "missing.yaml"));
    expect(resolved.rules.length).toBeGreaterThan(0);
    expect(resolved.rules[0]?.name).toBe(DEFAULT_CLEANUP_MANIFEST.rules[0]?.name);
  });
});
