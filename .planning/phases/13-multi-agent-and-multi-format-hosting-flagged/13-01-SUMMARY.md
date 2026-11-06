---
phase: 13-multi-agent-and-multi-format-hosting-flagged
plan: 01
subsystem: database
tags: [feature-flag, sqlite, drizzle, golden-test]
requires: []
provides:
  - agentKindsEnabled() flag (AGENT_KINDS, default off)
  - kind contracts (src/lib/spec/kinds.ts)
  - additive agent_kinds sidecar table + idempotent DDL
  - tolerant loadKindInfo reader
  - flag-off golden test
affects: [13-02, 13-03, 13-04, 13-05, 13-06, 13-07, 13-08, 13-09]
key-files:
  created:
    - scripts/flag-off.golden.test.ts
    - scripts/__golden__/flag-off.json
    - src/lib/flags.ts
    - src/lib/flags.test.ts
    - src/lib/spec/kinds.ts
    - src/lib/spec/kinds.test.ts
    - src/lib/spec/kinds-ddl.ts
    - src/lib/server/kinds.ts
    - src/lib/server/kinds.test.ts
  modified:
    - drizzle/schema.ts (appended agentKinds only)
    - .planning/AUTONOMOUS-DECISIONS.md
    - .planning/AUTONOMOUS-SUMMARY.md
key-decisions:
  - "D-033 sidecar agent_kinds table instead of ALTER on agents"
  - "D-034 AGENT_KINDS flag read at call time"
  - "D-035 KindInfo fields, kept separate from AgentRecord"
requirements-completed: [P13-FLAG, P13-SCHEMA]
duration: 15min
completed: 2026-10-12
---

# Phase 13 Plan 01: Flag, contracts and sidecar table Summary

Flag-off behaviour is frozen in a golden test captured before any change, and the `AGENT_KINDS` flag, kind contracts and an additive `agent_kinds` sidecar table now exist (the `agents` table is untouched).

## Tasks and commits
1. Golden captured from untouched code (deterministic across two runs): f5ef886
2. Flag module and kind contracts (TDD-style tests): 9c32284
3. Sidecar table, DDL helper, tolerant reader, decisions D-033..D-035: see the task 3 commit in the git log

## Deviations from Plan
None. The plan's D-numbers D-033..D-035 were free in AUTONOMOUS-DECISIONS.md (last used was D-032).

## Verification
`npm run check` exits 0 (82 files passed, 1 skipped; 795 tests). Golden, ingest and all pre-existing tests pass unmodified. Existing test files were not changed.
