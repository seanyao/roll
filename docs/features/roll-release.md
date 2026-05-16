# Feature: Release Script

> **2026-05-16 update**: The `roll-release` skill and `roll release` CLI subcommand
> have been removed. Release flow is now 100% script-driven via `scripts/release.sh`
> — npm publish requires real-terminal 2FA, which a skill cannot orchestrate.
> US-REL-001 below is kept as historical record.

<a id="us-rel-001"></a>
## US-REL-001 Add roll-release skill — one-command publish flow ✅ (superseded)

**Created**: 2026-04-19
**Completed**: 2026-04-20

- As a roll maintainer
- I want to run `$roll-release` to publish a new version
- So that releasing is a single command with no manual version calculation

**AC:**
- [x] Skill file `skills/roll-release/SKILL.md` created
- [x] Version format: `YYYY.MMDD.N` (e.g. `2026.419.1`); N auto-increments from existing git tags for today
- [x] Updates `VERSION="..."` in `bin/roll`
- [x] Updates `"version"` field in `package.json`
- [x] Commits with message `[release] vYYYY.MMDD.N`
- [x] Creates git tag `vYYYY.MMDD.N` and pushes with `git push && git push --tags`
- [ ] GitHub Actions `publish.yml` auto-publishes to npm on tag push (OIDC Trusted Publishing pending — workaround: `npm publish` locally)
- [x] Skill shows proposed version and asks for confirmation before making any changes
- [x] Added to README skill list

**Files:**
- `skills/roll-release/SKILL.md` (new)
- `README.md`

**Dependencies:**
- `.github/workflows/publish.yml` must exist (already done in US-DIST-004)

<a id="us-rel-002"></a>
## US-REL-002 发版脚本 AI 调用瘦身 ✅

**Created**: 2026-05-17
**Completed**: 2026-05-17

- As a Roll 维护者
- I want 发版时 `scripts/release.sh` 的 AI 调用更快更省
- So that 每次发版不再干等三次 claude 串行响应

**AC:**
- [x] changelog 同步和 release notes 生成合并为一次 AI 调用（原来两次串行）
- [x] features.md 重写的 prompt 不再内联 BACKLOG 全文（36KB → ~2KB 结构摘要）
- [x] 每次 AI 调用只发送 SKILL.md 中该任务需要的 section，不传全量 16KB
- [x] 最终产物（CHANGELOG.md、release_notes.txt、docs/features.md）内容不变
- [x] `release.sh` 端到端执行时间显著缩短，AI 调用从 3 次降为 2 次

**Files:**
- `scripts/release.sh`
- `tests/unit/release_ai_calls.bats` (new)
- `tests/integration/release_features_sync.bats` (E2E deposit added)

**Dependencies:**
- 无（纯脚本内部重构，不影响接口）
