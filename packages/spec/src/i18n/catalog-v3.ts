/**
 * v3-native message catalog. The frozen v2 catalog (catalog.generated.json) is
 * mechanically derived from the bash oracle and must not be hand-edited; strings
 * for behaviour that is new in v3 live here instead (see catalog.ts header).
 *
 * Both en and zh are always present so the single-language contract (output
 * follows ROLL_LANG, never mixes) holds.
 */
import type { Catalog } from "./index.js";

export const v3Catalog: Catalog = {
  // `agent.*` — v3-native agent roster compatibility messages (US-AGENT-045).
  "agent.use_removed_agent": {
    en: "'%s' is no longer supported. Use one of: claude, kimi, codex, pi, agy, reasonix",
    zh: "'%s' 已不再支持。请使用：claude, kimi, codex, pi, agy, reasonix",
  },

  // `agent.*` — v4 default-agent vs project route-profile separation (US-V4-002).
  "agent.default_usage": {
    en: "Usage: roll agent default <agent>",
    zh: "用法：roll agent default <agent>",
  },
  "agent.default_current": {
    en: "Machine default agent: %s",
    zh: "机器默认 agent：%s",
  },
  "agent.default_none": {
    en: "No machine default agent set yet (falls back to the first installed agent)",
    zh: "尚未设置机器默认 agent（回退到首个已安装的 agent）",
  },
  "agent.default_unknown_agent": {
    en: "Unknown agent '%s'. Use one of: claude, kimi, codex, pi, agy, reasonix",
    zh: "未知 agent '%s'。可用：claude, kimi, codex, pi, agy, reasonix",
  },
  "agent.default_saved": {
    en: "Machine default agent set to %s",
    zh: "机器默认 agent 已设为 %s",
  },
  "agent.default_routes_followed": {
    en: "Project routes that followed the old default were updated to %s",
    zh: "原先跟随旧默认的项目路由已更新为 %s",
  },
  "agent.default_routes_preserved": {
    en: "Customized project routes in .roll/agents.yaml were preserved",
    zh: "已保留 .roll/agents.yaml 中自定义的项目路由",
  },
  "agent.use_retired": {
    en: "`roll agent use` is retired. Set the machine default with `roll agent default <agent>`, or override one project route with `roll agent set <route> <agent>`.",
    zh: "`roll agent use` 已退役。用 `roll agent default <agent>` 设置机器默认，或用 `roll agent set <route> <agent>` 覆盖单条项目路由。",
  },
  "agent.view_default_label": {
    en: "Default agent (~/.roll/config.yaml)",
    zh: "默认 agent（~/.roll/config.yaml）",
  },
  "agent.view_routes_label": {
    en: "Project routes (.roll/agents.yaml)",
    zh: "项目路由（.roll/agents.yaml）",
  },

  // `ideav3.*` — the live `roll idea` capture command (US-PORT-003). Both en and
  // zh are always present so the single-language contract (output follows
  // ROLL_LANG, never mixes) holds.
  "ideav3.recorded": {
    en: "Recorded as %s",
    zh: "已记录为 %s",
  },
  "ideav3.type": {
    en: "Type",
    zh: "类型",
  },
  "ideav3.section": {
    en: "Section",
    zh: "分区",
  },
  "ideav3.text": {
    en: "Text",
    zh: "描述",
  },
  "ideav3.kind_bug": {
    en: "bug",
    zh: "缺陷",
  },
  "ideav3.kind_idea": {
    en: "idea",
    zh: "想法",
  },
  "ideav3.usage": {
    en: "Usage: roll idea <description>",
    zh: "用法：roll idea <描述>",
  },
  "ideav3.empty": {
    en: "Provide a short description to capture",
    zh: "请提供一句简短描述以记录",
  },
  "ideav3.lint_failed": {
    en: "Description fails backlog lint (%s) — not recorded",
    zh: "描述未过待办校验（%s）— 未记录",
  },
  "ideav3.lint_hint": {
    en: "Shorten to one plain sentence: ≤120 chars, no code, paths, filenames, or function names",
    zh: "精简为一句人话：≤120 字，不含代码、路径、文件名或函数名",
  },
  "ideav3.conflict": {
    en: "Backlog changed on disk — re-run to capture",
    zh: "待办文件已变更 — 请重试以记录",
  },

  // `releasev3.*` — the read-only release-guidance command (US-PORT-004). `roll
  // release` computes the next calver version, surfaces changelog readiness, and
  // prints the PR/tag flow; it NEVER pushes a tag or publishes (release is always
  // a human decision). Both en and zh present so the single-language contract
  // (output follows ROLL_LANG, never mixes) holds.
  "releasev3.usage": {
    en: "Usage: roll release [--dry-run|--yes|--showcase|--json]\n  The ONE release flow: bump → changelog fold → package gate → commit-push → consistency gate → PR → auto-merge → tag push.\n  Drives the merge itself via GitHub auto-merge (needs \"Allow auto-merge\" on the repo); prints progress while it waits and nudges CI if it stalls.\n  The consistency gate runs BEFORE the PR — a drifting release aborts before anything merges. Stops at the tag push; npm publish stays yours. No subcommands remain.\n  --showcase  After a successful release, run the golden-path showcase (real models; recommended, non-blocking — never fails the release).",
    zh: "用法：roll release [--dry-run|--yes|--showcase|--json]\n  唯一发版流：版本号 → 折叠 changelog → 包闸 → 提交推送 → 一致性闸 → PR → 自动合并 → 推 tag。\n  自驱合并（GitHub auto-merge，需仓库开启 “Allow auto-merge”）；等待期间打印进度，CI 卡住时自动推一下。\n  一致性闸在开 PR 之前先跑——漂移的发版会在任何东西合并前中止。止步于推 tag；npm publish 仍由你执行。不再有子命令。\n  --showcase  发版成功后跑一次黄金路径 showcase（真模型；建议、非硬卡——绝不让发版失败）。",
  },
  "releasev3.title": {
    en: "Release plan",
    zh: "发版计划",
  },
  "releasev3.current": {
    en: "Current version",
    zh: "当前版本",
  },
  "releasev3.next": {
    en: "Suggested next",
    zh: "建议下一版",
  },
  "releasev3.tag": {
    en: "Tag",
    zh: "标签",
  },
  "releasev3.changelog": {
    en: "Changelog",
    zh: "更新日志",
  },
  "releasev3.changelog_ready": {
    en: "Unreleased section has content",
    zh: "未发布区有内容",
  },
  "releasev3.changelog_empty": {
    en: "nothing under Unreleased — add entries to CHANGELOG.md before releasing",
    zh: "未发布区为空 — 发版前先把条目写进 CHANGELOG.md",
  },
  "releasev3.flow_title": {
    en: "Release flow (run these yourself — a release is always a human decision):",
    zh: "发版流程（请亲手执行 — 发版始终由人拍板）：",
  },
  "releasev3.step_bump": {
    en: "Bump package.json version to %s",
    zh: "把 package.json 版本号改为 %s",
  },
  "releasev3.step_commit": {
    en: "Commit the bump and open a PR to main",
    zh: "提交版本号变更并向 main 开 PR",
  },
  "releasev3.step_merge": {
    en: "After CI is green and the PR is merged, pull main",
    zh: "CI 通过且 PR 合并后，拉取 main",
  },
  "releasev3.step_tag": {
    en: "Tag %s and push the tag — this triggers the release workflow",
    zh: "打标签 %s 并推送 — 触发发版流水线",
  },
  "releasev3.gate_note": {
    en: "The consistency gate runs on tag push and aborts the release on any gap.",
    zh: "一致性闸在推送标签时运行，任一维度对不上即中止发版。",
  },
  "releasev3.gate_preview": {
    en: "Preview locally with: roll release --dry-run",
    zh: "本地预检：roll release --dry-run",
  },
  "releasev3.no_pkg": {
    en: "package.json version not found — run from the repo root",
    zh: "未找到 package.json 版本号 — 请在仓库根目录运行",
  },

  // `loopv3.*` — the retirement notices for the v2 tmux-popup commands
  // `loop monitor` / `loop attach` (US-PORT-007). The v3 self-contained runner
  // already streams every cycle into the tmux session roll-loop-<slug>, so the
  // old auto-refresh popup (monitor) has no object, and attaching is just a
  // plain `tmux attach`. Both en and zh present (single-language contract).
  "loopv3.monitor_retired": {
    en: "roll loop monitor is retired. Use `roll loop status` for a snapshot, or watch the live cycle: tmux attach -t roll-loop-%s",
    zh: "roll loop monitor 已退役。用 `roll loop status` 看快照，或观察实时周期：tmux attach -t roll-loop-%s",
  },
  "loopv3.attach_retired": {
    en: "roll loop attach is retired. Attach to the live cycle directly: tmux attach -t roll-loop-%s",
    zh: "roll loop attach 已退役。直接观察实时周期：tmux attach -t roll-loop-%s",
  },
  // `loop branches` (US-PORT-022): pure user-introspection (listed loop-branch
  // merge status); no internal caller, so it retires rather than port. The one
  // line that reproduced it is offered for anyone who still wants the view.
  "loopv3.branches_retired": {
    en: "roll loop branches is retired. List loop branches directly: git ls-remote --heads origin 'loop/*'",
    zh: "roll loop branches 已退役。直接列出 loop 分支：git ls-remote --heads origin 'loop/*'",
  },

  // FIX-232: doctor proxy-environment check
  "doctor.proxy_env_warning": {
    en: "Stale proxy environment variables",
    zh: "残留的代理环境变量",
  },
  "doctor.proxy_env_hint": {
    en: "Proxy variables are set but unreachable — a closed proxy app may have poisoned launchd. Clean up:",
    zh: "代理变量已设置但目标不可达 — 已关闭的代理软件可能毒化了 launchd。请清理：",
  },

  // FIX-232 AC2: loop egress pre-check messages
  "loop.egress_blocked": {
    en: "egress blocked (proxy?): network pre-check failed — cycle %s refused to start",
    zh: "出网阻断（疑似代理？）：网络预检失败 — 周期 %s 拒绝启动",
  },

  // FIX-298: shared network guard (first-checkpoint connectivity + active recovery).
  // Lines are emitted one per locale (the single-language contract) — EN and ZH
  // are kept on separate lines by the caller, never inline on one line.
  "net.recovering": {
    en: "network unreachable — running the configured proxy-enable command, then re-checking…",
    zh: "网络不可达 — 正在执行已配置的代理启用命令，然后重新检测……",
  },
  "net.recovered": {
    en: "network restored after the proxy-enable command — continuing.",
    zh: "执行代理启用命令后网络已恢复 — 继续。",
  },
  // FIX-1025: announced when the precheck is opted out via
  // `loop_safety.skip_network_check: true` (configured providers reachable directly).
  "net.skipped": {
    en: "network precheck skipped (loop_safety.skip_network_check) — assuming configured providers are reachable.",
    zh: "已跳过网络预检（loop_safety.skip_network_check）——假定所配置的服务可直接访问。",
  },
  // %s is the command name (e.g. `roll loop go`). Halt message: clear, actionable.
  // FIX-1025: the probe defaults to a foreign host; if your domestic providers are
  // reachable directly, point the probe at one (`probe_url`) or opt out
  // (`skip_network_check`) instead of forcing a proxy the work does not need.
  "net.blocked_no_hook": {
    en: "%s needs the network, but the connectivity probe failed. If your configured providers ARE reachable, point the probe at one with `loop_safety.probe_url: <host:port>` or opt out with `loop_safety.skip_network_check: true` in .roll/policy.yaml. Otherwise add `loop_safety.proxy_enable_cmd: <your proxy-on command>` (e.g. your VPN/proxy toggle), check your connection, then retry.",
    zh: "%s 需要网络，但连通性探测失败。若所配置的服务其实可达，请用 `loop_safety.probe_url: <host:port>` 把探测指向其中一个，或在 .roll/policy.yaml 中设置 `loop_safety.skip_network_check: true` 跳过预检。否则请加入 `loop_safety.proxy_enable_cmd: <你的开代理命令>`（例如你的 VPN/代理开关），检查网络后重试。",
  },
  "net.blocked_after_hook": {
    en: "%s needs the network, but the probe STILL failed after running the configured proxy-enable command. Check that the command actually turns on connectivity, or point `loop_safety.probe_url` at a host you do need, then retry.",
    zh: "%s 需要网络，但执行已配置的代理启用命令后探测仍失败。请确认该命令确实能打开网络，或将 `loop_safety.probe_url` 指向你确实需要的主机后重试。",
  },

  // FIX-394 — chromium headless browser messages
  "fix394.chromium_unavailable": {
    en: "headless Chromium unavailable",
    zh: "无头 Chromium 不可用",
  },
  "fix394.chromium_offline_hint": {
    en: "offline or network error — chromium download may have failed",
    zh: "离线或网络错误 — Chromium 下载可能失败",
  },
  "fix394.web_evidence_skipped": {
    en: "web evidence skipped",
    zh: "网页证据已跳过",
  },
  "fix394.chromium_fix_hint": {
    en: "run `roll init` or `npx playwright install chromium` after connecting to the network to enable web screenshots",
    zh: "联网后运行 `roll init` 或 `npx playwright install chromium` 以启用网页截图",
  },
  "fix394.browser_tool_degraded": {
    en: "browser tool unavailable — headless Chromium not installed",
    zh: "浏览器工具不可用 — 无头 Chromium 未安装",
  },

  // `onboard.*` — design handoff nudge (US-ONBOARD-NUDGE-001).
  // %s is $roll-design (baseline); `roll design` command phrasing to be
  // added by US-ONBOARD-NUDGE-005 after US-ONBOARD-NUDGE-004 ships.
  "onboard.design_nudge": {
    en: "Run %s — Found requirement docs but an empty backlog. Turn them into a domain model + INVEST backlog, then roll loop.",
    zh: "运行 %s — 检测到需求文档但待办为空。将其转化为领域模型 + INVEST 待办列表，然后 roll loop。",
  },

  // `design.*` — explicit `roll design` entry point (US-ONBOARD-NUDGE-004).
  // Thin wrapper that launches the existing $roll-design skill interactively.
  "design.usage": {
    en: "Usage: roll design [--from-file <path>] [--agent <name>]\n  Launch the $roll-design skill in an interactive agent conversation.\n  `--from-file` binds a PRD/brief file as the design input.\n  `--agent` and `ROLL_DESIGN_AGENT` override the configured primary_agent.\n  Unlike `roll init`, this command runs an LLM — run it only when you want to design.",
    zh: "用法：roll design [--from-file <path>] [--agent <name>]\n  在交互式 agent 对话中启动 $roll-design skill。\n  `--from-file` 会把 PRD/brief 文件绑定为设计输入。\n  `--agent` 与 `ROLL_DESIGN_AGENT` 覆盖已配置的 primary_agent。\n  与 `roll init` 不同，本命令会运行 LLM——只在需要设计时执行。",
  },
  "design.not_roll_project": {
    en: "This directory is not a Roll project (no .roll/). Run `roll init` first.",
    zh: "当前目录不是 Roll 项目（缺少 .roll/）。请先运行 `roll init`。",
  },
  "design.skill_missing": {
    en: "Skill file missing: skills/roll-design/SKILL.md. Run `roll setup` or initialise the skills submodule.",
    zh: "skill 文件缺失：skills/roll-design/SKILL.md。请运行 `roll setup` 或初始化 skills submodule。",
  },
  "design.no_agent": {
    en: "No AI agent detected. Install one (e.g., claude, kimi, pi) and try again.",
    zh: "未检测到 AI agent。请安装一个（如 claude、kimi、pi）后重试。",
  },
  "design.unknown_agent": {
    en: "Agent '%s' is unknown or not installed.",
    zh: "agent '%s' 未知或未安装。",
  },
  "design.from_file_missing": {
    en: "`--from-file` requires a path.",
    zh: "`--from-file` 需要一个文件路径。",
  },
  "design.from_file_not_found": {
    en: "Design source file not found: %s",
    zh: "未找到设计输入文件：%s",
  },

  // `setup.*` — primary agent selection during setup (US-ONBOARD-NUDGE-006).
  "setup.primary_prompt": {
    en: "Multiple AI agents detected. Pick a default:",
    zh: "检测到多个 AI agent，请选择默认：",
  },
  "setup.primary_auto_set": {
    en: "Only %s is installed — set as default agent.",
    zh: "仅安装了 %s — 已设为默认 agent。",
  },
  "setup.primary_no_agents": {
    en: "No AI agents installed. Run `roll agent default <agent>` later to set the machine default, or install one (e.g., claude, kimi, pi).",
    zh: "未安装 AI agent。请稍后运行 `roll agent default <agent>` 设置机器默认，或先安装一个（如 claude、kimi、pi）。",
  },
  "setup.primary_reselect": {
    en: "--reselect: pick a new default agent.",
    zh: "--reselect：重新选择默认 agent。",
  },
  "setup.primary_set": {
    en: "Default agent set to %s.",
    zh: "默认 agent 已设为 %s。",
  },

  // FIX-1021: `roll init` summary / confirmation
  "init.detected_project_type": {
    en: "Detected project type: %s",
    zh: "检测到项目类型：%s",
  },
  "init.will_scaffold": {
    en: "Roll will scaffold AGENTS.md, .roll/backlog.md, .roll/features/, .roll/pairing.yaml, and .claude/CLAUDE.md.",
    zh: "Roll 将在此目录生成 AGENTS.md、.roll/backlog.md、.roll/features/、.roll/pairing.yaml 与 .claude/CLAUDE.md。",
  },
  "init.proceed_prompt": {
    en: "Proceed?",
    zh: "继续？",
  },
  "init.cancelled": {
    en: "Init cancelled. Run `roll init` again when ready.",
    zh: "初始化已取消。准备就绪后重新运行 `roll init`。",
  },
  "init.auto_non_interactive": {
    en: "Non-interactive mode — proceeding automatically. Use `roll init --auto` to suppress this notice.",
    zh: "非交互模式 — 自动继续。可使用 `roll init --auto` 跳过此提示。",
  },
  "init.onboard_plan_facts_hash_unreadable": {
    en: "could not read factsHash from .roll/onboard-plan.yaml",
    zh: "无法读取 .roll/onboard-plan.yaml 中的 factsHash",
  },
  "init.onboard_plan_facts_hash_stale": {
    en: "plan factsHash is stale: expected %s, got %s",
    zh: "plan factsHash 已过期：当前应为 %s，plan 中为 %s",
  },
  "init.onboard_regenerate_before_apply": {
    en: "Regenerate the plan by running $roll-onboard again before applying.",
    zh: "应用前请重新运行 $roll-onboard 生成 plan。",
  },
  "init.onboard_plan_validated_review": {
    en: "Onboard plan validated. Review .roll/init-diagnosis.yaml and .roll/onboard-plan.yaml before applying.",
    zh: "接入方案已通过校验。应用前请审阅 .roll/init-diagnosis.yaml 和 .roll/onboard-plan.yaml。",
  },
  "init.onboard_apply_review_title": {
    en: "Onboard apply review checkpoint",
    zh: "应用接入方案审阅检查点",
  },
  "init.onboard_apply_review_action": {
    en: "action",
    zh: "动作",
  },
  "init.onboard_apply_review_target": {
    en: "target",
    zh: "路径",
  },
  "init.onboard_apply_review_mode": {
    en: "mode",
    zh: "模式",
  },
  "init.onboard_apply_review_owner_content": {
    en: "owner content",
    zh: "用户内容",
  },
  "init.onboard_apply_review_action_append": {
    en: "append",
    zh: "追加",
  },
  "init.onboard_apply_review_action_create": {
    en: "create",
    zh: "创建",
  },
  "init.onboard_apply_review_action_keep": {
    en: "keep",
    zh: "保留",
  },
  "init.onboard_apply_review_action_merge": {
    en: "merge",
    zh: "合并",
  },
  "init.onboard_apply_review_action_replace": {
    en: "replace",
    zh: "替换",
  },
  "init.onboard_apply_review_mode_append_line": {
    en: "append-line",
    zh: "追加行",
  },
  "init.onboard_apply_review_mode_create_if_missing": {
    en: "create-if-missing",
    zh: "缺失时创建",
  },
  "init.onboard_apply_review_mode_ensure_directory": {
    en: "ensure-directory",
    zh: "确保目录",
  },
  "init.onboard_apply_review_mode_replace": {
    en: "replace",
    zh: "替换",
  },
  "init.onboard_apply_review_mode_section_merge": {
    en: "section-merge",
    zh: "章节合并",
  },
  "init.onboard_apply_review_owner_not_present": {
    en: "not present",
    zh: "不存在",
  },
  "init.onboard_apply_review_owner_preserved": {
    en: "preserved",
    zh: "保留",
  },
  "init.onboard_apply_review_owner_replaced": {
    en: "replaced",
    zh: "会替换",
  },
  "init.onboard_apply_review_owner_roll_owned": {
    en: "roll-owned",
    zh: "Roll 管理",
  },
  "init.onboard_apply_review_sync_note": {
    en: "After confirmation, Roll also syncs conventions to the configured AI tools and registers this project.",
    zh: "确认后，Roll 还会把约定同步到已配置的 AI 工具，并登记这个项目。",
  },
  "init.onboard_apply_auto_required": {
    en: "Non-interactive apply requires explicit review acknowledgement:",
    zh: "非交互应用需要显式确认已审阅：",
  },
  "init.onboard_apply_confirm_prompt": {
    en: "Proceed with these changes?",
    zh: "确认执行这些变更？",
  },
  "init.onboard_apply_failed": {
    en: "Onboard apply failed before completion.",
    zh: "onboard 应用未完成即失败。",
  },
  "init.onboard_apply_recovery": {
    en: "Recovery metadata: .roll/onboard-changeset.yaml if present. Inspect it, then run roll offboard --confirm to reverse Roll-owned artifacts.",
    zh: "恢复元数据：如存在请检查 .roll/onboard-changeset.yaml，然后运行 roll offboard --confirm 回滚 Roll 管理的产物。",
  },
  "init.no_files_changed": {
    en: "No files changed.",
    zh: "未修改任何文件。",
  },

  // FIX-1020: new-project workflow — repo-first next steps
  "init.next_create_repo": {
    en: "Create a GitHub repo and push the initial commit",
    zh: "创建 GitHub 仓库并推送初始提交",
  },
  "init.next_push_commands": {
    en: "gh repo create <name> --public --source=. --push (or `git remote add origin ... && git push -u origin main`)",
    zh: "gh repo create <name> --public --source=. --push（或 `git remote add origin ... && git push -u origin main`）",
  },
  "init.next_loop_on": {
    en: "Enable the loop schedule",
    zh: "启用 loop 定时任务",
  },
  "init.next_repo_required": {
    en: "`roll loop` needs a pushable GitHub remote — create the repo first.",
    zh: "`roll loop` 需要一个可推送的 GitHub remote — 请先创建仓库。",
  },

  // FIX-1019 / FIX-1020: loop repo pushability precheck + pause gate
  "loop.paused_marker_present": {
    en: "loop is paused (PAUSE marker present) — skipping this tick. Run `roll loop resume` when ready.",
    zh: "loop 已暂停（存在 PAUSE 标记）— 跳过本次触发。准备就绪后运行 `roll loop resume`。",
  },
  "loop.repo_unreachable": {
    en: "GitHub repo unreachable — `git ls-remote origin` failed. Create the remote repo and push before running the loop.",
    zh: "GitHub 仓库不可达 — `git ls-remote origin` 失败。请先创建远程仓库并推送，再运行 loop。",
  },
  "loop.no_remote": {
    en: "No git remote configured — `roll loop` needs a pushable GitHub remote. Add one with `git remote add origin ...`",
    zh: "未配置 git remote — `roll loop` 需要一个可推送的 GitHub remote。请用 `git remote add origin ...` 添加。",
  },
  "loop.not_a_git_repo": {
    en: "Not a git repository — `roll loop` needs a git repo with a pushable GitHub remote.",
    zh: "不是 git 仓库 — `roll loop` 需要一个带有可推送 GitHub remote 的 git 仓库。",
  },
};
