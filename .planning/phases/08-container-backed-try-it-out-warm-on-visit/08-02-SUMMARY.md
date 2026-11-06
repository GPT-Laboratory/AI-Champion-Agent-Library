---
phase: 08-container-backed-try-it-out-warm-on-visit
plan: 02
subsystem: infra
tags: [pi, jsonl, skill, vitest]

requires:
  - phase: 08-container-backed-try-it-out-warm-on-visit
    provides: container runtime layer (plan 01)
provides:
  - LF-only JSONL parser, Pi event mapper and D-16 completion tracker (piEvents.ts)
  - Hand-written Pi JSONL fixtures (piFixtures.ts)
  - Pi-valid SKILL.md for demo-rfi-triage with frontmatter
  - parseSkillFrontmatter and loadPiSkill; loadPromptFor strips frontmatter
affects: [08-05, 08-06]

tech-stack:
  added: []
  patterns:
    - "Total pure functions over untrusted stream records"
    - "Success never keyed off the intermediate end-of-run event"

key-files:
  created:
    - src/lib/server/tryitout/piEvents.ts
    - src/lib/server/tryitout/piEvents.test.ts
    - src/lib/server/tryitout/piFixtures.ts
  modified:
    - src/lib/server/tryItOutPrompts.ts
    - src/lib/server/tryItOutPrompts.test.ts
    - data/tryitout-prompts/demo-rfi-triage/SKILL.md (renamed from skill.md)
    - .containerignore

key-decisions:
  - "Frontmatter description is double-quoted in SKILL.md because it contains ': ', which plain YAML scalars reject"
  - "Failure verdict precedence: timeout, unknown exit, model errorMessage, failed retry, nonzero exit stderr, not settled, bare stopReason"

requirements-completed: [D-02, D-11, D-12, D-16]

duration: 12 min
completed: 2026-10-08
---

# Phase 8 Plan 02: Pi Event Mapping and SKILL.md Summary

**Chunk-safe Pi JSONL parser, JobEvent mapper (no tool content leaked, 120-char summaries) and exit-0-is-not-enough completion rule, plus a frontmatter SKILL.md that Pi loads and the Phase 7 fallback still inlines.**

## Task Commits
1. Task 1 (tracer): parser, mapper, tracker, fixtures - `37d4789`
2. Task 2: failure verdicts and parser robustness tests - `f228cae`
3. Task 3: SKILL.md conversion and loaders - `8c5eff5`

## Deviations from Plan

**1. [Rule 3 - Process] Full verdict precedence implemented in Task 1**
- The Task 1 tracker already included the Task 2 precedence logic, so Task 2 added only tests (all passed immediately; no separate RED phase).

**2. [Rule 1 - Bug] Task 3 commit initially missed files**
- A failed `git add` (nonexistent old path) left only the rename staged; fixed by amending the unpushed commit before any other work.

Other stale `skill.md` mentions (README.md line 204, a mocked path string in tryItOutRunner.test.ts) are out of scope and untouched.

## Verification
- `npx vitest run` on piEvents, tryItOutPrompts, tryItOutRunner and tryitout dir: 101 passed.
- tsc: no errors in the touched files. Acceptance greps all satisfied.

## Self-Check: PASSED
