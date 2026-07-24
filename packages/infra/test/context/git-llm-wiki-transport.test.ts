import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildGitLlmWikiCommand,
  ContextTransportError,
  resolveContextCacheIdentity,
} from "../../src/context/context-cache.js";

const sandboxes: string[] = [];

afterEach(() => {
  for (const root of sandboxes.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), "roll-context-transport-"));
  sandboxes.push(root);
  return root;
}

function provider(remote = "https://github.com/bipo/context-wiki") {
  return {
    id: "bipo-enterprise",
    type: "git_llm_wiki" as const,
    enabled: true,
    remote,
    branch: "main",
    fetch_timeout_seconds: 30,
  };
}

describe("Git LLM Wiki cache identity and command policy", () => {
  it("uses the managed bare-cache and provider lock paths under ROLL_HOME", () => {
    const rollHome = sandbox();
    expect(resolveContextCacheIdentity({ rollHome, provider: provider() })).toEqual({
      providerId: "bipo-enterprise",
      remoteIdentity: "https://github.com/bipo/context-wiki",
      branch: "main",
      cacheRoot: join(rollHome, "context-cache"),
      cachePath: join(rollHome, "context-cache", "bipo-enterprise.git"),
      temporaryPath: join(rollHome, "context-cache", "bipo-enterprise.creating"),
      lockPath: join(rollHome, "context-cache", "locks", "bipo-enterprise.lock"),
      remoteName: "origin",
    });
  });

  it("builds an argv-only fetch with deny-by-default protocols, no hooks and no submodules", () => {
    const command = buildGitLlmWikiCommand("fetch", provider());
    expect(command).toEqual([
      "-c", "protocol.allow=never",
      "-c", "protocol.https.allow=always",
      "-c", "protocol.ssh.allow=always",
      "-c", "core.hooksPath=/dev/null",
      "-c", "credential.helper=",
      "-c", "credential.interactive=never",
      "fetch", "--prune", "--no-tags", "--recurse-submodules=no", "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ]);
    expect(command).not.toContain("sh");
    expect(command.join(" ")).not.toContain("checkout");
  });

  it.each([
    "http://example.test/team/wiki.git",
    "git://example.test/team/wiki.git",
    "file:///tmp/wiki.git",
    "/tmp/wiki.git",
    "../wiki.git",
    "ext::sh -c id",
    "helper::team/wiki",
  ])("rejects production transport %s without reflecting it in the error", (remote) => {
    let caught: unknown;
    try {
      resolveContextCacheIdentity({ rollHome: sandbox(), provider: provider(remote) });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContextTransportError);
    expect(caught).toMatchObject({ code: "unsupported_git_transport" });
    expect(String(caught)).not.toContain(remote);
    expect(JSON.stringify(caught)).not.toContain(remote);
  });

  it("rejects credential-bearing HTTPS before building any Git argv", () => {
    expect(() => resolveContextCacheIdentity({
      rollHome: sandbox(),
      provider: provider("https://secret-token@example.test/team/wiki.git"),
    })).toThrowError(expect.objectContaining({ code: "unsupported_git_transport" }));
  });
});
