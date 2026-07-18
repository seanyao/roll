import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";
import { SystemChromeLauncher } from "../../src/browser-operations/managed-chrome-adapter.js";
import { captureControlledLocalPage, type ControlledPage } from "../../src/controlled-local-window-capture.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("FIX-1440 real controlled React preparation", () => {
  it("renders checked state before the isolated physical-capture request and leaves Chrome alive after detach", async () => {
    if (process.env.ROLL_BROWSER_LIVE !== "1") {
      throw new Error("Live controlled-capture gate UNAVAILABLE — set ROLL_BROWSER_LIVE=1 on a desktop Chrome host.");
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
    const debuggingPort = await reserveLoopbackPort();
    const temporaryRoot = await mkdtemp(join(tmpdir(), "roll-fix-1440-project-"));
    const targetUrl = `http://127.0.0.1:${address.port}/`;
    let discovered: ControlledPage | undefined;
    let physicalRequestObserved = false;
    try {
      const result = await captureControlledLocalPage({
        projectRoot: temporaryRoot,
        url: targetUrl,
        prepare: [{ kind: "click", selector: "#synthetic-checkbox" }],
        request: {
          protocol: "roll.capture.v1",
          requestId: "fix-1440-live-synthetic",
          storyId: "FIX-1440",
          runId: "live-synthetic",
          kind: "web",
          out: join(temporaryRoot, ".roll", "features", "capture-tool", "FIX-1440", "screenshots", "live.png"),
          timeoutMs: 5_000,
          createdAt: "2026-07-18T00:00:00.000Z",
        },
      }, {
        chrome: new SystemChromeLauncher(),
        fs: { mkdtemp, rm },
        ports: { allocate: async () => debuggingPort },
        pages: {
          find: async ({ endpoint, expectedUrl }) => {
            const response = await fetch(`${endpoint}/json/list`);
            if (!response.ok) return null;
            const targets = await response.json() as unknown[];
            const target = targets.find((candidate): candidate is { type: string; url: string; webSocketDebuggerUrl: string } =>
              typeof candidate === "object" && candidate !== null &&
              (candidate as { type?: unknown }).type === "page" &&
              (candidate as { url?: unknown }).url === expectedUrl &&
              typeof (candidate as { webSocketDebuggerUrl?: unknown }).webSocketDebuggerUrl === "string",
            );
            if (target === undefined) return null;
            discovered = { url: target.url, webSocketDebuggerUrl: target.webSocketDebuggerUrl };
            return discovered;
          },
        },
        wrappers: {
          open: async () => {
            const title = "Roll Capture FIX-1440 live-synthetic";
            const wrapper = createServer((_request, response) => {
              response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
              response.end(`<!doctype html><title>${title}</title><iframe src="${targetUrl}" style="width:100%;height:100%;border:0"></iframe>`);
            });
            const wrapperAddress = await listenLoopback(wrapper);
            return {
              url: `http://127.0.0.1:${wrapperAddress.port}/`,
              windowTitle: title,
              close: async () => { await closeServer(wrapper); },
            };
          },
        },
        prepare: {
          run: async (input) => {
            const module = await import("../../src/controlled-local-window-capture.js");
            await module.runPlaywrightControlledPrepareActions(input);
          },
        },
        provider: {
          writeRequest: async () => {
            if (discovered === undefined) throw new Error("Live controlled-capture gate did not discover its disposable page.");
            const endpoint = new URL(discovered.webSocketDebuggerUrl);
            const browser = await chromium.connectOverCDP(`http://${endpoint.host}`);
            try {
              const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url() === discovered.url);
              if (page === undefined) throw new Error("Live controlled-capture gate lost its disposable page after Playwright detach.");
              const targetFrame = page.frames().find((frame) => frame.url() === targetUrl);
              if (targetFrame === undefined) throw new Error("Live controlled-capture gate lost its exact original target frame.");
              expect(await targetFrame.locator("#synthetic-checkbox").isChecked()).toBe(true);
              expect(await targetFrame.locator("#synthetic-result").textContent()).toBe("React state: selected");
              const health = await fetch(`http://${endpoint.host}/json/version`);
              expect(health.status).toBe(200);
              physicalRequestObserved = true;
            } finally {
              await browser.close();
            }
          },
          readResponse: async () => null,
          waitForResponse: async (request) => ({
            status: "taken" as const,
            path: request.out,
            response: {
              protocol: "roll.capture.v1" as const,
              requestId: request.requestId,
              status: "taken" as const,
              screenshotPath: request.out,
              responsePath: join(temporaryRoot, "response.json"),
              host: { appName: "Roll Capture.app", bundleId: "com.seanyao.roll.capture", version: "test" },
              startedAt: "2026-07-18T00:00:01.000Z",
              finishedAt: "2026-07-18T00:00:02.000Z",
            },
          }),
        },
        sleep: async (ms) => { await new Promise<void>((resolve) => setTimeout(resolve, ms)); },
      });

      if (result.status !== "taken") throw new Error(`Live controlled-capture gate failed: ${result.reason ?? result.status}`);
      expect(physicalRequestObserved).toBe(true);
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

async function reserveLoopbackPort(): Promise<number> {
  const server = createNetServer();
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") return reject(new Error("Live controlled-capture gate could not reserve debugging port."));
      server.close((error) => error === undefined ? resolve(address.port) : reject(error));
    });
  });
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
}
