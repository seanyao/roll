# roll-meta/

Roll 项目自身的内部事项，与 Roll **作为产品**提供给 roll-using projects 的能力分离。

## 这里放什么

- 只有 Roll 维护者关心、roll-using 项目完全不在乎的需求
- 例：监视上游 AI CLI 升级影响 Roll 承载层、Roll 自己的发版流程相关内容

## 与根目录 `BACKLOG.md` / `docs/features.md` 的区别

| | 根 BACKLOG / features.md | roll-meta/ |
|---|---|---|
| 受众 | 任何使用 Roll 的项目 | 只有 Roll 这一个项目 |
| 是否被 roll-loop 扫描 | 是 | 否 |
| 是否进 CHANGELOG / Release Notes | 是 | 否 |
| 是否被 features-sync 测试校验 | 是 | 否 |

## 当前条目

- `BACKLOG.md` — 内部待办
- `features/` — 与之配套的 Feature 设计文档
