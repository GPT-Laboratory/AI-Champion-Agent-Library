---
phase: 15-mcp-test-platform-flagged
plan: 07
subsystem: testing
tags: [mcp, test-suite, golden, isolation, synthetic-data]
requires:
  - phase: 15-01
    provides: case/golden/rubric loaders (cases.ts), fidelity table
  - phase: 15-03
    provides: UpstreamSpec, contract.ts, seeded datasets
provides:
  - loadSuite(rootDir) and SuiteCase with validated x- blocks
  - golden isolation gate (GOLDEN_MIN_LEN, goldenFingerprints, checkGoldenIsolation)
  - 12 synthetic case directories (case.yaml, golden.jsonl, rubric.yaml, fixtures)
  - suite-wide criteria test
affects: [15-08 runner, 15-04 fake runtime, 15-06, 15-13]
tech-stack:
  added: []
  patterns: [cases are data, runner interprets; x- keys keep source-compatible files]
key-files:
  created:
    - src/lib/mcptest/core/suite.ts
    - src/lib/mcptest/core/isolation.ts
    - src/lib/mcptest/core/suite.test.ts
    - src/lib/mcptest/core/isolation.test.ts
    - src/lib/mcptest/core/suite.criteria.test.ts
    - src/lib/mcptest/suite/ (12 case directories)
  modified: []
key-decisions:
  - "DRAFT-15-07-a through DRAFT-15-07-e (see below)"
requirements-completed: [SC-1, SC-2, SC-3]
duration: ~25 min
completed: 2026-10-12
---

# Phase 15 Plan 07: Synthetic suite, loader and isolation gate Summary

12 invented Acme/Example cases (Tier 1x1, 2x3, 3x4, 4x4) with a never-throwing suite loader, a single-constant golden isolation gate and a criteria test that ties the suite to the fidelity table and the mock dataset constants.

## Accomplishments
- `loadSuite` validates x-upstream (UpstreamSpec for a and b), x-env, x-identity, x-config, x-applies-to, x-requires, x-ceiling, x-strict; returns all errors prefixed with the case id; rejects id/dir mismatch; skips symlinks; 256 KiB fixture cap.
- `isolation.ts`: `GOLDEN_MIN_LEN = 8` used for both storing and comparing fingerprints (field_value values, case-insensitive); boundary tests at minLen-1 and minLen.
- T2-CATALOG-API: the 9 source ids plus 10 `bh_*` behaviour lines (check_kind) plus a multilingual line. x-identity values equal the datasets.ts constants (verified in the criteria test).
- T2-CATALOG-DUMP: header-only generator fixture, 40-row synthetic CSV kept under fixture/dump, `x-requires: real-runtime`.
- Criteria test: 12 ids equal CASE_IDS; every implemented fidelity case loads; no designed-only-gap case; check_kind values known; every tool_hint matches exactly one TOOL_NAMES value and agrees with contract HINTS; isolation holds incl. identity values; no non-loopback URL, forbidden token or secret-shaped string in suite files.

## Task Commits
1. Task 1 loader + isolation: d42f6ac
2. Task 2 Tier 1/2 cases: 36f6c80
3. Task 3 Tier 3/4 cases + criteria test: cd6d83b

## Deviations from Plan
- [Rule 1 - consistency] T1-STD-CATALOG uses `size: 30`, so the plan's reference id ACM-000042 does not exist there; its golden looks up ACM-000001 instead (item names from the seeded dataset confirmed: pump, gasket, valve, sensor, bearing all occur in the first six items).
- [Rule 1] T2-CATALOG-API `ceilingPage` is 4 (last valid page at per_page 50 and ceiling 200), not 5; the validator requests ceilingPage + 1. Batch call uses per_page 50.
- Extra golden lines beyond the plan: T4-FAULT-UPSTREAM includes 429-without-Retry-After and reset; T3-LARGE-RESP a huge-body inject line; T4-SEC-SECRETS a no_write_tools and three injection lines.
- T4-I18N-CODES: the codes dataset names are ASCII, so non-ASCII round-trip is asserted through the catalog name.fi/name.sv fields (catalog dataset added to its x-upstream).
- T3-RT-DOCS documents the two routes the mock actually serves (listWidgets, getWidget) instead of 5 operations, so the manual cannot promise routes the mock lacks.
No auth gates. `npm run check` exit 0 (148 files passed, 1 skipped; no timeouts).

## Assumptions the runner (15-08) and fake (15-04) must honour
Tool argument names used in golden lines: lookup_item {id | code}, search_items {query, page, per_page}, list_items_by_supplier {supplier}, find_items_by_attribute {attribute, value}, list_category_items {category}, lookup_product_by_gtin {gtin}, assemble_composite {component_id}, get_widget {id}. If 15-04 names them differently, adjust via binding args or the golden files (data only).

## Decision drafts (not written to AUTONOMOUS-DECISIONS.md)
- DRAFT-15-07-a: Cases re-authored from scratch in the source's formats with x- keys and generic ids (T2-CATALOG-API etc.). Alternatives: copy source content (rejected, real data guardrail). Revert: n/a, data only.
- DRAFT-15-07-b: T2-CATALOG-DUMP carries `x-requires: real-runtime` so fake subjects report PENDING_HUMAN instead of a fabricated result. Revert: remove the key and add a fake dump-backed tool.
- DRAFT-15-07-c: `x-upstream` shape is `{a, b?}`, each validated by UpstreamSpec; b is used only by T3-COMPOSITE. Revert: n/a.
- DRAFT-15-07-d: Golden isolation fingerprints cover only `expect.field_value` values plus (in the criteria test) identity values; one constant GOLDEN_MIN_LEN = 8 for storage and comparison. Fixtures "shown to a generator" are fixture/spec and fixture/docs; fixture/dump is excluded. Revert: change the constant or widen the collector.
- DRAFT-15-07-e: Behaviour-pack lines in T2-CATALOG-API are prefixed `bh_` to keep ids unique against the source-style ids (lookup_by_id exists in both); the runner dispatches on check_kind.

## Self-Check: PASSED
Files and commits verified: d42f6ac, 36f6c80, cd6d83b exist; 12 suite directories present; `npm run check` exit 0.
