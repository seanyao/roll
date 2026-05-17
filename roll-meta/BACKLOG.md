# Roll-Meta Backlog

> Roll 项目自身的内部待办。**不被 roll-loop 扫描，不进 CHANGELOG**。
> 详见 [README.md](README.md)。

## Epic: Upstream Awareness

### Feature: upstream-watch
| Story | Description | Status |
|-------|-------------|--------|
| [US-WATCH-001](features/upstream-watch.md#us-watch-001) | 上游 AI CLI 升级早期预警 MVP — dream 每晚扫一次 Claude Code 的 release notes，AI 用关注维度清单对照，有破坏性变更就开 FIX 入 BACKLOG，行为变更写 ALERT 提醒人 | 📋 Todo |
| [US-WATCH-002](features/upstream-watch.md#us-watch-002) | 上游 CLI 监视扩展到另外七家 — Kimi、DeepSeek、Codex、Gemini、Pi、opencode、Trae 都纳入扫描，每家配套独立来源与 fallback | 📋 Todo |
| [US-WATCH-003](features/upstream-watch.md#us-watch-003) | 上游 CLI 监视加固 — 同一变更不重复开 FIX、外部接口限流时优雅退避、关注维度清单独立可版本化迭代 | 📋 Todo |
