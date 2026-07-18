import { describe, expect, it, vi } from "vitest";
import {
  captureControlledLocalPage,
  captureControlledLocalWindow,
  runControlledPrepareActions,
  type ControlledLocalPageCaptureDeps,
  type ControlledLocalWindowCaptureDeps,
  type ControlledPrepareAction,
} from "../src/controlled-local-window-capture.js";
import { chromeLaunchArgs } from "../src/browser-operations/managed-chrome-adapter.js";

const request = {
  protocol: "roll.capture.v1" as const,
  requestId: "fix-005-request",
  storyId: "FIX-005",
  runId: "local",
  kind: "web" as const,
  out: "/project/.roll/features/capture-tool/FIX-005/screenshots/controlled.png",
  timeoutMs: 5_000,
  createdAt: "2026-07-18T00:00:00.000Z",
};

function dependencies(overrides: Partial<ControlledLocalWindowCaptureDeps> = {}): ControlledLocalWindowCaptureDeps {
  return {
    chrome: {
      launch: vi.fn(async () => ({ pid: 7722, kill: vi.fn(async () => undefined) })),
    },
    fs: {
      mkdtemp: vi.fn(async () => "/tmp/roll-controlled-window-fixture"),
      rm: vi.fn(async () => undefined),
    },
    ports: { allocate: vi.fn(async () => 9333) },
    pages: {
      find: vi.fn(async () => ({
        url: "http://127.0.0.1:4173/team",
        webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/page/fix-005",
      })),
    },
    prepare: { run: vi.fn(async () => undefined) },
    provider: {
      writeRequest: vi.fn(async () => undefined),
      readResponse: vi.fn(async () => null),
      waitForResponse: vi.fn(async (physicalRequest) => ({
        status: "taken" as const,
        path: physicalRequest.out,
        response: {
          protocol: "roll.capture.v1" as const,
          requestId: physicalRequest.requestId,
          status: "taken" as const,
          screenshotPath: physicalRequest.out,
          responsePath: "/tmp/response.json",
          host: { appName: "Roll Capture.app", bundleId: "com.seanyao.roll.capture", version: "0.3.3" },
          startedAt: "2026-07-18T00:00:01.000Z",
          finishedAt: "2026-07-18T00:00:02.000Z",
        },
      })),
    },
    sleep: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("FIX-005 controlled local window capture", () => {
  it("waits for the loopback React frame and runs only fixed click, wait, and scroll operations", async () => {
    let frameTreeCalls = 0;
    const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") {
        frameTreeCalls += 1;
        return frameTreeCalls === 1
          ? { frameTree: { frame: { id: "wrapper", url: "http://127.0.0.1:4888/" } } }
          : { frameTree: { frame: { id: "wrapper", url: "http://127.0.0.1:4888/" }, childFrames: [{ frame: { id: "react", url: "http://127.0.0.1:4173/" } }] } };
      }
      if (method === "Page.createIsolatedWorld") return { executionContextId: 17 };
      if (method === "Runtime.evaluate") return {};
      return {};
    });
    const close = vi.fn(async () => undefined);
    const sleep = vi.fn(async () => undefined);

    await runControlledPrepareActions({
      page: { url: "http://127.0.0.1:4888/", webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/page/controlled" },
      targetUrl: "http://127.0.0.1:4173/",
      actions: [
        { kind: "click", selector: "#synthetic-checkbox" },
        { kind: "wait", ms: 125 },
        { kind: "scroll", selector: "#synthetic-result" },
      ],
    }, { connect: vi.fn(async () => ({ send, close })), sleep });

    expect(sleep).toHaveBeenCalledWith(100);
    expect(sleep).toHaveBeenCalledWith(125);
    expect(send).toHaveBeenCalledWith("Page.createIsolatedWorld", { frameId: "react", grantUniveralAccess: false });
    const expressions = send.mock.calls.filter(([method]) => method === "Runtime.evaluate").map(([, params]) => String((params as { expression: string }).expression));
    expect(expressions).toEqual(expect.arrayContaining([expect.stringContaining("#synthetic-checkbox"), expect.stringContaining("#synthetic-result")]));
    expect(expressions.join("\n")).not.toContain("document.cookie");
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects a navigation that replaces the prepared frame even when another loopback frame remains", async () => {
    let frameTreeCalls = 0;
    const send = vi.fn(async (method: string) => {
      if (method === "Page.getFrameTree") {
        frameTreeCalls += 1;
        return frameTreeCalls === 1
          ? { frameTree: { frame: { id: "wrapper", url: "http://127.0.0.1:4888/" }, childFrames: [{ frame: { id: "react", url: "http://127.0.0.1:4173/" } }] } }
          : { frameTree: { frame: { id: "wrapper", url: "http://127.0.0.1:4888/" }, childFrames: [{ frame: { id: "react", url: "https://example.test/" } }, { frame: { id: "other-local", url: "http://127.0.0.1:4173/" } }] } };
      }
      if (method === "Page.createIsolatedWorld") return { executionContextId: 17 };
      return {};
    });

    await expect(runControlledPrepareActions({
      page: { url: "http://127.0.0.1:4888/", webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/page/controlled" },
      targetUrl: "http://127.0.0.1:4173/",
      actions: [{ kind: "click", selector: "#synthetic-checkbox" }],
    }, { connect: vi.fn(async () => ({ send, close: vi.fn(async () => undefined) })), sleep: vi.fn(async () => undefined) })).rejects.toThrow("left the original loopback origin");
  });

  it("keeps ordinary managed Chrome headless and makes only the dedicated capture process visible", () => {
    const headless = chromeLaunchArgs({ profileDir: "/tmp/default", remoteDebuggingPort: 9222 });
    const visible = chromeLaunchArgs({
      profileDir: "/tmp/capture",
      remoteDebuggingPort: 9333,
      visibility: "visible",
      initialUrl: "http://127.0.0.1:4173/team",
    });

    expect(headless).toContain("--headless=new");
    expect(headless).toContain("about:blank");
    expect(visible).not.toContain("--headless=new");
    expect(visible).toContain("--app=http://127.0.0.1:4173/team");
    expect(visible).toContain("--user-data-dir=/tmp/capture");
    expect(visible).toContain("--disable-extensions");
  });

  it("rejects a non-loopback URL before Chrome or Roll Capture can touch it", async () => {
    const deps = dependencies();

    const result = await captureControlledLocalWindow({
      projectRoot: "/project",
      url: "https://example.com/team",
      windowTitle: "Roll Capture FIX-005 nonce-unique",
      request,
    }, deps);

    expect(result).toMatchObject({ status: "failed", reason: expect.stringContaining("loopback") });
    expect(deps.chrome.launch).not.toHaveBeenCalled();
    expect(deps.provider.writeRequest).not.toHaveBeenCalled();
  });

  it("refuses a non-nonce window title before Chrome or Roll Capture can touch it", async () => {
    const deps = dependencies();

    const result = await captureControlledLocalWindow({
      projectRoot: "/project",
      url: "http://127.0.0.1:4173/team",
      windowTitle: "团队管理",
      request,
    }, deps);

    expect(result).toMatchObject({ status: "failed", reason: expect.stringContaining("nonce-bearing") });
    expect(deps.chrome.launch).not.toHaveBeenCalled();
    expect(deps.provider.writeRequest).not.toHaveBeenCalled();
  });

  it("uses one visible isolated Chrome window, a nonce title, and cleans it after a physical receipt", async () => {
    const deps = dependencies();

    const result = await captureControlledLocalWindow({
      projectRoot: "/project",
      url: "http://127.0.0.1:4173/team",
      windowTitle: "Roll Capture FIX-005 nonce-unique",
      request,
    }, deps);

    expect(result).toMatchObject({
      status: "taken",
      selector: { appName: "Google Chrome", windowTitle: "Roll Capture FIX-005 nonce-unique" },
    });
    expect(deps.chrome.launch).toHaveBeenCalledWith({
      profileDir: "/tmp/roll-controlled-window-fixture/profile",
      remoteDebuggingPort: 9333,
      visibility: "visible",
      initialUrl: "http://127.0.0.1:4173/team",
    });
    expect(deps.pages.find).toHaveBeenCalledWith({
      endpoint: "http://127.0.0.1:9333",
      expectedUrl: "http://127.0.0.1:4173/team",
    });
    expect(deps.provider.writeRequest).toHaveBeenCalledWith(expect.objectContaining({
      target: { type: "window", appName: "Google Chrome", windowTitle: "Roll Capture FIX-005 nonce-unique" },
    }));
    expect(deps.sleep).toHaveBeenCalledWith(3_000);
    expect(deps.fs.rm).toHaveBeenCalledWith("/tmp/roll-controlled-window-fixture", { recursive: true, force: true });
  });

  it("does not issue a physical request when the isolated page cannot be discovered", async () => {
    const pages = {
      find: vi.fn(async () => null),
    };
    const deps = dependencies({ pages });

    const result = await captureControlledLocalWindow({
      projectRoot: "/project",
      url: "http://localhost:4173/team",
      windowTitle: "Roll Capture FIX-005 nonce-unique",
      request,
    }, deps);

    expect(result).toMatchObject({ status: "failed", reason: expect.stringContaining("isolated local page") });
    expect(deps.provider.writeRequest).not.toHaveBeenCalled();
    expect(deps.fs.rm).toHaveBeenCalledWith("/tmp/roll-controlled-window-fixture", { recursive: true, force: true });
  });

  it("waits through a transient local DevTools discovery failure before requesting pixels", async () => {
    const find = vi.fn()
      .mockRejectedValueOnce(new Error("Chrome is still starting"))
      .mockResolvedValueOnce({
        url: "http://127.0.0.1:4173/team",
        webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/page/fix-005",
      });
    const deps = dependencies({ pages: { find } });

    const result = await captureControlledLocalWindow({
      projectRoot: "/project",
      url: "http://127.0.0.1:4173/team",
      windowTitle: "Roll Capture FIX-005 nonce-unique",
      request,
    }, deps);

    expect(result.status).toBe("taken");
    expect(find).toHaveBeenCalledTimes(2);
    expect(deps.provider.writeRequest).toHaveBeenCalledOnce();
  });

  it("runs an explicit closed-vocabulary prepare list against the isolated local page before requesting pixels", async () => {
    const actions: readonly ControlledPrepareAction[] = [
      { kind: "click", selector: "#synthetic-checkbox" },
      { kind: "wait", ms: 200 },
      { kind: "scroll", selector: "#synthetic-result" },
    ];
    const run = vi.fn(async () => undefined);
    const deps = dependencies({ prepare: { run } });

    const result = await captureControlledLocalWindow({
      projectRoot: "/project",
      url: "http://127.0.0.1:4173/team",
      windowTitle: "Roll Capture FIX-1435 nonce-unique",
      prepare: actions,
      request,
    }, deps);

    expect(result.status).toBe("taken");
    expect(run).toHaveBeenCalledWith({
      page: { url: "http://127.0.0.1:4173/team", webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/page/fix-005" },
      targetUrl: "http://127.0.0.1:4173/team",
      actions,
    });
    expect(run.mock.invocationCallOrder[0]).toBeLessThan((deps.provider.writeRequest as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
  });

  it("refuses an unknown prepare action before launching Chrome or requesting pixels", async () => {
    const deps = dependencies();

    const result = await captureControlledLocalWindow({
      projectRoot: "/project",
      url: "http://127.0.0.1:4173/team",
      windowTitle: "Roll Capture FIX-1435 nonce-unique",
      prepare: [{ kind: "evaluate", expression: "document.cookie" }] as unknown as readonly ControlledPrepareAction[],
      request,
    }, deps);

    expect(result).toMatchObject({ status: "failed", reason: expect.stringContaining("prepare") });
    expect(deps.chrome.launch).not.toHaveBeenCalled();
    expect(deps.provider.writeRequest).not.toHaveBeenCalled();
  });

  it("never requests pixels when a controlled prepare action fails", async () => {
    const deps = dependencies({ prepare: { run: vi.fn(async () => { throw new Error("selector not found"); }) } });

    const result = await captureControlledLocalWindow({
      projectRoot: "/project",
      url: "http://127.0.0.1:4173/team",
      windowTitle: "Roll Capture FIX-1435 nonce-unique",
      prepare: [{ kind: "click", selector: "#missing" }],
      request,
    }, deps);

    expect(result).toMatchObject({ status: "failed", reason: expect.stringContaining("selector not found") });
    expect(deps.provider.writeRequest).not.toHaveBeenCalled();
  });

  it("rejects password fills and aborts before any Roll Capture request", async () => {
    const send = vi.fn(async (method: string) => {
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "synthetic-page", url: "http://127.0.0.1:4173/team" } } };
      }
      if (method === "Page.createIsolatedWorld") return { executionContextId: 17 };
      if (method === "Runtime.evaluate") {
        return { exceptionDetails: { text: "prepare does not fill password fields" } };
      }
      return {};
    });
    const deps = dependencies({
      prepare: {
        run: (input) => runControlledPrepareActions(input, {
          connect: vi.fn(async () => ({ send, close: vi.fn(async () => undefined) })),
          sleep: vi.fn(async () => undefined),
        }),
      },
    });

    const result = await captureControlledLocalWindow({
      projectRoot: "/project",
      url: "http://127.0.0.1:4173/team",
      windowTitle: "Roll Capture FIX-1435 nonce-unique",
      prepare: [{ kind: "fill", selector: "#synthetic-password", value: "not-a-real-secret" }],
      request,
    }, deps);

    expect(result).toMatchObject({ status: "failed", reason: expect.stringContaining("password fields") });
    const evaluation = send.mock.calls.find(([method]) => method === "Runtime.evaluate")?.[1] as { expression?: string } | undefined;
    expect(evaluation?.expression).toContain('element.type.toLowerCase() === "password"');
    expect(deps.provider.writeRequest).not.toHaveBeenCalled();
  });

  it("wraps a loopback page in its own nonce-titled window and closes that wrapper after capture", async () => {
    const close = vi.fn(async () => undefined);
    const open = vi.fn(async () => ({
      url: "http://127.0.0.1:4888/",
      windowTitle: "Roll Capture FIX-005 generated-nonce",
      close,
    }));
    const deps: ControlledLocalPageCaptureDeps = { ...dependencies(), wrappers: { open } };

    const result = await captureControlledLocalPage({
      projectRoot: "/project",
      url: "http://localhost:4173/team",
      request,
    }, deps);

    expect(result).toMatchObject({ status: "taken", selector: { windowTitle: "Roll Capture FIX-005 generated-nonce" } });
    expect(open).toHaveBeenCalledWith({ url: "http://localhost:4173/team", storyId: "FIX-005" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps the original loopback frame as the only prepare target when capture uses a nonce wrapper", async () => {
    const close = vi.fn(async () => undefined);
    const open = vi.fn(async () => ({
      url: "http://127.0.0.1:4888/",
      windowTitle: "Roll Capture FIX-1435 generated-nonce",
      close,
    }));
    const run = vi.fn(async () => undefined);
    const deps: ControlledLocalPageCaptureDeps = { ...dependencies({ prepare: { run } }), wrappers: { open } };

    const result = await captureControlledLocalPage({
      projectRoot: "/project",
      url: "http://localhost:4173/team",
      prepare: [{ kind: "click", selector: "#synthetic-checkbox" }],
      request,
    }, deps);

    expect(result.status).toBe("taken");
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      targetUrl: "http://localhost:4173/team",
      actions: [{ kind: "click", selector: "#synthetic-checkbox" }],
    }));
  });
});
