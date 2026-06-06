/**
 * US-PORT-012 — `roll loop fmt` CLI: line buffering across chunk boundaries,
 * colour decision, and end-to-end formatting of a stream-json sample.
 */
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { decideColor, loopFmtCommand, StreamFmtPipe } from "../src/commands/loop-fmt.js";

const j = (o: unknown): string => JSON.stringify(o);

describe("StreamFmtPipe — line buffering", () => {
  it("emits only on complete lines; a straddling JSON object waits for its newline", () => {
    const pipe = new StreamFmtPipe({ color: false });
    const line = j({ type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "roll-build", args: "US-PORT-012" } }] } });
    const half = line.slice(0, 30);
    const rest = `${line.slice(30)}\n`;
    expect(pipe.push(half)).toEqual([]); // no newline yet → nothing
    const out = pipe.push(rest);
    expect(out.some((l) => l.includes("US-PORT-012"))).toBe(true);
  });

  it("a torn final line at EOF is tolerated by flush (no throw)", () => {
    const pipe = new StreamFmtPipe({ color: false });
    expect(pipe.push('{"type":"assi')).toEqual([]);
    expect(() => pipe.flush()).not.toThrow();
    expect(pipe.flush()).toEqual([]); // already drained
  });

  it("multiple lines in one chunk all render", () => {
    const pipe = new StreamFmtPipe({ color: false });
    const chunk = ["[loop] cycle 3: go", "[loop] cycle 4: go", ""].join("\n");
    const out = pipe.push(chunk);
    expect(out.length).toBe(2);
    expect(out[0]).toContain("cycle #3");
    expect(out[1]).toContain("cycle #4");
  });
});

describe("decideColor", () => {
  it("--no-color wins over everything", () => {
    expect(decideColor(["--no-color"], { NO_COLOR: "" }, true)).toBe(false);
  });
  it("--color forces colour even off a TTY", () => {
    expect(decideColor(["--color"], {}, false)).toBe(true);
  });
  it("NO_COLOR env disables colour", () => {
    expect(decideColor([], { NO_COLOR: "1" }, true)).toBe(false);
  });
  it("defaults to the TTY state", () => {
    expect(decideColor([], {}, true)).toBe(true);
    expect(decideColor([], {}, false)).toBe(false);
  });
});

describe("loopFmtCommand — end to end", () => {
  it("reads stream-json from stdin and writes the three-tier transcript", async () => {
    const lines = [
      j({ type: "system", subtype: "init" }),
      j({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/a" } }] } }),
      j({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "git commit -m 'tcr: do x'" } }] } }),
      j({ type: "user", message: { content: [{ type: "tool_result", content: "[loop/y bbbbbbb] tcr: do x" }] } }),
      j({ type: "result", subtype: "success", duration_ms: 1000, total_cost_usd: 0 }),
    ];
    const stdin = Readable.from([`${lines.join("\n")}\n`]);
    const written: string[] = [];
    const code = await loopFmtCommand([], {
      stdin: () => stdin,
      write: (s) => written.push(s),
      env: {},
      isTTY: () => false,
    });
    expect(code).toBe(0);
    const all = written.join("");
    // suppressed: system + Read tool produce nothing
    expect(all).not.toContain("init");
    // signal: the tcr commit surfaces with the shared TCR label
    expect(all).toContain("TCR bbbbbbb · tcr: do x");
    // outline: a cycle-done stamp with the tcr count
    expect(all).toMatch(/done · 1 tcr/);
  });
});
