/**
 * Unit tests for the Schedule module's pure generators (US-INFRA-004):
 * launchd label/path, plist content/schedule_xml shape, and the crontab
 * read-modify-write fns. Byte-parity vs extracted bash is asserted separately in
 * schedule.difftest.test.ts; here we cover edge cases + the FIX-195 cron shape.
 */
import { describe, expect, it } from "vitest";
import {
  type Scheduler,
  CronScheduler,
  LaunchdScheduler,
  createScheduler,
  cronHasEntry,
  cronInstall,
  cronLines,
  cronRemove,
  launchdLabel,
  launchdPlistPath,
  plistContent,
  scheduleXml,
} from "../src/schedule.js";

describe("launchdLabel / launchdPlistPath (bin/roll 8170-8197)", () => {
  it("com.roll.<svc>.<slug>", () => {
    expect(launchdLabel("loop", "main-abc123")).toBe("com.roll.loop.main-abc123");
    expect(launchdLabel("dream", "s")).toBe("com.roll.dream.s");
    expect(launchdLabel("pr", "s")).toBe("com.roll.pr.s");
  });
  it("plist path joins dir + label.plist", () => {
    expect(launchdPlistPath("loop", "s", "/home/u/Library/LaunchAgents")).toBe(
      "/home/u/Library/LaunchAgents/com.roll.loop.s.plist",
    );
  });
});

describe("scheduleXml (bin/roll 8235-8260)", () => {
  it("interval → StartInterval = period*60", () => {
    expect(scheduleXml({ kind: "interval", periodMinutes: 5 })).toBe(
      "  <key>StartInterval</key>\n  <integer>300</integer>",
    );
  });
  it("daily default (FIX-105) → StartInterval 86400", () => {
    expect(scheduleXml({ kind: "daily", hour: 3, minute: 2 })).toBe(
      "  <key>StartInterval</key>\n  <integer>86400</integer>",
    );
  });
  it("daily + calendar opt-in → array-style StartCalendarInterval Hour+Minute", () => {
    const xml = scheduleXml({ kind: "daily", hour: 3, minute: 2, calendar: true });
    expect(xml).toContain("<key>StartCalendarInterval</key>");
    expect(xml).toContain("<key>Hour</key>\n      <integer>3</integer>");
    expect(xml).toContain("<key>Minute</key>\n      <integer>2</integer>");
  });
});

describe("plistContent shape (bin/roll 8262-8289)", () => {
  const base = {
    label: "com.roll.loop.s",
    runnerScript: "/sh/loop/run-s.sh",
    projectPath: "/proj",
    pathValue: "/opt/homebrew/bin:/usr/bin:/bin",
    schedule: { kind: "interval", periodMinutes: 60 } as const,
  };
  it("ends with exactly one trailing newline (printf '%s\\n')", () => {
    const c = plistContent(base);
    expect(c.endsWith("</plist>\n")).toBe(true);
    expect(c.endsWith("</plist>\n\n")).toBe(false);
  });
  it("renders literal double-quotes (heredoc \\\" → \")", () => {
    expect(plistContent(base)).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(plistContent(base)).toContain('<plist version="1.0">');
  });
  it("embeds label/runner/project/path and ProgramArguments /bin/bash -l", () => {
    const c = plistContent(base);
    expect(c).toContain("<string>com.roll.loop.s</string>");
    expect(c).toContain("<string>/bin/bash</string>\n    <string>-l</string>\n    <string>/sh/loop/run-s.sh</string>");
    expect(c).toContain("<string>/opt/homebrew/bin:/usr/bin:/bin</string>");
    expect(c).toContain("<string>/proj</string>");
    expect(c).toContain("<integer>3600</integer>");
  });
});

const cmds = {
  loopCmd: 'cd "/proj" && roll loop now >> /sh/loop/cron-s.log 2>&1',
  loopMinute: 17,
  dreamCmd: 'cd "/proj" && roll dream >> /proj/.roll/dream/cron.log 2>&1',
  dreamMinute: 2,
  dreamHour: 3,
  projectPath: "/proj",
};

describe("cronLines (bin/roll 9960-9961, FIX-195: loop + dream only)", () => {
  it("loop is hourly at loopMinute; dream is daily at dreamMinute dreamHour", () => {
    const [loop, dream] = cronLines(cmds);
    expect(loop).toBe(
      '17 * * * * cd "/proj" && roll loop now >> /sh/loop/cron-s.log 2>&1 # roll-loop:/proj',
    );
    expect(dream).toBe(
      '2 3 * * * cd "/proj" && roll dream >> /proj/.roll/dream/cron.log 2>&1 # roll-loop:/proj',
    );
  });
  it("only TWO lines — no brief entry (FIX-195)", () => {
    expect(cronLines(cmds)).toHaveLength(2);
  });
});

describe("cronInstall / cronRemove / cronHasEntry (bin/roll 9958-9962 / 10012-10015)", () => {
  it("install onto an empty crontab → just the two lines", () => {
    const out = cronInstall("", cmds);
    expect(out).toBe(`${cronLines(cmds)[0]}\n${cronLines(cmds)[1]}\n`);
  });
  it("install preserves existing entries verbatim, appends after", () => {
    const out = cronInstall("0 0 * * * other-job\n", cmds);
    expect(out).toBe(`0 0 * * * other-job\n${cronLines(cmds)[0]}\n${cronLines(cmds)[1]}\n`);
  });
  it("install with existing crontab missing trailing newline still separates", () => {
    const out = cronInstall("0 0 * * * other-job", cmds);
    expect(out.startsWith("0 0 * * * other-job\n")).toBe(true);
  });
  it("cronHasEntry detects the project tag", () => {
    expect(cronHasEntry(cronInstall("", cmds), "/proj")).toBe(true);
    expect(cronHasEntry("0 0 * * * other-job\n", "/proj")).toBe(false);
  });
  it("remove strips every line carrying the project tag, keeps others", () => {
    const installed = cronInstall("0 0 * * * other-job\n", cmds);
    expect(cronRemove(installed, "/proj")).toBe("0 0 * * * other-job\n");
  });
  it("remove of the only entries → empty crontab", () => {
    expect(cronRemove(cronInstall("", cmds), "/proj")).toBe("");
  });
  it("remove keys on path: a different project's entries survive", () => {
    const other = cronInstall("", { ...cmds, projectPath: "/other" });
    const both = cronInstall(other, cmds);
    const after = cronRemove(both, "/proj");
    expect(cronHasEntry(after, "/proj")).toBe(false);
    expect(cronHasEntry(after, "/other")).toBe(true);
  });
});

// ─── Scheduler seam interface (US-LOOP-079f1) ─────────────────────────────────

describe("Scheduler interface — AC3 isArmed with injected Set (no real launchctl)", () => {
  it("isArmed returns false when nothing is loaded", async () => {
    const s = new LaunchdScheduler(501, { loadedSet: new Set() });
    await expect(s.isArmed("com.roll.loop.s")).resolves.toBe(false);
  });

  it("isArmed returns true after wake", async () => {
    const loaded = new Set<string>();
    const s = new LaunchdScheduler(501, { loadedSet: loaded });
    await s.wake("com.roll.loop.s", "/tmp/x.plist");
    await expect(s.isArmed("com.roll.loop.s")).resolves.toBe(true);
  });

  it("isArmed returns false after dormant", async () => {
    const loaded = new Set<string>(["com.roll.loop.s"]);
    const s = new LaunchdScheduler(501, { loadedSet: loaded });
    await expect(s.isArmed("com.roll.loop.s")).resolves.toBe(true);
    await s.dormant("com.roll.loop.s");
    await expect(s.isArmed("com.roll.loop.s")).resolves.toBe(false);
  });

  it("isArmed via injected Set — no real launchctl spawn (AC3)", async () => {
    const loaded = new Set<string>();
    const s = new LaunchdScheduler(501, { loadedSet: loaded });
    await expect(s.isArmed("svc-a")).resolves.toBe(false);
    await expect(s.isArmed("svc-b")).resolves.toBe(false);
    await s.wake("svc-a", "/tmp/a.plist");
    await expect(s.isArmed("svc-a")).resolves.toBe(true);
    await expect(s.isArmed("svc-b")).resolves.toBe(false);
    await s.dormant("svc-a");
    await expect(s.isArmed("svc-a")).resolves.toBe(false);
  });
});

describe("Scheduler — AC4 wake idempotent (double call = single arm)", () => {
  it("LaunchdScheduler: double wake returns true both times, arms only once", async () => {
    const loaded = new Set<string>();
    const s = new LaunchdScheduler(501, { loadedSet: loaded });
    const r1 = await s.wake("com.roll.loop.s", "/tmp/x.plist");
    expect(r1).toBe(true);
    const r2 = await s.wake("com.roll.loop.s", "/tmp/x.plist");
    expect(r2).toBe(true);
    await expect(s.isArmed("com.roll.loop.s")).resolves.toBe(true);
    expect(loaded.size).toBe(1);
  });

  it("CronScheduler: double wake is no-op on second call", async () => {
    const current = "";
    const cmds = {
      loopCmd: "cd /p && roll loop now",
      loopMinute: 17,
      dreamCmd: "cd /p && roll dream",
      dreamMinute: 2,
      dreamHour: 3,
      projectPath: "/p",
    };
    const after1 = cronInstall(current, cmds);
    expect(cronHasEntry(after1, "/p")).toBe(true);
    const already = cronHasEntry(after1, "/p");
    expect(already).toBe(true);
  });

  it("generic Scheduler: wake after dormant re-arms cleanly", async () => {
    const loaded = new Set<string>();
    const s = new LaunchdScheduler(501, { loadedSet: loaded });
    await s.wake("svc", "/tmp/p.plist");
    await expect(s.isArmed("svc")).resolves.toBe(true);
    await s.dormant("svc");
    await expect(s.isArmed("svc")).resolves.toBe(false);
    await s.wake("svc", "/tmp/p.plist");
    await expect(s.isArmed("svc")).resolves.toBe(true);
  });
});

describe("createScheduler factory (platform selection)", () => {
  it("darwin → LaunchdScheduler", () => {
    const s = createScheduler("darwin", { uid: 501 });
    expect(s instanceof LaunchdScheduler).toBe(true);
  });

  it("linux → CronScheduler", () => {
    const s = createScheduler("linux", {
      uid: 0,
      projectPath: "/p",
      cronCommands: {
        loopCmd: "loop",
        loopMinute: 5,
        dreamCmd: "dream",
        dreamMinute: 2,
        dreamHour: 3,
        projectPath: "/p",
      },
    });
    expect(s instanceof CronScheduler).toBe(true);
  });

  it("non-darwin platforms all map to CronScheduler", () => {
    for (const platform of ["linux", "win32", "freebsd", "sunos", "aix"] as NodeJS.Platform[]) {
      const s = createScheduler(platform, { uid: 0, projectPath: "/p" });
      expect(s instanceof CronScheduler).toBe(true);
    }
  });
});

describe("Scheduler interface conformance — contract tests", () => {
  function contract(scheduler: Scheduler, label: string): void {
    it(`${label}: dormant removes armed state`, async () => {
      await scheduler.wake("test", "/tmp/t.plist");
      await expect(scheduler.isArmed("test")).resolves.toBe(true);
      await scheduler.dormant("test");
      await expect(scheduler.isArmed("test")).resolves.toBe(false);
    });

    it(`${label}: wake arms the service`, async () => {
      await scheduler.wake("test", "/tmp/t.plist");
      await expect(scheduler.isArmed("test")).resolves.toBe(true);
    });

    it(`${label}: wake is idempotent (AC4)`, async () => {
      const r1 = await scheduler.wake("idem", "/tmp/i.plist");
      const r2 = await scheduler.wake("idem", "/tmp/i.plist");
      expect(r1).toBe(true);
      expect(r2).toBe(true);
      await expect(scheduler.isArmed("idem")).resolves.toBe(true);
    });

    it(`${label}: dormant of unarmed service is a no-op success`, async () => {
      const r = await scheduler.dormant("never-armed");
      expect(r).toBe(true);
    });

    it(`${label}: isArmed returns false for unknown service`, async () => {
      await expect(scheduler.isArmed("never-armed")).resolves.toBe(false);
    });
  }

  contract(new LaunchdScheduler(501, { loadedSet: new Set<string>() }), "LaunchdScheduler");
});
