import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveIntegrationBranch } from "@roll/infra";
import type { CycleRepositoryExecutionContext } from "@roll/spec";
import type { DraftEvidence } from "./attest-remediation.js";

const execFileAsync = promisify(execFile);

function writableRepositories(execution: CycleRepositoryExecutionContext) {
  return Object.values(execution.repositories)
    .filter((repository) => repository.access === "write")
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

export async function workspaceCycleDiff(execution: CycleRepositoryExecutionContext): Promise<string> {
  const sections: string[] = [];
  for (const repository of writableRepositories(execution)) {
    try {
      const { stdout } = await execFileAsync("git", ["diff", `${repository.baseSha}...HEAD`], {
        cwd: repository.worktreePath,
        encoding: "utf8",
        timeout: 15_000,
      });
      if (stdout.trim() !== "") sections.push(`Repository: ${repository.alias}\n${stdout}`);
    } catch {
      /* one unreadable leg must not erase the remaining review input */
    }
  }
  return sections.join("\n").slice(0, 60_000);
}

export async function workspaceChangedFiles(execution: CycleRepositoryExecutionContext): Promise<string[]> {
  const files: string[] = [];
  for (const repository of writableRepositories(execution)) {
    try {
      const { stdout } = await execFileAsync("git", ["diff", "--name-only", `${repository.baseSha}...HEAD`], {
        cwd: repository.worktreePath,
        encoding: "utf8",
        timeout: 15_000,
      });
      files.push(...stdout.split("\n")
        .map((path) => path.trim())
        .filter((path) => path !== "")
        .map((path) => `${repository.alias}/${path}`));
    } catch {
      /* repository verification remains the fail-loud authority */
    }
  }
  return files;
}

export async function workspaceDiffStat(execution: CycleRepositoryExecutionContext): Promise<string> {
  const sections: string[] = [];
  for (const repository of writableRepositories(execution)) {
    try {
      const { stdout } = await execFileAsync("git", ["diff", "--stat", `${repository.baseSha}...HEAD`], {
        cwd: repository.worktreePath,
        encoding: "utf8",
        timeout: 15_000,
      });
      if (stdout.trim() !== "") sections.push(`Repository: ${repository.alias}\n${stdout}`);
    } catch {
      /* summary degrades without weakening repository verification */
    }
  }
  return sections.join("\n").slice(0, 4_000);
}

export async function collectDraftEvidence(worktreeCwd: string, repoCwd: string): Promise<DraftEvidence> {
  const empty: DraftEvidence = { commitLines: [], diffStatLines: [], changedFilenames: [] };
  const base = resolveIntegrationBranch(repoCwd);
  try {
    const [commits, diffStat, changedFiles] = await Promise.all([
      execFileAsync("git", ["log", "--oneline", `${base}..HEAD`, "-n", "50"], {
        cwd: worktreeCwd,
        encoding: "utf8",
        timeout: 15_000,
      }).then((result) => result.stdout.trim().split("\n").filter((line) => line !== ""), () => [] as string[]),
      execFileAsync("git", ["diff", "--stat", `${base}...HEAD`], {
        cwd: worktreeCwd,
        encoding: "utf8",
        timeout: 15_000,
      }).then((result) => result.stdout.trim().split("\n").filter((line) => line !== ""), () => [] as string[]),
      execFileAsync("git", ["diff", "--name-only", `${base}...HEAD`], {
        cwd: worktreeCwd,
        encoding: "utf8",
        timeout: 15_000,
      }).then((result) => result.stdout.trim().split("\n").filter((line) => line !== ""), () => [] as string[]),
    ]);
    return { commitLines: commits, diffStatLines: diffStat, changedFilenames: changedFiles };
  } catch {
    return empty;
  }
}
