# Feature: new-skills

## US-SKILL-001 Add `roll-jot` — fast backlog capture for bugs and ideas ✅

**Completed**: 2026-04-17

**AC:**
- [x] Skill file `skills/roll-jot/SKILL.md` created with classification rules (bug vs idea)
- [x] Auto-assigns next `FIX-NNN` or `IDEA-NNN` ID
- [x] Appends row to `BACKLOG.md` Bug Fixes or Ideas table without asking questions
- [x] Added to README Quick Reference and Full Skill List

**Files:**
- `skills/roll-jot/SKILL.md`
- `skills/roll-build/SKILL.md`
- `README.md`
- `BACKLOG.md`

---

## US-SKILL-002 Add `roll-.clarify` — passive scope clarification for vague build requests ✅

**Completed**: 2026-04-17

**AC:**
- [x] Passive skill `skills/roll-.clarify/SKILL.md` created (hidden, auto-triggers)
- [x] Fires in `roll-build` Fly mode when uncertainty areas are non-empty
- [x] Outputs summarized intent + 3–5 targeted questions, then waits for user reply
- [x] Added to README Full Skill List and referenced in `roll-build` docs

**Files:**
- `skills/roll-.clarify/SKILL.md`
- `skills/roll-build/SKILL.md`
- `README.md`
- `BACKLOG.md`

---

---

## US-SKILL-007 roll-jot → roll-idea rename ✅

**Created**: 2026-05-10
**Completed**: 2026-05-10

- As a developer capturing backlog items
- I want the capture skill named `roll-idea` instead of `roll-jot`
- So that the command name is semantically aligned with the `IDEA-NNN` ID format it produces

**AC:**
- [x] `skills/roll-idea/SKILL.md` created (renamed from `skills/roll-jot/SKILL.md`)
- [x] `skills/roll-jot/SKILL.md` removed (git rename preserves history)
- [x] All forward-looking `$roll-jot` references updated to `$roll-idea` across skills, docs, conventions, README
- [x] Historical changelog entries referencing the original roll-jot feature left intact
- [x] `tests/unit/roll_idea.bats` — verifies rename correctness

**Files:**
- `skills/roll-idea/SKILL.md` (renamed from roll-jot)
- `skills/roll-build/SKILL.md`
- `skills/roll-design/SKILL.md`
- `skills/roll-.clarify/SKILL.md`
- `skills/roll-notes/SKILL.md`
- `skills/roll-.qa/SKILL.md`
- `conventions/global/AGENTS.md`
- `README.md`
- `tests/unit/roll_idea.bats`

## Dependencies
- `roll-build` SKILL.md structure
- `BACKLOG.md` format conventions
