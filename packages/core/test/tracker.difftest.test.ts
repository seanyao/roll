/**
 * diff-test: @roll/core CostTracker adapters vs the frozen python oracle
 * `lib/agent_usage/` (openai/gemini/kimi/qwen `extract`, pi `extract` stub,
 * pi/kimi `_sum_session_file`/`_sum_wire_file`).
 *
 * The fixtures are derived from each adapter's own docstring-documented
 * recognised formats. We spawn a python driver that imports the adapter module
 * (loading model_prices alongside it) and prints the extracted dict as JSON,
 * then value-compare to the TS extractor. Cost is compared with tolerance
 * because both sides round to 4 dp through the shared price table.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractUsage,
  geminiExtract,
  kimiExtract,
  openaiExtract,
  piExtract,
  qwenExtract,
  sumKimiWire,
  sumPiSession,
  type Extractor,
} from "../src/index.js";

const REPO = resolve(__dirname, "../../..");
const AU = `${REPO}/lib/agent_usage`;

/** Spawn python: load lib/agent_usage/<agent>.py and print extract(lines) as JSON. */
function pyExtract(agent: string, lines: string[]): Record<string, unknown> | null {
  const py = [
    "import sys, json, importlib.util, os",
    // ensure `import model_prices` inside the adapter resolves (it inserts lib/ itself,
    // but be explicit for the spec-loaded module form).
    `sys.path.insert(0, '${REPO}/lib')`,
    `spec = importlib.util.spec_from_file_location('agent_usage_${agent}', '${AU}/${agent}.py')`,
    "mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)",
    "lines = json.loads(sys.stdin.read())",
    "r = mod.extract(lines)",
    "print(json.dumps(r))",
  ].join("\n");
  const out = execFileSync("python3", ["-c", py], {
    encoding: "utf8",
    input: JSON.stringify(lines),
  }).trim();
  return JSON.parse(out) as Record<string, unknown> | null;
}

/** Spawn python: load adapter and print _sum_session_file / _sum_wire_file over a temp file. */
function pySum(agent: "pi" | "kimi", fn: string, lines: string[]): Record<string, unknown> | null {
  const py = [
    "import sys, json, importlib.util, tempfile, os",
    `sys.path.insert(0, '${REPO}/lib')`,
    `spec = importlib.util.spec_from_file_location('agent_usage_${agent}', '${AU}/${agent}.py')`,
    "mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)",
    "lines = json.loads(sys.stdin.read())",
    "f = tempfile.NamedTemporaryFile('w', suffix='.jsonl', delete=False)",
    "f.write('\\n'.join(lines)); f.close()",
    `r = mod.${fn}(f.name)`,
    "os.unlink(f.name)",
    "print(json.dumps(r))",
  ].join("\n");
  const out = execFileSync("python3", ["-c", py], {
    encoding: "utf8",
    input: JSON.stringify(lines),
  }).trim();
  return JSON.parse(out) as Record<string, unknown> | null;
}

/** Compare a TS usage object to the python dict, with cost tolerance. */
function expectUsageEqual(ts: Record<string, unknown> | null, py: Record<string, unknown> | null) {
  if (py === null) {
    expect(ts).toBeNull();
    return;
  }
  expect(ts).not.toBeNull();
  const t = ts as Record<string, unknown>;
  expect(t["model"]).toBe(py["model"]);
  expect(t["input_tokens"]).toBe(py["input_tokens"]);
  expect(t["output_tokens"]).toBe(py["output_tokens"]);
  if (py["cost_list_usd"] !== undefined) {
    expect(t["cost_list_usd"] as number).toBeCloseTo(py["cost_list_usd"] as number, 6);
  }
}

// Fixtures from each stdout-scrape adapter's docstring.
const STDOUT_FIXTURES: { agent: string; ex: Extractor; lines: string[] }[] = [
  {
    agent: "openai",
    ex: openaiExtract,
    lines: ["Model: gpt-4o", "Token usage: total=18420 input=15300 output=3120"],
  },
  {
    agent: "openai",
    ex: openaiExtract,
    // total-only path → input gets the whole total.
    lines: ["tokens used: 12,345"],
  },
  {
    agent: "openai",
    ex: openaiExtract,
    // alternate split + model line.
    lines: ["input tokens: 15300", "output tokens: 3120", "model: o3-mini"],
  },
  {
    agent: "gemini",
    ex: geminiExtract,
    lines: ["Model: gemini-2.5-pro", "Tokens: input=15300 output=3120"],
  },
  {
    agent: "gemini",
    ex: geminiExtract,
    lines: ["Input tokens:  15,300", "Output tokens:  3,120", "Total tokens:  18,420", "model: gemini-2.5-flash"],
  },
  {
    agent: "kimi",
    ex: kimiExtract,
    lines: ["Model: kimi-k2", "Tokens: input=15300 output=3120"],
  },
  {
    agent: "qwen",
    ex: qwenExtract,
    lines: ["Model: qwen-coder-plus", "Tokens: input=15300 output=3120"],
  },
  {
    agent: "qwen",
    ex: qwenExtract,
    lines: ["Input tokens:  15,300", "Output tokens:  3,120", "Total tokens:  18,420", "model: qwen-max"],
  },
  // explicit cost line — skips the price-table fallback.
  {
    agent: "openai",
    ex: openaiExtract,
    lines: ["Model: gpt-4o", "input=100 output=50", "cost: $0.0123 USD"],
  },
  // unrecognised (no token figure) → None.
  { agent: "openai", ex: openaiExtract, lines: ["hello, world", "nothing useful here"] },
  // empty input → None.
  { agent: "gemini", ex: geminiExtract, lines: [] },
];

describe("diff-test: stdout-scrape extractors == python adapters", () => {
  for (let i = 0; i < STDOUT_FIXTURES.length; i++) {
    const f = STDOUT_FIXTURES[i] as (typeof STDOUT_FIXTURES)[number];
    it(`${f.agent} #${i}: ${JSON.stringify(f.lines).slice(0, 50)}`, () => {
      const py = pyExtract(f.agent, f.lines);
      const ts = f.ex(f.lines) as Record<string, unknown> | null;
      expectUsageEqual(ts, py);
    });
  }

  it("pi extract stub returns None on both sides", () => {
    const py = pyExtract("pi", ["anything", "pi text mode answer"]);
    expect(py).toBeNull();
    expect(piExtract(["anything", "pi text mode answer"])).toBeNull();
  });

  it("extractUsage validates required fields like extract_usage", () => {
    // unknown agent → null
    expect(extractUsage("nope", ["input=1 output=1"])).toBeNull();
    // valid openai
    const u = extractUsage("openai", ["Model: gpt-4o", "input=10 output=5"]);
    expect(u).not.toBeNull();
    expect(u?.model).toBe("gpt-4o");
  });
});

// Session-file fixtures derived from pi.py / kimi.py docstrings.
const PI_SESSION = [
  JSON.stringify({ type: "session", cwd: "/tmp/wt" }),
  JSON.stringify({
    type: "message",
    message: {
      role: "assistant",
      model: "deepseek-v4-pro",
      usage: { input: 1200, output: 340, cacheRead: 800, cacheWrite: 60, cost: { total: 0.42 } },
    },
  }),
  JSON.stringify({
    type: "message",
    message: {
      role: "assistant",
      usage: { input: 300, output: 90, cacheRead: 100, cacheWrite: 0, cost: { total: 0.1 } },
    },
  }),
  // a non-assistant message + a malformed line — both ignored.
  JSON.stringify({ type: "message", message: { role: "user", usage: { input: 9999 } } }),
  "{ not json",
];

const KIMI_WIRE = [
  JSON.stringify({
    type: "usage.record",
    model: "kimi-code/kimi-for-coding",
    usage: { inputOther: 5000, output: 1200, inputCacheRead: 2000, inputCacheCreation: 300 },
    usageScope: "turn",
  }),
  JSON.stringify({
    type: "usage.record",
    usage: { inputOther: 1000, output: 200, inputCacheRead: 0, inputCacheCreation: 50 },
  }),
  JSON.stringify({ type: "something.else", usage: { inputOther: 9999 } }),
  "garbage",
];

describe("diff-test: session summers == python _sum_*", () => {
  it("pi _sum_session_file token sum + model + cost_reported", () => {
    const py = pySum("pi", "_sum_session_file", PI_SESSION);
    const ts = sumPiSession(PI_SESSION);
    expect(ts).not.toBeNull();
    expect(py).not.toBeNull();
    const p = py as Record<string, unknown>;
    expect(ts?.model).toBe(p["model"]);
    expect(ts?.input_tokens).toBe(p["input_tokens"]);
    expect(ts?.output_tokens).toBe(p["output_tokens"]);
    expect(ts?.cache_creation_tokens).toBe(p["cache_creation_tokens"]);
    expect(ts?.cache_read_tokens).toBe(p["cache_read_tokens"]);
    expect(ts?.cost_reported as number).toBeCloseTo(p["cost_reported"] as number, 6);
  });

  it("kimi _sum_wire_file token sum + model", () => {
    const py = pySum("kimi", "_sum_wire_file", KIMI_WIRE);
    const ts = sumKimiWire(KIMI_WIRE);
    expect(ts).not.toBeNull();
    expect(py).not.toBeNull();
    const p = py as Record<string, unknown>;
    expect(ts?.model).toBe(p["model"]);
    expect(ts?.input_tokens).toBe(p["input_tokens"]);
    expect(ts?.output_tokens).toBe(p["output_tokens"]);
    expect(ts?.cache_creation_tokens).toBe(p["cache_creation_tokens"]);
    expect(ts?.cache_read_tokens).toBe(p["cache_read_tokens"]);
  });

  it("no usage → None on both sides", () => {
    const lines = [JSON.stringify({ type: "session", cwd: "/x" }), "nope"];
    expect(sumPiSession(lines)).toBeNull();
    expect(pySum("pi", "_sum_session_file", lines)).toBeNull();
  });
});
