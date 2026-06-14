/**
 * US-DOSSIER-035 — grouped `roll loop --help` (design frame 4).
 *
 * The flat ~18-verb pipe list becomes four labeled bands so a user instantly
 * sees "control it vs watch it": control · observe · alerts · maintain, in the
 * design order, each listing exactly the subcommands frame 4 assigns it. A
 * fifth `internal` band lists the loop-AGENT cycle-gate verbs so no live
 * subcommand is dropped (AC5) while the four user-facing bands match the design.
 *
 * Single-language per resolved locale; the EN and 中 headers each render their
 * own block (never inline on one line).
 */
import type { Lang } from "@roll/spec";
import { c, pad } from "../render.js";

/** Each band: a label, its color, and the verbs the design frame 4 lists. */
interface Band {
  key: string;
  color: string;
  en: string;
  zh: string;
  verbs: string;
}

const BANDS: Band[] = [
  { key: "control", color: "amber", en: "control", zh: "作动", verbs: "on · off · now · pause · resume · reset · go · goal" },
  { key: "observe", color: "green", en: "observe", zh: "传感", verbs: "watch · status · runs · log · events · signals · eval" },
  { key: "alerts", color: "red", en: "alerts", zh: "告警", verbs: "alert list · alert ack · alert resolve · alert log" },
  { key: "maintain", color: "muted", en: "maintain", zh: "维护", verbs: "gc · fmt · mute · unmute · pr-inbox" },
  // Agent-invoked entry points — live, but not user-facing daily verbs. Listed
  // so AC5's "no live subcommand dropped" holds without polluting the four
  // design bands.
  { key: "internal", color: "faint", en: "internal", zh: "内部", verbs: "test · run-once · story · notify · enforce-tcr · precheck-ci · hotfix-head-context · agent-routes · pr-heal-run" },
];

/** Render the grouped `roll loop --help` body for the resolved locale. */
export function renderLoopHelp(lang: Lang): string {
  const title =
    lang === "zh"
      ? "用法：roll loop <子命令>\n自治交付循环——按作动/传感/告警/维护分组。"
      : "Usage: roll loop <subcommand>\nThe autonomous delivery loop — grouped control / observe / alerts / maintain.";
  const lines = BANDS.map((b) => `${c(b.color, pad(lang === "zh" ? b.zh : b.en, 10))}${b.verbs}`);
  return `${title}\n\n${lines.join("\n")}\n`;
}
