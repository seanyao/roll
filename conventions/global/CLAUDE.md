# Global Preferences — Claude Code

> Extends [AGENTS.md](./AGENTS.md) — read that first for shared conventions.
> This file adds Claude Code-specific configuration only.

## Claude Code-Specific

- When a project has Roll skills, use them (`$roll-design`, `$roll-build`, `$roll-fix`, etc.).
- Use plan mode for complex multi-step tasks before executing.
- Prefer Edit tool over Bash for file modifications.
- Use Agent tool with worktree isolation for parallel independent subtasks.
- When I say "帮我看下" or "处理下", go ahead and do it, not just analyze it.
