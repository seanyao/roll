# Roll — 工具与策略

Roll 的 tools layer 是交付周期里执行副作用的受治理路径：shell 命令、浏览器检查、文件系统访问、git、GitHub、网络请求和 MCP 调用。

tools layer 不是 AI 客户端自己的工具白名单替代品。客户端的 `allowed-tools` 决定内层 agent 能请求什么。Roll 的 tools layer 决定外层 harness 注册哪些工具、怎样解析项目策略、记录哪些事件，以及成本怎样进入 cycle 证据。

工具层设计方案见 [../../.roll/features/tools-layer/plan.md](../../.roll/features/tools-layer/plan.md)。

## 核心概念

| 概念 | 含义 |
|------|------|
| 工具声明 | 工具的共享契约：id、kind、标题、默认值、依赖、输入输出 schema。 |
| 注册表 | core 里的统一路径：注册工具、解析 policy、调用 adapter、发事件、重试、记录成本快照。 |
| 适配器 | infra 里的具体实现，例如 `bash`、`browser.screenshot`、`git.push`、`network.fetch`。 |
| 策略 | 工具声明默认值与 `.roll/policy.yaml` 覆盖合成后的有效配置。 |
| 证据 | `tool:invoke`、`tool:result`、cycle 成本行、CLI 输出、attest report、dashboard 时间线。 |

当前注册的工具族：

| 工具族 | 工具 id |
|--------|---------|
| Bash | `bash` |
| Browser | `browser.screenshot`、`browser.console`、`browser.dom-query` |
| Filesystem | `filesystem.stat`、`filesystem.read`、`filesystem.write` |
| Git | `git.status`、`git.commit`、`git.push`、`git.merge` |
| GitHub | `github.pr`、`github.ci` |
| MCP | `mcp.call` |
| Network | `network.fetch` |

完整的内置工具清单——每个工具的能力、输入/输出契约、默认护栏与依赖——可在机器全局 **Tools** 页（`tools.html`）浏览，它是 `MACHINE › …` 面包屑里与 Agents、Skills 同级的页面之一。

## 项目策略

工具策略写在 `.roll/policy.yaml` 的 `tools:` 段里。

```yaml
tools:
  bash:
    enabled: true
    timeoutMs: 30000
    maxInvocationsPerCycle: 20
    sandbox:
      allowedPaths: [.]
      blockedCommands: [sudo]
      maxOutputBytes: 65536

  browser.screenshot:
    timeoutMs: 60000
    sandbox:
      headlessOnly: true
      allowedOrigins: [http://localhost:4173]

  network.fetch:
    retry:
      attempts: 2
      backoffMs: 250
    sandbox:
      network: restricted
      allowedOrigins: [https://api.example.com]
```

支持字段：

| 字段 | 范围 | 含义 |
|------|------|------|
| `enabled` | 工具 | `false` 会通过 policy 阻断调用。 |
| `timeoutMs` | 工具 | adapter 使用的软超时；输入里更窄的限制可覆盖它。 |
| `retry.attempts` | 工具 | 支持重试的 adapter 的最大尝试次数。 |
| `retry.backoffMs` | 工具 | 两次重试之间的等待时间。 |
| `maxInvocationsPerCycle` | 工具 | registry 执行的单 cycle 调用预算。 |
| `sandbox.allowedPaths` | sandbox | 文件系统类 adapter 的路径白名单。 |
| `sandbox.blockedCommands` | sandbox | bash 的 advisory 命令阻断列表。 |
| `sandbox.hardTimeoutSec` | sandbox | 支持该字段的 adapter 的硬超时。 |
| `sandbox.maxOutputBytes` | sandbox | 输出截断上限。 |
| `sandbox.allowedOrigins` | sandbox | 网络或浏览器 origin 白名单。 |
| `sandbox.headlessOnly` | sandbox | 浏览器 lane 必须保持 headless。 |
| `sandbox.network` | sandbox | `inherit`、`restricted` 或 `blocked`。 |

未知字段会告警但不会拒绝整个 policy 文件，方便新旧版本之间前向兼容。

## Owner Chrome：手动交互通道

`roll browser interactive` 是一次性的、owner 手动运行边界：它只会连接已经开启的 loopback Chrome DevTools 端点，执行一个 typed 低风险动作。每次运行都必须附着 TTY，并重新输入 `y` 批准；提示会列出故事、批准的 origin、动作摘要、最长 15 分钟的过期时间和“禁止凭据导出”。

```text
roll browser interactive --story US-BROW-008b --origin https://app.example.test \
  --action navigate --url https://app.example.test/account
```

它只连接 origin 与 `--origin` 匹配的 tab，并会在批准过期、取消、错误或进程退出时断开 DevTools。Roll 不会启动或关闭 owner 的 Chrome。封闭动作词表只有 `navigate`、`click`、`fill` 和 `press_key`；cookie、storage 和 network body 没有 CLI 或 adapter 表面。交互成功只是手动证据，不会让 CI 通过，也不会变成后台自动化。

## CLI

用 `roll doctor tools status` 查看当前项目已注册工具、输入契约、依赖就绪度和合成后的有效 policy 状态。

```bash
roll doctor tools status
```

示例输出：

```text
tool              kind        enabled  readiness    timeout  limit  contract                                       sandbox
bash               bash        yes      available    30000    -      args?, command, cwd?, env?                     maxOutputBytes=65536
browser.screenshot browser     yes      available    60000    -      screenshotPath?, url, viewport?, waitFor?      headlessOnly=true,maxOutputBytes=2097152
network.fetch      network     yes      available    30000    -      body?, headers?, method?, timeoutMs?, url      network=restricted
```

修改 `.roll/policy.yaml` 后，可以用它确认 Roll 读到的状态符合预期。

## 完整示例

这个示例把浏览器截图限制在本地 dev server，先确认有效 policy，再说明一次交付完成后应该去哪里看工具证据。

1. 为项目配置 browser 和 network policy：

```yaml
tools:
  browser.screenshot:
    timeoutMs: 60000
    sandbox:
      headlessOnly: true
      allowedOrigins: [http://localhost:4173]

  network.fetch:
    timeoutMs: 10000
    retry:
      attempts: 2
      backoffMs: 250
    sandbox:
      network: restricted
      allowedOrigins: [http://localhost:4173]
```

2. 确认 Roll 解析到的 policy：

```bash
roll doctor tools status
```

预期能看到这些行：

```text
browser.screenshot browser     yes      60000    -      allowedOrigins=http://localhost:4173,headlessOnly=true,maxOutputBytes=2097152
network.fetch      network     yes      10000    -      allowedOrigins=http://localhost:4173,network=restricted
```

3. 跑一个有可视网页面的交付。故事 spec 应声明要截图的页面：

```yaml
---
deliverable_url: http://localhost:4173
---
```

attest 阶段会通过 `browser.screenshot` 捕获这个页面。对 Roll 暴露的工具 id 是 `browser.screenshot`；底层可能使用 Playwright 或 Chrome，但 `playwright` 不是 policy key，也不是工具 id。

4. 检查证据：

```bash
roll loop cycle <cycle-id>
```

寻找类似这样的行：

```text
tools browser.screenshot×1(2.0s) network.fetch×1(0.4s)
```

Story attest report 和 cycle 视图会从同一条事件流展示：

| 证据 | 检查点 |
|------|--------|
| `tool:invoke` | 工具 id、调用 cycle、合成后的 policy。 |
| `tool:result` | 成功或 errorCode、耗时、输出路径。 |
| 截图链接 | `.roll/tool-dumps/...png` 或卡片目录里附加的截图路径。 |
| 成本行 | 保留 USD、CNY/RMB 或 `¥`；混合币种不会被折成一个假的总额。 |

## 证据与成本

`roll loop status`、`roll loop cycle` 和 attest report 都会从事件流展示工具摘要。失败的工具调用保留 errorCode，截图工具可以直接链接到图片证据。

工具成本保留原生币种。美元行仍是 USD。人民币行仍是 CNY/RMB 或 `¥`。Roll 不会把人民币计价的工具或模型成本标成美元，也不会把混合币种盲目加成一个数字。
