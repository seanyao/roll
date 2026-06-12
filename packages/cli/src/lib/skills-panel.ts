/**
 * US-DOSSIER-017 — the Skills tab: the contract says how work should be done;
 * the strict audit + real invocations say how it actually is. One row per
 * skill READ FROM THE REPO DIRECTORY (no drifting hand-kept catalog), grouped
 * delivery / quality / observe / lifecycle, with usage counts from self-score
 * notes and an expandable anatomy (real file tree + audit essentials + the
 * SKILL.md hub inline; references stay pointers, never embedded).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readAllSelfScores } from "./self-score.js";

export type SkillGroup = "delivery" | "quality" | "observe" | "lifecycle";

export interface SkillFileEntry {
  path: string;
  lines: number;
  dir: boolean;
}

export interface SkillPanelRow {
  name: string;
  group: SkillGroup;
  hubLines: number;
  description: string;
  violations: string[];
  hasGotchas: boolean;
  hasLoadTrigger: boolean;
  routeCases: { positive: number; negative: number };
  usage: number;
  files: SkillFileEntry[];
  dirPath: string;
  hubText: string;
}

export interface SkillsPanelVM {
  summary: { skills: number; violations: number; hubLines: number };
  groups: Array<{ key: SkillGroup; rows: SkillPanelRow[] }>;
}

interface AuditSkill {
  name: string;
  lines: number;
  description?: string;
  violations?: string[];
  hasGotchas?: boolean;
  descriptionLoadTrigger?: boolean;
  routeCoverage?: { positiveCount?: number; negativeCount?: number };
}

export interface SkillsPanelDeps {
  /** The strict audit JSON (the SAME script `--strict --json` emits). */
  auditJson: () => { summary?: { skills?: number; violations?: number }; skills?: AuditSkill[] } | null;
  usageCounts: () => Record<string, number>;
}

export function defaultSkillsPanelDeps(projectPath: string): SkillsPanelDeps {
  return {
    auditJson: () => {
      const script = join(projectPath, "skills", "scripts", "audit-skills.mjs");
      if (!existsSync(script)) return null;
      try {
        const out = execFileSync(process.execPath, [script, "--strict", "--json"], {
          encoding: "utf8",
          timeout: 30_000,
          stdio: ["ignore", "pipe", "ignore"],
        });
        return JSON.parse(out) as ReturnType<SkillsPanelDeps["auditJson"]>;
      } catch {
        return null; // honest empty panel when the audit can't run
      }
    },
    usageCounts: () => {
      const counts: Record<string, number> = {};
      try {
        for (const e of readAllSelfScores(projectPath)) {
          if (e.skill !== "") counts[e.skill] = (counts[e.skill] ?? 0) + 1;
        }
      } catch {
        /* usage is best-effort */
      }
      return counts;
    },
  };
}

const GROUP_OF: Record<string, SkillGroup> = {
  "roll-build": "delivery",
  "roll-fix": "delivery",
  "roll-design": "delivery",
  "roll-idea": "delivery",
  "roll-.changelog": "delivery",
  "roll-.clarify": "delivery",
  "roll-.qa": "quality",
  "roll-.review": "quality",
  "roll-spar": "quality",
  "roll-peer": "quality",
  "roll-review-pr": "quality",
  "roll-notes": "observe",
  "roll-brief": "observe",
  "roll-sentinel": "observe",
  "roll-doctor": "observe",
  "roll-.dream": "observe",
  "roll-.echo": "observe",
  "roll-loop": "lifecycle",
  "roll-onboard": "lifecycle",
  "roll-doc": "lifecycle",
  "roll-propose": "lifecycle",
};

export function skillGroupOf(name: string): SkillGroup {
  return GROUP_OF[name] ?? "lifecycle";
}

function lineCount(path: string): number {
  try {
    return readFileSync(path, "utf8").split("\n").length;
  } catch {
    return 0;
  }
}

function skillFiles(dir: string): SkillFileEntry[] {
  const out: SkillFileEntry[] = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) {
        const sub = join(dir, e.name);
        out.push({ path: `${e.name}/`, lines: 0, dir: true });
        try {
          for (const f of readdirSync(sub).sort()) {
            const p = join(sub, f);
            if (statSync(p).isFile()) out.push({ path: `${e.name}/${f}`, lines: lineCount(p), dir: false });
          }
        } catch {
          /* unreadable subdir */
        }
      } else if (e.isFile()) {
        out.push({ path: e.name, lines: lineCount(join(dir, e.name)), dir: false });
      }
    }
  } catch {
    /* skill dir unreadable */
  }
  return out;
}

const GROUP_ORDER: readonly SkillGroup[] = ["delivery", "quality", "observe", "lifecycle"];

export function collectSkillsPanel(projectPath: string, deps: SkillsPanelDeps = defaultSkillsPanelDeps(projectPath)): SkillsPanelVM {
  const audit = deps.auditJson();
  const usage = deps.usageCounts();
  const skillsRoot = join(projectPath, "skills");
  const rows: SkillPanelRow[] = [];
  for (const a of audit?.skills ?? []) {
    const dir = join(skillsRoot, a.name);
    // the directory is the catalog: a skill the repo doesn't carry never appears.
    if (!existsSync(dir)) continue;
    const hubPath = join(dir, "SKILL.md");
    rows.push({
      name: a.name,
      group: skillGroupOf(a.name),
      hubLines: a.lines,
      description: a.description ?? "",
      violations: a.violations ?? [],
      hasGotchas: a.hasGotchas === true,
      hasLoadTrigger: a.descriptionLoadTrigger === true,
      routeCases: { positive: a.routeCoverage?.positiveCount ?? 0, negative: a.routeCoverage?.negativeCount ?? 0 },
      usage: usage[a.name] ?? 0,
      files: skillFiles(dir),
      dirPath: dir,
      hubText: existsSync(hubPath) ? readFileSync(hubPath, "utf8") : "",
    });
  }
  const hubLines = rows.reduce((acc, r) => acc + r.hubLines, 0);
  return {
    summary: {
      skills: audit?.summary?.skills ?? rows.length,
      violations: audit?.summary?.violations ?? rows.reduce((a, r) => a + r.violations.length, 0),
      hubLines,
    },
    groups: GROUP_ORDER.map((key) => ({ key, rows: rows.filter((r) => r.group === key).sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name)) })),
  };
}
