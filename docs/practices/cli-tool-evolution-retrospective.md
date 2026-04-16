# CLI 工具演化复盘：从 Cybernetix 到 Roll

> **Date:** 2026-04-16  
> **Scope:** roll CLI 工程历史、设计决策与经验教训

---

## 1. 演化时间线

```
2025-02  Cybernetix (cnx)     纯技能仓库起步，无 CLI，kimi 驱动
2025-03  加入 CLI 管理能力     sync conventions、manage skills
2025-04  Wukong (wk)          第一次品牌重命名，引入完整 CLI 体系
2025-10  Engineering Refactor  bats 测试框架、cmd 拆解、CI/CD
2026-04  Roll                  第二次品牌重命名 + 本次大规模简化
```

### 1.1 Cybernetix 阶段（cnx-）

以纯技能仓库起步：skill 文件定义 AI agent 的行为，通过 `$cnx-story-build`、`$cnx-design` 等命令触发。没有 CLI，没有约定同步机制——每个开发者手动维护各自的 AI 工具配置。

**核心问题**：多 AI 客户端（Claude、Kimi、Cursor）行为不一致，配置碎片化。

### 1.2 加入 CLI 管理能力

引入 `cnx` CLI，实现：
- `sync conventions`：将全局约定分发到各 AI 工具配置目录
- `sync skills`：通过符号链接把 skill 文件挂载到各工具
- `init [type]`：按项目类型（fullstack/cli/backend-service）初始化约定文件

**引入的设计负担**：`init` 要用户选类型、选工具，scaffold 目录，交互步骤过多。

### 1.3 Wukong 阶段（wk-）

第一次品牌重命名：`cybernetix` → `wukong`，命令前缀 `cnx-` → `wk-`。

迁移方式：脚本替换路径和命令，**但只替换了可执行的部分**，convention 模板文件里的文字内容没有全面扫描。这留下了后来需要集中清理的大量 WK/Wukong 字样。

### 1.4 Engineering Refactor（工程纪律补课）

在功能之外补了基础设施：
- bats 测试框架（unit + integration）
- GitHub Actions CI
- `cmd_init()` 165 行拆解为单职责函数
- AI 工具数据源统一（消除硬编码）

**价值**：没有这批测试，后续的大规模简化和 bug 修复就没有安全网。

### 1.5 Roll 阶段（第二次重命名 + 本次简化）

---

## 2. 本次工作内容（2026-04-16）

### 2.1 CLI 极简化（US-CLI-001～003）

**核心判断**：`roll init` 不应该问任何问题。项目类型应该由 skill 在执行 story 时从现有文件推断，而不是在 init 时由用户声明。

**改动幅度**：
- `cmd_init()` 从 165 行缩到 24 行
- 删除 8 个函数（`_select_project_type`、`_select_tools`、`scaffold_new_project` 等，共 ~300 行）
- `roll init` 变成三步：创建 AGENTS.md + BACKLOG.md + docs/features/，5 秒完成

### 2.2 命令体系梳理

| 改动 | 原因 |
|------|------|
| `roll sync conventions/skills/all` → `roll sync` | 用户不需要思考同步哪个 scope |
| `roll setup` 补全 convention sync | 首次安装后还要手动 sync 是设计缺陷 |
| `roll sync` 加入从 repo pull | 更新代码后跑 sync 结果没变，根本原因是 sync 不读 repo |
| 删除 `roll-story`、`roll-fly` skill | 逻辑已完整包含在 `roll-build` 里，保留只会让用户困惑 |
| `roll setup` 加 git hook 交互提示 | 装完还需要单独记得装 hook，是遗漏 |
| 新增 `uninstall.sh` | 装得上、卸不掉不是一个成熟工具应有的状态 |

### 2.3 集中清理技术债

- 所有 convention 文件、模板、AGENTS.md 中的 WK/CNX/Wukong/Cybernetix 字样
- `roll status` 统计的是 `wk-*` symlinks 而非 `roll-*`（根本看不到已安装的技能）
- `wk.md` / `@wk.md` → `roll.md` / `@roll.md`（实际文件名遗留旧品牌）
- `migrate-to-roll.sh` 使用 `sed -i ''`（macOS 专属，Linux 静默失败）
- `--force` 没有透传到 `safe_copy`（reset/setup --force 还是会交互提示）
- `config.yaml` 无 `ai_*` 条目时 `roll status` 静默空白，无任何提示

---

## 3. 问题根因分析

### 3.1 重命名 ≠ 重构

每次改名（cnx→wk→roll）都用脚本处理了**可执行的部分**（路径、命令名、变量名），但没有系统扫描**写给 AI 看的文本内容**（convention 文件、AGENTS.md、模板）。

**教训**：改名之后，必须跑一次 `grep -r "旧品牌名" .` 全面扫描。不能假设脚本覆盖了一切。

### 3.2 设计从实现视角出发，而非用户视角

`roll sync` 不从 repo 拉取，从实现角度有逻辑（sync = 分发），但用户看到的是：「我更新了代码，跑 sync，为什么没变？」

**教训**：命令的语义应该从用户的心理模型出发来定义，而不是从内部实现的边界来定义。每次新增命令，先问：「用户在什么场景下会想到跑这个命令？他期望发生什么？」

### 3.3 快速迭代的连锁遗漏

改了某个行为，但没有同步检查所有下游：
- 删了 `sync conventions` 子命令，但测试里还在用
- 更新了 sync 语义，但 `roll init` 的提示文字还在说「Next: roll sync」
- 加了 `--force` 参数，但没有追踪它是否透传到了最深层的调用

**教训**：改变一个接口或行为时，搜索所有引用它的地方（代码、测试、文档、提示文字）一并更新，不要分批。

### 3.4 没有防回归机制

没有 CI 检查来捕获：
- 旧品牌名出现在 convention 文件里
- 已废弃的命令出现在测试里

**教训**：重要的不变式应该写成测试或 lint 规则。「不应该出现 wk-/cnx- 这类字符串」这种约束，完全可以用一条 grep 来守护。

### 3.5 Agent worktree 清理不健壮

Claude Code Agent 创建 worktrees 做并行任务，但中断时 worktrees 会 locked 残留，且 `.claude/worktrees/` 没有加入 `.gitignore`。

**教训**：任何工具创建的临时文件，都应该在第一天就加入 `.gitignore`，不要等出现了再补。

---

## 4. 设计原则提炼

这些原则是从上述问题和修复中归纳出来的，适用于所有面向开发者的 CLI 工具：

**P1 — 零决策原则**  
用户的每一个问题都是摩擦。能从环境推断的，就不要问。`roll init` 不问类型是对的；`roll setup` 把 sync 合并进去是对的。

**P2 — 命令语义从用户心理模型出发**  
`sync` 对用户来说意味着「同步到最新状态」，不是「把本地缓存分发出去」。命令名不是内部模块的映射，是用户意图的表达。

**P3 — 改名必须全面扫描**  
每次品牌/命名变更：① 改可执行代码；② `grep -r` 扫描所有文本内容；③ 跑完整测试套件；④ 手动跑一遍主要用户流程。

**P4 — 改接口必须更新所有引用**  
改了一个命令/行为，立刻搜索：测试、文档、提示文字、其他命令里的调用。不要分批，一次性改完。

**P5 — 临时文件第一天就 .gitignore**  
工具创建的任何运行时产物（worktrees、cache、lock files）都应该在引入的第一天就被 `.gitignore` 排除。

**P6 — 错误提示必须有诊断价值**  
`roll status` 空白比报错更坏——用户不知道是正常还是出了问题。状态异常必须说明原因和修复方向。

**P7 — 装得上也要卸得掉**  
成熟工具应该提供干净的卸载路径。`uninstall.sh` 不是可选功能，是基本礼貌。

---

## 5. 测试体系现状

```
tests/
├── unit/                    # 纯函数单元测试
│   ├── ai_tool_name.bats
│   ├── config_get.bats
│   ├── detect_project_type.bats
│   ├── is_fresh_project.bats
│   ├── merge_convention.bats
│   ├── sanity.bats
│   └── scan_project_type.bats
└── integration/             # 完整命令集成测试
    ├── cmd_init.bats         (6 tests)
    ├── cmd_setup.bats        (16 tests)
    ├── cmd_status.bats       (5 tests)
    └── cmd_sync.bats         (7 tests)
```

**覆盖率**：核心命令（init/setup/sync/status）全部有集成测试，helper 函数有单元测试。CI 在每次 push 时运行。

**仍然缺失**：
- `roll reset` 的集成测试
- `roll clean` 的集成测试  
- `uninstall.sh` 的自动化验证
- 跨平台（Linux）的 CI 矩阵

---

## 6. 遗留工作

| 项目 | 说明 |
|------|------|
| `roll reset` / `roll clean` 测试 | 目前只有手动验证 |
| `uninstall.sh` 测试 | 无自动化验证 |
| Linux CI 矩阵 | 目前只在 ubuntu-latest 跑，没有 macOS/Linux 对比 |
| 旧品牌名防回归 lint | `grep` 规则防止 wk-/cnx-/wukong 重新混入 convention 文件 |
| `conventions/global/` 内容审查 | AGENTS.md 里的内容是否还有过时假设（如类型选择相关描述） |
