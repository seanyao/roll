import type {
  ToolCost,
  ToolDeclaration,
  ToolDeps,
  ToolError,
  ToolEvent,
  ToolId,
  ToolInvocation,
  ToolMeta,
  ToolPolicy,
  ToolResult,
} from "@roll/spec";

export interface Tool<I = unknown, O = unknown> {
  readonly declaration: ToolDeclaration;
  init(deps: ToolDeps): Promise<void>;
  execute(invocation: ToolInvocation<I>, deps: ToolDeps): Promise<ToolResult<O>>;
  dispose(deps: ToolDeps): Promise<void>;
}

export interface ToolRegistryPolicyEngine {
  resolve(toolId: ToolId, defaults: ToolDeclaration["defaults"]): Promise<ToolPolicy> | ToolPolicy;
}

export interface ToolRegistryEventSink {
  emit(event: ToolEvent): Promise<void> | void;
}

export interface ToolInvokeRequest<I = unknown> {
  invocationId: string;
  input: I;
  caller: ToolInvocation<I>["caller"];
}

export interface ToolRegistryOptions {
  deps: ToolDeps;
  policyEngine: ToolRegistryPolicyEngine;
  events?: ToolRegistryEventSink;
  currency?: string;
}

type ToolState = {
  tool: Tool<unknown, unknown>;
  initPromise?: Promise<void>;
  initialized: boolean;
  disposed: boolean;
};

function error(code: ToolError["code"], message: string, retryable = false, detail?: unknown): ToolError {
  return { code, message, retryable, detail };
}

function meta(toolId: ToolId, request: ToolInvokeRequest, startedAt: number, endedAt: number, attempt?: number): ToolMeta {
  return {
    invocationId: request.invocationId,
    toolId,
    caller: request.caller,
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    attempt,
  };
}

function failed(toolId: ToolId, request: ToolInvokeRequest, err: ToolError, startedAt: number, endedAt = startedAt): ToolResult<never> {
  return { ok: false, error: err, meta: meta(toolId, request, startedAt, endedAt) };
}

function jsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    return 0;
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ToolRegistry {
  private readonly tools = new Map<ToolId, ToolState>();
  private readonly budgetCounts = new Map<ToolId, number>();
  private readonly costs = new Map<ToolId, ToolCost>();
  private shutdownStarted = false;

  constructor(private readonly options: ToolRegistryOptions) {}

  register(tool: Tool<unknown, unknown>): void {
    if (this.tools.has(tool.declaration.id)) return;
    this.tools.set(tool.declaration.id, {
      tool,
      initialized: false,
      disposed: false,
    });
  }

  async invoke<I = unknown, O = unknown>(toolId: ToolId, request: ToolInvokeRequest<I>): Promise<ToolResult<O>> {
    const startedAt = this.options.deps.now();
    const state = this.tools.get(toolId);
    if (state === undefined) {
      return failed(toolId, request, error("not_found", `tool not found: ${toolId}`), startedAt) as ToolResult<O>;
    }

    const initResult = await this.ensureInitialized(state);
    if (!initResult.ok) {
      return failed(toolId, request, initResult.error, startedAt, this.options.deps.now()) as ToolResult<O>;
    }

    let policy: ToolPolicy;
    try {
      policy = await this.options.policyEngine.resolve(toolId, state.tool.declaration.defaults);
    } catch (cause) {
      return failed(toolId, request, error("policy_denied", "tool policy resolution failed", false, cause), startedAt, this.options.deps.now()) as ToolResult<O>;
    }

    if (!policy.enabled) {
      return failed(toolId, request, error("policy_denied", `tool disabled by policy: ${toolId}`), startedAt, this.options.deps.now()) as ToolResult<O>;
    }

    if (!this.reserveBudget(toolId, policy)) {
      return failed(toolId, request, error("budget_exhausted", `tool invocation budget exhausted: ${toolId}`), startedAt, this.options.deps.now()) as ToolResult<O>;
    }

    const invocation: ToolInvocation<I> = {
      invocationId: request.invocationId,
      toolId,
      input: request.input,
      caller: request.caller,
      policy,
      ts: startedAt,
    };

    await this.emit({
      type: "tool:invoke",
      cycleId: request.caller.cycleId,
      invocation,
      declaration: state.tool.declaration,
      ts: startedAt,
    });

    const result = await this.executeWithRetry<I, O>(state.tool, invocation, request, policy);
    await this.emit({
      type: "tool:result",
      cycleId: request.caller.cycleId,
      invocationId: request.invocationId,
      toolId,
      result,
      ts: this.options.deps.now(),
    });
    this.accumulateCost(toolId, request.input, result);
    return result;
  }

  snapshotCosts(): ToolCost[] {
    return [...this.costs.values()].map((cost) => ({ ...cost }));
  }

  async shutdown(): Promise<void> {
    if (this.shutdownStarted) return;
    this.shutdownStarted = true;
    await Promise.all(
      [...this.tools.values()].map(async (state) => {
        if (!state.initialized || state.disposed) return;
        try {
          await state.tool.dispose(this.options.deps);
        } catch {
          // ToolRegistry never throws; dispose failures are best-effort cleanup.
        } finally {
          state.disposed = true;
        }
      }),
    );
  }

  private async ensureInitialized(state: ToolState): Promise<{ ok: true } | { ok: false; error: ToolError }> {
    if (state.initialized) return { ok: true };
    if (state.initPromise === undefined) {
      state.initPromise = state.tool
        .init(this.options.deps)
        .then(() => {
          state.initialized = true;
        })
        .finally(() => {
          state.initPromise = undefined;
        });
    }
    try {
      await state.initPromise;
      return { ok: true };
    } catch (cause) {
      return { ok: false, error: error("init_failed", "tool init failed", true, cause) };
    }
  }

  private reserveBudget(toolId: ToolId, policy: ToolPolicy): boolean {
    const max = policy.maxInvocationsPerCycle;
    if (max === undefined) return true;
    const current = this.budgetCounts.get(toolId) ?? 0;
    if (current >= max) return false;
    this.budgetCounts.set(toolId, current + 1);
    return true;
  }

  private async executeWithRetry<I, O>(
    tool: Tool<unknown, unknown>,
    invocation: ToolInvocation<I>,
    request: ToolInvokeRequest<I>,
    policy: ToolPolicy,
  ): Promise<ToolResult<O>> {
    const attempts = Math.max(1, policy.retry?.attempts ?? 1);
    const backoffMs = policy.retry?.backoffMs ?? 0;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const attemptStartedAt = this.options.deps.now();
      try {
        return (await tool.execute(invocation, this.options.deps)) as ToolResult<O>;
      } catch (cause) {
        lastError = cause;
        if (attempt < attempts) await delay(backoffMs);
        else {
          return failed(
            invocation.toolId,
            request,
            error("adapter_error", "tool adapter threw", attempt < attempts, lastError),
            attemptStartedAt,
            this.options.deps.now(),
          ) as ToolResult<O>;
        }
      }
    }
    return failed(invocation.toolId, request, error("adapter_error", "tool adapter failed", false, lastError), this.options.deps.now()) as ToolResult<O>;
  }

  private async emit(event: ToolEvent): Promise<void> {
    try {
      await this.options.events?.emit(event);
    } catch {
      // Event emission must not make tool invocation throw.
    }
  }

  private accumulateCost(toolId: ToolId, input: unknown, result: ToolResult<unknown>): void {
    const current = this.costs.get(toolId) ?? {
      toolId,
      invocations: 0,
      estimatedCost: 0,
      currency: this.options.currency ?? "USD",
      inputBytes: 0,
      outputBytes: 0,
    };
    const output = result.ok ? result.output : result.error;
    this.costs.set(toolId, {
      ...current,
      invocations: current.invocations + 1,
      inputBytes: (current.inputBytes ?? 0) + jsonBytes(input),
      outputBytes: (current.outputBytes ?? 0) + jsonBytes(output),
    });
  }
}
