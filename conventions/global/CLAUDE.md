# Global Preferences — Claude Code

> Extends [AGENTS.md](./AGENTS.md) — read that first for shared conventions.
> This file adds Claude Code-specific configuration only.

## Identity

- Git: `Sean Yao <sean.dlut@gmail.com>`
- Default branch: `main`

## Commit Message Format

- Format: `<type>: <description>` (遵循 Git Hook 自动生成的前缀)
- TCR micro-commits: `tcr: <description>` (No prefix)
- Types: Story N, Fix, Refactor, Docs, Chore
- Example: `Story 7: Review assignment by org structure`

## Claude Code-Specific

- When a project has Roll skills, use them (`$roll-design`, `$roll-build`, `$roll-fix`, etc.).
- Use plan mode for complex multi-step tasks before executing.
- Prefer Edit tool over Bash for file modifications.
- Use Agent tool with worktree isolation for parallel independent subtasks.
- When I say "帮我看下" or "处理下", go ahead and do it, not just analyze it.

## Verification and Testing

Before claiming any fix is complete, verify it works in the target environment
mentioned by the user. If they said a specific CLI tool, remote server, or
hardware platform, test there explicitly. Do not claim completion until verified.

## Configuration File Editing

When editing config files (YAML, TOML, JSON with schema):
1. Find official documentation or a verified working example first
2. Do not guess syntax
3. If no docs found after 2 searches, ask user for a reference config
4. Maximum 2 syntax attempts before escalating to research mode

## External Service Integration

For npm publishing, proxy configurations, or auth-dependent deployment:
- Stop after 2 failed attempts and ask user for preferred fallback
- Do not continue iterating on auth/proxy debugging without explicit direction
- If OIDC/token issues persist, immediately fallback to manual with explanation

## Frontend Default Stack

- React + shadcn/ui + Tailwind CSS is the default.
- Use shadcn/ui components first. Custom components only when shadcn doesn't cover it.
- `components/ui/` is shadcn-generated — never edit manually.
- Tailwind utility classes only. No inline styles, no CSS modules.
- Icons: Lucide React.
