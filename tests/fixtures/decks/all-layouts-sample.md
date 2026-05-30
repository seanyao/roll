---
template: introduction-v3
slug: all-layouts-sample
title_en: "All Layouts Sample"
title_zh: "全布局样例"
total_slides: 6
created: 2026-05-23
---

## Slide 1
layout: cards-2
title_en: "Two Pillars"
title_zh: "两大支柱"
cards:
  - title_en: "Speed"
    title_zh: "速度"
    body_en: "Ship in minutes."
    body_zh: "几分钟内交付。"
  - title_en: "Safety"
    title_zh: "安全"
    body_en: "TCR keeps green."
    body_zh: "TCR 保持绿灯。"
evidence:
  - README.md:1

## Slide 2
layout: compare
title_en: "Before vs After"
title_zh: "前后对比"
left_title_en: "Before"
left_title_zh: "之前"
right_title_en: "After"
right_title_zh: "之后"
left_items:
  - text_en: "Manual steps"
    text_zh: "手动步骤"
  - text_en: "Slow feedback"
    text_zh: "反馈慢"
right_items:
  - text_en: "Automated"
    text_zh: "自动化"
  - text_en: "Fast feedback"
    text_zh: "反馈快"
evidence:
  - README.md:1

## Slide 3
layout: pipeline
title_en: "Build Pipeline"
title_zh: "构建流水线"
stages:
  - title_en: "Stage"
    title_zh: "暂存"
    desc_en: "git add -A"
    desc_zh: "git add -A"
  - title_en: "Test"
    title_zh: "测试"
    desc_en: "roll test"
    desc_zh: "roll test"
  - title_en: "Commit"
    title_zh: "提交"
    desc_en: "git commit"
    desc_zh: "git commit"
evidence:
  - README.md:1

## Slide 4
layout: timeline
title_en: "Project Evolution"
title_zh: "项目演进"
items:
  - title_en: "Phase 1"
    title_zh: "阶段一"
    body_en: "Generate and render."
    body_zh: "生成与渲染。"
  - title_en: "Phase 1.5"
    title_zh: "阶段 1.5"
    body_en: "Maturity and recovery."
    body_zh: "成熟化与恢复。"
  - title_en: "Phase 2"
    title_zh: "阶段二"
    body_en: "Visual richness."
    body_zh: "视觉富度。"
evidence:
  - README.md:1

## Slide 5
layout: quote
title_en: "What Users Say"
title_zh: "用户原话"
text_en: "Roll turned a 3-minute black screen into a deck I can share."
text_zh: "Roll 把 3 分钟的黑屏变成了我能分享的演示。"
evidence:
  - README.md:1

## Slide 6
layout: highlight
title_en: "Key Takeaway"
title_zh: "关键结论"
body_en: |
  One command takes a topic to a shareable HTML deck.
body_zh: |
  一条命令把主题变成可分享的 HTML 演示。
evidence:
  - README.md:1
