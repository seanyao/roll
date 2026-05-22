# 测试质量评分卷（中文）

> 适用范围：`tests/` 下的 bats 测试。`roll-.dream` Scan 7 据此扫描代码并输出结构化 REFACTOR 条目。
> 英文版本：[quality-rubric.md](./quality-rubric.md)

本评分卷把六类常见反模式公开化：要么让测试在无关改动上误报红，要么让真正的回归绿着过线。
每类按相同四节展开：

- **定义** — 这条反模式是什么
- **判定信号** — 看测试文件本身就能识别
- **最小修复模板** — 最少改动的修复路径，不要求整体重写
- **真实代码反例** — 当前仓库里真实存在的一处

类目编号 ❶ ~ ❻；`roll-.dream` 给每条发现都打上对应的编号 tag，下游过滤就是机械动作。

---

## ❶ 断言体里硬编码业务数据

### 定义

测试在断言里直接写死业务值（价格、版本号、产品文案、模型 ID），而不是从被测模块或版本化 fixture
读取。业务值一调，所有把它写死的测试一起红，看上去全军覆没，其实没动到任何逻辑。

### 判定信号

- `[[ "$output" == *"..."* ]]` / `[ "$output" = "..." ]` 里出现的裸数字 / 裸字符串字面量
  正好等于源模块里的值。
- 同一个字面量在 ≥2 个测试文件出现（价格表、版本号、模型名）。
- 测试文件不是该值的"产权方"（比如 runner 测试断言价格，价格定义在 `lib/model_prices.py`）。

### 最小修复模板

```bash
# 改之前
@test "opus rate is 5/25" {
  run my_cmd
  [[ "$output" == *"5.0 25.0"* ]]
}

# 改之后 —— 从源模块导入
@test "opus rate matches PRICES[claude-opus-4-7]" {
  expected=$(python3 -c "import lib.model_prices as m; \
    p=m.PRICES['claude-opus-4-7']; print(p['in'], p['out'])")
  run my_cmd
  [[ "$output" == *"$expected"* ]]
}
```

或者把字面量替换成注入式 fixture（`tests/fixtures/prices.json`），让"数值"只在一处存在，
测试体里只剩下对"公式"的断言。

### 真实代码反例

`tests/unit/model_prices.bats` 第 15–31 行把 opus/sonnet/haiku 价格（`5.0 25.0`、
`3.0 15.0`、`1.0 5.0`）硬编码进断言体。模型定价做一次调整，这批测试就一起红，但其实
价格解析逻辑没坏。

---

## ❷ 过度 mock 边界

### 定义

测试把本应实打实跑的边界 mock 掉了 —— 数据库、文件系统、子进程 spawn、git 调用 —— 测试
对着虚假实现绿了，第一次跑真实集成时就崩。

### 判定信号

- 单元测试顶部出现 `function git() { … }` / `function gh() { … }` 这种全局覆写，
  而被测代码本来就该跑真 git / 真 gh。
- 把 SQL 或文件系统调用换成内联返回手写串的 stub。
- mock 写在测试文件自己里、不在 `tests/helpers/`，说明是临时打补丁，不是共享。

### 最小修复模板

```bash
# 用真实的临时基底（tmp git repo / sqlite 文件 / tmpdir），teardown 时清掉。
setup() {
  TMP=$(mktemp -d); cd "$TMP"; git init -q
}
teardown() { rm -rf "$TMP"; }
```

如果某条边界在单元层确实跑不动（网络、launchctl 等），把测试搬到 `tests/integration/`，
接受它跑慢层；但不要在单元层假装它能跑。

### 真实代码反例

任何在测试文件顶部用 `function gh() { echo '{...}' }` 来模拟 loop PR 路由的单元测试。
修法是把 fake 收进 `tests/helpers/`，让它共享、明确、可被发现。

---

## ❸ 断言实现细节

### 定义

测试断言的不是观察得到的行为，而是内部状态的"形状"：私有函数名、中间变量值、内部缓存
文件路径。一次保留行为的重构就让测试红，本来该绿色放行的改动被卡死。

### 判定信号

- `grep -q '_internal_helper' "$output"` —— 断言一个私有符号名被外露。
- `[[ "$(cat .roll/internal/_cache.tmp)" == ... ]]` —— 断言一个公共 API 从未承诺的
  内部缓存路径。
- 即使发生真正的行为回归，这种断言还能过，因为它在错的层做检查。

### 最小修复模板

把断言"重新锚"到**公共效果**：退出码、用户可见输出、调用方能感知到的状态。如果内部细节
是唯一可见的东西，那往往说明生产代码缺一个对外的薄 API 层，应当主动加上。

### 真实代码反例

断言 `grep -q '_loop_check_depends_on' <output>` 的测试，函数一改名就红，但 gating
逻辑没动。正确的断言是"故事 X 因依赖 Y 没满足被跳过"，从公共副作用（故事仍是 📋 Todo、
日志行被打出来）来观察。

---

## ❹ Fixture 顺序耦合

### 定义

测试之间共享可变状态（文件、环境变量、临时目录），依赖一个固定的运行顺序。并发跑、
`--filter` 单跑、或者重排顺序都会引发偶发失败，看上去像 flaky test，其实是耦合。

### 判定信号

- A 测试读 B 测试在同文件里写下的状态。
- `setup_file()` 建了状态、`teardown_file()` 没清掉，后面的测试默默依赖它。
- 单跑能过，跑全套就红；反过来也算。

### 最小修复模板

把所有 setup 搬到 `setup()`（每条测试自己跑一遍），不再用 `setup_file()`。每条测试
自己建 tmpdir / env / fixture，自己断言，自己拆掉。跨测试依赖只在真有必要时显式存在，
而且要走一个有名字的 helper，绝不靠隐式顺序。

### 真实代码反例

任何 `setup_file()` 改写 `$HOME` 或写共享 state-`<slug>.yaml`、然后下一个测试不重置
就直接读的 bats 文件都是候选。修法是用 `mktemp -d` + 显式 `HOME=$tmp` 做单测隔离。

---

## ❺ 测私有函数 / 绕过公共 API

### 定义

测试直接伸进模块去调私有 helper、对它的返回值做断言。这个 helper 可以被改名、内联、
甚至删掉而不改变行为 —— 但测试会喊"回归了"。

### 判定信号

- 测试 `source lib/internal/foo.sh` 然后直接喊 `_private_helper`。
- 函数名以 `_` 开头（项目约定为私有），但测试却依赖它的签名。
- 整个测试文件根本没碰公共 API；它测的是内部分解方式。

### 最小修复模板

把调用走回公共入口（`roll <cmd>` / `my-tool foo`）。如果公共 API 覆盖不到要测的场景，
那是真实的功能缺口 —— 要么该场景根本不可达（删测试），要么公共 API 应该补一个 flag
（明确地加上去）。

### 真实代码反例

`source bin/roll; _loop_check_depends_on US-X` 这种写法的测试，把函数名锁死了。正确
做法是跑 `roll loop now` 然后从 run log 里观察 skip 决策 —— 测用户在乎的行为。

---

## ❻ 断言框架行为

### 定义

测试在测 bats 本身（或 pytest / jest 自身），不是项目代码：断言 `setup()` 会在测试
之前跑、`run` 会捕获 stderr、`@test` 块存在……框架是对的，所以测试是绿的，但对项目
没传递任何信息。

### 判定信号

- 断言 bats 内部变量：`$BATS_TEST_NUMBER` / `$BATS_SUITE_NAME`。
- 测试体里全是 setup/teardown 自检，没有任何对项目代码的调用。
- 框架升级之后新增的"确认 bats 还能跑"的测试。

### 最小修复模板

删掉。框架验证应该在上游做。如果项目真的依赖某个框架契约，把它写进 `tests/helpers/`
的文档里 + 一条 smoke 测试，而不是一整类断言。

### 真实代码反例

断言 `$BATS_TEST_NUMBER > 0` 的测试，每次 CI 都跑、从来没拦下过一次项目回归。如果
真要保留这种保障，放进 CI 配置里跑一次就够，不必落到测试套里。

---

## `roll-.dream` 怎么消费这份评分卷

`roll-.dream` Scan 7 扫描测试套，按每类的判定信号匹配，每轮 ≤ 5 条 REFACTOR
（避免把 backlog 淹没），每条标上对应类目编号：

```markdown
| REFACTOR-XXX | docs: <一句人话描述> [test-quality:❶] — flagged by dream YYYY-MM-DD | 📋 Todo |
```

维护者在早晨 brief 时分诊 REFACTOR 队列。
