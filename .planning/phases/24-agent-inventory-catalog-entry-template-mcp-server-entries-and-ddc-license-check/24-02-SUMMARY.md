---
phase: 24
plan: 02
subsystem: catalog-validation
tags: [validator, template, vitest]
requires: [24-01]
provides: [validate-entries-cli]
key-files:
  created:
    - scripts/validate-entries.ts
    - scripts/validate-entries.test.ts
  modified:
    - package.json
    - docs/agent-entry-template.md
decisions:
  - "An entry is a consortium entry when it carries any consortium metadata key; only entries with none of them are skipped as legacy. This makes a missing stage fail by name."
metrics:
  completed: 2026-10-14
---

# Phase 24 Plan 02: validate-entries Summary

`npm run validate-entries -- [path...]` parses entries with the real OracleAgentSpecSchema, scans for secret-like values with the shared scanSecrets, and checks the consortium template fields (stage enum, agent_no 1-12, purpose, non-empty inputs/outputs, data_sources/assumptions/gaps lists, draft_for_review true, sample_data kind and label). Exit 0 ok, 1 errors, 2 path not found. The template is the reference valid entry; the 9 legacy agents in data/agents report as skipped.

Evidence: scripts/validate-entries.test.ts has 19 passing tests (template ok, each of 9 required keys removed, bad values, legacy skipped, missing system_prompt, secret token, unreadable file, real data/agents zero errors, main exit codes).

## Deviations

- The test file and implementation were committed together, not as separate red and green commits.
- The validator is not added to `check` (as planned); vitest covers it.

## Commits

feat(24-02) validate-entries script and tests; chore/docs(24-02) usage in the template doc.
