# Project Backlog

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

### Feature: opencode-support
| Story | Description | Status |
|-------|-------------|--------|
| [US-OPENCODE-001](docs/features/opencode-support.md#us-opencode-001) | bin/roll integration — detect opencode, sync global AGENTS.md | ✅ Done |

## Epic: QA & Testing
### Feature: e2e-lifecycle
| Story | Description | Status |
|-------|-------------|--------|
| [US-QA-001](docs/features/e2e-lifecycle.md#us-qa-001) | roll-build Phase 5.5 — E2E Deposit after TCR | 📋 Todo |
| [US-QA-002](docs/features/e2e-lifecycle.md#us-qa-002) | Template CI add E2E gating step | 📋 Todo |
| [US-QA-003](docs/features/e2e-lifecycle.md#us-qa-003) | roll-.qa add CI failure triage guidance | 📋 Todo |

## Epic: Diagnostics
### Feature: roll-debug
| Story | Description | Status |
|-------|-------------|--------|
| [US-DEBUG-001](docs/features/roll-debug.md#us-debug-001) | Add BB Injection mode — mount BB on pages without native integration | ✅ Done |
| [US-DEBUG-002](docs/features/roll-debug.md#us-debug-002) | roll-debug auto-fix — diagnose then auto-TCR when fixable | 📋 Todo |

## Epic: Release Management
### Feature: roll-release
| Story | Description | Status |
|-------|-------------|--------|
| [US-REL-001](docs/features/roll-release.md#us-rel-001) | Add roll-release skill — one-command publish flow | ✅ Done |

## 🐛 Bug Fixes
| ID | Description | Status |
|----|-------------|--------|
| FIX-001 | bin/roll sync 加 file-level prune（防止未来删文件在用户机器留幽灵） | ✅ Done |
| FIX-002 | `AGENTS.md` 修正 src/index.ts → bin/roll 等过时引用 | ✅ Done |
| FIX-003 | `GEMINI.md` Stack 段修正：Node.js/commander/Vitest → bash + bats | ✅ Done |

## 💡 Ideas
| ID | Description | Status |
|----|-------------|--------|
| IDEA-001 | conventions/global/AGENTS.md 加 Identity 规则：从 git config 读取，禁止硬编码个人数据 | ✅ Done |
