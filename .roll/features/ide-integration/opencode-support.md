# Feature: opencode Support

> Design: [opencode-support-plan.md](opencode-support-plan.md)

---

<a id="us-opencode-001"></a>
## US-OPENCODE-001 bin/roll integration — detect opencode, sync global AGENTS.md ✅

**Created**: 2026-05-06
**Completed**: 2026-05-06
**Plan**: [opencode-support-plan.md](opencode-support-plan.md)

- As a product engineer using opencode on a Roll-managed project
- I want Roll to detect opencode and sync conventions to `~/.config/opencode/AGENTS.md`
- So that opencode reads Roll conventions automatically as global instructions

**AC:**
- [x] `_is_ai_installed()` 新增 `opencode` case：检测 `~/.opencode/bin/opencode` 或 `command -v opencode`
- [x] `_ensure_config_entries()` 添加默认项 `ai_opencode:~/.config/opencode|AGENTS.md|AGENTS.md`
- [x] `roll setup` / `roll init` 在 opencode 已安装时将 AGENTS.md 同步到 `~/.config/opencode/AGENTS.md`
- [x] `roll init` 同上：检测到 opencode 时生成全局 AGENTS.md
- [x] `npm test` 通过

**Files:**
- `bin/roll`
- `conventions/global/AGENTS.md`

**Dependencies:**
- Depends on: —
- Depended on by: —


**Notes:**
- opencode 全局指令文件路径：`~/.config/opencode/AGENTS.md`
- opencode 同时兼容读取 `~/.claude/CLAUDE.md`（Claude Code 兼容层），但 AGENTS.md 是主路径
- 项目级 AGENTS.md 已由现有约定覆盖，无需新增
- commands 机制（`.opencode/commands/`）暂不实现：skills 由 agent 自动发现已足够
- 检测优先级：binary 存在 > 目录存在
