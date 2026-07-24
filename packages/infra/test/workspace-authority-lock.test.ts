import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  WorkspaceAuthorityLockError,
  withWorkspaceAuthorityLock,
  withWorkspaceAuthorityLockSync,
  workspaceAuthorityLockPath,
} from "../src/workspace-authority-lock.js";

const roots: string[] = [];

function rollHome(): string {
  const root = mkdtempSync(join(tmpdir(), "roll-workspace-authority-lock-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("US-WS-026 Workspace authority lock", () => {
  it("uses one machine-scoped lock path and releases it after a synchronous writer", () => {
    const home = rollHome();
    const path = workspaceAuthorityLockPath(home, "ws-demo");

    expect(path).toBe(join(home, "locks", "workspace-authority", "ws-demo.lock"));
    expect(withWorkspaceAuthorityLockSync({ rollHome: home, workspaceId: "ws-demo", operation: "metadata-edit" }, () => {
      expect(existsSync(path)).toBe(true);
      return "applied";
    })).toBe("applied");
    expect(existsSync(path)).toBe(false);
  });

  it("fails loud when another writer already owns the Workspace authority", async () => {
    const home = rollHome();
    let release: (() => void) | undefined;
    const held = withWorkspaceAuthorityLock({ rollHome: home, workspaceId: "ws-demo", operation: "issue-init" }, async () => {
      await new Promise<void>((resolve) => { release = resolve; });
    });

    await expect(new Promise<void>((resolve) => setImmediate(resolve)).then(() =>
      withWorkspaceAuthorityLock({ rollHome: home, workspaceId: "ws-demo", operation: "migration" }, async () => undefined)
    )).rejects.toEqual(expect.objectContaining<Partial<WorkspaceAuthorityLockError>>({ code: "authority_locked" }));

    release?.();
    await held;
  });
});
