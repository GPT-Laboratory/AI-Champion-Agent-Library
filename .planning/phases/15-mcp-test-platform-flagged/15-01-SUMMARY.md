---
phase: 15-mcp-test-platform-flagged
plan: 01
subsystem: mcptest-core
tags: [mcp, testing, flags, fidelity, loaders]
requires: []
provides:
  - docs/mcp-test-port-fidelity.md (SC-1 map)
  - mcpTesterEnabled flag (MCP_TESTER, default off)
  - src/lib/mcptest/core/types.ts shared contracts
  - src/lib/mcptest/core/fidelity.ts (CASE_IDS, CHECK_IDS, FIDELITY, GAPS)
  - src/lib/mcptest/core/cases.ts (parseCaseYaml, parseGoldenJsonl, parseRubricYaml, loadCaseDir)
affects: [15-02 .. 15-13]
tech-stack:
  added: []
  patterns: [never-throw loaders returning {ok,value|errors}, x- key capture, core purity (no $lib)]
key-files:
  created:
    - docs/mcp-test-port-fidelity.md
    - src/lib/flags.mcptest.test.ts
    - src/lib/mcptest/core/types.ts
    - src/lib/mcptest/core/fidelity.ts
    - src/lib/mcptest/core/fidelity.test.ts
    - src/lib/mcptest/core/cases.ts
    - src/lib/mcptest/core/cases.test.ts
  modified:
    - src/lib/flags.ts
decisions:
  - DRAFT-15-01-a, DRAFT-15-01-b (below)
metrics:
  tasks: 3
  completed: 2026-10-12
---

# Phase 15 Plan 01: Foundation Summary

Port-fidelity map committed first, then the default-off MCP_TESTER flag, shared type contracts, a machine-readable fidelity table tested against the doc, and never-throwing loaders for source-style case.yaml, golden.jsonl and rubric.yaml.

## Commits

- ec5777e docs: port-fidelity map (committed alone, first)
- 13e5b67 docs: tag residual gaps with machine ids (see deviations)
- f8c8e8c feat: flag, contracts, fidelity table
- 1d06677 feat: loaders

## Verification

- `npx vitest run src/lib/mcptest src/lib/flags.mcptest.test.ts` green (38 tests), `npx tsc --noEmit` clean.
- `npm run check` exit 0 (134 files passed, 1 skipped; no timeouts).
- Token scan: no study repo name, LVI, ETIM or TT0 anywhere; STK appears only once, as T2-STK-API in the T2-CATALOG-API row of the doc.

## Decision drafts

- **DRAFT-15-01-a**: case.yaml, golden.jsonl and rubric.yaml use the source-compatible formats; platform keys live under x- prefixes (captured under `x`), additive golden fields inject/repeat/check_kind; all content re-authored in Acme terms. Revert: loaders accept only a native shape.
- **DRAFT-15-01-b**: generic platform case ids (T1-STD-CATALOG ... T4-I18N-CODES) replace the source ids; the single source id is recorded once in the doc table. Revert: rename ids in fidelity.ts, suite dirs and docs.

## Deviations from Plan

1. **[Rule 3 - Blocking] Gap ids added to the doc in a follow-up commit.** The fidelity test requires every gap id (for example legacy-http-sse) to appear in the doc, but the first doc used prose. Added backticked ids in a second docs-only commit (13e5b67). The first commit still contains only the doc and precedes all code.
2. **loadCaseDir tests use a temp directory** (mkdtemp, synthetic Acme content, removed afterwards) in addition to inline-string tests for the parsers, because loadCaseDir reads files. No real data or repo files are involved.
3. Rubric block shapes (D3/D5 as mapping with criteria, or bare list) and `field_value` as a mapping are inferred from the plan, since the source files were not read; a later plan may widen them.

## Self-Check: PASSED

All created files exist; commits ec5777e, 13e5b67, f8c8e8c, 1d06677 are in the log.
