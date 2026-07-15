import { EvidenceClassifier } from "@roll/core";
import { describe, expect, it } from "vitest";
import {
  McpDiagnosticFacade,
  type DiagnosticArtifactWriter,
  type McpDiagnosticToolCaller,
} from "../src/browser-operations/mcp-diagnostic-facade.js";

class FakeCaller implements McpDiagnosticToolCaller {
  readonly calls: Array<{ tool: string; input: Record<string, unknown> }> = [];
  result: unknown = {};

  async call(tool: string, input: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ tool, input });
    return this.result;
  }
}

class MemoryWriter implements DiagnosticArtifactWriter {
  readonly writes: Array<{ bytes: Buffer }> = [];
  fail = false;

  async write(input: { bytes: Buffer }): Promise<void> {
    if (this.fail) throw new Error("disk unavailable");
    this.writes.push({ bytes: input.bytes });
  }
}

function createFacade(
  caller = new FakeCaller(),
  writer = new MemoryWriter(),
  redactor?: (text: string) => string,
) {
  return { caller, writer, facade: new McpDiagnosticFacade({ caller, writer, randomId: () => "diag-1", redactor }) };
}

describe("US-BROW-017 McpDiagnosticFacade", () => {
  it("maps the eight typed actions to exact manifest tools and rejects arbitrary input before invocation", async () => {
    const { facade, caller } = createFacade();

    for (const action of ["navigate", "snapshot", "console", "network", "screenshot", "click", "fill", "press_key"]) {
      await facade.execute({ action, payload: {} });
    }
    const denied = await facade.execute({ action: "chrome_devtools_call", payload: {} });

    expect(caller.calls.map((call) => call.tool)).toEqual([
      "navigate_page", "take_snapshot", "list_console_messages", "list_network_requests",
      "take_screenshot", "click", "fill", "press_key",
    ]);
    expect(denied).toMatchObject({ status: "denied", denial: { code: "action_not_allowed" } });
    expect(caller.calls).toHaveLength(8);
  });

  it("normalizes and redacts bounded console and network summaries before writing diagnostic-only artifacts", async () => {
    const { facade, caller, writer } = createFacade();
    caller.result = [
      { level: "error", text: "Authorization: Bearer secret-value", source: "app", object: { password: "nope" } },
    ];
    const consoleResult = await facade.execute({ action: "console", payload: {} });
    caller.result = [
      { method: "POST", url: "https://api.example.test/orders?token=nope", status: 201, duration: 12, responseBody: "secret" },
    ];
    const networkResult = await facade.execute({ action: "network", payload: {} });

    expect(consoleResult.diagnosticRefs[0]).toMatchObject({ kind: "console-summary", untrusted: true, diagnosticOnly: true });
    expect(networkResult.diagnosticRefs[0]).toMatchObject({ kind: "network-summary", untrusted: true, diagnosticOnly: true });
    const stored = writer.writes.map((write) => write.bytes.toString("utf8")).join("\n");
    expect(stored).toContain("[REDACTED]");
    expect(stored).not.toContain("secret-value");
    expect(stored).not.toContain("responseBody");
    expect(stored).toContain('"origin":"https://api.example.test"');
  });

  it("drops an artifact with a classified failure when redaction or writing fails", async () => {
    const { facade, caller, writer } = createFacade();
    caller.result = [{ text: "x".repeat(10_000) }];
    const capped = await facade.execute({ action: "console", payload: {} });
    writer.fail = true;
    const dropped = await facade.execute({ action: "network", payload: {} });

    expect(capped.diagnosticRefs[0]?.bytes).toBeLessThanOrEqual(4 * 1024);
    expect(dropped).toMatchObject({ status: "failed", failure: "artifact_write_failed", diagnosticRefs: [] });
    expect(writer.writes).toHaveLength(1);

    const redactionFailure = createFacade(new FakeCaller(), new MemoryWriter(), () => {
      throw new Error("redactor offline");
    });
    redactionFailure.caller.result = [{ text: "secret" }];
    await expect(redactionFailure.facade.execute({ action: "console", payload: {} })).resolves.toMatchObject({
      status: "failed",
      failure: "redaction_failed",
      diagnosticRefs: [],
    });
  });

  it("never lets a facade screenshot artifact satisfy a visual acceptance criterion", async () => {
    const { facade, caller } = createFacade();
    caller.result = { data: Buffer.from("pixels").toString("base64") };
    const result = await facade.execute({ action: "screenshot", payload: {} });
    const classification = new EvidenceClassifier().classify({
      artifactId: result.diagnosticRefs[0]!.artifactId,
      provider: "chrome-devtools-mcp",
      isBrowserDiagnostic: true,
      diagnosticKind: result.diagnosticRefs[0]!.kind,
    });

    expect(classification.canSatisfyVisualAc).toBe(false);
  });
});
