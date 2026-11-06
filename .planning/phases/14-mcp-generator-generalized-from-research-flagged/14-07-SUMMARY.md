---
phase: 14-mcp-generator-generalized-from-research-flagged
plan: 07
subsystem: mcpgen
tags: [docs, verification, decisions, invariants]
requires: [14-01, 14-02, 14-03, 14-04, 14-05, 14-06]
provides:
  - docs/mcp-generator.md (user and extension guide)
  - 14-HUMAN-UAT.md, 14-VERIFICATION.md (status human_needed)
  - D-147..D-162 in AUTONOMOUS-DECISIONS.md
  - src/lib/mcpgen/criteria.test.ts (architecture invariants)
key-files:
  created:
    - docs/mcp-generator.md
    - src/lib/mcpgen/criteria.test.ts
    - .planning/phases/14-mcp-generator-generalized-from-research-flagged/14-HUMAN-UAT.md
    - .planning/phases/14-mcp-generator-generalized-from-research-flagged/14-VERIFICATION.md
  modified:
    - README.md
    - TECHNICAL_DOCUMENTATION.md
    - .planning/AUTONOMOUS-DECISIONS.md
    - .planning/AUTONOMOUS-SUMMARY.md
    - .planning/ROADMAP.md
    - src/lib/mcpgen/emit/python.ts
    - src/lib/mcpgen/__golden__/sqlddl.server.py
decisions: [D-147..D-162]
metrics:
  tasks: 3
  completed: 2026-10-12
---

# Phase 14 Plan 07: Docs, UAT, decisions, verification and invariants Summary

Documented the generator (including the DerivedTool extension point), consolidated decisions D-147..D-162 with revert notes, listed every live check as pending human with exact commands, and added a 25-test invariant self-check; `npm run check` exit 0 (131 files passed, 1 skipped; 1210 tests).

## Commits
- 9b8ce48 fix(14-07): SQL ORDER BY uses all primary-key columns
- 7ee1621 docs(14-07): MCP generator guide, README and technical doc pointers
- Decisions, UAT, invariant test, verification, summary and roadmap updates: see `git log` on this branch (`docs(14-07)` / `test(14-07)`).

## Deviations from Plan
**1. [Rule 1 - Bug] SQL ORDER BY used only the first identifier column** (limitation reported by 14-04). Cheap and safe, so fixed in `emit/python.ts`; only the sqlddl golden changed; D-161.
**2. Decisions numbered by title.** D-140..D-146 already existed; the 14-03..14-06 drafts were logged under D-147..D-158 matching their titles, plus D-159, D-160 as planned and D-161 (ORDER BY fix), D-162 (planner ignores `operations`, documented not fixed).
**3. Secret-shape scan excludes unit-test files** (existing `generate.test.ts` holds a deliberate hostile `sk-` literal and existing tests may not be edited); sources, goldens, fixtures and docs are scanned.
**4. STATE.md not edited**: it contains no Phase 13 entry either (same precedent), and the orchestrator owns planning state. ROADMAP plan checkboxes were marked; the Phase 14 line stays unchecked with a human_needed note, like Phase 13.
**5. UAT wording**: the route is described as adding no authentication of its own, with deployment auth unverified.

## Limitations recorded (docs and VERIFICATION)
- sql/dataset planners ignore `operations` (only `describe_*` and `query_<entity>`); not fixed (D-162).
- Only `inMemoryFilter` derived tools are accepted, http backends only.

## Pending human
See `14-HUMAN-UAT.md`: fastmcp pin check on PyPI, running a generated `test_server.py` in a throwaway venv, CLI generation from fixtures, dataset/SQL servers on synthetic data, browser checks of the Generate MCP panel and zip download, flag-off check.

## Self-Check: PASSED
Created files exist; commits 9b8ce48 and 7ee1621 present; `npm run check` exit 0; no existing test file modified (21 additions since the Phase 14 base, zero M/D).
