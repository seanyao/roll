# 测试质量评分卷（中文）

> 适用范围：`packages/*/test/` 下的 Vitest 测试。`roll-.dream` Scan 7 据此扫描代码并输出结构化 REFACTOR 条目。
> 英文版本：[quality-rubric.md](./quality-rubric.md)

本评分卷把六类常见反模式公开化：要么让测试在无关改动上误报红，要么让真正的回归绿着过线。
每类按相同四节展开：

- **定义** — 这条反模式是什么
- **判定信号** — 看测试文件本身就能识别
- **最小修复模板** — 最少改动的修复路径，不要求整体重写
- **真实代码反例** — 当前仓库里真实存在的一处

类目编号 ❶ ~ ❽。❶–❻ 为提醒级（dream 标出、维护者分诊）。❼ 和 ❽ 为**阻断级**：
loop cycle 的测试质量合并门（US-QA-012）会拒绝引入新的 ❼ 或 ❽ 违规的 PR，
哪怕 CI 是绿的也不放行。

---

## ❶ 断言体里硬编码业务数据

### 定义

测试在断言里直接写死业务值（价格、版本号、产品文案、模型 ID），而不是从被测模块或版本化 fixture
读取。业务值一调，所有把它写死的测试一起红，看上去全军覆没，其实没动到任何逻辑。

### 判定信号

- `[[ "$output" == *"..."* ]]` / `[ "$output" = "..." ]` 里出现的裸数字 / 裸字符串字面量
  正好等于源模块里的值。
- 同一个字面量在 ≥2 个测试文件出现（价格表、版本号、模型名）。
- 测试文件不是该值的"产权方"（比如 runner 测试断言价格，价格定义在 `packages/core/src/cost/prices.ts`）。

### 最小修复模板

```ts
// 改之前
it("opus rate is 5/25", () => {
  expect(computeListCost("claude-opus-4-7", usage)).toBe("5.0 25.0");
});

// 改之后 —— 喂固定 fixture 费率表，断"公式"而非线上费率
it("computeListCost 按 注入费率 × token 算", () => {
  const rates = { m: { in: 2, out: 4 } };
  expect(computeListCost("m", { input_tokens: 1000, output_tokens: 500 }, rates)).toBe(0.004);
});
```

或者对线上费率只断结构不变量（如 `cache_read < input`、`out ≥ in`），调价就不会无谓打红。

### 真实代码反例

`packages/core/test/prices.difftest.test.ts` 早先在断言里直接读线上 opus/sonnet/haiku
费率，每次调价就一起红、却没暴露任何回归。现在算术喂固定 fixture 表，对线上费率只断
结构不变量。

---

## ❷ 过度 mock 边界

### 定义

测试把本应实打实跑的边界 mock 掉了 —— 数据库、文件系统、子进程 spawn、git 调用 —— 测试
对着虚假实现绿了，第一次跑真实集成时就崩。

### 判定信号

- 单元测试顶部出现 `function git() { … }` / `function gh() { … }` 这种全局覆写，
  而被测代码本来就该跑真 git / 真 gh。
- 把 SQL 或文件系统调用换成内联返回手写串的 stub。
- mock 写在测试文件自己里、不在共享的测试 helper 模块里，说明是临时打补丁，不是共享。

### 最小修复模板

```ts
// 用真实的临时基底（tmp git repo / tmpdir），afterEach/afterAll 清掉。
let dir: string;
beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), "t-"))); execSync("git init -q", { cwd: dir }); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
```

如果某条边界在单元层确实跑不动（网络、gh、launchctl），把它做成可注入的 port/依赖、
测试里传 fake —— 即 `runner-executor.test.ts` 用 `fakePorts()` 的那套。

### 真实代码反例

任何在测试里零散用 `const gh = () => ({...})` 来模拟 loop PR 路由的写法。修法是注入
`GithubPort`（见 `packages/cli/test/runner-executor.test.ts`），让同一个 fake 共享、明确、可被发现。

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
- 模块级（或 `beforeAll`）fixture 改了共享状态、没人重置，后面的测试默默依赖它。
- 单跑能过，跑全套就红；反过来也算。

### 最小修复模板

每条测试的状态在 `beforeEach` 里建（自己的 tmpdir / env / fixture），断言，再在
`afterEach` 清掉。跨测试依赖只在真有必要时显式存在，且走一个有名字的 helper，
绝不靠隐式顺序或共享可变量。

### 真实代码反例

任何 `beforeAll` 改写 `$HOME` 或写共享 state-`<slug>.yaml`、然后下一个测试不重置
就直接读的测试文件都是候选。修法是每条测试用一个新 `mkdtempSync` + 注入 home/root 做隔离。

---

## ❺ 测私有函数 / 绕过公共 API

### 定义

测试直接伸进模块去调私有 helper、对它的返回值做断言。这个 helper 可以被改名、内联、
甚至删掉而不改变行为 —— 但测试会喊"回归了"。

### 判定信号

- 测试从模块内部深 import 一个未导出的 helper、直接喊它名字。
- 函数名以 `_` 开头（项目约定为私有），但测试却依赖它的签名。
- 整个测试文件根本没碰公共 API；它测的是内部分解方式。

### 最小修复模板

把调用走回公共入口（`roll <cmd>` / `my-tool foo`）。如果公共 API 覆盖不到要测的场景，
那是真实的功能缺口 —— 要么该场景根本不可达（删测试），要么公共 API 应该补一个 flag
（明确地加上去）。

### 真实代码反例

从后门 import 一个未导出的私有函数（如 `_loopCheckDependsOn`）来测，把函数名锁死了。正确
做法是跑命令、然后从 run log 里观察 skip 决策 —— 测用户在乎的行为。

---

## ❻ 断言框架行为

### 定义

测试在测 Vitest 本身（或任何框架），不是项目代码：断言 `beforeEach` 会在测试
之前跑、mock 记录了调用、`expect` 存在……框架是对的，所以测试是绿的，但对项目
没传递任何信息。

### 判定信号

- 断言框架内部 / 测试运行器自身的行为。
- 测试体里全是 setup/teardown 自检，没有任何对项目代码的调用。
- 框架升级之后新增的"确认 Vitest 还能跑"的测试。

### 最小修复模板

删掉。框架验证应该在上游做。如果项目真的依赖某个框架契约，把它写进一个共享
测试 helper 模块的文档里 + 一条 smoke 测试，而不是一整类断言。

### 真实代码反例

断言测试运行器内部计数的测试，每次 CI 都跑、从来没拦下过一次项目回归。如果
真要保留这种保障，放进 CI 配置里跑一次就够，不必落到测试套里。

---

## ❼ 测试内联外部工具行为

### 定义

测试体用内联的 shell 管道（`sed`、`grep`、`find`、`awk`、`tr`）把外部工具
的行为重新实现了一遍，而不是调用项目里已有的封装函数。当项目替换工具或改变内部
解析逻辑时，所有抄了这段管道的测试一起红，但公共 API 的输出根本没变。

### 判定信号

- 测试体里出现 `foo=$(echo "$output" | grep ... | sed ... | awk ...)` 这种链式调用。
- 同样的管道在 ≥2 个测试文件出现（解析逻辑被复制粘贴）。
- 项目里已经（或者本该）有一个函数封装了这个解析，但测试绕过了它自己搞了一遍。

### 最小修复模板

```ts
// 改之前 —— 内联正则复刻了项目函数已经做的事
const label = /<key>Label<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1];

// 改之后 —— 调项目里处理这件事的函数
import { plistString } from "../src/lib/plist.js";
const label = plistString(plist, "Label");
```

如果项目里还没有对应函数，把解析抽成一个有名字的 helper 模块，
让逻辑共享、可被发现。

### 真实代码反例

一条集成测试用手搓的正则链去解析 plist XML 提取 `<string>` 值，而不是 import 项目
自己的 plist 解析器。将来 schema 一改，所有抄了这段的测试都得跟着修——解析器才是
唯一该改的产权方。

---

## ❽ 测试断言触及仓库外的文件

### 定义

测试断言里读或检查的文件路径在仓库根目录之外（如 `~/.roll/`、`~/.codex/`、
`/etc/`、`/tmp/other-project/`）。换了机器或用户 home 目录状态不同时，测试要么
误报失败，要么更糟——恰好通过了却在测错的东西。

### 判定信号

- 断言里读/检查 `~/.xxx/...` 下的文件。
- 一个 tmp 路径不是测试文件自己创建的。
- 路径以 `~`、`${HOME}`、`/Users/` 或 `/home/` 开头，并且不是测试文件自己建的。

### 最小修复模板

```ts
// 改之前 —— 断言了一个仓库外、依赖本机环境的文件
it("skill file is synced", () => {
  expect(readFileSync(`${homedir()}/.roll/skills/roll-.dream/SKILL.md`, "utf8")).toMatch(/Scan 6/);
});

// 改之后 —— 在测试自己控制的 tmpdir 里重建最小 fixture
it("skill file includes Scan 6", () => {
  const home = mkdtempSync(join(tmpdir(), "h-"));
  mkdirSync(join(home, ".roll/skills/roll-.dream"), { recursive: true });
  writeFileSync(join(home, ".roll/skills/roll-.dream/SKILL.md"), "### Scan 6 — Doc Freshness\n");
  expect(checkSkillHasScan6({ home })).toBe(true);
});
```

如果测试的目的确实是与外部文件打交道，注入 home/root 路径（一个 tmpdir），
让测试在不同机器上结果一致。

### 真实代码反例

一条 dream-scan 测试断言 `${HOME}/.roll/skills/roll-.dream/SKILL.md`——一个仓库外的
文件，内容取决于用户有没有跑过 `roll setup`。没装 Roll 的机器、或装了旧版本的机器上，
这条测试会挂，但项目本身代码其实没问题。改法：把 fixture 沙箱进一个临时 `HOME`。

---

## `roll-.dream` 怎么消费这份评分卷

`roll-.dream` Scan 7 扫描测试套，按每类的判定信号匹配，每轮 ≤ 5 条 REFACTOR
（避免把 backlog 淹没），每条标上对应类目编号：

```markdown
| REFACTOR-XXX | docs: <一句人话描述> [test-quality:❶] — flagged by dream YYYY-MM-DD | 📋 Todo |
```

维护者在早晨 brief 时分诊 REFACTOR 队列。
