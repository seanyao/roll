import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serializeWorkspaceManifest } from "@roll/core";
import { WorkspaceRegistry } from "@roll/infra";
import { repositoryIdFromRemote, type WorkspaceManifest } from "@roll/spec";
import { dispatch } from "../src/bridge.js";
import { registerAll } from "../src/commands/index.js";

interface Run { readonly status: number; readonly stdout: string; readonly stderr: string }

const roots: string[] = [];
const ENV_KEYS = ["HOME", "ROLL_HOME", "ROLL_LANG", "NO_COLOR", "LC_ALL", "LANG"] as const;

function digest(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

function write(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function snapshot(root: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const stat = lstatSync(path);
      result.set(relative, JSON.stringify({
        kind: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file",
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        digest: stat.isFile() ? digest(readFileSync(path)) : "",
      }));
      if (stat.isDirectory() && !stat.isSymbolicLink()) walk(path, relative);
    }
  };
  walk(root, "");
  return result;
}

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "roll-workspace-edit-cli-"));
  roots.push(home);
  const rollHome = join(home, ".roll");
  const workspace = join(home, "workspace");
  const remote = "https://example.test/owner/product";
  const repoId = repositoryIdFromRemote(remote);
  if (!repoId.ok) throw new Error("fixture remote must normalize");
  const manifest: WorkspaceManifest = {
    schema: "roll.workspace/v1",
    workspaceId: "ws-demo",
    displayName: "Demo",
    createdAt: "2026-07-20T00:00:00.000Z",
    requirements: [{ provider: "jira", ref: "SOT-15499" }],
    repositories: [{
      schema: "roll.repository-binding/v1",
      repoId: repoId.value,
      alias: "product",
      remote,
      integrationBranch: "main",
      provider: "github",
      workflow: { branchPattern: "roll/{workspace_id}/{story_id}", requiredChecks: ["test"] },
    }],
  };
  write(join(workspace, "workspace.yaml"), manifest);
  mkdirSync(join(workspace, "issues"), { recursive: true });
  mkdirSync(join(workspace, "requirements"), { recursive: true });
  new WorkspaceRegistry({ rollHome, now: () => 1 }).register({ workspaceId: "ws-demo", root: workspace });
  const config = join(home, "workspace-edit.json");
  const configValue = (overrides: Record<string, unknown> = {}) => ({
    schema: "roll.workspace-edit/v1",
    workspace_id: "ws-demo",
    expected_manifest_sha256: digest(serializeWorkspaceManifest(manifest)),
    display_name: "Renamed Demo",
    requirements: [{ provider: "jira", ref: "sot-15499" }],
    repositories: [{
      alias: "product",
      remote: `${remote}.git`,
      provider: "github",
      integration_branch: "main",
      branch_pattern: "roll/{workspace_id}/{story_id}",
      required_checks: ["test"],
    }],
    ...overrides,
  });
  write(config, configValue());
  return { home, rollHome, workspace, config, configValue, manifest, repoId: repoId.value };
}

async function run(args: string[], f: ReturnType<typeof fixture>, lang: "en" | "zh" = "en"): Promise<Run> {
  const saved: Partial<Record<typeof ENV_KEYS[number], string>> = {};
  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) saved[key] = value;
    delete process.env[key];
  }
  process.env["HOME"] = f.home;
  process.env["ROLL_HOME"] = f.rollHome;
  process.env["ROLL_LANG"] = lang;
  process.env["NO_COLOR"] = "1";
  let stdout = "";
  let stderr = "";
  const output = process.stdout.write.bind(process.stdout);
  const error = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture seam
  process.stdout.write = (chunk: string | Uint8Array): boolean => { stdout += String(chunk); return true; };
  // @ts-expect-error capture seam
  process.stderr.write = (chunk: string | Uint8Array): boolean => { stderr += String(chunk); return true; };
  try {
    const result = await dispatch(args, async () => ({ ok: true }));
    return { status: result.status, stdout, stderr };
  } finally {
    process.stdout.write = output;
    process.stderr.write = error;
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

beforeEach(() => registerAll());
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("US-WS-025 roll workspace edit --check", () => {
  it("emits a complete safe JSON plan through the public route with zero Workspace writes", async () => {
    const f = fixture();
    const before = snapshot(f.workspace);

    const first = await run(["workspace", "edit", "ws-demo", "--config", f.config, "--check", "--json"], f);
    const second = await run(["workspace", "edit", f.workspace, "--config", f.config, "--check", "--json"], f);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ status: 0, stderr: "" });
    const plan = JSON.parse(first.stdout) as Record<string, unknown>;
    expect(plan).toMatchObject({
      schema: "roll.workspace-edit-plan/v1",
      outcome: "ready",
      workspaceId: "ws-demo",
      manifestPath: join(f.workspace, "workspace.yaml"),
      beforeManifest: { displayName: "Demo" },
      afterManifest: { displayName: "Renamed Demo" },
      changes: [{ path: "displayName", safety: "safe" }],
      blockers: [],
      nextAction: {
        kind: "apply",
        command: `roll workspace edit ws-demo --config ${f.config} --json`,
      },
    });
    expect(snapshot(f.workspace)).toEqual(before);
  });

  it("returns a blocked referenced-repository preview and preserves the Issue and Workspace bytes", async () => {
    const f = fixture();
    write(join(f.workspace, "issues", "US-EXISTING-1", "manifest.json"), {
      schema: "roll.issue/v1",
      workspaceId: "ws-demo",
      storyId: "US-EXISTING-1",
      requirements: [{ provider: "jira", ref: "SOT-15499" }],
      repositories: [{
        repoId: f.repoId,
        alias: "product",
        access: "write",
        requiredDelivery: true,
        noChangePolicy: "changes_required",
      }],
    });
    write(f.config, f.configValue({
      repositories: [{
        alias: "product",
        remote: "https://example.test/owner/product",
        provider: "github",
        integration_branch: "release",
        branch_pattern: "feature/{workspace_id}/{story_id}",
        required_checks: ["lint"],
      }],
    }));
    const before = snapshot(f.workspace);

    const result = await run(["workspace", "edit", "ws-demo", "--config", f.config, "--check", "--json"], f);

    expect(result).toMatchObject({ status: 2, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      outcome: "blocked",
      blockers: [expect.objectContaining({
        code: "metadata_referenced",
        path: `repositories[${f.repoId}].workflow`,
        references: [expect.objectContaining({ storyId: "US-EXISTING-1" })],
      })],
    });
    expect(snapshot(f.workspace)).toEqual(before);
  });

  it.each([
    ["apply is not part of this Story", ["workspace", "edit", "ws-demo", "--config", "<CONFIG>", "--json"], "invalid_arguments"],
    ["unknown config field", ["workspace", "edit", "ws-demo", "--config", "<CONFIG>", "--check", "--json"], "unknown_field"],
  ])("fails without writes when %s", async (name, rawArgs, code) => {
    const f = fixture();
    if (name === "unknown config field") write(f.config, f.configValue({ root: "/escape" }));
    const args = rawArgs.map((arg) => arg === "<CONFIG>" ? f.config : arg);
    const before = snapshot(f.workspace);

    const result = await run(args, f);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      schema: "roll.workspace-edit-error/v1",
      error: { code },
    });
    expect(snapshot(f.workspace)).toEqual(before);
  });

  it("fails closed when a reference authority is corrupt", async () => {
    const f = fixture();
    mkdirSync(join(f.workspace, "issues", "US-BROKEN"), { recursive: true });
    const before = snapshot(f.workspace);

    const result = await run(["workspace", "edit", "ws-demo", "--config", f.config, "--check", "--json"], f);

    expect(result).toMatchObject({ status: 1, stdout: "" });
    expect(JSON.parse(result.stderr)).toMatchObject({
      schema: "roll.workspace-edit-error/v1",
      error: { code: "reference_index_invalid" },
    });
    expect(snapshot(f.workspace)).toEqual(before);
  });
});
