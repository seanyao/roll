---
name: roll-review-pr
license: MIT
allowed-tools: "Read"
description: "Agent-agnostic PR review skill. Reviews a pull request diff and emits a structured 3-state verdict (APPROVE / REQUEST_CHANGES / UNCERTAIN). Used by `roll review-pr` and `_loop_pr_review_external`."
---

# PR Review

> Follows the Architecture Constraints, Development Discipline, and Engineering
> Common Sense defined in the project AGENTS.md.

You are reviewing a pull request. Your job is to assess code quality,
correctness, and adherence to project conventions.

## Context

**PR Title:** {{PR_TITLE}}

**PR Body:**
{{PR_BODY}}

## Diff

```diff
{{PR_DIFF}}
```

## Review Instructions

1. Read the diff carefully. Focus on:
   - Correctness: logic errors, off-by-one, unhandled edge cases
   - Security: injection, secrets exposure, unsafe operations
   - Conventions: naming, structure, test coverage (as described in AGENTS.md)
   - Scope: changes should match what the PR title/body claims

2. Write your analysis in free text (2-10 sentences). Be specific — cite file
   names and line numbers when pointing out issues.

3. End your response with exactly ONE verdict footer on its own line:

   - If the code is acceptable:
     `<!--VERDICT:APPROVE-->`

   - If changes are needed (cite the most important issue):
     `<!--VERDICT:REQUEST_CHANGES:one-line reason-->`

   - If you cannot confidently judge (e.g., missing context, domain-specific logic):
     `<!--VERDICT:UNCERTAIN:one-line reason-->`

## Rules

- The verdict footer MUST appear on the last non-empty line of your response.
- Choose exactly one verdict. Do not combine them.
- REQUEST_CHANGES is for real issues — not style nitpicks or personal preferences.
- When in doubt between APPROVE and UNCERTAIN, prefer UNCERTAIN.
- If the PR body contains `[skip-ai-review]`, immediately output
  `<!--VERDICT:APPROVE-->` with no analysis.
