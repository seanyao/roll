import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  REPOSITORY_BINDING_V1,
  repositoryIdFromRemote,
  type RepositoryBinding,
} from "@roll/spec";
import { afterEach, describe, expect, it } from "vitest";
import { resolveRepositoryCacheIdentity } from "../src/repository-cache.js";

const sandboxes: string[] = [];

afterEach(() => {
  for (const root of sandboxes.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), "roll-repository-cache-"));
  sandboxes.push(root);
  return root;
}

function binding(remote: string): RepositoryBinding {
  const repoId = repositoryIdFromRemote(remote);
  if (!repoId.ok) throw new Error("test remote must be valid");
  return {
    schema: REPOSITORY_BINDING_V1,
    repoId: repoId.value,
    alias: "primary",
    remote,
    integrationBranch: "main",
    provider: "generic",
    workflow: { branchPattern: "roll/{workspace_id}/{story_id}", requiredChecks: [] },
  };
}

describe("RepositoryCache identity and path safety", () => {
  it("maps normalized remote identity to one deterministic collision-resistant cache path", () => {
    const rollHome = sandbox();
    const canonical = resolveRepositoryCacheIdentity({
      rollHome,
      binding: binding("ssh://git@Example.TEST:22/team/product.git/"),
    });
    const scp = resolveRepositoryCacheIdentity({
      rollHome,
      binding: binding("git@example.test:team/product.git"),
    });
    const other = resolveRepositoryCacheIdentity({
      rollHome,
      binding: binding("git@example.test:team/other.git"),
    });

    expect(canonical).toEqual(scp);
    expect(canonical.cachePath).toBe(join(rollHome, "repos", `${canonical.repoId}.git`));
    expect(basename(canonical.cachePath)).toMatch(/^repo-[0-9a-f]{12}\.git$/u);
    expect(other.cachePath).not.toBe(canonical.cachePath);
    expect(canonical.lockPath).toBe(join(rollHome, "locks", "repos", `${canonical.repoId}.lock`));
  });

});
