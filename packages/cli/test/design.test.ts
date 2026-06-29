/**
 * US-ONBOARD-NUDGE-004 — `roll design` unit tests.
 *
 * All agent selection and spawn behaviour is verified through an injected spawn
 * adapter and a temporary ROLL_HOME/PATH; no real agent is launched.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { designCommand, type DesignCommandDeps } from "../src/commands/design.js";

const REPO = resolve(__dirname, "../../..");

type SpawnCall = { bin: string; args: string[]; opts: { cwd: string } };

function freshHome(): { home: string; bin: string } {
  const home = mkdtempSync(join(tmpdir(), "roll-design-home-"));
  const bin = mkdtempSync(join(tmpdir(), "roll-design-bin-"));
  mkdirSync(join(home, ".roll"), { recursive: true });
  return { home: join(home, ".roll"), bin };
}

function freshProj(): string {
  const proj = mkdtempSync(join(tmpdir(), "roll-design-proj-"));
  mkdirSync(join(proj, ".roll"), { recursive: true });
  return proj;
}

function writeConfig(home: string, lines: string): void {
  writeFileSync(join(home, "config.yaml"), lines, "utf8");
}

function makeAgent(bin: string, name: string): void {
  const path = join(bin, name);
  writeFileSync(path, "#!/bin/sh\necho ok\n", "utf8");
  chmodSync(path, 0o755);
}

function makeDeps(proj: string, bin: string): DesignCommandDeps & { calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  return {
    cwd: proj,
    env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}` },
    readLine: () => null,
    spawn: (binName, args, opts) => {
      calls.push({ bin: binName, args, opts: { cwd: String(opts.cwd ?? "") } });
      return { status: 0, signal: null };
    },
    calls,
  };
}

describe("roll design", () => {
  let home: string;
  let bin: string;
  const dirs: string[] = [];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    const f = freshHome();
    home = f.home;
    bin = f.bin;
    dirs.push(home, bin);
    savedEnv["ROLL_HOME"] = process.env["ROLL_HOME"];
    savedEnv["ROLL_PKG_DIR"] = process.env["ROLL_PKG_DIR"];
    savedEnv["ROLL_DESIGN_AGENT"] = process.env["ROLL_DESIGN_AGENT"];
    savedEnv["ROLL_LANG"] = process.env["ROLL_LANG"];
    process.env["ROLL_HOME"] = home;
    process.env["ROLL_PKG_DIR"] = REPO;
    process.env["ROLL_LANG"] = "en";
    delete process.env["ROLL_DESIGN_AGENT"];
  });

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("prints help and exits 0", () => {
    const out = { data: "" };
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      out.data += String(s);
      return true;
    });
    const code = designCommand(["--help"]);
    spy.mockRestore();
    expect(code).toBe(0);
    expect(out.data).toContain("Usage: roll design");
    expect(out.data).toContain("--from-file <path>");
    expect(out.data).toContain("\"<requirement>\"");
    expect(out.data).toContain("ROLL_DESIGN_AGENT");
  });

  it("fails with usage on unknown flag", () => {
    const code = designCommand(["--unknown"]);
    expect(code).toBe(1);
  });

  it("fails in a non-roll project", () => {
    const proj = mkdtempSync(join(tmpdir(), "roll-design-noroll-"));
    dirs.push(proj);
    writeConfig(home, "# config\n");
    const code = designCommand([], { cwd: proj });
    expect(code).toBe(1);
  });

  it("fails when the skill file is missing", () => {
    const proj = freshProj();
    dirs.push(proj);
    writeConfig(home, "# config\n");
    makeAgent(bin, "claude");
    const badPkg = mkdtempSync(join(tmpdir(), "roll-design-pkg-"));
    dirs.push(badPkg);
    process.env["ROLL_PKG_DIR"] = badPkg;
    const code = designCommand([], { cwd: proj });
    expect(code).toBe(1);
  });

  it("fails when no agent is installed", () => {
    const proj = freshProj();
    dirs.push(proj);
    writeConfig(home, "# config\n");
    const code = designCommand([], { cwd: proj });
    expect(code).toBe(1);
  });

  it("spawns claude when selected by --agent", () => {
    const proj = freshProj();
    dirs.push(proj);
    makeAgent(bin, "claude");
    makeAgent(bin, "kimi");
    writeConfig(home, "lang: en\nai_claude: ~/.claude\n");
    const d = makeDeps(proj, bin);
    const code = designCommand(["--agent", "claude"], d);
    expect(code).toBe(0);
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]?.bin).toBe("claude");
    expect(d.calls[0]?.args).toHaveLength(1);
    expect(d.calls[0]?.args[0]).toContain("Run the $roll-design skill");
    expect(d.calls[0]?.args[0]).toContain("Load when the user wants to discuss approaches");
    expect(d.calls[0]?.opts.cwd).toBe(proj);
  });

  it("accepts the init-suggested --from-file handoff and binds the source file in the prompt", () => {
    const proj = freshProj();
    dirs.push(proj);
    mkdirSync(join(proj, "docs"), { recursive: true });
    writeFileSync(join(proj, "docs", "intel-radar-PRD.md"), "# Intel Radar PRD\n", "utf8");
    makeAgent(bin, "claude");
    writeConfig(home, "lang: en\nai_claude: ~/.claude\n");
    const d = makeDeps(proj, bin);
    const code = designCommand(["--from-file", "docs/intel-radar-PRD.md"], d);
    expect(code).toBe(0);
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]?.bin).toBe("claude");
    expect(d.calls[0]?.args[0]).toContain("Use this product brief file as the design input: docs/intel-radar-PRD.md");
  });

  it("fails loud when --from-file has no value", () => {
    const proj = freshProj();
    dirs.push(proj);
    makeAgent(bin, "claude");
    writeConfig(home, "lang: en\nai_claude: ~/.claude\n");
    const d = makeDeps(proj, bin);
    const code = designCommand(["--from-file"], d);
    expect(code).toBe(1);
    expect(d.calls).toHaveLength(0);
  });

  it("fails loud when --from-file points at a missing file", () => {
    const proj = freshProj();
    dirs.push(proj);
    makeAgent(bin, "claude");
    writeConfig(home, "lang: en\nai_claude: ~/.claude\n");
    const d = makeDeps(proj, bin);
    const code = designCommand(["--from-file", "docs/missing.md"], d);
    expect(code).toBe(1);
    expect(d.calls).toHaveLength(0);
  });

  it("selects agent from ROLL_DESIGN_AGENT", () => {
    const proj = freshProj();
    dirs.push(proj);
    makeAgent(bin, "kimi");
    makeAgent(bin, "pi");
    writeConfig(home, "lang: en\nai_kimi: ~/.kimi\n");
    process.env["ROLL_DESIGN_AGENT"] = "kimi";
    const d = makeDeps(proj, bin);
    const code = designCommand([], d);
    expect(code).toBe(0);
    expect(d.calls[0]?.bin).toBe("kimi");
  });

  it("uses primary_agent when installed and multiple agents exist", () => {
    const proj = freshProj();
    dirs.push(proj);
    makeAgent(bin, "claude");
    makeAgent(bin, "pi");
    writeConfig(home, "lang: en\nprimary_agent: pi\nai_claude: ~/.claude\nai_pi: ~/.pi\n");
    const d = makeDeps(proj, bin);
    const code = designCommand([], d);
    expect(code).toBe(0);
    expect(d.calls[0]?.bin).toBe("pi");
  });

  it("auto-selects the only installed agent", () => {
    const proj = freshProj();
    dirs.push(proj);
    makeAgent(bin, "claude");
    writeConfig(home, "lang: en\nai_claude: ~/.claude\n");
    const d = makeDeps(proj, bin);
    const code = designCommand([], d);
    expect(code).toBe(0);
    expect(d.calls[0]?.bin).toBe("claude");
  });

  it("prompts interactively when multiple agents are installed and no primary is set", () => {
    const proj = freshProj();
    dirs.push(proj);
    makeAgent(bin, "claude");
    makeAgent(bin, "kimi");
    writeConfig(home, "lang: en\nai_claude: ~/.claude\nai_kimi: ~/.kimi\n");
    const d = makeDeps(proj, bin);
    d.readLine = () => "2";
    const code = designCommand([], d);
    expect(code).toBe(0);
    expect(d.calls[0]?.bin).toBe("kimi");
  });

  it("is fail-loud for an unknown --agent", () => {
    const proj = freshProj();
    dirs.push(proj);
    makeAgent(bin, "claude");
    writeConfig(home, "lang: en\nai_claude: ~/.claude\n");
    const d = makeDeps(proj, bin);
    const code = designCommand(["--agent", "unknown"], d);
    expect(code).toBe(1);
    expect(d.calls).toHaveLength(0);
  });

  it("is fail-loud for an unknown ROLL_DESIGN_AGENT", () => {
    const proj = freshProj();
    dirs.push(proj);
    makeAgent(bin, "claude");
    writeConfig(home, "lang: en\nai_claude: ~/.claude\n");
    process.env["ROLL_DESIGN_AGENT"] = "bogus";
    const d = makeDeps(proj, bin);
    const code = designCommand([], d);
    expect(code).toBe(1);
    expect(d.calls).toHaveLength(0);
  });

  it("ignores an uninstalled primary_agent and prompts", () => {
    const proj = freshProj();
    dirs.push(proj);
    makeAgent(bin, "claude");
    makeAgent(bin, "kimi");
    writeConfig(home, "lang: en\nprimary_agent: pi\nai_claude: ~/.claude\nai_kimi: ~/.kimi\n");
    const d = makeDeps(proj, bin);
    d.readLine = () => "1";
    const code = designCommand([], d);
    expect(code).toBe(0);
    expect(d.calls[0]?.bin).toBe("claude");
  });

  it("returns the spawn exit code", () => {
    const proj = freshProj();
    dirs.push(proj);
    makeAgent(bin, "claude");
    writeConfig(home, "lang: en\nai_claude: ~/.claude\n");
    const d = makeDeps(proj, bin);
    d.spawn = (binName, args, opts) => {
      d.calls.push({ bin: binName, args, opts: { cwd: String(opts.cwd ?? "") } });
      return { status: 42, signal: null };
    };
    const code = designCommand([], d);
    expect(code).toBe(42);
  });

  it("bare design with non-empty backlog prints bounded help and does not spawn", () => {
    const proj = freshProj();
    dirs.push(proj);
    // Write a non-empty backlog
    const backlog = [
      "| Story | Description | Status |",
      "|-------|-------------|--------|",
      "| [US-TEST-001](.roll/features/test/US-TEST-001/spec.md) | Test item | 📋 Todo |",
    ].join("\n") + "\n";
    writeFileSync(join(proj, ".roll", "backlog.md"), backlog, "utf8");
    const d = makeDeps(proj, bin);
    const out = { data: "" };
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      out.data += String(s);
      return true;
    });
    const code = designCommand([], d);
    spy.mockRestore();
    expect(code).toBe(0);
    expect(out.data).toContain("No design target given");
    expect(out.data).toContain("--from-file");
    expect(d.calls).toHaveLength(0);
  });

  it("bare design with empty backlog still spawns agent (onboarding path)", () => {
    const proj = freshProj();
    dirs.push(proj);
    makeAgent(bin, "claude");
    writeConfig(home, "lang: en\nai_claude: ~/.claude\n");
    const d = makeDeps(proj, bin);
    const code = designCommand([], d);
    expect(code).toBe(0);
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]?.bin).toBe("claude");
  });

  it("design with positional requirement text includes it in the prompt", () => {
    const proj = freshProj();
    dirs.push(proj);
    makeAgent(bin, "claude");
    writeConfig(home, "lang: en\nai_claude: ~/.claude\n");
    const d = makeDeps(proj, bin);
    const code = designCommand(["build a login system"], d);
    expect(code).toBe(0);
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]?.args[0]).toContain("Design requirement: build a login system");
  });

  it("--from-file and positional requirement text are mutually exclusive", () => {
    const proj = freshProj();
    dirs.push(proj);
    const req = join(proj, "req.md");
    writeFileSync(req, "# Requirement\n", "utf8");
    makeAgent(bin, "claude");
    writeConfig(home, "lang: en\nai_claude: ~/.claude\n");
    const d = makeDeps(proj, bin);
    const code = designCommand(["--from-file", "req.md", "extra target"], d);
    expect(code).toBe(1);
    expect(d.calls).toHaveLength(0);
  });
});
