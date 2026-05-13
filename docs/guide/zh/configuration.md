# Roll — 配置

Roll 在启动时解析三个环境变量。在运行 `roll` 之前覆盖任意一个，
就能改变它查找状态、技能和共享约定的位置。

## 环境变量

| 变量 | 默认值 | 用途 |
|------|--------|------|
| `ROLL_HOME` | `~/.roll` | 单用户状态根目录。存放 `config.yaml`、已安装的 `skills/`、同步的 `conventions/`。 |
| `ROLL_CONFIG` | `$ROLL_HOME/config.yaml` | Agent 路由、活跃窗口、调度计划、单工具配置。 |
| `ROLL_GLOBAL` | `$ROLL_HOME/conventions/global` | 全局约定文件（`AGENTS.md`、`CLAUDE.md` 等），同步到各 AI 工具目录。 |

`ROLL_CONFIG` 和 `ROLL_GLOBAL` 都派生自 `ROLL_HOME`，所以通常只需覆盖
`ROLL_HOME` 即可一并搬迁。

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
`roll doctor` 会在解析后的 `ROLL_HOME` 下检查目录结构。

## 相关文档

- [overview.md](overview.md) — 三层模型、BACKLOG 优先级
- [loop.md](loop.md) — `roll loop` 子命令
