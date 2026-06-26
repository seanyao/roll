/**
 * Critical CLI E2E coverage distilled from real loop incidents:
 * - pre-v3 loop logs carried aborted/preflight/publish-fail terminal records.
 * - v3 card minting must write card + backlog + index through one public entry.
 * - attest must parse modern card specs instead of producing facts-only shells.
 *
 * These tests run the public CLI subprocess from this checkout. They never call
 * the user's installed `roll` entry.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const rollBin = join(repoRoot, "packages", "cli", "bin", "roll.js");
const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) execFileSync("rm", ["-rf", dir]);
});

function tmpProject(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `roll-e2e-${prefix}-`)));
  dirs.push(dir);
  mkdirSync(join(dir, ".roll", "features"), { recursive: true });
  return dir;
}

function runRoll(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): { code: number; out: string; err: string } {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ROLL_LANG: "en",
    ...env,
  };
  delete childEnv["ROLL_PROJECT_RUNTIME_DIR"];
  delete childEnv["_LOOP_RUNS"];
  try {
    const out = execFileSync(process.execPath, [rollBin, ...args], {
      cwd,
      env: childEnv,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out, err: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: e.stdout ?? "", err: e.stderr ?? "" };
  }
}

describe("critical CLI E2E", () => {
  it("roll story new is the single card-minting entry: card folder + backlog row + index", () => {
    const project = tmpProject("story-new");
    writeFileSync(join(project, ".roll", "backlog.md"), "| Story | Description | Status |\n|---|---|---|\n");

    const result = runRoll(project, ["story", "new", "FIX-901", "--title", "critical e2e card", "--epic", "qa-testing"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("card minted");
    expect(result.out).toContain("backlog row appended");
    expect(existsSync(join(project, ".roll", "features", "qa-testing", "FIX-901", "spec.md"))).toBe(true);
    expect(readFileSync(join(project, ".roll", "backlog.md"), "utf8")).toContain(
      "| [FIX-901](.roll/features/qa-testing/FIX-901/spec.md) | critical e2e card | 📋 Todo |",
    );
    const index = JSON.parse(readFileSync(join(project, ".roll", "index.json"), "utf8")) as { stories: Record<string, string> };
    expect(index.stories["FIX-901"]).toBe("qa-testing");
  });

  it("roll attest parses modern `## Acceptance Criteria` specs instead of facts-only reports", () => {
    const project = tmpProject("attest-modern-ac");
    const storyDir = join(project, ".roll", "features", "acceptance-evidence", "FIX-902");
    mkdirSync(storyDir, { recursive: true });
    writeFileSync(
      join(storyDir, "spec.md"),
      [
        "---",
        "id: FIX-902",
        "title: modern AC parsing",
        "type: fix",
        "epic: acceptance-evidence",
        "created: 2026-06-12",
        "---",
        "",
        "# FIX-902 — modern AC parsing",
        "",
        "## Acceptance Criteria",
        "",
        "- [ ] AC1 report renders this checklist",
        "- [ ] AC2 report stays claim-only without ac-map",
        "",
      ].join("\n"),
    );

    const result = runRoll(project, ["attest", "FIX-902"]);

    expect(result.code).toBe(0);
    expect(result.err).not.toContain("no **AC:** block");
    const report = readFileSync(join(storyDir, "latest", "FIX-902-report.html"), "utf8");
    expect(report).toContain("FIX-902:AC1");
    expect(report).toContain("AC1 report renders this checklist");
    expect(report).toContain("Claimed");
  });

  it("physical_terminal stories validate and attest without headless stdout masquerading as pixels", () => {
    const project = tmpProject("physical-terminal");
    const storyDir = join(project, ".roll", "features", "acceptance-evidence", "US-PHYS-E2E");
    mkdirSync(storyDir, { recursive: true });
    const command = `node ${rollBin} doctor --tools`;
    writeFileSync(
      join(storyDir, "spec.md"),
      [
        "---",
        "id: US-PHYS-E2E",
        "title: physical terminal evidence e2e",
        "type: us",
        "epic: acceptance-evidence",
        "created: 2026-06-26",
        `deliverable_cmd: ${command}`,
        "physical_terminal:",
        "  app: Terminal.app",
        `  command: ${command}`,
        "  evidence: screenshot",
        "---",
        "",
        "# US-PHYS-E2E — physical terminal evidence e2e",
        "",
        "## Acceptance Criteria",
        "",
        "- [ ] [visual-evidence] real physical Terminal.app screenshot proves the CLI output",
        "",
      ].join("\n"),
    );

    const validate = runRoll(project, ["story", "validate", "US-PHYS-E2E"]);
    expect(validate.code).toBe(0);
    expect(validate.out).toContain("visual-evidence: ok (surface: terminal)");

    const attest = runRoll(project, ["attest", "US-PHYS-E2E", "--capture-command", command], {
      ROLL_NO_SCREENCAP: "1",
    });
    expect(attest.code).toBe(0);
    const latest = join(storyDir, "latest");
    expect(existsSync(join(latest, "screenshots", "terminal-headless.txt"))).toBe(false);
    const evidence = JSON.parse(readFileSync(join(latest, "evidence.json"), "utf8")) as {
      captures?: Array<{ kind?: string; taken?: boolean; skipped?: string }>;
    };
    expect(evidence.captures?.[0]).toMatchObject({ kind: "physical-terminal", taken: false });
    expect(evidence.captures?.[0]?.skipped).toContain("ROLL_NO_SCREENCAP");
  });

  it("roll loop runs reads real pre-v3 terminal patterns through the public CLI", () => {
    const project = tmpProject("loop-runs");
    const runtime = join(project, ".roll", "loop");
    mkdirSync(runtime, { recursive: true });
    writeFileSync(
      join(runtime, "runs.jsonl"),
      [
        JSON.stringify({
          ts: "2026-05-27T11:54:43Z",
          project: "roll-ecf079",
          run_id: "loop-20260527-194711",
          status: "failed",
          built: [],
          skipped: [],
          alerts: ["agent_invoke"],
          tcr_count: 0,
          duration_sec: 743,
          reason: "agent_invoke aborted",
        }),
        JSON.stringify({
          ts: "2026-06-04T03:41:12Z",
          project: "roll-ecf079",
          run_id: "loop-20260604-113328",
          status: "failed",
          built: [],
          skipped: [],
          alerts: ["publish_pr"],
          tcr_count: 0,
          duration_sec: 600,
          reason: "PR publish failed",
        }),
        JSON.stringify({
          ts: "2026-06-06T19:45:25Z",
          project: "roll-ecf079",
          run_id: "loop-20260606-1945",
          status: "built",
          built: ["US-CLI-003"],
          skipped: [],
          alerts: [],
          tcr_count: 4,
          duration_sec: 1662,
        }),
      ].join("\n") + "\n",
    );

    const result = runRoll(project, ["loop", "runs", "--all", "3"], {
      ROLL_LOOP_RUNS_ALL_DIRS: runtime,
    });

    expect(result.code).toBe(0);
    expect(result.out).toContain("[roll-ecf079] ✅ built 1 item");
    expect(result.out).toContain("US-CLI-003");
    expect(result.out).toContain("[roll-ecf079] ✗ FAILED — PR publish failed");
    expect(result.out).toContain("[roll-ecf079] ✗ FAILED — agent_invoke aborted");
  });
});
