---
phase: 13-multi-agent-and-multi-format-hosting-flagged
plan: 03
subsystem: ingest, search
tags: [agent-kinds, ingest, search, flag]
requires: [13-01, 13-02]
provides:
  - flag-gated multi-format ingest (ingestKindsInto) writing agents + agent_kinds
  - kind-aware search text (documents.ts), loader join and fingerprint (index.ts), same-kind related weight
affects: [13-09]
key-files:
  created:
    - scripts/ingest.kinds.test.ts
    - src/lib/server/search/documents.kinds.test.ts
    - src/lib/server/search/index.kinds.test.ts
    - src/lib/server/search/related.kinds.test.ts
  modified:
    - scripts/ingest.ts
    - src/lib/server/search/documents.ts
    - src/lib/server/search/index.ts
    - src/lib/server/search/related.ts
    - .planning/AUTONOMOUS-DECISIONS.md
decisions: [D-038, D-039, D-040]
metrics:
  completed: 2026-10-12
---

# Phase 13 Plan 03: Ingest and search wiring Summary

Flag-gated (AGENT_KINDS) registry ingest with an agent_kinds sidecar write, plus kind-aware search text, loader join and related weighting; flag off is byte-identical (golden and all existing tests pass unmodified).

## Tasks and commits
1. 166bb85 documents.ts optional kind/framework/memberNames, WithKind helpers.
2. b7e625e `ingestKindsInto` (separate function, early branch in `ingestInto`); works on legacy DDL; orphan agent_kinds cleanup; try_it_out never overwritten.
3. Search loader/related commit (see git log, "flag-on search loader") with D-040.

## D-numbers used
D-038 (gated search text), D-039 (flag-on ingest function and sub-directory scanning), D-040 (loader join, fingerprint, related weight).

## Deviations from Plan
- [Rule 3] Static imports of `kinds.js` and drizzle schema in search/index.ts broke `warm.test.ts` (drizzle-orm mock lacks `sql`). Switched to lazy dynamic imports in the async entry points (`search`, `related`, `warmUp`), loaded only when the flag is on. No existing tests modified.
- Flag-on ingest over `data/agents` also picks up the `data/agents/fixtures/` sub-directory (adds `minimal-agent`); recorded in D-039 and asserted in the test (base columns of the flag-off rows are identical, all kinds 'agent').
- The secret-redaction test relies on the registry's own redaction; extras stored are redacted via `redactSecrets` plus `clampExtras` as well.

## Verification
`npm run check` exit 0 (94 files passed, 855 tests).

## Self-Check: PASSED
