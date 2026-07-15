/**
 * US-DOSSIER-035 — grouped `roll loop --help` (design frame 4).
 *
 * Four labeled bands in the design order (control / observe / alerts /
 * maintain); every live loop subcommand lands in a band (no verb dropped);
 * EN/中 single-language snapshots.
 */
import { describe, expect, it } from "vitest";
import { renderLoopHelp } from "../src/lib/loop-help.js";
import { stripAnsi } from "../src/render.js";

const help = (lang: "en" | "zh"): string => stripAnsi(renderLoopHelp(lang));

// Every live `roll loop <sub>` arm in commands/index.ts (retired stubs excluded:
// monitor / attach / branches / test-quality-check just print a redirect).
const LIVE_SUBCOMMANDS = [
  "watch", "status", "eval", "story", "runs", "goal", "go", "signals", "log", "events",
  "alert", "run-once", "fmt", "reconcile-pending", "on", "off", "pause",
  "resume", "now", "reset", "mute", "unmute", "gc", "test", "notify",
  "enforce-tcr", "precheck-ci", "hotfix-head-context", "agent-routes", "fallback",
];

describe("roll loop --help groups — US-DOSSIER-035", () => {
  it("AC5: four labeled bands in the design order, replacing the flat pipe list", () => {
    const out = help("en");
    const iControl = out.indexOf("control");
    const iObserve = out.indexOf("observe");
    const iAlerts = out.indexOf("alerts");
    const iMaintain = out.indexOf("maintain");
    expect(iControl).toBeGreaterThan(-1);
    expect(iControl).toBeLessThan(iObserve);
    expect(iObserve).toBeLessThan(iAlerts);
    expect(iAlerts).toBeLessThan(iMaintain);
    // the flat "on|off|now|…" pipe list is gone
    expect(out).not.toContain("on|off|now");
  });

  it("AC5: the design verbs sit in their assigned band", () => {
    const out = help("en");
    expect(out).toMatch(/control\s+on · off \[--all\] · now · pause · resume · reset · go · goal · recover · fallback/);
    expect(out).toMatch(/observe\s+watch · status · runs · log · events · signals · eval/);
    expect(out).toMatch(/alerts\s+alert list · alert ack · alert resolve · alert log/);
    expect(out).toMatch(/maintain\s+gc · fmt · mute · unmute · reconcile-pending/);
  });

  it("AC5: no live loop subcommand is dropped — each appears somewhere in the help", () => {
    const out = help("en");
    for (const sub of LIVE_SUBCOMMANDS) {
      expect(out, `live subcommand "${sub}" must appear in the grouped help`).toContain(sub);
    }
  });

  it("US-LOOP-079m AC1/AC3: --help documents the 3 run-states + dormancy + wake sources", () => {
    const en = help("en");
    // the three states, each named
    expect(en).toMatch(/states\s+ACTIVE.*DORMANT.*PAUSED/);
    // DORMANT meaning: lane self-unloads + zero idle records
    expect(en).toMatch(/DORMANT.*self-unloads.*zero idle records/);
    // the three wake sources
    expect(en).toMatch(/wake\s+a DORMANT loop wakes on.*roll command.*dream scan.*PR merge/);
    const zh = help("zh");
    expect(zh).toMatch(/状态\s+ACTIVE.*DORMANT.*PAUSED/);
    expect(zh).toContain("自卸 loop lane");
    expect(zh).toMatch(/唤醒.*roll 命令.*dream 扫描.*PR 合并/);
  });

  it("US-LOOP-079m AC4: EN and 中 each their own block — no inline language mix on the state lines", () => {
    // EN block carries no CJK; 中 block carries the CJK labels.
    expect(/[一-鿿]/.test(help("en"))).toBe(false);
    expect(help("zh")).toContain("休眠");
  });

  it("AC6: EN/中 snapshots (single-language per locale, color scrubbed)", () => {
    expect(help("en")).toMatchSnapshot();
    expect(help("zh")).toMatchSnapshot();
  });
});
