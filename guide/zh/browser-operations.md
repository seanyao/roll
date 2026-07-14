# Roll — 浏览器操作（受管通道 + 交互通道）

Roll 可以驱动一个**受管、隔离的 Chrome（经 DevTools 传输）**来采集浏览器诊断
——导航检查、DOM 快照、控制台与网络捕获、诊断截图。它也支持对
**已打开的本地 Chrome 调试端点**执行单次、低风险的交互式 owner-Chrome 操作，
需前台 owner 批准并受严格租约控制。

两条通道都需显式开启、依赖受控、范围刻意收窄。

它们**不是**两件事：

- 它们**不是安装器**。Roll 绝不往你的产品仓 `package.json` 加依赖，也绝不擅自
  开启你自己（owner）Chrome 的远程调试。`setup` 只在你确认后写入一份机器级
  配置。
- 它们的产物**不是视觉验收证据**。受管诊断截图或交互式 owner 运行结果只能证明
  页面动作成功，不能满足故事的视觉验收（visual AC）。只有 **Roll Capture**
  （对你真实终端/应用的物理截图）才满足视觉验收——见[验收证据](acceptance-evidence.md)。

本页同时描述当前已发布的受管通道与交互通道。

## Managed

受管通道用一份**全新的临时 profile** 启动 Chrome，对白名单内目标执行一次操作，
结束后删除该 profile。owner 浏览器状态（cookie、登录态、历史）绝不进入。

### 前置条件

受管通道需要固定版本的 `chrome-devtools-mcp` 传输和一个 Chrome 可执行文件。
Roll 不会替你安装——它只报告缺什么、怎么修。先跑体检：

```bash
roll browser doctor
```

```
Browser operations doctor
浏览器操作体检

~ managed:     degraded unavailable — chrome-devtools-mcp not ready; existing Playwright and Roll Capture paths remain usable
    → roll browser setup --dry-run
    → install the missing dependency, then re-run roll browser doctor
✓ interactive: ready    owner Chrome reachable on 127.0.0.1:9222
~ capture:     degraded skipped — Roll Capture readiness probe skipped (headless / CI / ROLL_NO_SCREENCAP).
    → roll doctor --tools
    → see Roll Capture.app setup guidance
```

每条通道只报告三种诚实状态之一：

| 状态 | 含义 |
|------|------|
| `ready` | 该通道的前置条件已满足。 |
| `degraded` | 通道不可用或仅部分可用。已有的 Playwright 与 Roll Capture 路径照常工作——缺前置绝不会被报成通过。 |
| `blocked` | 存在硬性前置阻断通道运行；会打印原因与修复命令。 |

### 安装（先 dry-run）

`setup --dry-run` 展示 Roll 将要写入的机器级配置全文，并跑依赖预检。它**什么都
不写**：

```bash
roll browser setup --dry-run
```

```
Browser operations setup
浏览器操作安装

  target (machine-level, never committed): ~/.roll/browser-operations.yaml

  proposed ~/.roll/browser-operations.yaml:
    devtools:
      command: npx
      args: ["-y", "chrome-devtools-mcp@1.5.0", "--no-usage-statistics"]
      package: chrome-devtools-mcp
      package_version: 1.5.0
      chrome_channel: stable
      remote_debugging: { host: "127.0.0.1", port: 9222 }
  ...
  Roll never installs into a product package.json and never enables owner Chrome remote debugging.
  Roll 绝不改动产品仓 package.json，也绝不自动开启 owner Chrome 的远程调试。

  dry-run: no configuration was written.
```

你审阅之后才写入配置，且必须显式确认：

```bash
roll browser setup --confirm
```

没有 `--confirm`（也没有 `--dry-run`）时，`setup` 会拒绝并且什么都不写。

### 跑一次受管操作

`roll browser run` 对一个假目标执行一次受管通道操作，并打印操作者可观测的结果。
用它无需真实站点就能看清通道行为：

```bash
roll browser run --action screenshot
```

```
Managed browser operation — fixture (fake target)
受管浏览器操作 — fixture（假目标）

  lane / 通道:            managed
  action / 动作:          screenshot
  target / 目标:          https://fake.target.test
  run state / 运行状态:   passed
  result / 结果:          pass (action: ok)
  temp profile / 临时档案: removed (owner state never entered / 绝不进入 owner 状态)
  diagnostics / 诊断产物:  1 (diagnostic-only, NOT visual acceptance / 仅诊断，非视觉验收)
  summary / 摘要:         diagnostic screenshot captured at https://fake.target.test

  Diagnostic success is not visual acceptance evidence.
  诊断通过不等于视觉验收证据。
```

支持的动作：`navigate`（默认）、`snapshot`、`console`、`network`、`screenshot`。
白名单之外的目标——包括从请求 origin 跳走的重定向——会被**拒绝**，不会跟随：

```bash
roll browser run --redirect https://evil.test
# run state: denied — Origin not in allowlist
```

失败会被分类，绝不静默：`--fail timeout|crash|devtools-error` 可注入各类失败，
看通道如何报告。

### 传输更新

DevTools 传输版本是固定的。`update --check` 比较固定版本与候选版本，不下载、
不改任何东西：

```bash
roll browser update --check
```

应用更新与 setup 同样受控——需显式确认，跑冒烟检查加体检，失败时保留原版本
不动：

```bash
roll browser update --apply --confirm
```

## 交互通道

交互通道让你对自己 Chrome 中**已经打开的页面**执行单次低风险操作。它用于
手动举证（manual-attest）工作流，而非后台自动化。

### 先决条件

Roll **不会替你启动 Chrome**，也**不会开启远程调试**。你必须先自行启动带有
本地调试端点的 Chrome，再运行 `roll browser interactive`：

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/owner-chrome-profile
```

仅允许 `127.0.0.1:9222`（或其他 loopback 地址）。非 loopback 端点会被拒绝。

### 运行一次交互操作

```bash
roll browser interactive \
  --story US-EXAMPLE-001 \
  --origin https://example.test \
  --action navigate --url https://example.test/login
```

支持动作：`navigate`、`click`、`fill`、`press_key`。

该命令要求**已连接的 TTY**。它会打印待执行内容（story、origin、动作、最长
15 分钟的租约），然后请求**一次 owner 批准**：

```
Owner Chrome approval required (one operation only)
  story: US-EXAMPLE-001
  origin: https://example.test
  action: navigate to https://example.test
  expiry: 2026-07-15T08:34:00.000Z (15 minutes maximum)
  credential export: denied (cookies, storage, and network bodies are unavailable)
Approve this owner-run operation? [y/N]
```

如果你拒绝，不会尝试任何连接。如果批准，Roll 会连接本地调试端点、执行单次
操作、打印结果，并立即释放租约：

```
manual owner-run result: ok (tab: 1234)
This interactive result does not make CI pass and is not background automation.
```

### 租约到期与取消

每次交互操作最多持有 **15 分钟** 租约。租约绑定到持有进程与 loopback 端点；
操作结束后立即释放。若进程死亡或租约到期，Roll 会自动回收。你无法批准持久
后台租约——每次操作都需要独立的前台批准。

### 交互通道永远不会做的事

- 在没有 TTY 和显式 owner 批准的情况下运行。
- 连接非 loopback 或远程调试端点。
- 导出 cookie、storage、network bodies 或任何其他凭证。
- 自动启动 Chrome 或留下后台调度器。
- 独自让 CI 通过——它只是一个 **owner-run manual-attest** 工具。

## 证据边界

受管浏览器诊断与交互式 owner 运行结果**仅为诊断 / 仅为 manual-attest**。每次
run 报告都重复这句：*诊断通过不等于视觉验收证据*。诊断截图或交互结果会被归类
为诊断产物，而非视觉验收产物，因此绝不可能伪造故事的视觉验收。故事需要视觉
验收时，请用 **Roll Capture**——对真实终端/应用的物理截图——只有它满足该要求。
见[验收证据](acceptance-evidence.md)。

## 安全恢复

- 若 `doctor` 报告 `managed: degraded`，已有的 Playwright 与 Roll Capture 路径
  照常可用——你原本依赖的东西没有被破坏。装上缺失依赖后重跑 `roll browser
  doctor`。
- 临时 profile 每次运行后都会删除；owner Chrome 状态绝不进入。运行被中断后重跑
  是安全的——每次都从全新 profile 开始。
- 不会向你的产品仓写任何东西。Roll 唯一可能写入的是机器级
  `~/.roll/browser-operations.yaml`，且仅在 `--confirm` 时。

## 排障

### `roll browser interactive` 提示 "requires an attached TTY"

交互式 owner-Chrome 操作需要前台终端。它们不能从后台调度器、CI 作业或非交互式
shell 中运行。这是设计如此：每次操作都需要实时的 owner 批准。

### "Connects only to an already-open loopback Chrome debug endpoint"

Roll 不会启动 Chrome，也不会打开远程调试端口。你需要自行用
`--remote-debugging-port=9222` 绑定到 `127.0.0.1` 来启动 Chrome。非 loopback
地址会被拒绝。

### 交互模式能导出 cookie 或保持会话吗？

不能。凭证导出（cookie、storage、network bodies）始终被拒绝。租约在操作结束后
立即释放，并在 15 分钟内过期；没有后台调度器，也没有持久会话。

### 我能把交互模式指向远程 Chrome 实例吗？

不能。仅支持 loopback 端点。没有远程端点、隧道或云浏览器集成。

## 相关

- [工具与策略](tools.md) —— `browser.*` 工具访问如何被治理。
- [验收证据](acceptance-evidence.md) —— 为什么诊断不是视觉验收。
- [English](../en/browser-operations.md)
