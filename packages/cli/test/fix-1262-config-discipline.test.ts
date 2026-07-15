/**
 * FIX-1262 — config-discipline leaks (points 3/4/5 of the audit family).
 *
 * Each of these panels used to FABRICATE an identity/path from a source-baked
 * default rather than an honest source:
 *   3. dashboard session backfill hardcoded owner 'seanyao' + /Users/... path;
 *   4. index-gen live feed read a dead `ROLL_LOOP_AGENT ?? 'claude'` env knob;
 *   5. supervisor identity hardcoded 'codex' behind an undocumented env.
 * The fixes source from sharedRoot(), the live.log banner, and agents.yaml
 * respectively — honest empty (never fabrication) when the source is absent.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sessionBackfillProjDir } from "../src/commands/dashboard.js";
import { parseLiveFeedAgent, collectLoopLiveFeed } from "../src/commands/index-gen.js";
import { resolveSupervisorAgent } from "../src/commands/supervisor.js";

/** Run `fn` with a scoped env patch, restoring the prior values after. */
function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T): T {
  const save: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(patch)) {
    save[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(save)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const tmp = (p: string): string => mkdtempSync(join(tmpdir(), p));

describe("FIX-1262 point 3 — dashboard session backfill dir is sharedRoot()-driven, not hardcoded owner", () => {
  it("encodes ROLL_SHARED_ROOT, never a baked 'seanyao'/'/Users' worktree path", () => {
    const dir = withEnv({ ROLL_SHARED_ROOT: "/custom/shared/root", USER: "someone-else" }, () =>
      sessionBackfillProjDir("myproj-abc123", "20260715-1200"),
    );
    // The worktree-path portion of the project dir must come from sharedRoot().
    expect(dir).toContain("-custom-shared-root-worktrees-myproj-abc123-cycle-20260715-1200");
    // ...and must NOT hardcode the owner username in that derived segment.
    expect(dir).not.toContain("seanyao--shared");
  });

  it("is stable regardless of $USER (the username is no longer read)", () => {
    const a = withEnv({ ROLL_SHARED_ROOT: "/r", USER: "alice" }, () => sessionBackfillProjDir("p", "L"));
    const b = withEnv({ ROLL_SHARED_ROOT: "/r", USER: "bob" }, () => sessionBackfillProjDir("p", "L"));
    expect(a).toBe(b);
  });
});

describe("FIX-1262 point 4 — live feed agent comes from the live.log banner, not the dead ROLL_LOOP_AGENT knob", () => {
  const BANNER = "── cycle 20260715-131807-84428 · FIX-1262 · agent kimi · build-session 20260715:build:kimi:1 ──";

  it("parseLiveFeedAgent extracts the agent named in the banner", () => {
    expect(parseLiveFeedAgent(BANNER + "\nsome other line\n")).toBe("kimi");
  });

  it("parseLiveFeedAgent returns undefined when there is no banner", () => {
    expect(parseLiveFeedAgent("just some log line\nanother\n")).toBeUndefined();
  });

  it("collectLoopLiveFeed reads the banner agent and IGNORES a bogus ROLL_LOOP_AGENT", () => {
    const rt = tmp("roll-1262-rt-");
    writeFileSync(join(rt, "live.log"), BANNER + "\n{\"type\":\"assistant\"}\n");
    const feed = withEnv({ ROLL_PROJECT_RUNTIME_DIR: rt, ROLL_LOOP_AGENT: "claude" }, () =>
      collectLoopLiveFeed("/unused"),
    );
    expect(feed.agent).toBe("kimi");
  });

  it("collectLoopLiveFeed leaves agent empty (honest blank) when no banner is present", () => {
    const rt = tmp("roll-1262-rt-");
    writeFileSync(join(rt, "live.log"), "no banner here\n");
    const feed = withEnv({ ROLL_PROJECT_RUNTIME_DIR: rt, ROLL_LOOP_AGENT: "claude" }, () =>
      collectLoopLiveFeed("/unused"),
    );
    expect(feed.agent).toBe("");
  });

  it("collectLoopLiveFeed is idle with empty agent when the live.log is absent", () => {
    const rt = tmp("roll-1262-rt-");
    const feed = withEnv({ ROLL_PROJECT_RUNTIME_DIR: rt, ROLL_LOOP_AGENT: "claude" }, () =>
      collectLoopLiveFeed("/unused"),
    );
    expect(feed.status).toBe("idle");
    expect(feed.agent).toBe("");
  });
});

describe("FIX-1262 point 5 — supervisor identity is config-driven (env only as override)", () => {
  const V1_CONFIG = (agent: string): string =>
    ["schema: roll-agents/v1", "scope: project", "roles:", "  supervise:", "    kind: fixed", `    agent: ${agent}`, ""].join("\n");

  function projectWith(agentsYaml: string | null): string {
    const proj = tmp("roll-1262-proj-");
    if (agentsYaml !== null) {
      mkdirSync(join(proj, ".roll"), { recursive: true });
      writeFileSync(join(proj, ".roll", "agents.yaml"), agentsYaml);
    }
    return proj;
  }

  it("ROLL_SUPERVISOR_AGENT wins as an explicit operator override", () => {
    const proj = projectWith(V1_CONFIG("kimi"));
    const emptyHome = tmp("roll-1262-home-");
    const who = withEnv({ ROLL_SUPERVISOR_AGENT: "pi", ROLL_HOME: emptyHome }, () => resolveSupervisorAgent(proj));
    expect(who).toBe("pi");
  });

  it("resolves the roles.supervise fixed agent from agents.yaml when no env override", () => {
    const proj = projectWith(V1_CONFIG("kimi"));
    const emptyHome = tmp("roll-1262-home-");
    const who = withEnv({ ROLL_SUPERVISOR_AGENT: undefined, ROLL_HOME: emptyHome }, () => resolveSupervisorAgent(proj));
    expect(who).toBe("kimi");
  });

  it("returns honest empty (never a baked 'codex') when nothing is configured", () => {
    const proj = projectWith(null);
    const emptyHome = tmp("roll-1262-home-");
    const who = withEnv({ ROLL_SUPERVISOR_AGENT: undefined, ROLL_HOME: emptyHome }, () => resolveSupervisorAgent(proj));
    expect(who).toBe("");
  });
});
