import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { repoRoot } from "../src/bridge.js";
import { dreamCommand } from "../src/commands/dream.js";

async function capture(fn: () => number | Promise<number>): Promise<{ code: number; stdout: string; stderr: string }> {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // @ts-expect-error capture-only
  process.stdout.write = (c: string | Uint8Array): boolean => (outChunks.push(String(c)), true);
  // @ts-expect-error capture-only
  process.stderr.write = (c: string | Uint8Array): boolean => (errChunks.push(String(c)), true);
  try {
    return { code: await fn(), stdout: outChunks.join(""), stderr: errChunks.join("") };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
}

describe("roll dream command wrapper", () => {
  afterEach(() => {
    delete process.env["NO_COLOR"];
  });

  it("delegates run-once to the v3 dream heart with remaining args", async () => {
    const seen: string[][] = [];
    const code = await dreamCommand(["run-once", "--x"], (args) => {
      seen.push(args);
      return 7;
    });
    expect(code).toBe(7);
    expect(seen).toEqual([["--x"]]);
  });

  it("freezes v2 unknown-command output for bare dream, without bash fallback", async () => {
    const r = await capture(() => dreamCommand([]));
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("[roll] Unknown command: dream\n");
    expect(r.stdout).toMatchInlineSnapshot(`
      "
        roll · autonomous delivery for software teams                                           v3.606.3  
        自主交付，人只做三件事：提需求、审核、发版

        usage  roll <command> [options]

      ────────────────────────────────────────────────────────────────────────────────────────────────────

        AUTONOMY  ·  日常使用                                                                ★ = most used

        loop ★  <on|off|now|status|…>  manage the autonomous BACKLOG executor
                管理自主执行循环
        brief ★      show latest owner brief
                 查看最新简报
        backlog ★  [block|defer|…]  view and manage pending tasks
                   查看和管理待处理任务
        peer        cross-agent negotiation & review
                跨 Agent 协商对审
        alert        view and clear loop alerts
                 查看 / 清除 loop 告警
        feedback    --type bug|idea|ux …  open a GitHub issue for this project
                    为本项目提交反馈

      ────────────────────────────────────────────────────────────────────────────────────────────────────

        PROJECT  ·  项目内                                                           per-repo setup and CI

        init        create AGENTS.md + .roll/backlog.md + .roll/features/
                初始化项目工作流文件
        status        show current state and drift
                  显示当前状态和漂移项
        agent    [use <name>]  per-project agent selection
                 切换项目 agent
        ci    [--wait]  show or wait for current commit's CI status
              查看 / 等待 CI 状态
        release        run the release script (human-only)
                   执行发版脚本（仅人工）
        review-pr    <number>  AI-powered code review for a PR
                     AI 代码评审
        slides    build <slug>  render a deck.md to HTML and open in browser
                  渲染 deck.md 为 HTML 并打开

      ────────────────────────────────────────────────────────────────────────────────────────────────────

        MACHINE  ·  全局                                                         install, upgrade, version

        setup    [-f]  first-time install or re-sync
                 首次安装或重新同步
        update        upgrade to latest + re-sync
                  升级到最新版并重新同步
        version        print installed roll version
                   显示已安装版本

      ────────────────────────────────────────────────────────────────────────────────────────────────────

        examples

        roll loop on  启用自主执行循环
        roll brief  查看最新简报
        roll backlog defer US-DOC '过早引入'  推迟一类任务
        roll agent use kimi  切换当前项目到 kimi

        docs: github.com/seanyao/roll  ·  issues: github.com/seanyao/roll/issues
      "
    `);
  });

  it.each([["--help"], ["anything"]])("keeps v2 command-level unknown behavior for dream %s", async (arg) => {
    const bare = await capture(() => dreamCommand([]));
    const r = await capture(() => dreamCommand([arg]));
    expect(r).toEqual(bare);
  });

  it("removes the dream bash fallback from the ported registry", () => {
    const src = readFileSync(`${repoRoot()}/packages/cli/src/commands/index.ts`, "utf8");
    expect(src).not.toContain('fallbackToBash(["dream"');
  });
});
