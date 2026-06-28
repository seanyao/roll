import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectOperatingSlug, resolveOperatingMode } from "../src/lib/operating-mode.js";

const dirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  process.env[key] = value;
}

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
});

describe("operating mode", () => {
  it("honors the explicit project slug override", () => {
    setEnv("ROLL_MAIN_SLUG", "proj-abc123");
    expect(projectOperatingSlug(tmp("roll-mode-proj-"))).toBe("proj-abc123");
  });

  it("defaults to guided when the scheduler is not installed", () => {
    setEnv("ROLL_MAIN_SLUG", "proj-abc123");
    const project = tmp("roll-mode-project-");
    const launchd = tmp("roll-mode-launchd-");
    const mode = resolveOperatingMode(project, { launchdDir: () => launchd, launchdEnabled: () => false });
    expect(mode.mode).toBe("guided");
    expect(mode.installState).toBe("not_installed");
    expect(mode.schedulerAction).toContain("will not start");
  });

  it("maps an enabled scheduler to autonomous mode without new state files", () => {
    setEnv("ROLL_MAIN_SLUG", "proj-abc123");
    const project = tmp("roll-mode-project-");
    const launchd = tmp("roll-mode-launchd-");
    writeFileSync(join(launchd, "com.roll.loop.proj-abc123.plist"), "<plist />\n");
    const mode = resolveOperatingMode(project, { launchdDir: () => launchd, launchdEnabled: () => true });
    expect(mode.mode).toBe("autonomous");
    expect(mode.runState).toBe("active");
    expect(existsSync(join(project, ".roll", "mode.yaml"))).toBe(false);
  });

  it("maps a pause marker back to guided mode even when the scheduler is installed", () => {
    setEnv("ROLL_MAIN_SLUG", "proj-abc123");
    const project = tmp("roll-mode-project-");
    const launchd = tmp("roll-mode-launchd-");
    mkdirSync(join(project, ".roll", "loop"), { recursive: true });
    writeFileSync(join(project, ".roll", "loop", "PAUSE-proj-abc123"), "paused\n");
    writeFileSync(join(launchd, "com.roll.loop.proj-abc123.plist"), "<plist />\n");
    const mode = resolveOperatingMode(project, { launchdDir: () => launchd, launchdEnabled: () => true });
    expect(mode.mode).toBe("guided");
    expect(mode.runState).toBe("paused");
    expect(mode.ownerAction).toContain("roll loop resume");
  });

  it("maps a stale plist to guided mode with a repair action", () => {
    setEnv("ROLL_MAIN_SLUG", "proj-abc123");
    const project = tmp("roll-mode-project-");
    const launchd = tmp("roll-mode-launchd-");
    writeFileSync(join(launchd, "com.roll.loop.proj-abc123.plist"), "<plist />\n");
    const mode = resolveOperatingMode(project, { launchdDir: () => launchd, launchdEnabled: () => false });
    expect(mode.mode).toBe("guided");
    expect(mode.installState).toBe("stale");
    expect(mode.ownerAction).toContain("roll loop on");
  });
});
