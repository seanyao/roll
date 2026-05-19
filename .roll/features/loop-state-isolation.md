# Loop Shared-State Isolation Contract

> Origin: FIX-065 根因分析 — 2026-05-19 那次 cycle 跑 FIX-064 时被自己写的测试吓停。

## 触发事件

2026-05-19 11:11 启动的 cycle `20260519-111112-38945`：

```
11:11  cycle 启动，挑到 FIX-064
11:17  TCR commit 425e740 落地（test + lib + bin）
11:21  ALERT-roll-d9dfa0.md 被写入，Story 字段写的是 US-TEST-001
11:22  cycle 看到 ALERT → 中断 publish → tmux 退出
       FIX-064 改动留在 branch loop/cycle-20260519-111112-38945，未合 main
```

US-TEST-001 是测试套件里的虚拟 story ID。意思是：cycle 自己跑的测试，把假报警写进了 loop 自己监控的真实路径，然后 loop 看到这个假信号就把自己关了。

## 三层失守

```
第1层  报警/状态文件的默认值直接指向生产
       未显式设置就回退到 ~/.shared/roll/loop/...
       → 测试忘改 = 自动指向生产

第2层  子进程边界对测试作者不可见
       bats setup() 里 _LOOP_ALERT=... 只对同进程函数有效
       一旦测试 spawn 子进程跑 CLI，变量不继承 → 静默回退到默认值
       同进程测试看着都没事，子进程测试静默泄漏

第3层（最关键）  自我吞噬的反馈环
       cycle ──→ 跑测试 ──→ 测试写 ALERT ──→ cycle 自杀
         ↑                                       │
         └───────────────────────────────────────┘
       报警通道既是输出口，又是输入口，还是普通函数可写
       没有"谁有资格写""现在写算不算数"的边界
```

## 当前共享状态文件清单

`~/.shared/roll/loop/` 下、任何 loop cycle 都会读/写的文件：

- `ALERT-<slug>.md`（报警 + 健康闸门）
- `state.yaml` / `state-<slug>.yaml`（cycle 状态机）
- `.heartbeat-<slug>`（liveness 信号）
- `.LOCK-<slug>`（互斥锁）
- `runs.jsonl`（历史）
- `events-<slug>.ndjson`（事件流）

每一个都满足"默认值=生产路径 + 没有沙盒契约"的模式。今天是 ALERT 翻车，明天可能是 state.yaml 或 LOCK 被某个测试踩到。

## 治本方案

### 1. 写入闸门：默认拒写生产

把所有共享状态文件路径的默认解析从「fallback 到生产」改成「未提供路径就 abort」。

```
现状（不健康）        目标（健康）
──────────────       ──────────────
: "${X:=prod-path}"   [[ -z "$X" ]] && fail "X must be set"
```

副作用：所有 CLI / 函数入口在调用前必须显式提供路径。生产侧由 loop 自己注入；测试侧由 harness 注入沙盒前缀。

### 2. 测试 harness 强制注入沙盒

bats `helpers` 加一道 `loop_state_sandbox`：在 `setup()` 里 export 所有 loop 状态变量到 `$TEST_TMP/` 下；再加一个"路径前缀检查"——如果运行中检测到任何 `~/.shared/roll/` 路径被打开，立即 abort 测试。

```
sandboxed_state() {
  export _LOOP_ALERT="${TEST_TMP}/alert"
  export _LOOP_STATE="${TEST_TMP}/state.yaml"
  export _LOOP_HEARTBEAT="${TEST_TMP}/heartbeat"
  export _LOOP_LOCK="${TEST_TMP}/lock"
  export _SHARED_ROOT="${TEST_TMP}"   # 一锅端
}
```

`_SHARED_ROOT` override 是最稳的——所有派生路径都会跟着走，子进程也继承（因为 export）。

### 3. 当前事故的扫尾

- 测试侧：`tests/unit/loop_tcr.bats` 第 108、120 行那两个 `"$ROLL_BIN" loop enforce-tcr` 子进程测试，setup() 里 `_LOOP_ALERT` 没 export → 立刻补 export 或改用 `_SHARED_ROOT` override
- 生产侧：清掉本次污染的 ALERT、重置卡住的 state.yaml、捡回 FIX-064 commit 425e740

## 拆分建议

如果按 INVEST 拆，至少两块：

- **S1（治本）**：所有 loop 共享状态文件加入"路径必须显式提供"的契约 + 测试 harness 沙盒注入
- **S2（防御）**：路径前缀检查——任何指向 `~/.shared/roll/` 的写动作在测试环境一律 abort

S1 已能切断今天这条事故链；S2 是为了拦住所有未来同类型事故。

## 验收

- 删掉测试里所有针对 `_LOOP_ALERT` 等的局部赋值，全靠 harness sandbox
- 故意写一个"忘记 sandbox"的反例测试，CI 必须红
- loop 的真实 ALERT/state 文件在测试套件跑完后必须 `mtime` 不变
