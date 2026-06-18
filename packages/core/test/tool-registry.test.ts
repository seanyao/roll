import type {
  MinimalFs,
  ToolDeclaration,
  ToolDeps,
  ToolId,
  ToolInvocation,
  ToolPolicy,
  ToolResult,
} from "@roll/spec";
import { describe, expect, it } from "vitest";
import { ToolRegistry, type Tool, type ToolRegistryEventSink, type ToolRegistryPolicyEngine } from "../src/index.js";

const TOOL_ID = "test.echo" as ToolId;

const declaration: ToolDeclaration = {
  id: TOOL_ID,
  kind: "bash",
  title: "Echo",
  defaults: {
    enabled: true,
    timeoutMs: 1000,
    maxInvocationsPerCycle: 10,
  },
};

function deps(): ToolDeps {
  const fs: MinimalFs = {
    readFile: async () => "",
    writeFile: async () => undefined,
    mkdir: async () => undefined,
  };
  return {
    fs,
    now: () => 100,
    execFile: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    redact: (value) => value,
  };
}

function policyEngine(policy: Partial<ToolPolicy> = {}): ToolRegistryPolicyEngine {
  return {
    resolve: async (_toolId, defaults) => ({
      enabled: defaults.enabled ?? true,
      timeoutMs: defaults.timeoutMs,
      retry: defaults.retry,
      sandbox: defaults.sandbox,
      maxInvocationsPerCycle: defaults.maxInvocationsPerCycle,
      ...policy,
    }),
  };
}

function sink(): ToolRegistryEventSink & { types: string[] } {
  return {
    types: [],
    emit(event) {
      this.types.push(event.type);
    },
  };
}

function request(input: unknown = "ok") {
  return {
    invocationId: "inv-1",
    input,
    caller: { cycleId: "cycle-1", storyId: "US-TOOL-002", agent: "codex" },
  };
}

function okResult(invocation: ToolInvocation<unknown>, output: unknown = invocation.input): ToolResult<unknown> {
  return {
    ok: true,
    output,
    meta: {
      invocationId: invocation.invocationId,
      toolId: invocation.toolId,
      caller: invocation.caller,
      startedAt: 100,
      endedAt: 101,
      durationMs: 1,
    },
  };
}

function tool(overrides: Partial<Tool<unknown, unknown>> = {}): Tool<unknown, unknown> & { initCount: number; disposeCount: number; executes: number } {
  return {
    initCount: 0,
    disposeCount: 0,
    executes: 0,
    declaration,
    async init() {
      this.initCount += 1;
    },
    async execute(invocation) {
      this.executes += 1;
      return okResult(invocation);
    },
    async dispose() {
      this.disposeCount += 1;
    },
    ...overrides,
  };
}

describe("US-TOOL-002 ToolRegistry", () => {
  it("returns not_found and never throws for an unknown tool", async () => {
    const registry = new ToolRegistry({ deps: deps(), policyEngine: policyEngine() });

    const result = await registry.invoke(TOOL_ID, request());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });

  it("register() is idempotent and invokes the registered tool through policy and events", async () => {
    const events = sink();
    const t = tool();
    const registry = new ToolRegistry({ deps: deps(), policyEngine: policyEngine(), events });

    registry.register(t);
    registry.register(t);
    const result = await registry.invoke(TOOL_ID, request("hello"));

    expect(result).toMatchObject({ ok: true, output: "hello" });
    expect(t.initCount).toBe(1);
    expect(t.executes).toBe(1);
    expect(events.types).toEqual(["tool:invoke", "tool:result"]);
  });

  it("denies disabled policy before execution", async () => {
    const t = tool();
    const registry = new ToolRegistry({ deps: deps(), policyEngine: policyEngine({ enabled: false }) });
    registry.register(t);

    const result = await registry.invoke(TOOL_ID, request());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("policy_denied");
    expect(t.executes).toBe(0);
  });

  it("enforces maxInvocationsPerCycle with an atomic check before async execution", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const t = tool({
      async execute(invocation) {
        this.executes += 1;
        await gate;
        return okResult(invocation);
      },
    });
    const registry = new ToolRegistry({
      deps: deps(),
      policyEngine: policyEngine({ maxInvocationsPerCycle: 1 }),
    });
    registry.register(t);

    const first = registry.invoke(TOOL_ID, request("a"));
    const second = registry.invoke(TOOL_ID, { ...request("b"), invocationId: "inv-2" });
    release();

    const results = await Promise.all([first, second]);

    expect(results.map((r) => (r.ok ? "ok" : r.error.code)).sort()).toEqual(["budget_exhausted", "ok"]);
    expect(t.executes).toBe(1);
  });

  it("catches adapter crashes and returns adapter_error", async () => {
    const registry = new ToolRegistry({ deps: deps(), policyEngine: policyEngine() });
    registry.register(
      tool({
        async execute() {
          throw new Error("boom");
        },
      }),
    );

    const result = await registry.invoke(TOOL_ID, request());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("adapter_error");
  });

  it("guards lazy init so concurrent invocations initialize once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const t = tool({
      async init() {
        this.initCount += 1;
        await gate;
      },
    });
    const registry = new ToolRegistry({ deps: deps(), policyEngine: policyEngine() });
    registry.register(t);

    const first = registry.invoke(TOOL_ID, request("a"));
    const second = registry.invoke(TOOL_ID, { ...request("b"), invocationId: "inv-2" });
    release();
    await Promise.all([first, second]);

    expect(t.initCount).toBe(1);
    expect(t.executes).toBe(2);
  });

  it("retries retryable adapter errors and accumulates costs", async () => {
    let calls = 0;
    const registry = new ToolRegistry({
      deps: deps(),
      policyEngine: policyEngine({ retry: { attempts: 2, backoffMs: 0 } }),
    });
    registry.register(
      tool({
        async execute(invocation) {
          calls += 1;
          if (calls === 1) throw new Error("transient");
          return okResult(invocation, "recovered");
        },
      }),
    );

    const result = await registry.invoke(TOOL_ID, request("x"));

    expect(result).toMatchObject({ ok: true, output: "recovered" });
    expect(calls).toBe(2);
    expect(registry.snapshotCosts()).toEqual([
      expect.objectContaining({ toolId: TOOL_ID, invocations: 1, currency: "USD" }),
    ]);
  });

  it("shutdown disposes initialized tools once and is idempotent", async () => {
    const t = tool();
    const registry = new ToolRegistry({ deps: deps(), policyEngine: policyEngine() });
    registry.register(t);
    await registry.invoke(TOOL_ID, request());

    await registry.shutdown();
    await registry.shutdown();

    expect(t.disposeCount).toBe(1);
  });
});
