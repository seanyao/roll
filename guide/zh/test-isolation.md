# Roll — 测试隔离（`roll test`）

`roll test` 通过可插拔的隔离 adapter 跑项目测试套件。Adapter 由
`.roll/local.yaml` 的一行配置决定，所以"在 host 跑"和"在 Apple
Silicon VM 里跑"之间切换不需要改任何命令。

## 为什么要做这个

Roll 早期版本靠"软沙箱"——用环境变量重定向把 dev 测试挡在真
`launchd` 和 `~/.shared/roll/` 之外。但凡有一条代码路径写出沙箱
之外就是一个破口，我们补过几十次（FIX-065 / 087 / 097 / 101 /
124 / 125）。补丁的成本最终超过了"干脆把测试放到 host 摸不到的
地方跑"的成本。

本 epic 的 Phase 1 在 Apple Silicon Mac 上引入 **Tart** 作为真
VM 隔离 provider。VM 里的测试物理上摸不到 host `launchd`。软
沙箱继续保留，作为 CI（Ubuntu）和 host-only 测试路径的纵深防御。

## 快速上手

```bash
# 1. 装 Tart（一次性）
brew install cirruslabs/cli/tart

# 2. 告诉 Roll 用它
cat >> .roll/local.yaml <<'YAML'
test_isolation:
  type: tart
YAML

# 3. 跑测试
roll test                      # 在 VM 里跑 npm test
roll test --where              # tart:192.168.64.5
roll test -- --tier=fast       # 透传参数
roll test --reset              # 销毁 VM 重建
```

## 三种 `type:` 值

| `type` | 何时使用 | 行为 |
|--------|----------|------|
| `none`（默认） | Linux / Intel Mac 开发、CI runner、没装 Tart 的人 | 测试在 `npm test` 同一个 shell 里跑。除了软沙箱外没有额外隔离。 |
| `tart` | macOS Apple Silicon 开发机、要硬隔离 | `roll-dev-test` VM 从 base image clone 出来；`brew install bats node bash` 跑一次；worktree 通过 virtiofs 挂到 `/Volumes/My Shared Files/roll`；`npm test` 走 SSH。 |
| *（未来）* `docker` | cycle-time 隔离，不只是 test-time | Phase 2 — 还没实现。 |

如果 `.roll/local.yaml` 没设置 `test_isolation.type`，dispatcher
回退到 `none` 并在 stderr 打一行提示。显式 `type: none` 不打提示。

## 命令清单

### `roll test`

在配置的 adapter 里跑 `npm test`。退码就是测试套件的退码——
`type: tart` 下 VM 里测试失败时，host 看到同样的非零退码。

**默认只跑 affected 测试。** 无额外参数调用时，`roll test` 自动
给 `npm test` 加 `--affected`，只跑自 `HEAD~1` 起的改动和未提交
工作区编辑所影响的测试。这和 pre-commit hook 的逻辑一致，让 VM
的测试也能秒级完成（而不是跑满整套）。

需要全量跑时：

```bash
roll test -- tests/
```

`--` 后面的参数原样透传给 `npm test`：

```bash
roll test -- --tier=all              # 全量，所有 tier
roll test -- tests/unit/loop.bats    # 指定文件
```

`type: tart` 且 VM 起不来时，命令非零退出，**不**静默 fallback
到 host 跑。整个隔离的意义就在于你知道测试到底跑在哪。

### `roll test --where`

打印下一次 `roll test` 会在哪里执行。机器可读，一个 token（可
带冒号分隔的细节）：

| 输出 | 含义 |
|------|------|
| `host` | type=none — 测试在当前 shell 跑 |
| `tart:<ip>` | type=tart 且 VM 已起；`<ip>` 是 VM 的 IP |
| `tart:ready` | VM 已起且 SSH 可达（已 provision） |
| `tart:running` | VM 进程起来了但 SSH 还没就绪 |
| `tart:stopped` | type=tart 但 VM 没在跑 |
| `tart:not-installed` | type=tart 但 Tart 二进制或 VM 不存在 |

`--where` 是只读的——`roll test --reset` 重建 VM 时也仍然可用。

### `roll test --reset`

把隔离环境推倒重建到 clean 状态：

- `type: tart` —— `tart stop` → `tart delete` → `tart clone` → 重新 provision。
- `type: none` —— 打印"none isolation 无需重置（host 执行是无状态的）"
  并退码 **0**（不算失败——host 没有要清理的状态）。

重建期间在 `.roll/.iso-reset.lock` 持锁。持锁期间：

- 第二个 `roll test --reset` 立即拒绝并给明确的报错。
- 并发的 `roll test`（test-execution 路径）以同样的报错拒绝——
  冲进半重建状态的 VM 比等待更糟。
- `roll test --where` 和 `--help` 忽略锁（只读）。

### `roll test --help`

```
Usage: roll test [--where | --reset] [--] [<extra-args>...]

Runs the project's test suite through the isolation adapter chosen in
.roll/local.yaml:

  test_isolation:
    type: none   (default)   Direct host execution — same shell as `npm test`.
    type: tart               Inside the Apple-Silicon `roll-dev-test` Tart VM,
                             so tests can't reach the host's launchd / shared
                             roll state. Tart isn't auto-installed; run
                             `brew install cirruslabs/cli/tart` first.

Flags:
  --where        Print where tests will run, then exit (e.g. `host`,
                 `tart:192.168.64.5`, `tart:stopped`).
  --reset        Rebuild the isolation environment to a clean baseline.
                 type=tart: stop → delete → clone → provision (~90s).
                 type=none: prints a note and exits 0 (host is stateless).
                 Holds a lockfile under .roll/.iso-reset.lock; concurrent
                 `roll test` invocations fast-fail with a clear error.
  --help, -h     Show this help.

Examples:
  roll test                    Run the suite in whatever the config says.
  roll test -- --tier=fast     Forward arguments to npm test.
  roll test --where            Don't run; just report routing.
  roll test --reset            Rebuild the VM (or host no-op).

When type=tart and the VM can't be reached, the command exits non-zero
rather than silently falling back to host execution.
```

## 故障恢复

VM 状态怪？测试卡住？brew install 只装了一半？一条命令搞定：

```bash
roll test --reset
```

目标时长：~90 秒。下一次 `roll test` 会启动一台新鲜的、已
provision 的 VM。`--reset` 本身失败时，跑 `roll test --where`
看 dispatcher 认为你现在处于什么状态。

## 长期路线图

Phase 1（本 epic）只覆盖 **test-time** 隔离。后续两个 phase 已规
划但还没实现：

### Phase 2 —— 每 cycle 容器隔离（`type: docker`）

**触发条件**：

- 你的 `roll loop` cycle 开始装真依赖、调真外部 API，或做任何
  你不想让副作用落到 host 上的事。
- 你对 cycle 当前的工作改动信不过，不想让它碰 host 文件系统。

**方案**：一个实现同 `IsolationAdapter` 接口的 `docker` adapter。
`init` 变 `docker pull <image>`，`exec` 变 `docker exec`（长驻）
或 `docker run --rm`（一次性）。这层之上的所有东西（`roll test`、
`_isolation_dispatch`）不用改。

### Phase 3 —— 多租户 sandbox 编排

**触发条件**：

- Roll 不再是单用户 / 单机部署。
- 你需要 network policy、按租户路由、按用户计费、对隔离执行环境
  做平台级管理。

**方案**：OpenSandbox 风格的 adapter（E2B、Modal、Daytona 或同
类）接到同一个接口。**OpenSandbox 的触发条件不是"想要更强的隔离"，
而是"想要多租户编排"。** 单用户单机的隔离用 `docker run` 一行
就够了。

### 如何加一个新 adapter

在 `bin/roll` 里实现这 6 个函数：

- `_isolation_<type>_init`
- `_isolation_<type>_provision`
- `_isolation_<type>_exec`
- `_isolation_<type>_status`
- `_isolation_<type>_reset`
- `_isolation_<type>_destroy`

在 dispatcher 的 `_ISOLATION_SUPPORTED_TYPES` 里加上 `<type>`。
就这些——上面的系统已经全部走 `_isolation_dispatch` 路由。

## FAQ

**Q: FIX-124（macOS bash 3.2 自检过不了）一直挡我 commit，VM 里
还在吗？**

VM 里没了——Tart base image 自带 bash 5，触发 FIX-124 的 bash
3.2 怪行为不会再出现。host 上（不配 `type: tart` 时）问题仍可能
出现；它保留在 backlog 上，给那些极少数 `type: none` 跑测试的
情况。

**Q: 既然 VM 解决了隔离，为什么 FIX-125（cycle-context tripwire）
还在？**

FIX-125 保护的是 **host** 上的 `roll loop` —— cycle 期间它自己不
会去动自己的 LaunchAgents。VM 让测试不再碰 host，但 host loop
本身仍然跑在 host 上，仍然需要这条 tripwire。两个 fix 解决的是
正交的问题。

**Q: 软沙箱（`_LAUNCHD_DIR` / `_SHARED_ROOT` / `_launchctl_safe`
/ FIX-065/087/097/101）会下线吗？**

短期内不下线。CI 跑在 Ubuntu 上没法用 Tart，host-only 的测试
路径也仍然存在。Phase 1 把软沙箱保留下来作为纵深防御。后续会
有一个 story（不在本 epic 里）审视一下 Tart 路稳定下来后哪些可
以简化。

**Q: 我能用自己的 VM image 吗？**

Phase 1 不支持。Base image 写死在
`ghcr.io/cirruslabs/macos-tahoe-base:latest`，确实有需要时可以
通过 `_TART_BASE_IMAGE` 环境变量临时覆盖。等出现第二个需要这
个能力的用户时，会加一个正式的 `.roll/local.yaml` 字段。
