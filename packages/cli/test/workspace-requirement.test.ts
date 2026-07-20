import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceRegistry } from "@roll/infra";
import { dispatch } from "../src/bridge.js";
import { registerAll } from "../src/commands/index.js";

interface Run { readonly status: number; readonly stdout: string; readonly stderr: string }
const roots: string[] = [];
const ENV_KEYS = ["HOME", "ROLL_HOME", "ROLL_LANG", "ROLL_WORKSPACE", "NO_COLOR"] as const;

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "roll-workspace-requirement-cli-"));
  roots.push(home);
  const rollHome = join(home, ".roll");
  const workspace = join(home, "workspace");
  mkdirSync(workspace);
  write(join(workspace, "workspace.yaml"), `${JSON.stringify({
    schema: "roll.workspace/v1",
    workspaceId: "ws-demo",
    displayName: "Demo",
    requirements: [{ provider: "JIRA", ref: "sot-15499" }],
    repositories: [{
      schema: "roll.repository-binding/v1",
      repoId: "repo-ff7a87ddbb2b",
      alias: "product",
      remote: "https://example.test/owner/product",
      integrationBranch: "main",
      provider: "generic",
      workflow: { branchPattern: "roll/{workspace_id}/{story_id}", requiredChecks: [] },
    }],
  }, null, 2)}\n`);
  for (const storyId of ["US-WS-007", "US-WS-008"]) {
    write(join(workspace, "backlog", "epic", storyId, "spec.md"), `# ${storyId}\n`);
  }
  const body = join(home, "jira.md");
  write(body, "# SOT-15499\n\nWorkspace requirement source.\n");
  const contextRoot = join(home, "context");
  write(join(contextRoot, "brief.md"), "brief context\n");
  const registry = new WorkspaceRegistry({ rollHome, now: () => 1 });
  registry.register({ workspaceId: "ws-demo", root: workspace });
  registry.activate("ws-demo");
  return { home, rollHome, workspace, body, contextRoot };
}

async function run(args: string[], f: ReturnType<typeof fixture>, options: { readonly lang?: string; readonly workspaceEnv?: string; readonly cwd?: string } = {}): Promise<Run> {
  const savedEnv: Partial<Record<typeof ENV_KEYS[number], string>> = {};
  for (const key of ENV_KEYS) if (process.env[key] !== undefined) savedEnv[key] = process.env[key];
  const savedCwd = process.cwd();
  process.env["HOME"] = f.home;
  process.env["ROLL_HOME"] = f.rollHome;
  process.env["ROLL_LANG"] = options.lang ?? "en";
  process.env["NO_COLOR"] = "1";
  if (options.workspaceEnv === undefined) delete process.env["ROLL_WORKSPACE"];
  else process.env["ROLL_WORKSPACE"] = options.workspaceEnv;
  if (options.cwd !== undefined) process.chdir(options.cwd);
  let stdout = "";
  let stderr = "";
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture seam
  process.stdout.write = (chunk: string | Uint8Array): boolean => { stdout += String(chunk); return true; };
  // @ts-expect-error capture seam
  process.stderr.write = (chunk: string | Uint8Array): boolean => { stderr += String(chunk); return true; };
  try {
    const result = await dispatch(args, async () => ({ ok: true }));
    return { status: result.status, stdout, stderr };
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
    process.chdir(savedCwd);
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

function addArgs(f: ReturnType<typeof fixture>): string[] {
  return [
    "workspace", "requirement", "add",
    "--workspace", "ws-demo",
    "--provider", "jira",
    "--ref", "SOT-15499",
    "--revision", "42",
    "--body-file", f.body,
    "--context-root", f.contextRoot,
    "--context", "brief.md",
    "--story", "US-WS-007",
    "--story", "US-WS-008",
  ];
}

function scrub(text: string, f: ReturnType<typeof fixture>): string {
  return text.replaceAll(realpathSync(f.home), "<HOME>").replaceAll(f.home, "<HOME>");
}

beforeEach(() => registerAll());
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("US-WS-007 roll workspace requirement add", () => {
  it("captures, repeats and updates a Jira-shaped local fixture through stable JSON", async () => {
    const f = fixture();
    const first = await run([...addArgs(f), "--json"], f);
    expect(first).toMatchObject({ status: 0, stderr: "" });
    expect(scrub(first.stdout, f)).toMatchSnapshot("created-json");
    const repeated = await run([...addArgs(f), "--json"], f);
    expect(repeated).toMatchObject({ status: 0, stderr: "" });
    expect(scrub(repeated.stdout, f)).toMatchSnapshot("reused-json");

    writeFileSync(f.body, "# SOT-15499\n\nRevision 43.\n", "utf8");
    const updatedArgs = addArgs(f).map((arg) => arg === "42" ? "43" : arg);
    const updated = await run([...updatedArgs, "--json"], f);
    expect(updated).toMatchObject({ status: 0, stderr: "" });
    expect(scrub(updated.stdout, f)).toMatchSnapshot("updated-json");
    const requirementPath = join(f.workspace, "requirements", "jira", "req-c78ccf14ea21");
    expect(existsSync(join(requirementPath, "source.yaml"))).toBe(true);
    expect(readFileSync(join(requirementPath, "requirement.md"), "utf8")).toContain("Revision 43");
  });

  it("resolves the Workspace from environment and cwd while terminal output stays bounded", async () => {
    const f = fixture();
    const envArgs = addArgs(f).filter((_arg, index, all) => all[index - 1] !== "--workspace" && _arg !== "--workspace");
    const fromEnv = await run(envArgs, f, { workspaceEnv: "ws-demo" });
    expect(fromEnv).toMatchObject({ status: 0, stderr: "" });
    expect(scrub(fromEnv.stdout, f)).toMatchSnapshot("terminal-en");

    const fromCwd = await run(envArgs, f, { cwd: join(f.workspace, "backlog", "epic") });
    expect(fromCwd).toMatchObject({ status: 0, stderr: "" });
    expect(scrub(fromCwd.stdout, f)).toMatchSnapshot("terminal-cwd-reused");
  });

  it("rejects credential-shaped refs and unsafe paths without echoing input or writing evidence", async () => {
    const f = fixture();
    const secret = "https://token:credential-sentinel@example.test/issue/1";
    const credentialArgs = addArgs(f).map((arg) => arg === "SOT-15499" ? secret : arg);
    const credential = await run([...credentialArgs, "--json"], f);
    expect(credential.status).toBe(1);
    expect(credential.stdout).not.toContain(secret);
    expect(credential.stdout).not.toContain("credential-sentinel");
    expect(credential.stderr).not.toContain(secret);
    expect(credential.stderr).not.toContain("credential-sentinel");
    expect(credential.stdout).toBe("");
    expect(JSON.parse(credential.stderr)).toMatchObject({ error: { code: "source_not_declared" } });
    expect(existsSync(join(f.workspace, "requirements"))).toBe(false);

    const escapeArgs = addArgs(f).map((arg) => arg === "brief.md" ? "../jira.md" : arg);
    const escape = await run([...escapeArgs, "--json"], f);
    expect(escape.status).toBe(1);
    expect(JSON.parse(escape.stderr)).toMatchObject({ error: { code: "unsafe_context" } });
    expect(existsSync(join(f.workspace, "requirements"))).toBe(false);
  });

  it("never leaks a credential sentinel embedded in the body or context content through stdout or stderr on success", async () => {
    const f = fixture();
    writeFileSync(f.body, "# SOT-15499\n\ncredential-sentinel-in-body access_token=body-secret-value\n", "utf8");
    writeFileSync(join(f.contextRoot, "brief.md"), "credential-sentinel-in-context api_key=context-secret-value\n", "utf8");

    const captured = await run([...addArgs(f), "--json"], f);
    expect(captured).toMatchObject({ status: 0, stderr: "" });
    expect(captured.stdout).not.toContain("credential-sentinel-in-body");
    expect(captured.stdout).not.toContain("body-secret-value");
    expect(captured.stdout).not.toContain("credential-sentinel-in-context");
    expect(captured.stdout).not.toContain("context-secret-value");

    const requirementPath = join(f.workspace, "requirements", "jira", "req-c78ccf14ea21");
    expect(readFileSync(join(requirementPath, "requirement.md"), "utf8")).toContain("body-secret-value");
    expect(readFileSync(join(requirementPath, "context", "brief.md"), "utf8")).toContain("context-secret-value");
  });

  it("exposes locale-specific nested help and includes requirement in Workspace help", async () => {
    const f = fixture();
    const workspace = await run(["workspace", "--help"], f, { lang: "en" });
    const en = await run(["workspace", "requirement", "--help"], f, { lang: "en" });
    const zh = await run(["workspace", "requirement", "--help"], f, { lang: "zh" });
    expect(workspace.stdout).toContain("requirement add");
    expect(en).toMatchObject({ status: 0, stderr: "" });
    expect(en.stdout).toContain("Usage: roll workspace requirement add");
    expect(zh).toMatchObject({ status: 0, stderr: "" });
    expect(zh.stdout).toContain("用法：roll workspace requirement add");
  });
});
