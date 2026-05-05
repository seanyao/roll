# Plan: opencode Support

## Context

opencode (https://opencode.ai) 是开源 coding agent，150k+ GitHub stars，支持 75+ LLM providers。
与 Trae、Cursor 类似，Roll 需要将约定文件同步到 opencode 的全局配置目录。

## opencode 约定文件机制

| 层级 | 路径 | 说明 |
|------|------|------|
| 项目级 | `AGENTS.md`（项目根） | 已由 Roll 现有约定覆盖 |
| 全局 | `~/.config/opencode/AGENTS.md` | Roll 需要同步到这里 |
| 兼容层 | `~/.claude/CLAUDE.md` | opencode 自动读取，已有 |

加载顺序：项目目录向上遍历 → `~/.config/opencode/AGENTS.md` → `~/.claude/CLAUDE.md`

## 检测策略

opencode 安装目录为 `~/.opencode/`，binary 在 `~/.opencode/bin/opencode`。
与 Trae 类似，全局配置目录 `~/.config/opencode/` 可能在首次运行前不存在，
因此检测应基于 binary 而非目录。

```bash
_is_ai_installed() 新增:
  opencode)
    [[ -x "$HOME/.opencode/bin/opencode" ]] || command -v opencode &>/dev/null
```

## File Mapping

| Roll convention source | Output path（全局 sync） |
|------------------------|--------------------------|
| conventions/global/AGENTS.md | ~/.config/opencode/AGENTS.md |

## bin/roll 改动

1. `_is_ai_installed()` — 新增 `opencode` case，检测 binary
2. `_ensure_config_entries()` — 添加 `ai_opencode:~/.config/opencode|AGENTS.md|AGENTS.md`

## 不做的事

- `.opencode/commands/` 生成：skills 由 agent 自动发现，无需 command wrapper
- 新增约定文件：AGENTS.md 已存在于 global + 4 templates

## Stories

- US-OPENCODE-001: bin/roll 集成
