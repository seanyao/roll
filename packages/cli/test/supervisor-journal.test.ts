import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { supervisorJournalCommand } from "../src/commands/supervisor-journal.js";

function makeProject(): string {
  const dir = join(tmpdir(), `roll-supervisor-journal-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, ".roll", "loop"), { recursive: true });
  return dir;
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function eventsText(dir: string): string {
  return readFileSync(join(dir, ".roll", "loop", "events.ndjson"), "utf8");
}

describe("supervisor journal command", () => {
  it("lists empty journal state", () => {
    const project = makeProject();
    try {
      const code = supervisorJournalCommand(["journal", "list"], project);
      expect(code).toBe(0);
    } finally {
      cleanup(project);
    }
  });

  it("records a journal event and appends to events.ndjson", () => {
    const project = makeProject();
    try {
      const code = supervisorJournalCommand(
        ["journal", "record", "--action", "rescue", "--story", "US-OBS-048", "--note", "rerouted after auth block"],
        project,
      );
      expect(code).toBe(0);
      expect(existsSync(join(project, ".roll", "loop", "events.ndjson"))).toBe(true);
      const lines = eventsText(project).trim().split("\n");
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0] ?? "{}") as { type: string; action: string; storyId: string; actor: string };
      expect(parsed.type).toBe("supervisor:journal");
      expect(parsed.action).toBe("rescue");
      expect(parsed.storyId).toBe("US-OBS-048");
      expect(parsed.actor).not.toBe("");
    } finally {
      cleanup(project);
    }
  });

  it("rejects an invalid action", () => {
    const project = makeProject();
    try {
      const code = supervisorJournalCommand(["journal", "record", "--action", "dance"], project);
      expect(code).toBe(1);
      expect(existsSync(join(project, ".roll", "loop", "events.ndjson"))).toBe(false);
    } finally {
      cleanup(project);
    }
  });

  it("records --json emits the event verbatim", () => {
    const project = makeProject();
    try {
      const code = supervisorJournalCommand(
        ["journal", "record", "--action", "verify", "--story", "US-A", "--json"],
        project,
      );
      expect(code).toBe(0);
      const lines = eventsText(project).trim().split("\n");
      const parsed = JSON.parse(lines[0] ?? "{}") as { type: string; action: string; storyId: string };
      expect(parsed.type).toBe("supervisor:journal");
      expect(parsed.action).toBe("verify");
    } finally {
      cleanup(project);
    }
  });

  it("lists filters by story and limits", () => {
    const project = makeProject();
    try {
      supervisorJournalCommand(["journal", "record", "--action", "decide", "--story", "US-A"], project);
      supervisorJournalCommand(["journal", "record", "--action", "decide", "--story", "US-B"], project);
      supervisorJournalCommand(["journal", "record", "--action", "decide", "--story", "US-B"], project);

      // Story filter.
      const filtered = captureStdout(() => supervisorJournalCommand(["journal", "list", "--story", "US-B"], project));
      expect(filtered).toContain("US-B");
      expect(filtered).not.toContain("US-A");

      // Limit.
      const limited = captureStdout(() => supervisorJournalCommand(["journal", "list", "--limit", "2"], project));
      const rows = limited.split("\n").filter((l) => l.includes("·") && l.includes("decide"));
      expect(rows).toHaveLength(2);
    } finally {
      cleanup(project);
    }
  });
});

function captureStdout(fn: () => number): string {
  const chunks: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  // @ts-expect-error capture-only override
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = realWrite;
  }
  return chunks.join("");
}
