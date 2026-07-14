/**
 * US-BROW-004c — Managed-lane CLI orchestration + operator-observable result.
 *
 * Wires the US-BROW-004a run service and the US-BROW-004b managed Chrome adapter
 * against a US-BROW-004c fake-target fixture, producing a readable diagnostic
 * result an operator can observe end-to-end (CLI → run service → adapter →
 * terminal result) with NO real Chrome.
 *
 * Honesty contract (scorer_focus):
 *  - The managed lane always runs in a temporary profile — owner state can never
 *    enter it, so this surface never proves a logged-in / visual acceptance.
 *  - DevTools screenshots are diagnostic-only artifacts. Diagnostic *success* is
 *    never conflated with visual acceptance; the rendered result says so
 *    explicitly.
 */
import { BrowserOperationRunService } from "@roll/core";
import { ManagedChromeAdapter, createManagedFixtureDeps, type ManagedFixtureFailure } from "@roll/infra";
import type {
  BrowserActionKind,
  BrowserActionResult,
  BrowserLanePolicy,
  PerformanceDiagnosticSummary,
} from "@roll/spec";

/** Actions the managed fixture surface accepts (closed subset of the vocabulary). */
export const MANAGED_FIXTURE_ACTIONS: readonly BrowserActionKind[] = [
  "navigate",
  "snapshot",
  "console",
  "network",
  "screenshot",
];

export interface ManagedFixtureRunOptions {
  action: BrowserActionKind;
  /** The fake target URL (never a real site). */
  targetUrl: string;
  /** DOM selector for a `snapshot` action. */
  selector?: string;
  /** Simulate a redirect to this URL (used to prove redirect denial pass-through). */
  redirectTo?: string;
  /** Inject a categorized diagnostic failure to prove classification pass-through. */
  failure?: ManagedFixtureFailure;
  /** Per-run timeout; defaults small for injected timeouts, 5s otherwise. */
  timeoutMs?: number;
  /** Optional device emulation profile name (US-BROW-014). */
  deviceProfile?: string;
  /** Optional performance diagnostic profile name (US-BROW-012, opt-in). */
  performanceProfile?: string;
  /** Make the performance profile collection fail (proves graceful degradation). */
  performanceFailure?: boolean;
}

/** The operator-observable outcome of a managed fixture run. */
export interface ManagedRunReport {
  lane: "managed";
  action: BrowserActionKind;
  targetUrl: string;
  /** Terminal run state from the aggregate: passed | failed | denied | expired. */
  runState: string;
  /** Terminal diagnostic result: pass | fail | skipped | denied. */
  result: "pass" | "fail" | "skipped" | "denied";
  /** The action-level status returned by the adapter. */
  actionStatus: BrowserActionResult["status"];
  /** Whether the temporary profile reached its terminal "removed" state. */
  profileRemoved: boolean;
  /** Number of diagnostic-only artifacts produced (never visual AC evidence). */
  diagnosticArtifacts: number;
  /** Categorized diagnostic failures (empty on a clean pass). */
  failures: { category: string; message: string }[];
  /** Redacted, operator-safe one-line summary from the adapter. */
  summary: string;
  /** The device profile applied, if any (US-BROW-014). */
  deviceProfile?: string;
  /** The performance profile requested, if any (US-BROW-012). */
  performanceProfile?: string;
  /** The bounded, redacted performance summary, when collected (US-BROW-012). */
  performanceSummary?: PerformanceDiagnosticSummary;
  /** Structured denial when the profile was disabled by policy or unknown. */
  performanceDenied?: string;
}

const DEFAULT_MANAGED_POLICY = (targetUrl: string, performanceDiagnostics: boolean): BrowserLanePolicy => ({
  enabled: true,
  allowedOrigins: [originOf(targetUrl)],
  allowedActions: [...MANAGED_FIXTURE_ACTIONS],
  maxRunsPerCycle: 5,
  timeoutMs: 5_000,
  // Opt-in: the operator selecting a performance profile flips this policy gate
  // on. Without a selected profile the diagnostic surface stays disabled.
  performanceDiagnostics,
});

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/**
 * Run one managed browser operation against the fake-target fixture and return a
 * structured, operator-observable report.
 */
export async function runManagedFixtureOperation(options: ManagedFixtureRunOptions): Promise<ManagedRunReport> {
  const timeoutMs = options.timeoutMs ?? (options.failure === "timeout" ? 30 : 5_000);
  const lanePolicy = DEFAULT_MANAGED_POLICY(options.targetUrl, options.performanceProfile !== undefined);

  const runService = BrowserOperationRunService.create({
    runId: "fixture-run",
    idempotencyKey: "fixture-key",
    caller: "builder",
    lane: "managed",
    requestedOrigin: options.targetUrl,
    holderTokenHash: "fixture-token-hash",
    now: () => "2026-07-15T00:00:00.000Z",
  });

  const { deps } = createManagedFixtureDeps({
    targetUrl: options.targetUrl,
    redirectTo: options.redirectTo,
    domNodes: options.selector ? [`text for ${options.selector}`] : undefined,
    failure: options.failure,
    performanceFailure: options.performanceFailure,
  });
  const adapter = new ManagedChromeAdapter(deps);

  const { service, result, performance } = await adapter.execute({
    runService,
    lanePolicy,
    action: options.action,
    payload: buildPayload(options),
    timeoutMs,
    deviceProfile: options.deviceProfile,
    performanceProfile: options.performanceProfile,
  });

  const terminal = service.terminalResult();
  return {
    lane: "managed",
    action: options.action,
    targetUrl: options.targetUrl,
    runState: service.run.state,
    result: service.run.result,
    actionStatus: result.status,
    profileRemoved: service.isProfileRemoved(),
    diagnosticArtifacts: result.diagnosticRefs.length,
    failures:
      terminal?.kind === "fail"
        ? terminal.failures.map((f) => ({ category: f.category, message: f.message }))
        : service.diagnosticFailures.map((f) => ({ category: f.category, message: f.message })),
    summary: result.redactedSummary,
    deviceProfile: options.deviceProfile,
    performanceProfile: options.performanceProfile,
    performanceSummary: performance?.summary,
    performanceDenied: performance?.denial ? `${performance.denial.code}: ${performance.denial.message}` : undefined,
  };
}

function buildPayload(options: ManagedFixtureRunOptions): Record<string, string | number | boolean> {
  switch (options.action) {
    case "navigate":
      return { url: options.targetUrl };
    case "snapshot":
      return { selector: options.selector ?? "body" };
    default:
      return {};
  }
}

/**
 * Render a managed run report as operator-observable terminal lines. This is the
 * text a physical-terminal screenshot captures for attest evidence — concise,
 * and explicit that diagnostic success is not visual acceptance.
 */
export function renderManagedRunReport(report: ManagedRunReport): string[] {
  const lines: string[] = [
    "Managed browser operation — fixture (fake target)",
    "受管浏览器操作 — fixture（假目标）",
    "",
    `  lane / 通道:            ${report.lane}`,
    `  action / 动作:          ${report.action}`,
    `  target / 目标:          ${report.targetUrl}`,
    `  run state / 运行状态:   ${report.runState}`,
    `  result / 结果:          ${report.result} (action: ${report.actionStatus})`,
    `  temp profile / 临时档案: ${report.profileRemoved ? "removed" : "NOT removed"} (owner state never entered / 绝不进入 owner 状态)`,
    `  diagnostics / 诊断产物:  ${report.diagnosticArtifacts} (diagnostic-only, NOT visual acceptance / 仅诊断，非视觉验收)`,
  ];

  if (report.failures.length > 0) {
    lines.push("  failures / 失败分类:");
    for (const failure of report.failures) {
      lines.push(`    - ${failure.category}: ${failure.message}`);
    }
  }

  if (report.deviceProfile !== undefined) {
    lines.push(`  device profile / 设备仿真: ${report.deviceProfile}`);
  }

  if (report.performanceProfile !== undefined) {
    lines.push(`  perf profile / 性能诊断: ${report.performanceProfile} (opt-in, diagnostic-only / 需选启，仅诊断)`);
    if (report.performanceDenied !== undefined) {
      lines.push(`    denied / 已拒绝: ${report.performanceDenied}`);
    } else if (report.performanceSummary !== undefined) {
      const s = report.performanceSummary;
      if (s.degraded) {
        lines.push("    result / 结果: degraded — no signal collected (action verdict unchanged) / 降级——未采到信号（动作结论不变）");
      } else {
        lines.push(`    metrics / 指标 (${s.metrics.length}, bounded & redacted / 有界脱敏):`);
        for (const m of s.metrics) {
          lines.push(`      - ${m.name}: ${m.value}`);
        }
      }
    }
  }

  lines.push(`  summary / 摘要:         ${report.summary}`);
  lines.push("");
  lines.push("  Diagnostic success is not visual acceptance evidence.");
  lines.push("  诊断通过不等于视觉验收证据。");
  lines.push("");
  return lines;
}
