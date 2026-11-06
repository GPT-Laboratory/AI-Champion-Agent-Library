---
phase: 24
plan: 01
subsystem: catalog-docs
tags: [inventory, template, licence, gaps]
requires: []
provides: [consortium-agents-inventory, agent-entry-template, third-party-notices, gaps-list]
affects: [25, 26, 27, 28, 29]
key-files:
  created:
    - docs/consortium-agents-inventory.md
    - docs/agent-entry-template.md
    - docs/templates/agent-entry.template.yaml
    - docs/consortium-agents-gaps.md
    - docs/third-party-notices.md
  modified:
    - .planning/ROADMAP.md
decisions:
  - "Inventory result: 0 full, 2 partial (4 RFI generation, 8 Cut-sheet QA), 10 missing"
  - "Docs avoid the uppercase source-case token guarded by src/lib/mcptest/criteria.test.ts; the Excel product database is described in words"
metrics:
  completed: 2026-10-14
---

# Phase 24 Plan 01: Inventory, template, notices Summary

Audit of the 12 consortium agents (2 partial, 10 missing), a copyable AgentSpec YAML template that passes validate-submission as ingestible, a seeded gaps list, and DDC MIT attribution with the book/CWICR/trademark carve-outs (licence text re-checked live, unchanged).

## Deviations

- [Rule 3 - Blocking] The worktree was based on main; fast-forwarded to autonomous/overnight-improvements to get the phase 24 plans. node_modules was hard-linked (cp -al) instead of symlinked because vite refused files outside the project root through a symlink. db:push and ingest were run locally (db/ is gitignored) because many tests need a populated db.
- [Rule 1] The gaps doc first contained the uppercase source-case token, which tripped criteria.test.ts. Reworded the doc instead of changing the test.
- Added github_url to the template so it validates as ingestible rather than partial.

## Commits

Inventory, template and gaps list, notices (see git log, prefix docs(24-01)).
