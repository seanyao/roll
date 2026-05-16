# Feature: landing-page

<a id="us-web-001"></a>
## US-WEB-001 首屏 hero 动画讲清三层自治故事 — 双帧叙事 + 时间快进转场 📋

**Created**: 2026-05-17
**Plan**: [landing-page-plan.md](landing-page-plan.md)

- As a 第一次访问 https://seanyao.github.io/Roll/ 的潜在用户
- I want 在首屏 4-6 秒内看懂这个产品到底干什么、自治到什么程度
- So that 不必滚动到 HOW 段读文字，仅凭右侧动画就能 grok"装一次开关，47 分钟后它自己跑出一轮交付"

**Domain Model:**
- Context: Marketing & Site
- Aggregate: Hero Animation (Root) owns [Frame, Transition, Fixture]
- Events raised: 无
- Cross-context: 消费 Loop Observability 提供的 cycle-sample.ndjson fixture

**AC:**
- [ ] Terminal 组件改造为双帧状态机：Frame A（install）/ Transition（time-lapse）/ Frame B（cycle）
- [ ] Frame A 显示 4 行 install 回执，逐条 fade-in，hold 800ms
- [ ] Transition：body 文字 dim 到 20%，右下角浮现数字时钟从 10:23 跳到 11:05，途中飘过 3 行 idle 幽灵字
- [ ] Transition 时长 1200ms，时钟到 11:05 时整体复亮、chrome pulse 由灰变绿
- [ ] Frame B 读 `docs/site/cycle-sample.ndjson`（US-LOOP-001 产出），按 stage 字段渲染 7 行 cycle 事件
- [ ] 完整动画结束后 hold 2000ms，循环重播
- [ ] 实现 `@media (prefers-reduced-motion: reduce)`：跳过时钟旋转和 dim，仅做两帧硬切，整轮压到 ~4.5s
- [ ] chrome title 随帧切换：`roll · install` → `roll · idle` → `roll-loop-roll · cycle #047`
- [ ] Frame B 的事件行颜色按 outcome 着色（绿 ok / 红 fail / 黄 warn）
- [ ] 视觉回归：截图对比当前 hero 在浅色 / 深色主题下的关键帧（Frame A 末 / Transition 中段 / Frame B 末）
- [ ] Lighthouse 性能不退化（动画用 CSS transform / opacity，不触发 layout）
- [ ] 移动端窄屏（≤640px）回退到静态终端截图（不播动画），避免动画在小屏被压扁失真

**Files:**
- `docs/site/roll-data.js` — TERMINAL 数组改造为双帧 fixture 引用
- `docs/site/roll-atoms.jsx` — Terminal 组件改造为状态机（Frame A / Transition / Frame B）
- `docs/site/roll-site.css` — 新增时钟样式、dim 过渡、idle 幽灵字样式、reduced-motion 媒体查询
- `docs/site/cycle-sample.ndjson` — 消费由 US-LOOP-001 录制的 fixture
- `docs/features/landing-page.md` / `landing-page-plan.md` — 本 feature 文档

**Dependencies:**
- Depends on: US-LOOP-001（提供 cycle-sample.ndjson fixture，让 Frame B 内容与产品物理同源）
- Depended on by: 无

**Data Flow:**
- Producer: US-LOOP-001 录制的样本 cycle 写入 `docs/site/cycle-sample.ndjson`
- Consumer: Terminal 组件在浏览器内 fetch 并播放
- Integration test: 无传统集成测试（前端视觉），用 Playwright 视觉回归覆盖
