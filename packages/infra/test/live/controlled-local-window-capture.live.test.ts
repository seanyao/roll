import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { captureControlledLocalPage } from "../../src/controlled-local-window-capture.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("FIX-1440 real controlled React preparation", () => {
  it("captures a default-wrapper physical receipt for a checked synthetic React control", async () => {
    if (process.env.ROLL_BROWSER_LIVE !== "1") {
      throw new Error("Live controlled-capture gate UNAVAILABLE — set ROLL_BROWSER_LIVE=1 on a desktop Chrome host.");
    }
    if (process.env.ROLL_CAPTURE_PHYSICAL !== "1") {
      throw new Error("Live physical-capture gate UNAVAILABLE — set ROLL_CAPTURE_PHYSICAL=1 after starting Roll Capture.app.");
    }

    const bundle = await build({
      absWorkingDir: PACKAGE_ROOT,
      bundle: true,
      format: "iife",
      platform: "browser",
      write: false,
      stdin: {
        resolveDir: PACKAGE_ROOT,
        sourcefile: "synthetic-react-controlled-input.tsx",
        contents: [
          'import React, { useState } from "react";',
          'import { createRoot } from "react-dom/client";',
          "function App() {",
          "  const [selected, setSelected] = useState(false);",
          "  return React.createElement('main', null,",
          "    React.createElement('label', null, React.createElement('input', { id: 'synthetic-checkbox', type: 'checkbox', checked: selected, onChange: (event) => setSelected(event.currentTarget.checked) }), ' synthetic choice'),",
          "    selected ? React.createElement('output', { id: 'synthetic-result' }, 'React state: selected') : null,",
          "  );",
          "}",
          "createRoot(document.getElementById('root')).render(React.createElement(App));",
        ].join("\n"),
      },
    });
    const script = bundle.outputFiles[0]?.text;
    if (script === undefined) throw new Error("Live controlled-capture gate could not bundle synthetic React page.");
    const server = createServer((request, response) => {
      if (request.url === "/app.js") {
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        response.end(script);
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end('<!doctype html><title>FIX-1440 synthetic React</title><div id="root"></div><script src="/app.js"></script>');
    });
    const address = await listenLoopback(server);
    const temporaryRoot = await mkdtemp(join(tmpdir(), "roll-fix-1440-project-"));
    const targetUrl = `http://127.0.0.1:${address.port}/`;
    const requestId = `fix-1440-live-synthetic-${randomUUID()}`;
    try {
      const result = await captureControlledLocalPage({
        projectRoot: temporaryRoot,
        url: targetUrl,
        prepare: [{ kind: "click", selector: "#synthetic-checkbox" }],
        request: {
          protocol: "roll.capture.v1",
          requestId,
          storyId: "FIX-1440",
          runId: "live-synthetic",
          kind: "web",
          out: join(temporaryRoot, ".roll", "features", "capture-tool", "FIX-1440", "screenshots", "live.png"),
          timeoutMs: 15_000,
          createdAt: "2026-07-18T00:00:00.000Z",
        },
      });

      if (result.status !== "taken") throw new Error(`Live controlled-capture gate failed: ${result.reason ?? result.status}`);
      expect(result.path).toBe(join(temporaryRoot, ".roll", "features", "capture-tool", "FIX-1440", "screenshots", "live.png"));
      expect(result.response?.host.appName).toBe("Roll Capture.app");
      expect(result.response?.host.version).not.toBe("test");
      expect(result.response?.responsePath).toBeTruthy();
      expect((await stat(result.path)).size).toBeGreaterThan(0);
      const screenshot = await readFile(result.path);
      const receiptPath = result.response?.responsePath;
      if (receiptPath === undefined) throw new Error("Live physical-capture gate did not return a receipt path.");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as { requestId?: unknown; status?: unknown; screenshotPath?: unknown };
      expect(receipt.requestId).toBe(requestId);
      expect(receipt.status).toBe("taken");
      expect(receipt.screenshotPath).toBe(result.path);
      const evidence = {
        evidence: "FIX-1440 physical default-wrapper receipt",
        screenshotSha256: createHash("sha256").update(screenshot).digest("hex"),
      };
      const evidenceDirectory = process.env.ROLL_CAPTURE_EVIDENCE_DIR;
      if (evidenceDirectory !== undefined) {
        await mkdir(evidenceDirectory, { recursive: true });
        await copyFile(result.path, join(evidenceDirectory, "roll-capture-react-controlled-local-synthetic.png"));
        await writeFile(join(evidenceDirectory, "receipt-sanitized.json"), JSON.stringify({
          protocol: result.response?.protocol,
          requestId: result.response?.requestId,
          status: result.response?.status,
          screenshotPath: "roll-capture-react-controlled-local-synthetic.png",
          host: result.response?.host,
          ...evidence,
        }, null, 2) + "\n", "utf8");
      }
      console.info(JSON.stringify(evidence));
    } finally {
      await closeServer(server);
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

async function listenLoopback(server: ReturnType<typeof createServer>): Promise<{ port: number }> {
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") return reject(new Error("Live controlled-capture gate could not bind loopback target."));
      resolve({ port: address.port });
    });
  });
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
}
