/**
 * US-ATTEST-006 — `roll attest <story-id>`: compose the five-piece evidence
 * chain into one acceptance report.
 *
 *   AC parser (core)      → structured AC items from .roll/features/**
 *   evidence collector    → evidence.json hard facts (infra, injectable seams)
 *   ANSI→HTML + renderer  → single-file report.html (core, pure)
 *   screenshots           → CONSUMED if present in the run dir; this command
 *                           never captures (the skill drives the dispatcher —
 *                           AI owns intent, D7)
 *
 * Intent hook (the AI layer's contract, consumed when present):
 *   `.roll/verification/<id>/ac-map.json` —
 *     [{ "ac": "<acId>", "status": "pass|readonly|partial|claimed|missing",
 *        "evidence": [{kind,label,href?,textFile?}], "note": "…" }]
 *   Written by the attest skill during the Gate session (US-ATTEST-007 wiring).
 *   ABSENT map ⇒ every AC renders honestly as 🟧 Claimed (the render-layer red
 *   line) — a standalone run never invents per-AC evidence.
 *
 * Run lifecycle (D4): `.roll/verification/<id>/<run-id>/` (run-id =
 * YYYY-MM-DDTHH-MM-SS, never overwritten) + `latest` symlink. Failure policy
 * (D1): story-not-found errs exit 1; anything else degrades with a WARN and
 * still writes the best report it can, exit 0 — attest must never block
 * delivery.
 */
import { acForStory, renderReport, ansiPre, type AcReportItem, type AcStatus, type EvidenceRef } from "@roll/core";
import { collectEvidence, writeEvidenceJson, type EvidenceRun } from "@roll/infra";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative } from "node:path";

export interface AttestDeps {
  now?: () => Date;
  run?: EvidenceRun;
  ghProbe?: () => Promise<boolean>;
}

const STATUSES: readonly AcStatus[] = ["pass", "readonly", "partial", "claimed", "missing"];

function warn(msg: string): void {
  process.stderr.write(`[roll] attest WARN: ${msg}\n`);
}

/** Locate the feature markdown that defines the story (heading or AC owner). */
export function findFeatureFile(projectPath: string, storyId: string): string | null {
  const root = join(projectPath, ".roll", "features");
  if (!existsSync(root)) return null;
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".md")) {
        if (e.name === `${storyId}.md`) hits.unshift(p); // ID-named file wins
        else {
          try {
            if (readFileSync(p, "utf8").includes(storyId)) hits.push(p);
          } catch {
            /* unreadable file: skip */
          }
        }
      }
    }
  };
  try {
    walk(root);
  } catch {
    return null;
  }
  return hits[0] ?? null;
}

interface AcMapEntry {
  ac: string;
  status?: string;
  note?: string;
  evidence?: Array<{ kind?: string; label?: string; href?: string; textFile?: string }>;
}

/** Read + validate the optional AI intent map; null when absent/malformed. */
function readAcMap(storyDir: string): Map<string, AcMapEntry> | null {
  const p = join(storyDir, "ac-map.json");
  if (!existsSync(p)) return null;
  try {
    const arr = JSON.parse(readFileSync(p, "utf8")) as AcMapEntry[];
    if (!Array.isArray(arr)) return null;
    const m = new Map<string, AcMapEntry>();
    for (const e of arr) if (typeof e?.ac === "string") m.set(e.ac, e);
    return m;
  } catch {
    warn("ac-map.json malformed — rendering without intent mapping");
    return null;
  }
}

function toRef(runDir: string, e: NonNullable<AcMapEntry["evidence"]>[number]): EvidenceRef | null {
  const kind = (e.kind ?? "") as EvidenceRef["kind"];
  const label = e.label ?? kind;
  if (kind === "text" && e.textFile !== undefined) {
    const p = join(runDir, e.textFile);
    if (!existsSync(p)) return null;
    try {
      return { kind, label, inlineHtml: ansiPre(readFileSync(p, "utf8")) };
    } catch {
      return null;
    }
  }
  if (["screenshot", "commit", "ci", "deploy", "test-pass"].includes(kind)) {
    return e.href !== undefined ? { kind, label, href: e.href } : { kind, label };
  }
  return null;
}

/**
 * US-ATTEST-009 — same-story Self-Score entries from `.roll/notes/`:
 * `YYYY-MM-DD-<skill>-<STORY>-<ts>.md` with YAML frontmatter
 * {skill, story, score, verdict, ts} + a prose body. Tolerant reader: files
 * that fail to parse are skipped; no notes ⇒ empty list ⇒ block skipped.
 */
export function readSelfScores(
  projectPath: string,
  storyId: string,
): Array<{ skill: string; score: number; verdict: string; ts: string; note: string }> {
  const dir = join(projectPath, ".roll", "notes");
  if (!existsSync(dir)) return [];
  const out: Array<{ skill: string; score: number; verdict: string; ts: string; note: string }> = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith(".md") && f.includes(`-${storyId}-`));
  } catch {
    return [];
  }
  for (const name of names.sort()) {
    try {
      const text = readFileSync(join(dir, name), "utf8");
      const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
      if (!m) continue;
      const fm = new Map<string, string>();
      for (const line of (m[1] ?? "").split("\n")) {
        const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line.trim());
        if (kv?.[1] !== undefined) fm.set(kv[1], (kv[2] ?? "").trim());
      }
      if (fm.get("story") !== storyId) continue;
      const score = Number(fm.get("score") ?? "");
      out.push({
        skill: fm.get("skill") ?? basename(name),
        score: Number.isFinite(score) ? score : 0,
        verdict: fm.get("verdict") ?? "",
        ts: fm.get("ts") ?? "",
        note: (m[2] ?? "").trim().slice(0, 300),
      });
    } catch {
      /* tolerant reader */
    }
  }
  return out;
}

/** `roll attest <story-id> [--deploy-url <url>]` */
export async function attestCommand(args: string[], deps: AttestDeps = {}): Promise<number> {
  const storyId = args.find((a) => !a.startsWith("-"));
  if (storyId === undefined || storyId === "") {
    process.stderr.write("Usage: roll attest <story-id> [--deploy-url <url>]\n");
    return 1;
  }
  const di = args.indexOf("--deploy-url");
  const deployUrl = di >= 0 ? args[di + 1] : undefined;

  const projectPath = process.cwd();
  const featureFile = findFeatureFile(projectPath, storyId);
  if (featureFile === null) {
    process.stderr.write(`[roll] attest: story ${storyId} not found under .roll/features/\n`);
    process.stderr.write(`[roll] attest：在 .roll/features/ 下找不到 ${storyId}\n`);
    return 1;
  }

  const acItems = acForStory(readFileSync(featureFile, "utf8"), storyId);
  if (acItems.length === 0) warn(`no **AC:** block for ${storyId} — report will carry facts only`);

  // run dir + latest symlink (never overwrite history).
  const now = (deps.now ?? ((): Date => new Date()))();
  const p2 = (n: number): string => String(n).padStart(2, "0");
  const runId = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}T${p2(now.getHours())}-${p2(now.getMinutes())}-${p2(now.getSeconds())}`;
  const storyDir = join(projectPath, ".roll", "verification", storyId);
  const runDir = join(storyDir, runId);
  mkdirSync(runDir, { recursive: true });

  // hard facts.
  const manifest = await collectEvidence({
    storyId,
    projectPath,
    runDir,
    ...(deployUrl !== undefined ? { deployUrl } : {}),
    now: () => now.toISOString(),
    ...(deps.run !== undefined ? { run: deps.run } : {}),
    ...(deps.ghProbe !== undefined ? { ghProbe: deps.ghProbe } : {}),
  });
  writeEvidenceJson(manifest, runDir);

  // intent map (AI layer) → report items; absent ⇒ honest all-Claimed.
  const acMap = readAcMap(storyDir);
  const items: AcReportItem[] = acItems.map((ac) => {
    const mapped = acMap?.get(ac.id);
    const status: AcStatus =
      mapped?.status !== undefined && (STATUSES as readonly string[]).includes(mapped.status)
        ? (mapped.status as AcStatus)
        : "claimed";
    const evidence = (mapped?.evidence ?? [])
      .map((e) => toRef(runDir, e))
      .filter((x): x is EvidenceRef => x !== null);
    return {
      id: ac.id,
      text: ac.text,
      status,
      evidence,
      ...(mapped?.note !== undefined ? { note: mapped.note } : {}),
    };
  });

  const age = manifest.test_pass.present
    ? manifest.test_pass.age_seconds >= 0
      ? `${manifest.test_pass.age_seconds}s ago`
      : "present"
    : "absent";
  const selfScores = readSelfScores(projectPath, storyId);
  const html = renderReport({
    storyId,
    title: `${storyId} — Acceptance Evidence`,
    generatedAt: now.toISOString(),
    items,
    facts: { tcrCount: manifest.tcr_commits.length, ciConclusion: manifest.ci.conclusion, testPassAge: age },
    ...(selfScores.length > 0 ? { selfScores } : {}),
  });
  const reportPath = join(runDir, "report.html");
  writeFileSync(reportPath, html);

  // latest symlink (replace — rm is force-tolerant of absence).
  const latest = join(storyDir, "latest");
  try {
    rmSync(latest, { force: true });
    symlinkSync(runId, latest);
  } catch {
    warn("latest symlink update failed (report still written)");
  }

  process.stdout.write(`Acceptance report written\n验收报告已生成\n  ${relative(projectPath, reportPath)}\n`);
  return 0;
}
