import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { supervisorCommand } from "../src/commands/supervisor.js";

function makeFakeGh(binDir: string, payload: unknown): void {
  const script = `#!/bin/sh
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  cat <<'JSON'
${JSON.stringify(payload)}
JSON
  exit 0
fi
echo '[]'
exit 0
`;
  writeFileSync(join(binDir, "gh"), script, { mode: 0o755 });
}

function buildPrView(storyId: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    reviews: [{ authorAssociation: "BOT", state: "APPROVED" }],
    mergeStateStatus: "CLEAN",
    statusCheckRollup: [{ conclusion: "SUCCESS" }],
    body: `Fixes ${storyId}\n\n[roll:manual-merge]`,
    labels: [{ name: "roll:manual-merge" }],
    isDraft: true,
    headRefName: `loop/cycle-20260701-000000-00000-${storyId.toLowerCase()}`,
    state: "OPEN",
    ...overrides,
  };
}

function setupProject(base: string, storyId: string): void {
  mkdirSync(join(base, ".roll", "loop"), { recursive: true });
  writeFileSync(join(base, ".roll", "loop", "events.ndjson"), "", "utf8");
  const specDir = join(base, ".roll", "features", "uncategorized", storyId);
  mkdirSync(specDir, { recursive: true });
  writeFileSync(
    join(specDir, "spec.md"),
    `---\nid: ${storyId}\ntype: bug\n---\n\n# ${storyId}\n\n**AC:**\n- [ ] AC one\n- [ ] AC two\n`,
    "utf8",
  );
}

describe("supervisor repair-evidence", () => {
  let base: string;
  let binDir: string;
  let originalCwd: string;
  let originalPath: string;
  const storyId = "FIX-TEST-001";

  beforeEach(() => {
    originalCwd = process.cwd();
    originalPath = process.env.PATH ?? "";
    base = join(tmpdir(), `roll-repair-evidence-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    binDir = join(base, "bin");
    mkdirSync(binDir, { recursive: true });
    setupProject(base, storyId);
    process.env.PATH = `${binDir}:${originalPath}`;
    process.chdir(base);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env.PATH = originalPath;
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      /* temp cleanup best-effort */
    }
  });

  function captureIo(): { stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
    return { stdout, stderr };
  }

  it("repairs a green manual-merge PR and writes gate-checked latest/<ID>-report.html", () => {
    makeFakeGh(binDir, buildPrView(storyId));
    const io = captureIo();
    const code = supervisorCommand(["repair-evidence", "42", "--json"]);
    const out = io.stdout.join("");
    const result = JSON.parse(out);

    expect(code).toBe(0);
    expect(result).toMatchObject({
      prNumber: 42,
      storyId,
      verdict: "repaired",
      action: "merge_ready",
    });
    expect(result.artifacts.report).toContain("latest/");
    expect(result.artifacts.report).toContain(`${storyId}-report.html`);

    const reportPath = join(base, ".roll", "features", "uncategorized", storyId, "latest", `${storyId}-report.html`);
    expect(existsSync(reportPath)).toBe(true);
    const report = readFileSync(reportPath, "utf8");
    expect(report).toContain("<!doctype html>");
    expect(report).toContain(storyId);

    const acMapPath = join(base, ".roll", "features", "uncategorized", storyId, "ac-map.json");
    expect(existsSync(acMapPath)).toBe(true);
    const acMap = JSON.parse(readFileSync(acMapPath, "utf8")) as unknown;
    expect(Array.isArray(acMap)).toBe(true);
    expect((acMap as Array<{ status: string }>).every((e) => e.status === "claimed")).toBe(true);

    const events = readFileSync(join(base, ".roll", "loop", "events.ndjson"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as { type: string });
    expect(events.map((e) => e.type)).toEqual(["evidence:repair_requested", "evidence:repaired"]);
  });

  it("returns already_repaired when an evidence:repaired event exists for the PR", () => {
    writeFileSync(
      join(base, ".roll", "loop", "events.ndjson"),
      JSON.stringify({ type: "evidence:repaired", prNumber: 42, storyId, outcome: "evidence-generated", details: "ok", ts: 1 }) + "\n",
      "utf8",
    );
    makeFakeGh(binDir, buildPrView(storyId));
    const io = captureIo();
    const code = supervisorCommand(["repair-evidence", "42", "--json"]);
    const result = JSON.parse(io.stdout.join(""));

    expect(code).toBe(0);
    expect(result.verdict).toBe("already_repaired");
  });

  it("returns no_gap when a fresh latest/<ID>-report.html already exists", () => {
    makeFakeGh(binDir, buildPrView(storyId));
    const latestDir = join(base, ".roll", "features", "uncategorized", storyId, "latest");
    mkdirSync(latestDir, { recursive: true });
    writeFileSync(join(latestDir, `${storyId}-report.html`), "<html>existing</html>", "utf8");

    const io = captureIo();
    const code = supervisorCommand(["repair-evidence", "42", "--json"]);
    const result = JSON.parse(io.stdout.join(""));

    expect(code).toBe(0);
    expect(result.verdict).toBe("no_gap");
  });

  it("returns not_reparable when CI is red", () => {
    makeFakeGh(binDir, buildPrView(storyId, { statusCheckRollup: [{ conclusion: "FAILURE" }] }));
    const io = captureIo();
    const code = supervisorCommand(["repair-evidence", "42", "--json"]);
    const result = JSON.parse(io.stdout.join(""));

    expect(code).toBe(1);
    expect(result.verdict).toBe("not_reparable");
    expect(result.reason).toContain("CI");
  });

  it("formats human-readable output matching the snapshot", () => {
    makeFakeGh(binDir, buildPrView(storyId));
    const io = captureIo();
    const code = supervisorCommand(["repair-evidence", "42"]);
    const out = io.stdout.join("");

    expect(code).toBe(0);
    expect(out).toContain("repair-evidence: PR #42");
    expect(out).toContain("action: merge_ready");
    expect(out).toContain("ac-map: generated for 2 AC(s)");
    expect(out).toContain("latest/");
    expect(out).toMatchSnapshot();
  });
});
