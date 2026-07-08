import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dispatch } from "../src/bridge.js";
import { doctorCommand } from "../src/commands/doctor.js";
import { registerAll } from "../src/commands/index.js";
import { renderScreenRecordingSetupNotice } from "../src/commands/setup.js";
import { EXTERNAL_TOOL_DECLARATIONS, type ExternalToolState } from "../src/lib/external-tools.js";

const dirs: string[] = [];
const repoRoot = resolve(__dirname, "../../..");

afterAll(() => {
  for (const dir of dirs) execSync(`rm -rf '${dir}'`);
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function captureDoctorTools(): string {
  const keys = ["HOME", "ROLL_HOME", "_ROLL_EXTERNAL_TOOLS_PLATFORM", "NO_COLOR", "ROLL_LANG"];
  const saved: Record<string, string | undefined> = {};
  for (const key of keys) saved[key] = process.env[key];
  const home = tempDir("roll-doctor-tools-home-");
  const cwd = tempDir("roll-doctor-tools-cwd-");
  mkdirSync(join(home, ".roll"), { recursive: true });
  for (const key of keys) delete process.env[key];
  process.env["HOME"] = home;
  process.env["ROLL_HOME"] = join(home, ".roll");
  process.env["_ROLL_EXTERNAL_TOOLS_PLATFORM"] = "linux";
  process.env["NO_COLOR"] = "1";
  process.env["ROLL_LANG"] = "en";
  const originalCwd = process.cwd();
  const realOut = process.stdout.write.bind(process.stdout);
  const chunks: string[] = [];
  // @ts-expect-error capture-only
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    process.chdir(cwd);
    expect(doctorCommand(["--tools"])).toBe(0);
  } finally {
    process.stdout.write = realOut;
    process.chdir(originalCwd);
    for (const key of keys) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return chunks.join("");
}

function externalState(status: ExternalToolState["status"]): ExternalToolState {
  const decl = EXTERNAL_TOOL_DECLARATIONS.find((row) => row.id === "screencapture");
  if (decl === undefined) throw new Error("missing screencapture declaration");
  return {
    ...decl,
    status,
    detail: `screencapture is ${status}`,
    repairCommand: "open x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  };
}

describe("US-INIT-003c Terminal.app screenshot preflight", () => {
  it("roll doctor --tools renders a focused readiness view", () => {
    const output = captureDoctorTools();

    expect(output).toContain("Tool readiness");
    expect(output).toContain("External requirements");
    expect(output).toContain("macOS screencapture");
    expect(output).not.toContain("Skill catalog");
    expect(output).not.toContain("PR review extras");
    expect(output).not.toContain("Design handoff nudge");
  });

  it("roll doctor --tools reuses the external requirement result instead of probing twice", () => {
    let probes = 0;
    const realOut = process.stdout.write.bind(process.stdout);
    const chunks: string[] = [];
    // @ts-expect-error capture-only
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      chunks.push(String(chunk));
      return true;
    };
    try {
      expect(
        doctorCommand(["--tools"], {
          externalTools: () => {
            probes += 1;
            return [externalState("permission-missing")];
          },
        }),
      ).toBe(0);
    } finally {
      process.stdout.write = realOut;
    }

    expect(probes).toBe(1);
    expect(chunks.join("")).toContain("Terminal.app Screen Recording");
    expect(chunks.join("")).toContain("permission-missing");
  });

  it("setup surfaces Screen Recording remediation only when permission is missing", () => {
    expect(renderScreenRecordingSetupNotice([externalState("ok")])).toBeNull();
    expect(renderScreenRecordingSetupNotice([externalState("stale")])).toBeNull();

    const notice = renderScreenRecordingSetupNotice([externalState("permission-missing")]);

    expect(notice).not.toBeNull();
    expect(notice).toContain("macOS Screen Recording permission is missing for Terminal.app");
    expect(notice).toContain("restart Terminal.app");
  });

  it("documents tool readiness in CLI help and README", async () => {
    registerAll();
    let stdout = "";
    const realOut = process.stdout.write.bind(process.stdout);
    try {
      // @ts-expect-error capture-only
      process.stdout.write = (chunk: string | Uint8Array): boolean => {
        stdout += String(chunk);
        return true;
      };
      const result = await dispatch(["doctor", "--help"]);
      expect(result.status).toBe(0);
    } finally {
      process.stdout.write = realOut;
    }

    expect(stdout).toContain("--tools");
    expect(readFileSync(join(repoRoot, "README.md"), "utf8")).toContain("roll doctor [skills\\|tools\\|language\\|repair-protection]");
  });
});
