---
phase: 15-mcp-test-platform-flagged
plan: 09
subsystem: mcptest-generator-subject
tags: [mcp, generator, in-process, generator-side-checks]
requires:
  - phase: 15-01
    provides: Subject/PrepareResult/CheckResult contracts
  - phase: 15-07
    provides: synthetic suite (T4-PARTIAL-SPEC fixture)
provides:
  - generatorSubjects() (generator:openapi, generator:tabular-catalog, generator:sql-ddl)
  - deriveBinding(), deriveEnvNames(), resolveSample()
  - runGeneratorSideChecks(caseId, ctx) with ids generates, reproducible, gap_reported, credential_rejected
affects: [15-08 runner wraps these Subjects]
key-files:
  created:
    - src/lib/mcptest/generatorSubject.ts
    - src/lib/mcptest/generatorChecks.ts
    - src/lib/mcptest/generatorSubject.test.ts
key-decisions:
  - "DRAFT-15-09-a, -b, -c (below)"
requirements-completed: [SC-1, SC-2, SC-4]
completed: 2026-10-12
---

# Phase 15 Plan 09: Generator subject and generator-side checks Summary

The Phase 14 generator is now a Subject that generates in process via runPipeline, writes the package into a workdir, returns a stdio python3 launch descriptor (never executed), a binding derived from toolsEmitted and env names derived by suffix; deterministic generator-side checks are attached as extraChecks.

## Behaviour
- prepare(): http case -> NA_TRANSPORT; non-spec modality (docs, dump) or x-applies-to without generator (T3-RT-DOCS, T3-COMPOSITE, T2-CATALOG-HTTP, T3-PROFILE-CONTRACT) -> NA_MODALITY/NA_TRANSPORT with a "generator-unsupported" reason; T4-PARTIAL-SPEC applies to the openapi sample only (it reads the case's fixture/spec file). Pipeline failure -> GEN_FAILED with gap notes capped at 200 chars.
- Checks: T1-STD-CATALOG gets generates (D1) + reproducible (D6); T4-PARTIAL-SPEC gets gap_reported (D4, with SILENT_GUESS warning flag on failure) + reproducible; T4-SEC-SECRETS gets credential_rejected (D4; value assembled at runtime from fragments, gap must not echo it, clean spec must still be accepted).
- Binding: lookup/get/query_* -> lookup_by_id, projection, bad_input, empty_vs_error (and lookup_by_alt_key if a second get-like tool exists); list_/search_ -> pagesize_clamp, pagination_ceiling; filter_/list_ -> derived_filter. partition_filter binds to the lookup tool with empty args. Unmatched kinds omitted so the check fails honestly.
- No child_process import, no alias imports (asserted in a test).

## Observed Phase 14 behaviour on the partial spec (honest finding)
Running the pipeline on T4-PARTIAL-SPEC today:
- Missing response type (GET /gadgets): gap `missing-response-schema` (warn), operation omitted. Reported.
- Undocumented required header on the same operation: not separately reported, but the operation is omitted, so nothing is guessed. Counted as covered.
- Stale example (legacy_flag in the by-id example, absent from the schema): tool `lookup_gadget_by_id` emitted, NO gap or assumption. Counted as silently guessed.
- 3 reruns byte-identical.
Result: gap_reported FAILS with flag SILENT_GUESS (warning), reason "silently guessed: stale example". The test asserts this current behaviour. No Phase 14 source was modified.

Observed tool names on the samples: openapi -> filter_part_by_features, lookup_part_by_id, search_part (env ACME_PARTS_BASE_URL, ACME_PARTS_API_KEY); tabular -> describe_acme_widgets, query_widget (ACME_WIDGETS_DATA_PATH); sql -> describe_acme_schema, query_customer, query_note_log, query_order, query_order_line (ACME_SCHEMA_DB_PATH). Note: the openapi planner emits lookup_*, not get_*, so the lookup prefix is also matched. Data-path env var names (..._DATA_PATH / _DB_PATH) are not mapped by the suffix rule; the runner needs them for the tabular/sql subjects (see questions).

## Decision drafts (not written to AUTONOMOUS-DECISIONS.md)
- DRAFT-15-09-a: The generator runs in process; generated Python is never executed in CI (launch descriptor only). Revert: n/a, safety.
- DRAFT-15-09-b: Binding is derived from report.toolsEmitted by name prefix instead of changing Phase 14 (answers Phase 14 question 7). Revert: add bindings to report.json in Phase 14.
- DRAFT-15-09-c: SILENT_GUESS is a warning, not a blocker; the stale-example finding is recorded as an honest Phase 14 result.

## Questions for Ville
- Phase 14 emits a tool for the stale-example operation without any gap. Should Phase 14 report example/schema mismatches, or is this acceptable?
- Tabular and SQL servers read ACME_*_DATA_PATH / ACME_*_DB_PATH, not a base URL. The runner (15-08) must supply a dataset path via envNames.dataPath for them; deriveEnvNames does not currently fill dataPath (suffix rule per plan covers only _BASE_URL, _API_KEY, _BASE_URL_B).

## Deviations from Plan
- [Process] Tasks 1 and 2 are in one commit: the subject imports generatorChecks, so neither compiles alone.
- [Rule 1] deriveBinding also matches `lookup_` (the openapi planner's actual prefix) and `filter_` (derived_filter), beyond the plan's get_/query_ mapping.
- The unused `describe_*` -> schema mapping was dropped (BehaviourKind has no schema kind).

## Verification
`npx vitest run src/lib/mcptest/generatorSubject.test.ts` 18 tests green; `npm run check` exit 0 (see final notes in the report).
