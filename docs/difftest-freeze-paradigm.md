# Difftest Freeze Paradigm

> How Roll locks a command's observable contract: a **frozen expectation
> snapshot**, captured once and compared byte-for-byte thereafter — no engine
> spawn, no live oracle.
>
> 范式：命令的可观察契约用冻结期望快照守护——抓一次基线，之后逐字节对拍。

## Why

A command's contract is its observable surface — args, stdout, side effects,
exit code, the files and events it writes. Tests must lock *that*, not the
implementation. The freeze paradigm captures the proven-correct output once and
asserts against it forever: a regression snapshot, with no external process in
the loop.

一段行为的契约是它的可观察面（入参 / stdout / 副作用 / 退出码 / 写的文件与事件）。
测试锁的是这个，不是实现。冻结范式抓一次正确输出、之后永久对拍——回归快照，测试期不起任何外部进程。

> History: this convention was established while porting Roll's engine to
> TypeScript — each function was first proven byte-equal to its bash/python
> predecessor, then that output was frozen so the predecessor could be retired.
> Those engines are now gone; the snapshots remain as the regression guard.

**Status (US-PORT-021 / 021b): the bash/python oracles are gone.** `bin/roll`
and the dead `lib/*.py` were deleted (US-PORT-021). The difftests that
still shelled an oracle — `migrate` · `offboard` · `test` · `update` ·
`changelog` · `loop-story` — are now frozen snapshots
(`toMatchSnapshot`) of the proven-correct TS output (US-PORT-021b). They scrub
per-run volatility (the temp dir incl. macOS `/private` prefix, git SHAs,
relative-time spans / cycle-id timestamps) so the snapshot is platform-stable;
**CI (Linux/UTC) is the cross-platform gate** that catches any locale/TZ drift a
+8/macOS box would miss. No difftest spawns `bin/roll` / `python3` / `jq` anymore.

## The mechanical recipe

For each `*.difftest.test.ts` that spawns a live oracle:

1. **Capture once.** With the oracle still present (tests green ⇒ TS == oracle),
   run the TS side and capture its `{status, stdout, stderr}` (or structured
   result) for every case. The captured value *is* the oracle value.
   一次性捕获：测试还绿时 TS 输出即 oracle 输出，抓下来。

2. **Classify each output for portability — this is the load-bearing step:**
   - **Deterministic & portable** (derived from fixed string inputs, fixed
     `HOME`, fixed config content): freeze the exact literal.
     确定且可移植：原样固化为字面量。
   - **Volatile** (embeds a random `mktemp` path, a `realpath`'d tmp dir whose
     prefix differs across machines — macOS `/private/tmp` vs Linux `/tmp` — a
     timestamp, or a live pid): **do not freeze the raw bytes.** Either
     (a) feed the pure function a *fixed* input string so the output becomes
     deterministic, or (b) assert a stable substring / structural pattern
     (e.g. `/^slug-[0-9a-f]{6}$/`).
     易变（随机路径/realpath 前缀跨机不同/时间戳/pid）：改喂固定输入，
     或断言稳定子串/结构，**绝不冻结原始字节**——否则本机绿、CI 红。

3. **Delete the oracle spawn.** Remove the `bashX` / `pyX` helper, the
   `sed -n '/.../p' bin/roll` extraction, the `source lib/*.sh`, the transcribed
   bash snippet. Assert `expect(ts).toBe(FROZEN)` instead.
   删掉 spawn helper，断言改对拍冻结值。

4. **Verify green & record divergences.** Run the file's vitest. Note any
   intentional v3-vs-v2 divergence (e.g. a whitelisted behavior change) in a
   header comment, same as US-PORT-005 did for `changelog --help`.

## Already oracle-free (no conversion needed)

Tests that drive a **fabricated binary on `PATH`** (a fake `gh`, fake `tmux`,
fake `launchctl`/`crontab`) never spawned the v2 engine — they assert argv shape
and parse canned output. They already satisfy the US-PORT-009e gate and stay
as-is.
用 PATH 上假二进制（假 gh/tmux/launchctl）的测试本就不起旧引擎，无需转换。

## Freezing form: literal `toBe` vs inline snapshot

Both are frozen expectations with **zero engine spawn** — pick by output shape:

- **Scalar / small structured values** (a count, a sorted JSON object, a one-line
  string): freeze a literal with `expect(ts).toBe(FROZEN)` / `toEqual(FROZEN)`.
  Used by the spec/infra/core batches (009a/009b).
- **Multi-line, ANSI-coloured, or CJK CLI render output** (`roll status`,
  `agent list`, `backlog`, `doctor`, …): freeze with vitest
  `expect(ts).toMatchInlineSnapshot()`, captured once via `vitest -u`. The
  snapshot lives in the test file (visible, reviewable), auto-escapes ANSI/CJK,
  and is byte-exact — hand-transcribing such literals is error-prone and a single
  wrong byte reds CI. Used by the CLI read-only batch (009c).

Inline snapshots are keyed by **call site**, so a parametrized `for` loop whose
iterations produce *different* values cannot share one — **unroll** such loops
into explicit `it` blocks (one snapshot each). Loops whose iterations all yield
the *same* value may stay.

### Scrubbing volatile substrings before the snapshot

When the otherwise-deterministic output embeds a volatile fragment (a tmp path, a
`basename(cwd)`, a uid, `uname -srm`, the package.json version), do **not** freeze
the raw bytes (step 2). Instead scrub the known fragment to a placeholder *before*
the snapshot, e.g. `out.split(home).join("<HOME>")`, `…/${uid}/… → /<UID>/`,
`/- OS: .*/ → "- OS: <OS>"`. The test already knows the fabricated path/uid, so
the scrub is exact. For an inherently host-specific appendix (for example an
issue body Environment block), assert the deterministic prefix + structural
markers and replace the whole appendix with `<ENV>`.

## The portability trap (why step 2 matters)

A slug like `basename-<md5(path)>` looks freezable, but `md5` of a `realpath`'d
temp dir is **not portable**: macOS resolves `/tmp` → `/private/tmp`, Linux CI
does not, so a frozen md5 goes green locally and red in CI. For pure functions,
pass a fixed path *string* (no I/O, no realpath) so the md5 is of a constant. For
I/O-bound functions that must touch a real dir, assert the structure
(`basename` slug + 6 hex), not the exact md5.
教训同 difftest TZ 假绿：冻结 realpath 的 md5 会本机绿 CI 红。纯函数喂固定字符串，
I/O 函数断言结构。
