---
phase: 14-mcp-generator-generalized-from-research-flagged
plan: 01
subsystem: mcpgen
tags: [mcp, generator, feature-flag, credentials, registry]
requires: []
provides:
  - docs/mcp-generator-design.md
  - mcpGeneratorEnabled() flag (MCP_GENERATOR, default off)
  - src/lib/mcpgen/types.ts contract (SourceModel, InputAdapter, ServerPlan, Gap)
  - adapter registry (listAdapters, detectAdapters, parseInput) with stub adapters
  - credential scanner (scanForCredentials, toGaps) and gap diagnostics
  - api-contract constants (MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, ROUTE_PATH)
affects: [14-02, 14-03, 14-04, 14-05, 14-06, 14-07]
key-files:
  created:
    - docs/mcp-generator-design.md
    - src/lib/flags.mcp.test.ts
    - src/lib/mcpgen/types.ts
    - src/lib/mcpgen/registry.ts
    - src/lib/mcpgen/registry.test.ts
    - src/lib/mcpgen/credentials.ts
    - src/lib/mcpgen/credentials.test.ts
    - src/lib/mcpgen/diagnostics.ts
    - src/lib/mcpgen/diagnostics.test.ts
    - src/lib/mcpgen/api-contract.ts
    - src/lib/mcpgen/adapters/index.ts
    - src/lib/mcpgen/adapters/openapi.ts
    - src/lib/mcpgen/adapters/tabular-catalog.ts
    - src/lib/mcpgen/adapters/sql-ddl.ts
  modified:
    - src/lib/flags.ts
    - .planning/AUTONOMOUS-DECISIONS.md
decisions:
  - D-140 flag MCP_GENERATOR, default off
  - D-141 adapters listed only in adapters/index.ts; stubs overwritten later
  - D-142 credential scanner rejects rather than redacts
metrics:
  tasks: 3
  completed: 2026-10-12
---

# Phase 14 Plan 01: Design and Foundation Summary

Design doc committed first, then a flag-gated generator foundation: MCP_GENERATOR flag, one-file contract, registry-owned adapter list with stubs, and a no-echo credential scanner that rejects unsafe input before any adapter runs.

## Commits

- fba9807 docs(14-01): MCP generator design (committed alone, before any code)
- 7a37b28 feat(14-01): flag, contract, registry, stub adapters, API contract
- 9751fe9 feat(14-01): credential scanner and gap diagnostics

## Verification

- `npm run check` exit 0 (113 test files passed, 1 skipped; 1008 tests passed).
- Design doc has 14 synthesis-section citations and no forbidden tokens (word-boundary grep clean).
- Existing test files untouched; new tests are separate files.

## Deviations from Plan

None in substance. The registry test for "credential scan runs before parse" lives in `credentials.test.ts` (it needs the scanner from task 3) rather than in `registry.test.ts`. The stub-adapter behaviour (detect 0, parse rejects) is exercised implicitly through the registry list test only, because the stubs are overwritten by later plans.

## Notes

- `parseInput` accepts an extra `options` field (GenerateOptions) passed through to `adapter.parse`.
- FastMCP pin remains UNVERIFIED against PyPI (pending human), as stated in the design doc.

## Self-Check: PASSED

All created files exist and commits fba9807, 7a37b28, 9751fe9 are present on the worktree branch.
