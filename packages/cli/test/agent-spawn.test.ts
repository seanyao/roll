/**
 * FIX-1056 — agy headless auth-context propagation.
 *
 * The observed break (cycle 20260701-000657-76542): agy was selected for both
 * code review and score and emitted `agent:blocked cause=auth` twice even though
 * the owner had authenticated agy interactively. Root cause: agy used the generic
 * simplePromptProfile with NO childEnv, so its headless (launchd) child never saw
 * the owner's authenticated auth-context home. These tests lock the fix: the agy
 * spawn envelope forwards the SAME auth-context dir the interactive CLI uses, the
 * readiness diagnostic reuses that same envelope, and NO credential value is ever
 * surfaced.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  AGY_AUTH_CONTEXT_ENV,
  agentProfile,
  agentSpawnEnvironment,
  agyAuthContext,
  agyAuthContextDir,
  agyEnv,
  buildSpawnCommand,
} from "../src/runner/agent-spawn.js";

const tmpDirs: string[] = [];
function homeWithAgyConfig(): string {
  const home = mkdtempSync(join(tmpdir(), "roll-agy-home-"));
  tmpDirs.push(home);
  mkdirSync(join(home, ".config", "agy"), { recursive: true });
  return home;
}
function homeWithoutAgyConfig(): string {
  const home = mkdtempSync(join(tmpdir(), "roll-agy-nohome-"));
  tmpDirs.push(home);
  return home;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe("FIX-1056 — agy spawn envelope propagates the authenticated auth-context", () => {
  it("agy has an EXPLICIT profile with a childEnv hook (not the generic simplePromptProfile)", () => {
    const agy = agentProfile("agy");
    expect(agy.name).toBe("agy");
    expect(typeof agy.childEnv).toBe("function");
  });

  it("the argv shape is unchanged (`agy -p <prompt>`) — only the child env is added", () => {
    const prompt = agentProfile("agy").buildSpawnCommand({ cwd: "/wt", skillBody: "DO WORK" }).args[1];
    const { bin, args } = buildSpawnCommand("agy", { cwd: "/wt", skillBody: "DO WORK" });
    expect(bin).toBe("agy");
    expect(args).toEqual(["-p", prompt]);
  });

  it("forwards the resolved auth-context dir to the headless child when it exists", () => {
    const home = homeWithAgyConfig();
    expect(agentSpawnEnvironment("agy", home)).toEqual({
      [AGY_AUTH_CONTEXT_ENV]: agyAuthContextDir(home),
    });
  });

  it("adds nothing when the owner has no auth-context dir (an absent context is surfaced, not masked)", () => {
    const home = homeWithoutAgyConfig();
    expect(agentSpawnEnvironment("agy", home)).toEqual({});
  });

  it("respects an explicit owner AGY_CONFIG_DIR override — never clobbers it", () => {
    const home = homeWithAgyConfig();
    expect(agyEnv(home, { [AGY_AUTH_CONTEXT_ENV]: "/owner/custom" })).toEqual({});
  });

  it("readiness reuses the SAME envelope (same auth-context dir) as the spawn", () => {
    const home = homeWithAgyConfig();
    const ctx = agyAuthContext(home, {});
    expect(ctx.ok).toBe(true);
    expect(ctx.configDir).toBe(agyAuthContextDir(home));
    expect(ctx.configDir).toBe(agentSpawnEnvironment("agy", home)[AGY_AUTH_CONTEXT_ENV]);
    expect(ctx.missingBoundary).toBeNull();
  });

  it("reports an actionable missing boundary when NO auth context exists (never a silent exclude)", () => {
    const home = homeWithoutAgyConfig();
    const ctx = agyAuthContext(home, {});
    expect(ctx.ok).toBe(false);
    expect(ctx.configDirExists).toBe(false);
    expect(ctx.missingBoundary).toContain(agyAuthContextDir(home));
    expect(ctx.missingBoundary).toContain("GEMINI_API_KEY");
  });

  it("an auth env var alone satisfies readiness (env-based auth, no config dir)", () => {
    const home = homeWithoutAgyConfig();
    const ctx = agyAuthContext(home, { GEMINI_API_KEY: "super-secret-token-value" });
    expect(ctx.ok).toBe(true);
    expect(ctx.authEnvPresent).toEqual(["GEMINI_API_KEY"]);
  });

  it("NEVER surfaces a credential VALUE — only names/paths are reported (redaction)", () => {
    const home = homeWithoutAgyConfig();
    const secret = "AIza-super-secret-token-value";
    const ctx = agyAuthContext(home, { GEMINI_API_KEY: secret, GOOGLE_API_KEY: secret });
    const blob = JSON.stringify(ctx);
    expect(blob).not.toContain(secret);
    expect(ctx.authEnvPresent).toEqual(["GEMINI_API_KEY", "GOOGLE_API_KEY"]);
  });
});

describe("US-AGENT-048 — Cursor headless Builder argv", () => {
  it("builds the documented headless argv with --workspace (not --worktree)", () => {
    const { bin, args } = buildSpawnCommand("cursor", { cwd: "/cycle/wt", skillBody: "DO WORK" });
    expect(bin).toBe("cursor-agent");
    expect(args).toEqual([
      "--print",
      "--trust",
      "--force",
      "--workspace",
      "/cycle/wt",
      "--output-format",
      "text",
      expect.stringContaining("DO WORK"),
    ]);
    expect(args).not.toContain("--worktree");
  });

  it("carries the story pin and autorun directive in the prompt", () => {
    const { args } = buildSpawnCommand("cursor", {
      cwd: "/cycle/wt",
      skillBody: "skill body",
      storyId: "US-AGENT-048",
    });
    const prompt = args[args.length - 1] ?? "";
    expect(prompt).toContain("[roll 自主模式]");
    expect(prompt).toContain("US-AGENT-048");
    expect(prompt).toContain("skill body");
  });

  it("bare reviewer spawn omits the worker directive and story pin", () => {
    const { args } = buildSpawnCommand("cursor", {
      cwd: "/cycle/wt",
      skillBody: "review prompt",
      storyId: "US-AGENT-048",
      bare: true,
    });
    const prompt = args[args.length - 1] ?? "";
    expect(prompt).toBe("review prompt");
    expect(prompt).not.toContain("[roll 自主模式]");
  });
});
