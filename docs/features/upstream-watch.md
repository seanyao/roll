# Feature: upstream-watch

Roll 承接 8 家 AI CLI 的能力，任一上游升级都可能让承载层（permission、stream-json、prompt 协议等）静默失效。`upstream-watch` 是嵌入 `roll dream` 的 Scan 7：每晚拉取各家 CLI release notes，AI 用「关注维度清单」对照评估，破坏性变更自动开 FIX，行为变更写 ALERT。

**Plan**: [upstream-watch-plan.md](upstream-watch-plan.md)

---

<a id="us-watch-001"></a>
## US-WATCH-001 Claude Code 早期预警 MVP 📋

**Created**: 2026-05-17
**Plan**: [upstream-watch-plan.md](upstream-watch-plan.md)

- As a Roll 维护者
- I want dream 每晚扫一次 Claude Code 的 release notes，AI 评估有没有可能破坏 Roll
- So that 我能在掉坑前 24 小时收到 FIX 或 ALERT

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: Watcher (Root) owns [WatchTarget(claude), VersionDiff, ImpactAssessment]
- Events raised: [UpstreamVersionDetected] (内部), [HighImpactDetected] → Backlog Context (开 FIX), [MediumImpactDetected] → Loop Context (写 ALERT)
- Cross-context: 写 BACKLOG.md（Backlog Context）、写 ~/.shared/roll/loop/ALERT.md（Loop Context）

**AC:**
- [ ] dream 跑完时多打印一行 `Scan 7: upstream compatibility` 段落
- [ ] 拉取 Claude Code 的 release notes（GitHub releases 主来源 + `claude --version` fallback）
- [ ] 维护 `~/.shared/roll/dream/watch-state.yaml`，记录 claude 的 last_seen_version + last_changelog_hash
- [ ] 首次跑：写入当前 version，不开 FIX（避免历史变更倾盆而出）
- [ ] 后续跑：仅评估 last_seen 与现版本之间的新增变更
- [ ] AI 评估按「关注维度清单」（[idea-024-watch-dimensions.md](../design/idea-024-watch-dimensions.md)）输出 JSON
- [ ] tier=high 自动在 BACKLOG 加 FIX-XXX，描述含 AI 给出的 rationale
- [ ] tier=medium 写 ALERT 提示人
- [ ] tier=low/noise 只落 dream 日志，不开 FIX
- [ ] Idempotency：同一 (cli, version, entry_hash) 三元组不重复开 FIX
- [ ] 拉取或 AI 评估失败 → 跳过 Scan 7，写 dream 日志，不阻塞 dream 其他扫描
- [ ] 单元测试：维度清单加载 / state 读写 / idempotency 去重 / 失败 fallback
- [ ] 集成测试：用 fixture release notes 触发一条 high-impact 评估，验证 FIX 被开

**Files:**
- `bin/roll`（dream 入口加 Scan 7）
- `lib/watch.py` 或 `lib/watch.sh`（拉取 + state + AI 调用）
- `docs/design/idea-024-watch-dimensions.md`（关注维度清单首版）
- `tests/unit/watch.bats`
- `tests/integration/watch_fixture.bats`

**Dependencies:**
- Depends on: 无
- Depended on by: US-WATCH-002, US-WATCH-003

---

<a id="us-watch-002"></a>
## US-WATCH-002 扩展到另外 7 家 CLI 📋

**Created**: 2026-05-17

- As a Roll 维护者
- I want upstream-watch 把 Kimi / DeepSeek / Codex / Gemini / Pi / opencode / Trae 都纳入扫描
- So that 任何一家上游的升级都不会成为盲点

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: Watcher (Root) — 扩展 WatchTarget 实体的 instance 列表
- Events raised: 同 US-WATCH-001（每家 CLI 复用同一套事件）

**AC:**
- [ ] 每家 CLI 至少配置一个 release notes 来源 + 一个 fallback（参 plan 表格）
- [ ] 来源不规范的 CLI（deepseek/pi/opencode/trae）若解析失败，降级为「只记录版本号变化、不做条目级评估」
- [ ] watch-state.yaml 平行维护 8 家 CLI 的 last_seen 字段
- [ ] 单 CLI 失败不影响其他 CLI 扫描
- [ ] 关注维度清单按 CLI 差异适配（claude 有 stream-json，kimi 没有 → 维度命中规则不同）
- [ ] 单元测试：覆盖每家 CLI 的拉取分支 + fallback 路径

**Files:**
- `lib/watch.py` 或 `lib/watch.sh`（per-CLI fetcher 扩展）
- `docs/design/idea-024-watch-dimensions.md`（维度清单按 CLI 标注）
- `tests/unit/watch.bats`

**Dependencies:**
- Depends on: US-WATCH-001
- Depended on by: US-WATCH-003

---

<a id="us-watch-003"></a>
## US-WATCH-003 加固：去重、限流、可迭代维度清单 📋

**Created**: 2026-05-17

- As a Roll 维护者
- I want upstream-watch 不会因为同一条变更反复开 FIX、不会被外部 API 限流卡住整个 dream、维度清单可以独立版本化迭代
- So that 这个机制在长期使用中不变成新的噪音源

**Domain Model:**
- Context: Autonomous Evolution
- Aggregate: Watcher — 强化 Idempotency invariant + 引入 RateLimit / Backoff value object

**AC:**
- [ ] Idempotency 边界覆盖：同一变更跨 dream 多次跑、跨机器同步 watch-state 时不重复开 FIX
- [ ] 外部 API 限流（429）→ 指数退避、记录到下次跑、不重复打到上限
- [ ] 维度清单独立可版本化：清单文件加 `version: N` 字段，AI 评估 prompt 把版本带上，便于未来追溯「这条 FIX 是基于 v3 维度清单评出来的」
- [ ] dream 日志结构化记录每次 Scan 7 的: 扫描耗时 / 拉取成功率 / 评估出的 high/medium/low/noise 数量
- [ ] 提供 `roll dream watch-replay <cli> <version>` 子命令，用现有 state 重跑某次评估（用于 dimension 清单迭代后回放历史）
- [ ] 集成测试：模拟 429 退避、模拟跨次跑同一条变更去重

**Files:**
- `bin/roll`（roll dream watch-replay 子命令）
- `lib/watch.py` 或 `lib/watch.sh`（idempotency + 退避）
- `tests/unit/watch.bats`
- `tests/integration/watch_idempotency.bats`

**Dependencies:**
- Depends on: US-WATCH-002
