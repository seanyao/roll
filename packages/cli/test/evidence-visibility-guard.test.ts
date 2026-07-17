/**
 * US-PHYSICAL-008 — in-repo .roll evidence commit must also check remote
 * visibility before staging image evidence.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { publishBodyWithEvidenceTrailer } from "../src/runner/publish-lifecycle.js";
import { assessBootstrapArtifacts, readPendingDeliveryEvidenceManifests } from "@roll/core";
import type { Ports } from "../src/runner/ports.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmp(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `roll-ev-guard-${tag}-`));
  dirs.push(d);
  return d;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      GIT_CEILING_DIRECTORIES: undefined,
    },
  });
}

function makeInRepoProject(tag: string): string {
  const project = tmp(tag);
  git(project, ["init", "-q", "-b", "main"]);
  git(project, ["config", "user.email", "t@t"]);
  git(project, ["config", "user.name", "t"]);
  const roll = join(project, ".roll");
  mkdirSync(roll, { recursive: true });
  writeFileSync(join(roll, "backlog.md"), "| ID | Status |\n|----|--------|\n", "utf8");
  // A bare file:// remote is reachable but non-GitHub → visibility unknown/public.
  const remote = tmp(`${tag}-remote`);
  git(remote, ["init", "-q", "--bare", "-b", "main"]);
  git(project, ["remote", "add", "origin", remote]);
  git(project, ["add", "-A"]);
  git(project, ["commit", "-q", "--no-verify", "-m", "seed"]);
  return project;
}

function makePorts(project: string): { ports: Ports; alerts: string[] } {
  const alerts: string[] = [];
  const ports = {
    repoCwd: project,
    paths: {
      alertsPath: join(project, "alerts.md"),
      eventsPath: join(project, "events.ndjson"),
      runsPath: join(project, "runs.ndjson"),
      lockPath: join(project, "lock"),
    },
    events: {
      ensureEventFiles: () => {},
      appendEvent: () => {},
      upsertRun: () => {},
      appendAlert: (_path: string, msg: string) => {
        alerts.push(msg);
      },
    },
  } as unknown as Ports;
  return { ports, alerts };
}

function writeEvidence(project: string, storyId: string, cycleId: string): void {
  const cardDir = join(project, ".roll", "features", "capture-tool", storyId);
  const runDir = join(cardDir, cycleId);
  mkdirSync(join(runDir, "screenshots"), { recursive: true });
  writeFileSync(join(cardDir, "ac-map.json"), "[]", "utf8");
  writeFileSync(join(runDir, "screenshots", "x.png"), "fake", "utf8");
}

describe("US-PHYSICAL-008 in-repo evidence visibility guard", () => {
  it("blocks image evidence when the main repo remote is public/unknown", async () => {
    const project = makeInRepoProject("block");
    writeEvidence(project, "US-PHYSICAL-008", "cycle-20260704-010000-00000");
    const { ports, alerts } = makePorts(project);

    const body = await publishBodyWithEvidenceTrailer(ports, {
      cycleId: "cycle-20260704-010000-00000",
      storyId: "US-PHYSICAL-008",
    } as Parameters<typeof publishBodyWithEvidenceTrailer>[1]);

    expect(body).toBeNull();
    expect(alerts.some((a) => a.includes("image evidence blocked"))).toBe(true);
  });

  it("allows image evidence when the owner records a public-visibility waiver", async () => {
    const project = makeInRepoProject("waiver");
    mkdirSync(join(project, ".roll"), { recursive: true });
    writeFileSync(join(project, ".roll", "local.yaml"), "evidence_public_waiver: true\n", "utf8");
    writeEvidence(project, "US-PHYSICAL-008", "cycle-20260704-020000-00000");
    const { ports, alerts } = makePorts(project);

    const body = await publishBodyWithEvidenceTrailer(ports, {
      cycleId: "cycle-20260704-020000-00000",
      storyId: "US-PHYSICAL-008",
    } as Parameters<typeof publishBodyWithEvidenceTrailer>[1]);

    expect(body).not.toBeNull();
    expect(alerts).toEqual([]);
    // The evidence was actually committed to the in-repo .roll project.
    expect(existsSync(join(project, ".git"))).toBe(true);
    const tree = git(project, ["ls-tree", "-r", "--name-only", "HEAD"]);
    expect(tree).toContain(".roll/features/capture-tool/US-PHYSICAL-008/cycle-20260704-020000-00000/screenshots/x.png");
  });

  it("FIX-1272: records a schema-valid per-cycle evidence manifest that verifies the committed evidence", async () => {
    const project = makeInRepoProject("manifest");
    writeFileSync(join(project, ".roll", "local.yaml"), "evidence_public_waiver: true\n", "utf8");
    const cycleId = "cycle-20260704-030000-00000";
    writeEvidence(project, "US-ORG-004", cycleId);
    const { ports } = makePorts(project);

    const body = await publishBodyWithEvidenceTrailer(ports, {
      cycleId,
      storyId: "US-ORG-004",
      branch: `loop/${cycleId}`,
    } as Parameters<typeof publishBodyWithEvidenceTrailer>[1]);
    expect(body).not.toBeNull();

    // AC1: a runner-written, schema-valid manifest keyed by this cycle exists.
    const manifests = readPendingDeliveryEvidenceManifests(project);
    expect(manifests).toHaveLength(1);
    const m = manifests[0]!;
    expect(m.cycleId).toBe(cycleId);
    expect(m.storyId).toBe("US-ORG-004");
    const paths = m.files.map((f) => f.path);
    expect(paths).toContain(`.roll/features/capture-tool/US-ORG-004/${cycleId}/screenshots/x.png`);
    expect(paths).toContain(".roll/features/capture-tool/US-ORG-004/ac-map.json");

    // The manifest verifies the exact on-disk evidence by hash.
    const a = assessBootstrapArtifacts(paths, manifests, project);
    expect(a.verified.sort()).toEqual([...paths].sort());
    expect(a.unconfirmed).toEqual([]);
  });
});
