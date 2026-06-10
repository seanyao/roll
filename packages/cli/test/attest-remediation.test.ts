/**
 * FIX-246 — ac-map omission remediation.
 *
 * Observed 2026-06-10: every delivered cycle died at the attest gate because
 * agents consistently skip skill step 10.6 (write `ac-map.json`) even when the
 * delivery itself is real — the gate then classifies the fresh report as an
 * empty shell and the correction breaker pauses the loop. The remediation is a
 * single surgical second pass: when a real delivery has no ac-map, spawn the
 * SAME agent once with an explicit write-the-ac-map prompt, then render attest.
 * The honesty red line is untouched — the prompt demands `claimed` for any AC
 * without real evidence; the render layer still downgrades fabricated passes.
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  acMapPath,
  buildAcMapRemediationPrompt,
  needsAcMapRemediation,
} from "../src/runner/attest-remediation.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) execSync(`rm -rf '${d}'`);
});

function tmp(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `roll-246-${tag}-`)));
  dirs.push(d);
  return d;
}

/** Worktree fixture: a card-layout story spec WITH an AC block, no ac-map. */
function withStory(storyId: string, spec?: string): string {
  const wt = tmp("wt");
  const dir = join(wt, ".roll", "features", "uncategorized", storyId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "spec.md"),
    spec ?? `# ${storyId}\n\n**AC:**\n- [ ] AC1 it works\n- [ ] AC2 it stays working\n`,
  );
  return wt;
}

describe("needsAcMapRemediation", () => {
  it("real story with an AC block and NO ac-map → remediation needed", () => {
    const wt = withStory("FIX-900");
    expect(needsAcMapRemediation(wt, "FIX-900")).toBe(true);
  });

  it("ac-map already present → no remediation", () => {
    const wt = withStory("FIX-901");
    writeFileSync(acMapPath(wt, "FIX-901"), "[]\n");
    expect(needsAcMapRemediation(wt, "FIX-901")).toBe(false);
  });

  it("story without an AC block → nothing to map, no remediation", () => {
    const wt = withStory("FIX-902", "# FIX-902\n\njust prose, no acceptance criteria\n");
    expect(needsAcMapRemediation(wt, "FIX-902")).toBe(false);
  });

  it("empty story id → no remediation (idle cycle)", () => {
    const wt = tmp("idle");
    expect(needsAcMapRemediation(wt, "")).toBe(false);
  });
});

describe("acMapPath", () => {
  it("resolves to the card archive home (same path the gate reads)", () => {
    const wt = withStory("FIX-903");
    expect(acMapPath(wt, "FIX-903")).toBe(
      join(wt, ".roll", "features", "uncategorized", "FIX-903", "ac-map.json"),
    );
  });
});

describe("buildAcMapRemediationPrompt", () => {
  it("carries the absolute ac-map path, the story id, the schema template, and the honesty red line", () => {
    const wt = withStory("FIX-904");
    const p = buildAcMapRemediationPrompt(wt, "FIX-904", "/frame/run-dir");
    expect(p).toContain(acMapPath(wt, "FIX-904")); // exact write target, no guessing
    expect(p).toContain("FIX-904:AC1"); // schema template anchored to this story
    expect(p).toContain('"claimed"'); // honesty red line: no-evidence ACs stay claimed
    expect(p).toContain("../evidence/"); // run-dir-relative evidence convention
    expect(p).toMatch(/never fabricate|绝不伪造/); // bilingual red line present
    expect(p).toMatch(/do not commit/i); // surgical scope: file write only
  });
});
