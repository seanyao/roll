/**
 * US-DELTA-003 — Delta protocol integration tests.
 *
 * Temp-project fixtures: prepare, collision, crash/recovery, validate,
 * conclude, status. Uses real filesystem with temp dirs, no external engines.
 */
import { describe, expect, it, afterEach, beforeAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { deltaCommand } from "../src/commands/delta.js";
import { renderState } from "../src/render.js";

// ── Temp project fixture ─────────────────────────────────────────────────────

let projectDirs: string[] = [];

afterEach(() => {
  for (const d of projectDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
  projectDirs = [];
});

function makeProject(): string {
  const dir = join(tmpdir(), `roll-delta-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  projectDirs.push(dir);
  return dir;
}

/** Set up a minimal Roll project with a card directory. */
function setupMinimalProject(storyId: string, epic: string): string {
  const dir = makeProject();
  const featuresDir = join(dir, ".roll", "features", epic, storyId);
  mkdirSync(featuresDir, { recursive: true });
  // Write a minimal spec.md so the archive resolver finds it
  writeFileSync(
    join(featuresDir, "spec.md"),
    `# ${storyId}\n\nStory spec.\n`,
    "utf8",
  );
  // Create the loop dir for events
  mkdirSync(join(dir, ".roll", "loop"), { recursive: true });
  return dir;
}

// ── tsRun with cwd ──────────────────────────────────────────────────────────

function tsRunCwd(argv: string[], cwd: string): { stdout: string; stderr: string; code: number } {
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only override
  process.stdout.write = (c: string | Uint8Array): boolean => {
    out.push(typeof c === "string" ? c : Buffer.from(c).toString("utf8"));
    return true;
  };
  // @ts-expect-error capture-only override
  process.stderr.write = (c: string | Uint8Array): boolean => {
    err.push(typeof c === "string" ? c : Buffer.from(c).toString("utf8"));
    return true;
  };
  const saveCwd = process.cwd();
  let code: number;
  try {
    process.chdir(cwd);
    code = deltaCommand(argv);
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    renderState.useColor = true;
    process.chdir(saveCwd);
  }
  return { stdout: out.join(""), stderr: err.join(""), code };
}

// ── Scrubbing ────────────────────────────────────────────────────────────────

function scrubId(s: string): string {
  return s
    .replace(/delta-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, "delta-<DELEGATION_ID>")
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, "<DELEGATION_ID>")
    .replace(/[a-f0-9]{64}/gi, "<SHA256>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<TS>")
    .replace(/\b\d{13}\b/g, "<TS>");
}

function scrubPaths(s: string, dir: string): string {
  let r = scrubId(s);
  r = r.split(dir).join("<PROJECT>");
  r = r.split(tmpdir()).join("<TMP>");
  return r;
}

// ── Resolution template helper ───────────────────────────────────────────────

function writeResolutionTemplate(projectDir: string, storyId: string, presetId: string, name?: string): string {
  const resPath = join(projectDir, name ?? "resolution-template.json");
  const template = {
    schema: "roll-delta-resolution/v1",
    storyId,
    trigger: "host-guided",
    topology: "delta-team",
    qualityProfile: "standard",
    presetId,
    presetSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    inventoryObservedAt: new Date().toISOString(),
    inventorySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    roles: [
      { role: "designer", roleInstanceId: "ri-1", hostId: "pi", modelId: "claude", source: "user-pin", reasons: ["test"] },
      { role: "builder", roleInstanceId: "ri-2", hostId: "pi", modelId: "claude", source: "user-pin", reasons: ["test"] },
      { role: "evaluator", roleInstanceId: "ri-3", hostId: "pi", modelId: "claude", source: "user-pin", reasons: ["test"] },
    ],
  };
  writeFileSync(resPath, JSON.stringify(template, null, 2), "utf8");
  return resPath;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("US-DELTA-003 — prepare atomic allocation", () => {
  it("prepare creates delegation frame, marker, resolution, and events", () => {
    const dir = setupMinimalProject("US-DELTA-TEST", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-TEST", "local-preset");
    const r = tsRunCwd([
      "prepare", "US-DELTA-TEST",
      "--trigger", "host-guided",
      "--topology", "delta-team",
      "--profile", "standard",
      "--preset", "local-preset",
      "--resolution", resPath,
      "--json",
    ], dir);

    // Should succeed
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(parsed.ok).toBe(true);
    expect(typeof parsed.delegationId).toBe("string");
    expect(typeof parsed.runId).toBe("string");
    expect(parsed.runId).toBe(`delta-${parsed.delegationId}`);

    // Verify frame directory exists
    const frameDir = join(dir, ".roll", "features", "delta-team", "US-DELTA-TEST", `delta-${parsed.delegationId}`);
    expect(existsSync(frameDir)).toBe(true);

    // Verify marker exists
    const markerPath = join(frameDir, "delegation-open.json");
    expect(existsSync(markerPath)).toBe(true);

    // Verify resolution was persisted (with bound delegationId)
    const savedResolutionPath = join(frameDir, "role-artifacts", "delegation", "delegation-resolution.json");
    expect(existsSync(savedResolutionPath)).toBe(true);
    const savedRes = JSON.parse(readFileSync(savedResolutionPath, "utf8"));
    expect(savedRes.delegationId).toBe(parsed.delegationId);

    // Verify events were appended
    const eventsPath = join(dir, ".roll", "loop", "events.ndjson");
    expect(existsSync(eventsPath)).toBe(true);
    const events = readFileSync(eventsPath, "utf8").trim().split("\n");
    expect(events.length).toBeGreaterThanOrEqual(2);
    const preparedEvent = JSON.parse(events[0]!);
    expect(preparedEvent.type).toBe("delta:prepared");

    // Verify lease exists (per-story file)
    const leasePath = join(dir, ".roll", "loop", "host-delegation-leases", "US-DELTA-TEST.json");
    expect(existsSync(leasePath)).toBe(true);
    const lease = JSON.parse(readFileSync(leasePath, "utf8"));
    expect(lease.state).toBe("in_flight");
    expect(lease.ownerKind).toBe("host-delegation");
    expect(lease.delegationId).toBe(parsed.delegationId);
    expect(lease.runId).toBe(parsed.runId);

    // No latest, no runs.jsonl, no cycle
    expect(existsSync(join(dir, ".roll", "features", "delta-team", "US-DELTA-TEST", "latest"))).toBe(false);
    expect(existsSync(join(dir, ".roll", "loop", "runs.jsonl"))).toBe(false);
  });

  it("prepare rejects duplicate lease (concurrent collision)", () => {
    const dir = setupMinimalProject("US-DELTA-TEST-2", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-TEST-2", "local-preset");

    // First prepare succeeds
    const r1 = tsRunCwd([
      "prepare", "US-DELTA-TEST-2",
      "--trigger", "host-guided",
      "--topology", "delta-team",
      "--profile", "standard",
      "--preset", "local-preset",
      "--resolution", resPath,
      "--json",
    ], dir);
    expect(r1.code).toBe(0);

    // Second prepare on same story should fail with builder_lease_conflict
    const r2 = tsRunCwd([
      "prepare", "US-DELTA-TEST-2",
      "--trigger", "host-guided",
      "--topology", "delta-team",
      "--profile", "standard",
      "--preset", "local-preset",
      "--resolution", resPath,
      "--json",
    ], dir);
    expect(r2.code).toBe(1);
    const err2 = JSON.parse(r2.stderr);
    expect(err2.error).toBe("builder_lease_conflict");
  });

  it("prepare generates distinct crypto IDs on different stories", () => {
    const dir = setupMinimalProject("US-DELTA-TEST-3", "delta-team");
    const resPath1 = writeResolutionTemplate(dir, "US-DELTA-TEST-3", "local-preset");

    // Also set up a second story — use a completely distinct ID to avoid substring match
    const story2 = "US-DELTA-TEST-4";
    const featuresDir2 = join(dir, ".roll", "features", "delta-team", story2);
    mkdirSync(featuresDir2, { recursive: true });
    writeFileSync(join(featuresDir2, "spec.md"), `# ${story2}\n\nStory spec.\n`, "utf8");
    const resPath2 = writeResolutionTemplate(dir, story2, "local-preset", "resolution-template-2.json");

    const r1 = tsRunCwd([
      "prepare", "US-DELTA-TEST-3",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath1, "--json",
    ], dir);
    expect(r1.code).toBe(0);
    const id1 = JSON.parse(r1.stdout).delegationId;

    const r2 = tsRunCwd([
      "prepare", story2,
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath2, "--json",
    ], dir);
    expect(r2.code).toBe(0, `r2 failed: ${r2.stderr}`);
    const id2 = JSON.parse(r2.stdout).delegationId;

    expect(id1).not.toBe(id2);
  });

  it("prepare rejects --cycle flag with no side effects", () => {
    const dir = setupMinimalProject("US-DELTA-TEST-4", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-TEST-4", "local-preset");

    const r = tsRunCwd([
      "prepare", "US-DELTA-TEST-4",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath,
      "--cycle", "some-cycle-id",
      "--json",
    ], dir);
    expect(r.code).toBe(1);
    const err = JSON.parse(r.stderr);
    expect(err.error).toBe("cycle_rejected");

    // No frame, no lease, no events
    expect(existsSync(join(dir, ".roll", "loop", "events.ndjson"))).toBe(false);
    expect(existsSync(join(dir, ".roll", "loop", "host-delegation-leases"))).toBe(false);
  });

  it("prepare fails when story card directory cannot be uniquely resolved", () => {
    const dir = makeProject();
    // No card dir, no feature file — cardArchiveDir would use uncategorized
    // But our resolveExistingUniqueCardArchiveDir should fail
    // We need to test without a card directory, so the resolver fails.
    mkdirSync(join(dir, ".roll", "loop"), { recursive: true });
    const resPath = join(dir, "res.json");
    writeFileSync(resPath, JSON.stringify({
      schema: "roll-delta-resolution/v1",
      storyId: "US-NOEXIST",
      trigger: "host-guided",
      topology: "delta-team",
      qualityProfile: "standard",
      presetId: "x",
      presetSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      inventoryObservedAt: new Date().toISOString(),
      inventorySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      roles: [],
    }), "utf8");

    const r = tsRunCwd([
      "prepare", "US-NOEXIST",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath,
      "--json",
    ], dir);
    expect(r.code).toBe(1);
    // Error about missing or ambiguous card
    expect(r.stderr).toBeTruthy();
  });
});
