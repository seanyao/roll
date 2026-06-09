/**
 * `roll release ship` — collapse the manual tag-push sequence into one
 * gated command (US-REL-SHIP). It gathers git + consistency facts, runs the
 * pure {@link planShip} gate, and on a clean pass tags `v<version>` and pushes
 * it — which triggers release.yml (the remote consistency gate + GitHub
 * Release).
 *
 * Hard rule preserved: ship STOPS at the tag push. It never runs
 * `npm publish` and never touches 2FA — publishing stays the owner's separate,
 * authenticated step. A human typing `roll release ship` IS the human release
 * decision; the autonomous loop never invokes it.
 *
 * Safety: every precondition is checked BEFORE any mutation. A dirty tree,
 * a branch other than main, being behind origin, an existing tag, or a red
 * consistency gate each abort with the reason — nothing is tagged or pushed.
 * `--dry-run` prints the plan and exits; `--yes` skips the confirm prompt.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planShip, type ShipFacts } from "@roll/core";
import { type Lang, resolveLang } from "@roll/spec";
import { c, renderState } from "../render.js";
import { consistencyPasses } from "./consistency.js";

// FIX-228/229: the interactive confirm reader lives in the shared tty-confirm
// module (also used by `slides delete`, US-PORT-016). Imported for local use in
// `confirm`, and re-exported so the release-ship tests keep their import surface.
import { readConfirmLine, readLineSyncFromFd } from "../lib/tty-confirm.js";
import type { ByteReader } from "../lib/tty-confirm.js";
export { readConfirmLine, readLineSyncFromFd, type ByteReader };

/** Injectable seams (tests pass fakes; production wires real git/fs/consistency). */
export interface ShipDeps {
  version: (cwd: string) => string;
  branch: (cwd: string) => string;
  clean: (cwd: string) => boolean;
  synced: (cwd: string, branch: string) => boolean;
  tagExists: (cwd: string, tag: string) => boolean;
  consistency: (cwd: string) => boolean;
  tag: (cwd: string, tag: string, version: string) => void;
  pushTag: (cwd: string, tag: string) => void;
  confirm: (tag: string) => boolean;
}

const DEFAULT_BRANCH = "main";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const realDeps: ShipDeps = {
  version: (cwd) => {
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { version?: unknown };
      return typeof pkg.version === "string" ? pkg.version : "";
    } catch {
      return "";
    }
  },
  branch: (cwd) => {
    try {
      return git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
    } catch {
      return "";
    }
  },
  clean: (cwd) => {
    try {
      return git(cwd, ["status", "--porcelain"]) === "";
    } catch {
      return false;
    }
  },
  synced: (cwd, branch) => {
    try {
      git(cwd, ["fetch", "origin", branch, "--quiet"]);
      return git(cwd, ["rev-parse", "HEAD"]) === git(cwd, ["rev-parse", `origin/${branch}`]);
    } catch {
      return false;
    }
  },
  tagExists: (cwd, tag) => {
    try {
      if (git(cwd, ["tag", "--list", tag]) !== "") return true;
      return git(cwd, ["ls-remote", "--tags", "origin", tag]) !== "";
    } catch {
      return false;
    }
  },
  consistency: (cwd) => consistencyPasses(cwd),
  tag: (cwd, tag, version) => {
    git(cwd, ["tag", "-a", tag, "-m", `release: ${tag}`]);
    void version;
  },
  pushTag: (cwd, tag) => {
    git(cwd, ["push", "origin", tag]);
  },
  confirm: (tag) => {
    // Non-interactive without --yes is treated as "no" by the caller; this
    // real confirm reads a single y/N line from the TTY.
    process.stdout.write(`\n  Tag and push ${tag}? This triggers the release workflow. [y/N] `);
    try {
      // FIX-229: read /dev/tty (blocking), not fd 0 (non-blocking in a Node v26 TTY).
      return /^\s*y(es)?\s*$/i.test(readConfirmLine());
    } catch {
      return false;
    }
  },
};

const BLOCKER_MSG: Record<string, [string, string]> = {
  "not-default-branch": ["must be on the main branch", "必须在 main 分支"],
  "dirty-tree": ["working tree has uncommitted changes", "工作区有未提交改动"],
  "out-of-sync": ["local HEAD is not in sync with origin/main", "本地 HEAD 与 origin/main 不同步"],
  "tag-exists": ["the release tag already exists (already shipped?)", "发版 tag 已存在（已发过？）"],
  "consistency-failed": ["consistency check failed — run `roll consistency check`", "一致性闸未过——先跑 roll consistency check"],
};

export function releaseShipCommand(args: string[], deps: ShipDeps = realDeps): number {
  const noColor =
    args.includes("--no-color") || !process.stdout.isTTY || (process.env["NO_COLOR"] ?? "") !== "";
  renderState.useColor = !noColor;
  const lang: Lang = resolveLang({
    rollLang: process.env["ROLL_LANG"],
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });
  const zh = lang === "zh";

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      "Usage: roll release ship [--dry-run] [--yes]\n" +
        "  Gate (main · clean · synced · no existing tag · consistency green),\n" +
        "  then tag v<version> and push it (triggers release.yml). Never npm-publishes.\n",
    );
    return 0;
  }

  const cwd = process.cwd();
  const version = deps.version(cwd);
  if (version === "") {
    process.stderr.write(`${c("amber", zh ? "✗ 读不到 package.json 版本" : "✗ cannot read package.json version")}\n`);
    return 1;
  }
  const branch = deps.branch(cwd);
  const facts: ShipFacts = {
    currentVersion: version,
    branch,
    clean: deps.clean(cwd),
    syncedWithOrigin: deps.synced(cwd, DEFAULT_BRANCH),
    tagExists: deps.tagExists(cwd, `v${version}`),
    consistencyPass: deps.consistency(cwd),
    defaultBranch: DEFAULT_BRANCH,
  };
  const plan = planShip(facts);

  if (!plan.ok) {
    process.stderr.write(`${c("amber", zh ? `✗ 不能发版 ${plan.tag}：` : `✗ cannot ship ${plan.tag}:`)}\n`);
    for (const b of plan.blockers) {
      const [en, zhm] = BLOCKER_MSG[b] ?? [b, b];
      process.stderr.write(`  • ${zh ? zhm : en}\n`);
    }
    return 1;
  }

  if (args.includes("--dry-run")) {
    process.stdout.write(`${c("green", "✓")} ${zh ? "前置闸全过；将打并推送" : "all gates pass; would tag and push"} ${plan.tag}\n`);
    return 0;
  }

  if (!args.includes("--yes") && !deps.confirm(plan.tag)) {
    process.stdout.write(`${zh ? "已取消。" : "Aborted."}\n`);
    return 1;
  }

  deps.tag(cwd, plan.tag, version);
  deps.pushTag(cwd, plan.tag);
  process.stdout.write(
    `${c("green", "✓")} ${zh ? "已推送" : "pushed"} ${plan.tag} → release.yml\n` +
      `  ${c("dim", zh ? "等 release.yml 绿后，owner 跑 npm publish（需 2FA）" : "after release.yml is green, the owner runs npm publish (2FA)")}\n`,
  );
  return 0;
}
