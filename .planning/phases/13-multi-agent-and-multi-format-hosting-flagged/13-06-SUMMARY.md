---
phase: 13-multi-agent-and-multi-format-hosting-flagged
plan: 06
subsystem: ui
tags: [svelte, feature-flag, a11y, axe]
requires: [13-01]
provides:
  - KindBadge and SystemMembers components
  - flag-gated kindInfo on the agent detail load and page
affects: [13-07, 13-08, 13-09]
key-files:
  created:
    - src/lib/components/KindBadge.svelte
    - src/lib/components/KindBadge.a11y.test.ts
    - src/lib/components/SystemMembers.svelte
    - src/lib/components/SystemMembers.a11y.test.ts
    - src/routes/agents/detail.kinds.test.ts
    - src/lib/components/a11y.pages.kinds.test.ts
    - .planning/phases/13-multi-agent-and-multi-format-hosting-flagged/13-HUMAN-UAT.md
  modified:
    - src/routes/agents/[slug]/+page.server.ts
    - src/routes/agents/[slug]/+page.svelte
    - .planning/AUTONOMOUS-DECISIONS.md
key-decisions:
  - "D-050 lazy kinds import, extras stripped, non-agent kinds never runnable"
  - "D-051 badge + Members section before Technical Specification; n/a LLM line hidden"
requirements-completed: [P13-UI]
completed: 2026-10-12
---

# Phase 13 Plan 06: System detail UI Summary

With `AGENT_KINDS` on, a non-agent detail page shows a text kind badge (with framework), a "Members" h2 section with topology and a ul of members, and Try It Out is restricted. With the flag off, the load return shape and markup are unchanged.

## Tasks and commits
1. KindBadge and SystemMembers plus axe tests: f7cc3e9
2. Flag-gated detail load and page, flag-on tests, page-level axe: a9b975b
3. Decisions and pending UAT: docs commit (see git log)

## Deviations from Plan
**[Rule 3 - Blocking] kinds.ts imported lazily, not statically.** A top-level import loaded `drizzle/schema.ts` under detail.test.ts's drizzle-orm mock (no `sql` export) and failed 9 existing tests. The plan said to verify this; it is now `await import(...)` inside the flag branch (D-050). detail.test.ts is unmodified and green.

## Notes
- The CustomizationPanel in the right column still lists the language model for systems (D-051); only the Technical Specification LLM line is hidden.
- Pre-existing svelte warnings (state_referenced_locally for `tryItOutOpen`, tabindex in TechAccordion/TryItOutPanel) are untouched.
- Browser check is pending human (13-HUMAN-UAT.md).

## Verification
`npm run check` exit 0 (86 files passed, 1 skipped; 809 tests). Existing test files unmodified.

D-numbers used: D-050, D-051

## Self-Check: PASSED
