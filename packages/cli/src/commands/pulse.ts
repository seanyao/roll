/**
 * `roll pulse` — today's delivery pulse (US-DEMO-001).
 *
 * Reads ONE truth source (.roll/features/truth.json), same as the web
 * dossier's Now tab badge. No alternate calculation, no stale cache.
 *
 * Output:
 *   - default: bilingual human-readable (EN + 中), one screen
 *   - --json:  machine-readable JSON, same numbers
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLang } from "@roll/spec";
import type { TruthSnapshot } from "@roll/spec";

const SPARK_CHARS = " ▁▂▃▄▅▆▇█";

function sparkline(values: number[]): string {
  const max = Math.max(...values, 1);
  return values
    .map((v) => SPARK_CHARS[Math.min(Math.round((v / max) * 8), 8)] ?? SPARK_CHARS[8])
    .join("");
}

interface PulseData {
  cycles: number;
  merged: number;
  attested: number;
  spark: string;
  spectrum: Record<string, number>;
  generatedAt: string;
}

function loadPulse(): PulseData {
  const raw = readFileSync(join(process.cwd(), ".roll", "features", "truth.json"), "utf8");
  const snap = JSON.parse(raw) as TruthSnapshot;

  const cyc = snap.cycle?.cycles3d ?? 0;
  const stories = snap.stories ?? [];
  const merged = stories.filter(
    (r) => r.ladder === "merged" || r.ladder === "attested",
  ).length;
  const attested = stories.filter((r) => r.ladder === "attested").length;

  const spectrumOrder: Array<keyof typeof snap.story.spectrum> = [
    "done", "fail", "unknown", "wip", "todo", "hold",
  ];
  const sv = spectrumOrder.map((k) => snap.story.spectrum[k]);
  const spark = sparkline(sv);

  return {
    cycles: cyc,
    merged,
    attested,
    spark,
    spectrum: { ...snap.story.spectrum },
    generatedAt: snap.generatedAt,
  };
}

function formatHuman(pulse: PulseData, lang: "en" | "zh"): string {
  const isZh = lang === "zh";
  const lines: string[] = [];
  lines.push(isZh ? "⚡ 今日交付脉搏" : "⚡ Today's delivery pulse");
  lines.push("");
  lines.push(
    isZh
      ? `   周期/cycles   ${pulse.cycles}  (近 3 天/3d)`
      : `   cycles        ${pulse.cycles}  (last 3d)`,
  );
  lines.push(
    isZh
      ? `   已合/merged    ${pulse.merged}`
      : `   merged        ${pulse.merged}`,
  );
  lines.push(
    isZh
      ? `   已验收/attested ${pulse.attested}`
      : `   attested      ${pulse.attested}`,
  );
  lines.push("");
  lines.push(
    isZh
      ? `   故事光谱       ${pulse.spark}  完成 ${pulse.spectrum.done} · 待办 ${pulse.spectrum.todo} · 进行中 ${pulse.spectrum.wip}`
      : `   spectrum       ${pulse.spark}  done ${pulse.spectrum.done} · todo ${pulse.spectrum.todo} · wip ${pulse.spectrum.wip}`,
  );
  lines.push("");
  lines.push(
    isZh
      ? `   数据源: .roll/features/truth.json  ·  生成: ${pulse.generatedAt}`
      : `   source: .roll/features/truth.json  ·  generated: ${pulse.generatedAt}`,
  );
  return lines.join("\n") + "\n";
}

function formatJson(pulse: PulseData): string {
  return JSON.stringify(
    {
      cycles: pulse.cycles,
      merged: pulse.merged,
      attested: pulse.attested,
      spark: pulse.spark,
      spectrum: pulse.spectrum,
      generatedAt: pulse.generatedAt,
    },
    null,
    2,
  ) + "\n";
}

export function pulseCommand(args: string[]): number {
  const json = args.includes("--json");
  if (args.length > 0 && !json) {
    process.stderr.write("Usage: roll pulse [--json]\n");
    return 1;
  }

  let pulse: PulseData;
  try {
    pulse = loadPulse();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`roll pulse: cannot read truth.json: ${msg}\n`);
    return 2;
  }

  if (json) {
    process.stdout.write(formatJson(pulse));
    return 0;
  }

  const lang = resolveLang({
    rollLang: process.env["ROLL_LANG"],
    lcAll: process.env["LC_ALL"],
    lang: process.env["LANG"],
  });
  process.stdout.write(formatHuman(pulse, lang === "zh" ? "zh" : "en"));
  return 0;
}
