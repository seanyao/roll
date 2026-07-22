/**
 * US-DELTA-003 — Delta protocol integration tests.
 *
 * Temp-project fixtures: prepare, collision, crash/recovery, validate,
 * conclude, status. Uses real filesystem with temp dirs, no external engines.
 */
import { describe, expect, it, afterEach, beforeAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, unlinkSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { deltaCommand, injectValidator } from "../src/commands/delta.js";
import { injectIdGenerator } from "../src/lib/delta-allocation.js";
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
    presetSha256: "0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff",
    inventoryObservedAt: new Date().toISOString(),
    inventorySha256: "0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff",
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

    // F-3: presetSha256 must match the host-supplied resolution template value (not fabricated)
    expect(preparedEvent.presetSha256).toBe("0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff");

    // F-5: hostId is resolved from preset (not hardcoded "pi")
    // When no machine-local preset exists, hostId is "unknown" — not a fabricated host name
    expect(typeof preparedEvent.hostId).toBe("string");
    expect(preparedEvent.hostId).not.toBe("pi");

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

  it("prepare retries with distinct delegation ID on frame collision (F-4)", () => {
    const dir = setupMinimalProject("US-DELTA-COLLIDE", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-COLLIDE", "local-preset");

    // Deterministic collision: control ID generator so first mkdir collides,
    // second retry also collides, third attempt generates a fresh distinct ID.
    // The collision frame is never touched (only own lease is released).
    const controlledIds = ["collide-1", "collide-1", "collide-1", "collide-2"];
    let callIndex = 0;
    injectIdGenerator(() => {
      const id = controlledIds[callIndex]!;
      callIndex++;
      return id;
    });

    try {
      // First prepare: "collide-1" successfully creates frame delta-collide-1
      const r1 = tsRunCwd([
        "prepare", "US-DELTA-COLLIDE",
        "--trigger", "host-guided", "--topology", "delta-team",
        "--profile", "standard", "--preset", "local-preset",
        "--resolution", resPath, "--json",
      ], dir);
      expect(r1.code).toBe(0);
      const id1 = JSON.parse(r1.stdout).delegationId;
      expect(id1).toBe("collide-1");

      const collisionFrame = join(dir, ".roll", "features", "delta-team", "US-DELTA-COLLIDE", `delta-${id1}`);
      expect(existsSync(collisionFrame)).toBe(true);

      // Remove the lease so second prepare can claim again
      const leasePath = join(dir, ".roll", "loop", "host-delegation-leases", "US-DELTA-COLLIDE.json");
      unlinkSync(leasePath);

      // Second prepare: first two generateDelegationId() calls produce "collide-1"
      // → mkdirSync("delta-collide-1") throws EEXIST both times
      // → only own lease is released, collision frame is preserved
      // → third call produces "collide-2" → fresh frame succeeds
      const r2 = tsRunCwd([
        "prepare", "US-DELTA-COLLIDE",
        "--trigger", "host-guided", "--topology", "delta-team",
        "--profile", "standard", "--preset", "local-preset",
        "--resolution", resPath, "--json",
      ], dir);
      expect(r2.code).toBe(0);
      const id2 = JSON.parse(r2.stdout).delegationId;

      // Must have retried and used the distinct ID (collide-2, not collide-1)
      expect(id2).toBe("collide-2");
      expect(id2).not.toBe(id1);

      // Original collision frame is preserved (never overwritten)
      expect(existsSync(collisionFrame)).toBe(true);

      // Only own lease was released during retry; the collision frame's
      // delegation-open.json is untouched (verify it still has collided ID)
      const collisionMarker = JSON.parse(readFileSync(
        join(collisionFrame, "delegation-open.json"), "utf8"));
      expect(collisionMarker.delegationId).toBe("collide-1");

      // New distinct frame exists with the fresh ID
      const newFrame = join(dir, ".roll", "features", "delta-team", "US-DELTA-COLLIDE", `delta-${id2}`);
      expect(existsSync(newFrame)).toBe(true);
      expect(newFrame).not.toBe(collisionFrame);
    } finally {
      injectIdGenerator(null);
    }
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

  it("prepare rejects when a live cycle lease exists for the story (cross-lease exclusion)", () => {
    const dir = setupMinimalProject("US-DELTA-XLEASE", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-XLEASE", "local-preset");

    // Write a simulated cycle lease into story-leases.json
    const leasesPath = join(dir, ".roll", "loop", "story-leases.json");
    mkdirSync(dirname(leasesPath), { recursive: true });
    writeFileSync(leasesPath, JSON.stringify({
      "US-DELTA-XLEASE": { pid: 12345, claimedAt: Date.now(), source: "cycle" },
    }), "utf8");

    const r = tsRunCwd([
      "prepare", "US-DELTA-XLEASE",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath, "--json",
    ], dir);
    expect(r.code).toBe(1);
    const err = JSON.parse(r.stderr);
    expect(err.error).toBe("builder_lease_conflict");
  });

  it("prepare succeeds when story-leases.json has a non-cycle source (human/supervisor)", () => {
    const dir = setupMinimalProject("US-DELTA-XLEASE2", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-XLEASE2", "local-preset");

    // Write a human lease (not cycle) — should NOT block host-delegation
    const leasesPath = join(dir, ".roll", "loop", "story-leases.json");
    mkdirSync(dirname(leasesPath), { recursive: true });
    writeFileSync(leasesPath, JSON.stringify({
      "US-DELTA-XLEASE2": { pid: undefined, claimedAt: Date.now(), source: "human" },
    }), "utf8");

    const r = tsRunCwd([
      "prepare", "US-DELTA-XLEASE2",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath, "--json",
    ], dir);
    expect(r.code).toBe(0);
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
      presetSha256: "0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff",
      inventoryObservedAt: new Date().toISOString(),
      inventorySha256: "0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff",
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

// ── Crash / recovery / status ──────────────────────────────────────────────

describe("US-DELTA-003 — crash marker and recovery", () => {
  it("orphan marker (delegation-open.json without events) is detected by status", () => {
    const dir = setupMinimalProject("US-DELTA-ORPHAN", "delta-team");

    // Manually create an orphan frame: marker exists but no events
    const delegationId = randomUUID();
    const frameDir = join(dir, ".roll", "features", "delta-team", "US-DELTA-ORPHAN", `delta-${delegationId}`);
    mkdirSync(frameDir, { recursive: true });
    writeFileSync(
      join(frameDir, "delegation-open.json"),
      JSON.stringify({
        schema: "roll-delta-delegation-open/v1",
        delegationId,
        storyId: "US-DELTA-ORPHAN",
        createdAt: new Date().toISOString(),
      }),
      "utf8",
    );

    // status should report uncommitted
    const r = tsRunCwd(["status", "--story", "US-DELTA-ORPHAN", "--json"], dir);
    // Status should detect orphan
    expect(r.code).toBe(0);
    const result = JSON.parse(r.stdout);
    // Should show unknown or uncommitted state
    expect(result.uncommittedFrames).toBeDefined();
    expect(result.uncommittedFrames.length).toBeGreaterThan(0);
    expect(result.uncommittedFrames[0].delegationId).toBe(delegationId);
  });

  it("prepare then status --story shows zero uncommittedFrames (BLOCK-1: no false orphans)", () => {
    const dir = setupMinimalProject("US-DELTA-ORPHAN3", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-ORPHAN3", "local-preset");

    // Normal prepare: marker + events both written
    const r1 = tsRunCwd([
      "prepare", "US-DELTA-ORPHAN3",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath, "--json",
    ], dir);
    expect(r1.code).toBe(0);

    // status --story must NOT show any uncommittedFrames because delegation is committed
    const r2 = tsRunCwd(["status", "--story", "US-DELTA-ORPHAN3", "--json"], dir);
    expect(r2.code).toBe(0);
    const result = JSON.parse(r2.stdout);
    // Either no uncommittedFrames key or an empty array — commited delegations are not orphans
    const uf = result.uncommittedFrames;
    expect(uf === undefined || (Array.isArray(uf) && uf.length === 0)).toBe(true);
  });

  it("prepare never adopts an orphan frame", () => {
    const dir = setupMinimalProject("US-DELTA-ORPHAN2", "delta-team");

    // Create an orphan frame manually
    const oldDelegationId = randomUUID();
    const frameDir = join(dir, ".roll", "features", "delta-team", "US-DELTA-ORPHAN2", `delta-${oldDelegationId}`);
    mkdirSync(frameDir, { recursive: true });
    writeFileSync(
      join(frameDir, "delegation-open.json"),
      JSON.stringify({
        schema: "roll-delta-delegation-open/v1",
        delegationId: oldDelegationId,
        storyId: "US-DELTA-ORPHAN2",
        createdAt: new Date().toISOString(),
      }),
      "utf8",
    );

    // Now prepare — should create a new frame, not adopt the orphan
    const resPath = writeResolutionTemplate(dir, "US-DELTA-ORPHAN2", "local-preset");
    const r = tsRunCwd([
      "prepare", "US-DELTA-ORPHAN2",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath, "--json",
    ], dir);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    // New delegation ID should be different
    expect(parsed.delegationId).not.toBe(oldDelegationId);
    // Orphan frame still exists
    expect(existsSync(frameDir)).toBe(true);
  });

  it("status --json shows host-unobservable cost", () => {
    const dir = setupMinimalProject("US-DELTA-STATUS", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-STATUS", "local-preset");

    // Prepare first
    const r1 = tsRunCwd([
      "prepare", "US-DELTA-STATUS",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath, "--json",
    ], dir);
    expect(r1.code).toBe(0);
    const delegationId = JSON.parse(r1.stdout).delegationId;

    // Status by delegation
    const r2 = tsRunCwd(["status", "--delegation", delegationId, "--json"], dir);
    expect(r2.code).toBe(0);
    const status = JSON.parse(r2.stdout);

    // Verify projection
    expect(status.delegationId).toBe(delegationId);
    expect(status.storyId).toBe("US-DELTA-STATUS");
    expect(status.status).toBe("in_progress");
    expect(status.visibleMode).toBe("delta-team");
    expect(status.totalCost).toBe("? (host_unobservable)");
    expect(status.roles).toBeDefined();
    expect(status.roles.length).toBeGreaterThan(0);
  });

  it("status human output contains expected fields", () => {
    const dir = setupMinimalProject("US-DELTA-STATUS2", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-STATUS2", "local-preset");

    const r1 = tsRunCwd([
      "prepare", "US-DELTA-STATUS2",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath, "--json",
    ], dir);
    expect(r1.code).toBe(0);
    const delegationId = JSON.parse(r1.stdout).delegationId;

    const r2 = tsRunCwd(["status", "--delegation", delegationId], dir);
    expect(r2.code).toBe(0);
    // Human output
    expect(r2.stdout).toContain("US-DELTA-STATUS2");
    expect(r2.stdout).toContain("in_progress");
    expect(r2.stdout).toContain("host_unobservable");
  });
});

// ── Validator plumbing ──────────────────────────────────────────────────────

describe("US-DELTA-003 — validate plumbing", () => {
  it("validate returns error when delegation not found", () => {
    const dir = setupMinimalProject("US-DELTA-VAL", "delta-team");
    const r = tsRunCwd(["validate", "--delegation", "nonexistent-id", "--stage", "designer", "--json"], dir);
    expect(r.code).toBe(1);
    const err = JSON.parse(r.stderr);
    expect(err.error).toBe("delegation_not_found");
  });

  it("validate returns error when stage is missing", () => {
    const dir = setupMinimalProject("US-DELTA-VAL2", "delta-team");
    const r = tsRunCwd(["validate", "--delegation", "d-123", "--json"], dir);
    expect(r.code).toBe(1);
    const err = JSON.parse(r.stderr);
    expect(err.error).toBe("missing_required");
  });

  it("validate block appends delta:blocked event and retains lease (BLOCK-3)", () => {
    const dir = setupMinimalProject("US-DELTA-VAL3", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-VAL3", "local-preset");

    const r1 = tsRunCwd([
      "prepare", "US-DELTA-VAL3",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath, "--json",
    ], dir);
    expect(r1.code).toBe(0);
    const delegationId = JSON.parse(r1.stdout).delegationId;

    // Count events before validate
    const eventsPath = join(dir, ".roll", "loop", "events.ndjson");
    const eventsBefore = readFileSync(eventsPath, "utf8").trim().split("\n").filter(l => l.trim());

    // Validate without creating the stage artifact — should block
    const r2 = tsRunCwd([
      "validate", "--delegation", delegationId,
      "--stage", "designer", "--json",
    ], dir);
    expect(r2.code).toBe(1);

    // Verify delta:blocked event was appended
    const eventsAfter = readFileSync(eventsPath, "utf8").trim().split("\n").filter(l => l.trim());
    expect(eventsAfter.length).toBe(eventsBefore.length + 1);

    const lastEvent = JSON.parse(eventsAfter[eventsAfter.length - 1]!);
    expect(lastEvent.type).toBe("delta:blocked");
    expect(lastEvent.delegationId).toBe(delegationId);
    expect(lastEvent.reason).toBe("artifact_invalid");
    expect(lastEvent.role).toBe("designer");

    // Lease must be retained (not released by validate)
    const leasePath = join(dir, ".roll", "loop", "host-delegation-leases", "US-DELTA-VAL3.json");
    expect(existsSync(leasePath)).toBe(true);
  });

  it("validate allow appends delta:artifact_published event (BLOCK-3)", () => {
    const dir = setupMinimalProject("US-DELTA-VAL4", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-VAL4", "local-preset");

    const r1 = tsRunCwd([
      "prepare", "US-DELTA-VAL4",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath, "--json",
    ], dir);
    expect(r1.code).toBe(0);
    const parsed = JSON.parse(r1.stdout);
    const delegationId = parsed.delegationId;

    // Create the stage artifact directory so validation passes
    const stageDir = join(dir, ".roll", "features", "delta-team", "US-DELTA-VAL4",
      `delta-${delegationId}`, "role-artifacts", "designer");
    mkdirSync(stageDir, { recursive: true });

    // Count events before validate
    const eventsPath = join(dir, ".roll", "loop", "events.ndjson");
    const eventsBefore = readFileSync(eventsPath, "utf8").trim().split("\n").filter(l => l.trim());

    // Validate should pass
    const r2 = tsRunCwd([
      "validate", "--delegation", delegationId,
      "--stage", "designer", "--json",
    ], dir);
    expect(r2.code).toBe(0);
    const result = JSON.parse(r2.stdout);
    expect(result.verdict).toBe("allow");

    // Verify delta:artifact_published event was appended
    const eventsAfter = readFileSync(eventsPath, "utf8").trim().split("\n").filter(l => l.trim());
    expect(eventsAfter.length).toBe(eventsBefore.length + 1);

    const lastEvent = JSON.parse(eventsAfter[eventsAfter.length - 1]!);
    expect(lastEvent.type).toBe("delta:artifact_published");
    expect(lastEvent.delegationId).toBe(delegationId);
    expect(lastEvent.role).toBe("designer");
    expect(lastEvent.identityProvenance).toBe("host-attested");
  });

  it("validate invokes injected validator seam (BLOCK-3)", () => {
    const dir = setupMinimalProject("US-DELTA-VAL5", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-VAL5", "local-preset");

    const r1 = tsRunCwd([
      "prepare", "US-DELTA-VAL5",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath, "--json",
    ], dir);
    expect(r1.code).toBe(0);
    const delegationId = JSON.parse(r1.stdout).delegationId;

    // Inject a validator that always blocks with a custom reason
    let calledWithDelegationId = "";
    let calledWithStage = "";
    injectValidator((did: string, s: string, _fd: string) => {
      calledWithDelegationId = did;
      calledWithStage = s;
      return { ok: false, reason: "host_supervisor_required", detail: "test injected block", role: s };
    });

    try {
      const r2 = tsRunCwd([
        "validate", "--delegation", delegationId,
        "--stage", "builder", "--json",
      ], dir);
      expect(r2.code).toBe(1);
      expect(calledWithDelegationId).toBe(delegationId);
      expect(calledWithStage).toBe("builder");

      // Verify custom block event was appended
      const eventsPath = join(dir, ".roll", "loop", "events.ndjson");
      const events = readFileSync(eventsPath, "utf8").trim().split("\n").filter(l => l.trim());
      const lastEvent = JSON.parse(events[events.length - 1]!);
      expect(lastEvent.type).toBe("delta:blocked");
      expect(lastEvent.reason).toBe("host_supervisor_required");
    } finally {
      injectValidator(null);
    }
  });
});

// ── Conclude ─────────────────────────────────────────────────────────────────

describe("US-DELTA-003 — conclude", () => {
  it("conclude with owner_continue disposition succeeds and writes terminal", () => {
    const dir = setupMinimalProject("US-DELTA-CONC", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-CONC", "local-preset");

    // Prepare first
    const r1 = tsRunCwd([
      "prepare", "US-DELTA-CONC",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath, "--json",
    ], dir);
    expect(r1.code).toBe(0);
    const delegationId = JSON.parse(r1.stdout).delegationId;

    // Conclude should succeed with owner_continue disposition
    const r2 = tsRunCwd([
      "conclude", "--delegation", delegationId,
      "--delivery-disposition", "owner_continue", "--json",
    ], dir);
    expect(r2.code).toBe(0);
    const result = JSON.parse(r2.stdout);
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("handoff_ready");
    expect(result.terminalBinding).toBe("handoff_only");
  });

  it("conclude blocks with terminal_path_unselected when disposition is missing (BLOCK-2)", () => {
    const dir = setupMinimalProject("US-DELTA-CONC-BLK", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-CONC-BLK", "local-preset");

    const r1 = tsRunCwd([
      "prepare", "US-DELTA-CONC-BLK",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath, "--json",
    ], dir);
    expect(r1.code).toBe(0);
    const delegationId = JSON.parse(r1.stdout).delegationId;

    // Conclude without --delivery-disposition should block
    const eventsPath = join(dir, ".roll", "loop", "events.ndjson");
    const eventsBefore = readFileSync(eventsPath, "utf8").trim().split("\n").filter(l => l.trim());

    const r2 = tsRunCwd([
      "conclude", "--delegation", delegationId, "--json",
    ], dir);
    expect(r2.code).toBe(1);
    const err = JSON.parse(r2.stderr);
    expect(err.error).toBe("terminal_path_unselected");

    // Verify delta:blocked event was appended
    const eventsAfter = readFileSync(eventsPath, "utf8").trim().split("\n").filter(l => l.trim());
    expect(eventsAfter.length).toBe(eventsBefore.length + 1);
    const lastEvent = JSON.parse(eventsAfter[eventsAfter.length - 1]!);
    expect(lastEvent.type).toBe("delta:blocked");
    expect(lastEvent.reason).toBe("terminal_path_unselected");

    // Lease must be retained
    const leasePath = join(dir, ".roll", "loop", "host-delegation-leases", "US-DELTA-CONC-BLK.json");
    expect(existsSync(leasePath)).toBe(true);
  });

  it("conclude blocks with terminal_path_unselected when disposition is invalid (BLOCK-2)", () => {
    const dir = setupMinimalProject("US-DELTA-CONC-BLK2", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-CONC-BLK2", "local-preset");

    const r1 = tsRunCwd([
      "prepare", "US-DELTA-CONC-BLK2",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath, "--json",
    ], dir);
    expect(r1.code).toBe(0);
    const delegationId = JSON.parse(r1.stdout).delegationId;

    // Conclude with invalid disposition should block
    const eventsPath = join(dir, ".roll", "loop", "events.ndjson");
    const eventsBefore = readFileSync(eventsPath, "utf8").trim().split("\n").filter(l => l.trim());

    const r2 = tsRunCwd([
      "conclude", "--delegation", delegationId,
      "--delivery-disposition", "bad_value", "--json",
    ], dir);
    expect(r2.code).toBe(1);
    const err = JSON.parse(r2.stderr);
    expect(err.error).toBe("terminal_path_unselected");

    // Verify delta:blocked was appended with correct reason
    const eventsAfter = readFileSync(eventsPath, "utf8").trim().split("\n").filter(l => l.trim());
    const lastEvent = JSON.parse(eventsAfter[eventsAfter.length - 1]!);
    expect(lastEvent.type).toBe("delta:blocked");
    expect(lastEvent.reason).toBe("terminal_path_unselected");
  });

  it("conclude with owner_hold disposition succeeds", () => {
    const dir = setupMinimalProject("US-DELTA-CONC2", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-CONC2", "local-preset");

    const r1 = tsRunCwd([
      "prepare", "US-DELTA-CONC2",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath, "--json",
    ], dir);
    expect(r1.code).toBe(0);
    const delegationId = JSON.parse(r1.stdout).delegationId;

    const r2 = tsRunCwd([
      "conclude", "--delegation", delegationId,
      "--delivery-disposition", "owner_hold", "--json",
    ], dir);
    expect(r2.code).toBe(0);
    const result = JSON.parse(r2.stdout);
    expect(result.ok).toBe(true);
    expect(result.deliveryDisposition).toBe("owner_hold");
  });

  it("conclude releases the host-delegation lease", () => {
    const dir = setupMinimalProject("US-DELTA-CONC3", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-CONC3", "local-preset");

    const r1 = tsRunCwd([
      "prepare", "US-DELTA-CONC3",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath, "--json",
    ], dir);
    expect(r1.code).toBe(0);
    const delegationId = JSON.parse(r1.stdout).delegationId;

    // Lease file should exist before conclude
    const leasePath = join(dir, ".roll", "loop", "host-delegation-leases", "US-DELTA-CONC3.json");
    expect(existsSync(leasePath)).toBe(true);

    const r2 = tsRunCwd([
      "conclude", "--delegation", delegationId,
      "--delivery-disposition", "owner_continue", "--json",
    ], dir);
    expect(r2.code).toBe(0);

    // Lease file should be released
    expect(existsSync(leasePath)).toBe(false);
  });

  it("conclude fails for unknown delegation", () => {
    const dir = setupMinimalProject("US-DELTA-CONC4", "delta-team");
    const r = tsRunCwd([
      "conclude", "--delegation", "nonexistent",
      "--delivery-disposition", "owner_continue", "--json",
    ], dir);
    expect(r.code).toBe(1);
    const err = JSON.parse(r.stderr);
    expect(err.error).toBe("delegation_not_found");
  });
});

// ── Snapshot tests ──────────────────────────────────────────────────────────

describe("US-DELTA-003 — CLI snapshots", () => {
  it("prepare --json output is scrubbed and snapshotted", () => {
    const dir = setupMinimalProject("US-DELTA-SNAP-1", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-SNAP-1", "local-preset");

    const r = tsRunCwd([
      "prepare", "US-DELTA-SNAP-1",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath, "--json",
    ], dir);
    expect(r.code).toBe(0);

    const scrubbed = scrubPaths(scrubId(r.stdout), dir);
    expect(scrubbed).toMatchSnapshot();
  });

  it("status --json after prepare is scrubbed and snapshotted", () => {
    const dir = setupMinimalProject("US-DELTA-SNAP-2", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-SNAP-2", "local-preset");

    const r1 = tsRunCwd([
      "prepare", "US-DELTA-SNAP-2",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath, "--json",
    ], dir);
    expect(r1.code).toBe(0);
    const delegationId = JSON.parse(r1.stdout).delegationId;

    const r2 = tsRunCwd(["status", "--delegation", delegationId, "--json"], dir);
    expect(r2.code).toBe(0);

    const scrubbed = scrubPaths(scrubId(r2.stdout), dir);
    expect(scrubbed).toMatchSnapshot();
  });

  it("validate block on missing artifact is scrubbed and snapshotted", () => {
    const dir = setupMinimalProject("US-DELTA-SNAP-3", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-SNAP-3", "local-preset");

    const r1 = tsRunCwd([
      "prepare", "US-DELTA-SNAP-3",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath, "--json",
    ], dir);
    expect(r1.code).toBe(0);
    const delegationId = JSON.parse(r1.stdout).delegationId;

    // Validate without creating the stage artifact
    const r2 = tsRunCwd([
      "validate", "--delegation", delegationId,
      "--stage", "designer", "--json",
    ], dir);
    expect(r2.code).toBe(1);

    const scrubbed = scrubPaths(scrubId(r2.stderr), dir);
    expect(scrubbed).toMatchSnapshot();
  });

  it("conclude --json output is scrubbed and snapshotted", () => {
    const dir = setupMinimalProject("US-DELTA-SNAP-4", "delta-team");
    const resPath = writeResolutionTemplate(dir, "US-DELTA-SNAP-4", "local-preset");

    const r1 = tsRunCwd([
      "prepare", "US-DELTA-SNAP-4",
      "--trigger", "host-guided", "--topology", "delta-team",
      "--profile", "standard", "--preset", "local-preset",
      "--resolution", resPath, "--json",
    ], dir);
    expect(r1.code).toBe(0);
    const delegationId = JSON.parse(r1.stdout).delegationId;

    const r2 = tsRunCwd([
      "conclude", "--delegation", delegationId,
      "--delivery-disposition", "owner_continue", "--json",
    ], dir);
    expect(r2.code).toBe(0);

    const scrubbed = scrubPaths(scrubId(r2.stdout), dir);
    expect(scrubbed).toMatchSnapshot();
  });
});
