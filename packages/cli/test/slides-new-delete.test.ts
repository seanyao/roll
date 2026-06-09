/**
 * US-PORT-016 — `roll slides new` (TS-launched agent) + `roll slides delete`
 * (native TS interactive confirm). Both used to fall back to bash; now neither
 * does. Injected deps keep the agent unspawned and the confirm fd-free.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type SlidesNewDeps,
  cmdDelete,
  cmdNew,
  composeNewPrompt,
  slidesTextArgv,
  topicSlug,
} from "../src/commands/slides/index.js";
import { stripAnsi } from "../src/render.js";

let cwd0: string;
let dir: string;
const savedEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string): void {
  if (!(k in savedEnv)) savedEnv[k] = process.env[k];
  process.env[k] = v;
}
beforeEach(() => {
  cwd0 = process.cwd();
  dir = mkdtempSync(join(tmpdir(), "slides-pt16-"));
  process.chdir(dir);
  setEnv("ROLL_LANG", "en");
  setEnv("NO_COLOR", "1");
});
afterEach(() => {
  process.chdir(cwd0);
  rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
});

function capture(fn: () => number): { status: number; out: string; err: string } {
  const o: string[] = [];
  const e: string[] = [];
  const wo = process.stdout.write.bind(process.stdout);
  const we = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((x: string | Uint8Array) => (o.push(String(x)), true)) as typeof process.stdout.write;
  process.stderr.write = ((x: string | Uint8Array) => (e.push(String(x)), true)) as typeof process.stderr.write;
  try {
    const status = fn();
    return { status, out: stripAnsi(o.join("")), err: stripAnsi(e.join("")) };
  } finally {
    process.stdout.write = wo;
    process.stderr.write = we;
  }
}

describe("slides pure helpers — US-PORT-016", () => {
  it("topicSlug lowercases, collapses non-alnum to single dash, trims", () => {
    expect(topicSlug("Hello, World!")).toBe("hello-world");
    expect(topicSlug("  AI & ML 2026  ")).toBe("ai-ml-2026");
    expect(topicSlug("!!!")).toBe("");
  });

  it("slidesTextArgv maps known agents (text mode), null for unknown", () => {
    expect(slidesTextArgv("claude", "P")).toEqual({
      bin: "claude",
      args: ["-p", "--output-format", "text", "P"],
    });
    expect(slidesTextArgv("pi", "P")).toEqual({ bin: "pi", args: ["-p", "P"] });
    expect(slidesTextArgv("codex", "P")).toEqual({ bin: "codex", args: ["exec", "P"] });
    expect(slidesTextArgv("nope", "P")).toBeNull();
  });

  it("composeNewPrompt embeds skill body + topic/slug/template + target file", () => {
    const p = composeNewPrompt("SKILL_BODY_HERE", "My Topic", "my-topic", "introduction-v3");
    expect(p).toContain("SKILL_BODY_HERE");
    expect(p).toContain("topic: My Topic");
    expect(p).toContain("slug: my-topic");
    expect(p).toContain("template: introduction-v3");
    expect(p).toContain("target_file: .roll/slides/my-topic/deck.md");
  });
});

describe("slides new — US-PORT-016 (TS launch)", () => {
  function deps(over: Partial<SlidesNewDeps> = {}): { deps: SlidesNewDeps; calls: string[] } {
    const calls: string[] = [];
    const base: SlidesNewDeps = {
      agent: () => "claude",
      skillBody: () => "ROLL-DECK SKILL BODY",
      spawn: (bin, args) => {
        calls.push(`spawn:${bin} ${args.join(" ")}`);
        // simulate the agent authoring the deck
        const slugDir = join(".roll", "slides", "my-deck");
        mkdirSync(slugDir, { recursive: true });
        writeFileSync(join(slugDir, "deck.md"), "# deck\n");
        return 0;
      },
      build: (slug) => (calls.push(`build:${slug}`), 0),
      ...over,
    };
    return { deps: base, calls };
  }

  it("happy path: resolves agent, spawns, then builds; deck dir created", () => {
    const { deps: d, calls } = deps();
    const r = capture(() => cmdNew(["My Deck"], d));
    expect(r.status).toBe(0);
    expect(existsSync(join(".roll", "slides", "my-deck", "deck.md"))).toBe(true);
    expect(calls.some((c) => c.startsWith("spawn:claude -p --output-format text"))).toBe(true);
    expect(calls).toContain("build:my-deck");
  });

  it("--no-build authors deck then prints the Next hint, no build", () => {
    const { deps: d, calls } = deps();
    const r = capture(() => cmdNew(["My Deck", "--no-build"], d));
    expect(r.status).toBe(0);
    expect(calls.some((c) => c.startsWith("build:"))).toBe(false);
    expect(r.out).toContain("roll slides build my-deck");
  });

  it("missing topic → usage, exit 1, no spawn", () => {
    const { deps: d, calls } = deps();
    const r = capture(() => cmdNew([], d));
    expect(r.status).toBe(1);
    expect(r.err).toContain("Usage: roll slides new");
    expect(calls).toHaveLength(0);
  });

  it("empty skill body → err, exit 1, no spawn", () => {
    const { deps: d, calls } = deps({ skillBody: () => null });
    const r = capture(() => cmdNew(["My Deck"], d));
    expect(r.status).toBe(1);
    expect(r.err).toContain("roll-deck");
    expect(calls).toHaveLength(0);
  });

  it("unknown agent → err naming the agent, exit 1, no spawn", () => {
    const { deps: d, calls } = deps({ agent: () => "nope" });
    const r = capture(() => cmdNew(["My Deck"], d));
    expect(r.status).toBe(1);
    expect(r.err).toContain("Unknown agent 'nope'");
    expect(calls).toHaveLength(0);
  });

  it("agent non-zero exit → surfaces the code, no build", () => {
    const { deps: d, calls } = deps({ spawn: () => 3 });
    const r = capture(() => cmdNew(["My Deck"], d));
    expect(r.status).toBe(3);
    expect(calls.some((c) => c.startsWith("build:"))).toBe(false);
  });

  it("--template overrides the deck template in the prompt", () => {
    let seenArgs: string[] = [];
    const { deps: d } = deps({
      spawn: (_b, args) => {
        seenArgs = args;
        mkdirSync(join(".roll", "slides", "my-deck"), { recursive: true });
        writeFileSync(join(".roll", "slides", "my-deck", "deck.md"), "x");
        return 0;
      },
    });
    capture(() => cmdNew(["My Deck", "--template", "dark-v2", "--no-build"], d));
    expect(seenArgs.join(" ")).toContain("template: dark-v2");
  });
});

describe("slides delete — US-PORT-016 (native TS confirm)", () => {
  let ttyDesc: PropertyDescriptor | undefined;
  beforeEach(() => {
    ttyDesc = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });
  afterEach(() => {
    if (ttyDesc) Object.defineProperty(process.stdin, "isTTY", ttyDesc);
  });

  function seedDeck(slug: string): void {
    const d = join(".roll", "slides", slug);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "deck.md"), "# x\n");
    writeFileSync(join(".roll", "slides", `${slug}.html`), "<html>");
  }

  it("confirm yes → removes deck dir + html", () => {
    seedDeck("doomed");
    const r = capture(() => cmdDelete(["doomed"], () => true));
    expect(r.status).toBe(0);
    expect(existsSync(join(".roll", "slides", "doomed"))).toBe(false);
    expect(existsSync(join(".roll", "slides", "doomed.html"))).toBe(false);
    expect(r.out).toContain("Deleted doomed");
  });

  it("confirm no → cancelled, deck preserved", () => {
    seedDeck("keep");
    const r = capture(() => cmdDelete(["keep"], () => false));
    expect(r.status).toBe(0);
    expect(existsSync(join(".roll", "slides", "keep", "deck.md"))).toBe(true);
    expect(r.out).toContain("Cancelled");
  });

  it("the prompt is passed to the confirm callback", () => {
    seedDeck("ask");
    let prompt = "";
    capture(() => cmdDelete(["ask"], (p) => ((prompt = p), false)));
    expect(prompt).toContain("ask");
  });
});
