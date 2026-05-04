# Project Backlog

## Epic: Demo
### Feature: hello-world
| Story | Description | Status |
|-------|-------------|--------|
| [US-HELLO-001](docs/features/hello-world.md#us-hello-001) | Hello World demo story to verify roll-design workflow | 📋 Todo |

## Epic: CLI Simplification
### Feature: cli-simplification
| Story | Description | Status |
|-------|-------------|--------|
| [US-CLI-001](docs/features/cli-simplification.md#us-cli-001) | 精簡 cmd_init() — 移除類型/scaffold，三步極簡 init | ✅ Done |
| [US-CLI-002](docs/features/cli-simplification.md#us-cli-002) | conventions/templates 重新定位為 skills 參考資料 | ✅ Done |
| [US-CLI-003](docs/features/cli-simplification.md#us-cli-003) | skills 加入 Project Context Rule — 觀察再行動 | ✅ Done |

## Epic: Skill Ecosystem
### Feature: new-skills
| Story | Description | Status |
|-------|-------------|--------|
| [US-SKILL-001](docs/features/new-skills.md#us-skill-001) | Add `roll-jot` — fast backlog capture for bugs and ideas | ✅ Done |
| [US-SKILL-002](docs/features/new-skills.md#us-skill-002) | Add `roll-.clarify` — passive scope clarification for vague build requests | ✅ Done |

## Epic: Distribution
### Feature: npm-distribution
| Story | Description | Status |
|-------|-------------|--------|
| [US-DIST-001](docs/features/npm-distribution.md#us-dist-001) | Rename REPO_ROOT → ROLL_PKG_DIR — explicit dev/runtime separation | ✅ Done |
| [US-DIST-002](docs/features/npm-distribution.md#us-dist-002) | Add `roll update` command (auto-detects npm vs git install) | ✅ Done |
| [US-DIST-003](docs/features/npm-distribution.md#us-dist-003) | Background version check + update nudge (24h cache) | ✅ Done |
| [US-DIST-004](docs/features/npm-distribution.md#us-dist-004) | npm publish infrastructure (.npmignore, GH Actions, README) | ✅ Done |

## Epic: IDE Integration
### Feature: trae-support
| Story | Description | Status |
|-------|-------------|--------|
| [US-TRAE-001](docs/features/trae-support.md#us-trae-001) | Add project_rules.md convention files (global + 4 templates) | ✅ Done |
| [US-TRAE-002](docs/features/trae-support.md#us-trae-002) | bin/roll integration — detect Trae, refresh project, config template | ✅ Done |

## Epic: Diagnostics
### Feature: roll-debug
| Story | Description | Status |
|-------|-------------|--------|
| [US-DEBUG-001](docs/features/roll-debug.md#us-debug-001) | Add BB Injection mode — mount BB on pages without native integration | 📋 Todo |

## Epic: Release Management
### Feature: roll-release
| Story | Description | Status |
|-------|-------------|--------|
| [US-REL-001](docs/features/roll-release.md#us-rel-001) | Add roll-release skill — one-command publish flow | 📋 Todo |

## 🐛 Bug Fixes
| ID | Description | Status |
|----|-------------|--------|
| FIX-001 | bin/roll `_pull_skills` / `_sync_convention_for_tool` 应改为 rsync --delete 模式，否则未来删文件会在用户机器留下幽灵文件 | 📋 Todo |
| FIX-002 | `AGENTS.md` ## 4. CLI 段写 `src/index.ts`，但实际入口是 `bin/roll`（bash 脚本） | 📋 Todo |
| FIX-003 | `GEMINI.md` Stack 段写 Node.js / commander / Vitest，实际是 bash + bats | 📋 Todo |

## 💡 Ideas
| ID | Description | Status |
|----|-------------|--------|
| IDEA-001 | Identity 自动从 git config 读取，不在 conventions 或 AGENTS.md 里写死个人邮箱（防止 npm 发布后泄露给所有用户） | 📋 Todo |
| IDEA-002 | 实测验证 `model:` / `allowed-tools:` SKILL.md frontmatter 字段在各 AI 客户端（Claude Code/Cursor/Codex）是否被识别和生效 | 📋 Todo |
