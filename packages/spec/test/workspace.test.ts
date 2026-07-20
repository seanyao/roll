import { describe, expect, it } from "vitest";
import {
  normalizeRepositoryRemote,
  repositoryIdFromRemote,
} from "../src/types/workspace.js";

describe("Workspace repository identity", () => {
  it.each([
    ["https://GitHub.com/Owner/Repo.git/", "https://github.com/Owner/Repo"],
    ["https://github.com:443/Owner/Repo", "https://github.com/Owner/Repo"],
    ["git@GitHub.com:Owner/Repo.git", "ssh://github.com/Owner/Repo"],
    ["ssh://deploy@GitHub.com:22/Owner/Repo.git/", "ssh://github.com/Owner/Repo"],
    ["file:///Users/Example/Repo.git/", "file:///Users/Example/Repo"],
  ])("canonicalizes the closed v1 remote table: %s", (input, expected) => {
    expect(normalizeRepositoryRemote(input)).toEqual({ ok: true, value: expected });
  });

  it("derives a stable repository ID from the canonical remote", () => {
    const https = repositoryIdFromRemote("https://GitHub.com/Owner/Repo.git");
    const canonical = repositoryIdFromRemote("https://github.com/Owner/Repo");
    expect(https).toEqual(canonical);
    expect(https).toMatchObject({ ok: true, value: expect.stringMatching(/^repo-[0-9a-f]{12}$/u) });
  });

  it.each([
    "https://token@example.com/Owner/Repo.git",
    "https://example.com:8443/Owner/Repo.git",
    "https://example.com/Owner/Repo.git?token=secret",
    "https://example.com/Owner/Repo.git#fragment",
    "ssh://git@example.com:2222/Owner/Repo.git",
    "../Owner/Repo.git",
    "C:\\Owner\\Repo.git",
    "file://server/share/Repo.git",
    "file:///Owner/../Repo.git",
    "https://example.com/Owner/%52epo.git",
  ])("rejects ambiguous or credential-bearing remote input without echoing it: %s", (input) => {
    const result = normalizeRepositoryRemote(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((error) => error.path === "remote")).toBe(true);
    expect(JSON.stringify(result.errors)).not.toContain("token");
    expect(JSON.stringify(result.errors)).not.toContain("secret");
  });
});
