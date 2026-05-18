# Roll — PR Review

Roll handles the full PR lifecycle — from opening to merging — without requiring
manual intervention for most cases.

## Manual Review

```bash
roll review-pr <number>   # AI review of a specific PR
```

Fetches the PR title, body, and diff via `gh cli`, routes to the project's
configured AI agent, and outputs a structured verdict:

| Verdict | Action |
|---------|--------|
| `APPROVE` | `gh pr review --approve` |
| `REQUEST_CHANGES` | `gh pr review --request-changes` with reason |
| `UNCERTAIN` | Writes ALERT — human decides |

## Loop PR Inbox

Each loop cycle processes open PRs before picking new stories:

| PR classification | Loop action |
|---|---|
| Loop's own (`loop/*` branch) | Skip — no self-review |
| Bot already approved | Skip — let auto-merge proceed |
| Bot requested changes | Write ALERT — wait for author |
| Stale (CI failed, branch behind) | Auto-rebase onto `main` |
| External / clean | Invoke `roll review-pr` |

**Stale PR circuit breaker**: If rebasing fails 3× within 24 hours, loop stops
retrying and writes an ALERT for human attention.

## Auto-merge

Loop's own PRs (`loop/*`) are opened with `--auto --squash --delete-branch`.
GitHub merges them automatically once all required checks pass. No manual
`git merge` needed.

## Optional: Event-Driven Review (GitHub Actions)

For instant feedback (seconds vs. up to 1 hour with loop scheduling):

```bash
cp templates/workflows/pr-review-event.yml .github/workflows/
```

This workflow triggers `roll review-pr` on every PR open or update.
Fork PRs and PRs with `[skip-ai-review]` in the body are skipped automatically.
The two modes coexist — GHA provides instant feedback, loop acts as safety net.

## Skip AI Review

Add `[skip-ai-review]` anywhere in the PR body to auto-approve without invoking
the agent. Useful for mechanical PRs (dependency bumps, generated content).

## See Also

- [loop.md](loop.md) — full loop PR inbox details and stale rebase handling
- [ai-agents.md](ai-agents.md) — which agent handles reviews
