/**
 * US-PORT-015 — `roll ci --wait` poll loop (ciWaitCommand) with injected deps:
 * no real git/gh/sleep. Verifies exit codes + the decision sequence.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ciWaitCommand, type CiWaitDeps } from "../src/commands/ci.js";
import type { CiRunRow } from "@roll/core";

function deps(over: Partial<CiWaitDeps> = {}): CiWaitDeps {
  return {
    ghAvailable: () => true,
    headCommit: () => "abc1234deadbeef",
    shortCommit: () => "abc1234",
    branch: () => "feat/x",
    repoSlug: () => "owner/repo",
    fetchRuns: async () => [],
    openPrCount: async () => 1,
    sleep: async () => {},
    now: (() => { let t = 0; return () => (t += 1); })(), // each call advances 1s
    ...over,
  };
}
const completed = (c: string | null): CiRunRow => ({ status: "completed", conclusion: c });

let out = "", err = "", ow: typeof process.stdout.write, oe: typeof process.stderr.write;
beforeEach(() => {
  out = ""; err = "";
  ow = process.stdout.write.bind(process.stdout); oe = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture
  process.stdout.write = (s: string) => ((out += String(s)), true);
  // @ts-expect-error capture
  process.stderr.write = (s: string) => ((err += String(s)), true);
});
afterEach(() => { process.stdout.write = ow; process.stderr.write = oe; });

describe("ciWaitCommand — US-PORT-015 CI gate", () => {
  it("runs already green → exit 0", async () => {
    expect(await ciWaitCommand(["--wait"], deps({ fetchRuns: async () => [completed("success")] }))).toBe(0);
  });
  it("a red run → exit 1", async () => {
    expect(await ciWaitCommand(["--wait"], deps({ fetchRuns: async () => [completed("failure")] }))).toBe(1);
  });
  it("pending then green across polls → exit 0", async () => {
    let n = 0;
    const code = await ciWaitCommand(["--wait"], deps({
      fetchRuns: async () => (n++ === 0 ? [{ status: "in_progress", conclusion: null }] : [completed("success")]),
    }));
    expect(code).toBe(0);
  });
  it("no runs AND no open PR → lenient skip, exit 0 (FIX-046)", async () => {
    const code = await ciWaitCommand(["--wait"], deps({ fetchRuns: async () => [], openPrCount: async () => 0 }));
    expect(code).toBe(0);
    expect(out).toContain("[roll]"); // the no-open-pr warn line
  });
  it("never completes before timeout → exit 1", async () => {
    const code = await ciWaitCommand(["--wait", "--timeout=5"], deps({
      fetchRuns: async () => [{ status: "in_progress", conclusion: null }],
    }));
    expect(code).toBe(1);
  });
  it("gh missing → lenient exit 0", async () => {
    expect(await ciWaitCommand(["--wait"], deps({ ghAvailable: () => false }))).toBe(0);
  });
  it("not a git repo → exit 1", async () => {
    expect(await ciWaitCommand(["--wait"], deps({ headCommit: () => null }))).toBe(1);
  });
  it("repo slug unresolvable → exit 1", async () => {
    expect(await ciWaitCommand(["--wait"], deps({ repoSlug: () => undefined }))).toBe(1);
  });
  it("unknown arg → usage error exit 1", async () => {
    expect(await ciWaitCommand(["--wait", "--bogus"], deps())).toBe(1);
  });
});
