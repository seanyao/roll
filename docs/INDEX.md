# Docs Index

roll 文档目录——每个 public-facing doc 在此登记，CI 用此表检查完整性。

| 文档 | 主题 | 关键章节/锚点 |
|------|------|---------------|
| [architecture.md](architecture.md) | 系统设计全貌 | 产品定位 · 设计五原则 · 系统架构 · 能力域归宿 · 领域模型(BC1–BC8) · 行为合同(I1–I12) · 事实来源(US-TRUTH) |
| [architecture.md#结构化交付真相-deliveryrecord--deliveriesjsonl](architecture.md#结构化交付真相-deliveryrecord--deliveriesjsonl) | 结构化交付真相(DeliveryRecord / deliveries.jsonl) | 写入规则 · 读取规则 |
| [architecture.md#生命周期与裁定正交](architecture.md#生命周期与裁定正交) | LifecycleState ⊥ TruthState 正交 | 两维独立字段 · 不混不塌缩 |
| [architecture.md#唯一查询入口-querystorydelivery](architecture.md#唯一查询入口-querystorydelivery) | queryStoryDelivery 唯一查询入口 | 消费者契约 · 硬约束 · deriveBacklogStatus · CLI truth query |
| [architecture.md#存储裁定不上-sqlite-当源](architecture.md#存储裁定不上-sqlite-当源) | 不上 SQLite 当源的裁定 | 3-agent 会审 · 4 条理由 · JSONL 方案 |
| [architecture.md#消费者契约总结](architecture.md#消费者契约总结) | 消费者契约总结 | picker/reconcile/dossier/watch/release/shadow audit |
| [difftest-freeze-paradigm.md](difftest-freeze-paradigm.md) | 测试冻结快照范式 | 行为契约 · scrub 策略 · CI 跨平台 |
| [manifesto.md](manifesto.md) | 项目宣言 | 愿景与原则 |
| [verification.md](verification.md) | 验证体系 | 测试金字塔 · E2E · CI 门 |
