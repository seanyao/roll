# Roll — 项目初始化

## 初始化项目

在项目根目录执行：

```bash
roll init
```

`roll init` 按顺序做三件事：

1. **读取项目** — 检测语言、框架和已有结构，不问问题。
2. **写入约定** — 若不存在，创建 `CLAUDE.md`、`AGENTS.md`、`BACKLOG.md`。
3. **同步技能** — 将 roll 技能集链接到 AI 工具的技能目录（Claude Code 对应 `.claude/skills/`）。

全程无交互提示，无需选择项目类型。Roll 从已有内容自动推断。

## 更新约定和技能

roll 发布新版本后，将新约定同步到项目：

```bash
roll sync
```

`sync` 只覆盖 roll 管理的文件（技能和全局约定），不会动你的 `BACKLOG.md`、`docs/` 等项目文件。

## 典型首次使用流程

```bash
npm install -g roll        # 安装 roll
roll setup                 # 全机器配置 AI 工具（仅需一次）
cd my-project
roll init                  # 初始化该项目
$roll-design               # 开设计会话，填充 BACKLOG.md
roll loop on               # 开启自主执行
```

## 创建的文件

| 文件 | 用途 |
|------|------|
| `CLAUDE.md` | Claude Code 项目指令 |
| `AGENTS.md` | Agent 约定：领域模型、作用域、编码规范 |
| `BACKLOG.md` | 故事跟踪（Epic / Feature / Story / Fix / Refactor） |
| `docs/features/` | 每个 Feature 的深度文档 |

## 幂等性

`roll init` 可安全重复执行——已存在的文件会被跳过，只补充缺失的内容。

## 另见

- [installation.md](installation.md) — 安装和更新 roll
- [conventions.md](conventions.md) — AGENTS.md 结构和约定
- [loop.md](loop.md) — 开启自主执行
