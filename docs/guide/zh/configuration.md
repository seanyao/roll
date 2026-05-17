# Roll — 配置

Roll 在启动时解析三个环境变量。在运行 `roll` 之前覆盖任意一个，
就能改变它查找状态、技能和共享约定的位置。

## 环境变量

| 变量 | 默认值 | 用途 |
|------|--------|------|
| `ROLL_HOME` | `~/.roll` | 单用户状态根目录。存放 `config.yaml`、已安装的 `skills/`、同步的 `conventions/`。 |
| `ROLL_CONFIG` | `$ROLL_HOME/config.yaml` | Agent 路由、活跃窗口、调度计划、单工具配置。 |
| `ROLL_GLOBAL` | `$ROLL_HOME/conventions/global` | 全局约定文件（`AGENTS.md`、`CLAUDE.md` 等），同步到各 AI 工具目录。 |
| `ROLL_HEARTBEAT_TIMEOUT` | `1800`（秒） | loop runner 认定 inner cycle 已成孤儿、需要 heal state 的心跳静默阈值。如果你的 cycle 合理静默时间超过 30 分钟，可调大此值。 |

`ROLL_CONFIG` 和 `ROLL_GLOBAL` 都派生自 `ROLL_HOME`，所以通常只需覆盖
`ROLL_HOME` 即可一并搬迁。

## 进阶变量

以下变量日常很少改动，但在 `bin/roll` 里频繁出现。集中列在这里，
方便贡献者和深度用户不读源码也能发现。

| 变量 | 默认值 | 用途 |
|------|--------|------|
| `ROLL_TEMPLATES` | `$ROLL_HOME/conventions/templates` | 项目类型模板文件（`fullstack/`、`frontend-only/`、`backend-service/`、`cli/`）从 npm 包同步到的目标目录。覆盖后 `roll init` 会从自定义模板树读取。 |
| `ROLL_PKG_CONVENTIONS` | `$ROLL_PKG_DIR/conventions` | 安装态 `roll` 包内自带的约定文件源目录。发布前想用另一个源目录试验约定改动时覆盖它。 |
| `ROLL_LOOP_FORCE` | 未设置 | 内部标记：`roll loop now` 和 `roll loop test` 用它跳过 active-window 时间窗与 pause 文件。脚本里想强制单次跑一轮 loop 时再手动设置。 |

### 内部状态（不可覆盖）

`_ROLL_MERGE_SUMMARY` 是 `roll init` / `roll sync` 内部使用的 bash 数组，
逐文件累积合并结果（`created` / `merged` / `unchanged`），最后用于打印汇总。
变量名前的下划线表示私有 —— 不要在 `bin/roll` 之外 export 或覆盖。

## 常见覆盖场景

把 roll 状态钉到项目本地目录（适合 CI、测试、隔离实验）：

```bash
export ROLL_HOME="$PWD/.roll-sandbox"
roll setup
roll loop now
```

不动 `~/.roll`，用另一套约定运行 roll：

```bash
ROLL_GLOBAL=/path/to/team-conventions roll init
```

用一次性配置文件验证改动：

```bash
ROLL_CONFIG=/tmp/test-config.yaml roll agent use kimi
```

## 验证

`roll status` 会打印解析后的路径，便于确认覆盖是否生效；
通过 `$roll-doctor` 技能可以诊断解析后的 `ROLL_HOME` 下的目录结构问题。

## 相关文档

- [overview.md](overview.md) — 三层模型、BACKLOG 优先级
- [loop.md](loop.md) — `roll loop` 子命令
