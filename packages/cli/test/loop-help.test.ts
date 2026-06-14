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
  "alert", "run-once", "fmt", "pr-inbox", "pr-heal-run", "on", "off", "pause",
  "resume", "now", "reset", "mute", "unmute", "gc", "test", "notify",
  "enforce-tcr", "precheck-ci", "hotfix-head-context", "agent-routes",
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
    expect(out).toMatch(/control\s+on · off · now · pause · resume · reset · go · goal/);
    expect(out).toMatch(/observe\s+watch · status · runs · log · events · signals · eval/);
    expect(out).toMatch(/alerts\s+alert list · alert ack · alert resolve · alert log/);
    expect(out).toMatch(/maintain\s+gc · fmt · mute · unmute · pr-inbox/);
  });

  it("AC5: no live loop subcommand is dropped — each appears somewhere in the help", () => {
    const out = help("en");
    for (const sub of LIVE_SUBCOMMANDS) {
      expect(out, `live subcommand "${sub}" must appear in the grouped help`).toContain(sub);
    }
  });

  it("AC6: EN/中 snapshots (single-language per locale, color scrubbed)", () => {
    expect(help("en")).toMatchSnapshot();
    expect(help("zh")).toMatchSnapshot();
  });
});
