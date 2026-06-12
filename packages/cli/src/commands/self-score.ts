/**
 * FIX-274 — `roll self-score <skill> <story> <score> <verdict> <rationale...>`
 *
 * Hidden, agent-facing entry point for the skill self-score note (US-SKILL-010
 * family). Replaces the dead v2 path that sourced the bash `roll` to call
 * `_skill_write_self_score` — the v3 bundled TS CLI cannot be sourced as a
 * bash library. Writes the note shape every existing reader (dossier, attest
 * gate, dashboard trend, `roll tune`) already parses, then prints the path.
 */
import { relative } from "node:path";
import { SELF_SCORE_VERDICTS, writeSelfScoreNote } from "../lib/self-score.js";

export const SELF_SCORE_USAGE =
  "Usage: roll self-score <skill> <story> <score 1..10> <good|ok|regression> <rationale>\n" +
  "  Write the skill self-score note for a finished cycle (TS-native; never source roll).\n" +
  "写入技能自评分 note（TS 原生路径；不要把 roll 当 bash 库 source）。";

export async function selfScoreCommand(args: string[]): Promise<number> {
  if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(`${SELF_SCORE_USAGE}\n`);
    return 0;
  }
  const [skill, story, scoreRaw, verdictRaw, ...rest] = args;
  const rationale = rest.join(" ").trim();
  if (skill === undefined || story === undefined || scoreRaw === undefined || verdictRaw === undefined || rationale === "") {
    process.stderr.write(`${SELF_SCORE_USAGE}\n`);
    return 1;
  }
  const score = /^\d+$/.test(scoreRaw) ? Number(scoreRaw) : Number.NaN;
  try {
    const res = writeSelfScoreNote(process.cwd(), {
      skill,
      story,
      score,
      verdict: verdictRaw as (typeof SELF_SCORE_VERDICTS)[number],
      rationale,
    });
    const rel = relative(process.cwd(), res.path);
    process.stdout.write(
      res.written
        ? `Self-score note written\n自评分 note 已写入\n  ${rel}\n`
        : `Self-score note already exists (idempotent retry)\n自评分 note 已存在（幂等重试）\n  ${rel}\n`,
    );
    return 0;
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}
