---
phase: 21-generator-stage-0
status: passed
verified: 2026-10-15
---

# Phase 21 Verification

Status: passed. All five success criteria are evidenced by tests; generated packages were run on real FastMCP 3.4.8 and 4.1.0.

## Final verified numbers (branch autonomous/overnight-improvements, 2026-10-15)

- `npm run check` exit 0, run alone: 277 test files passed (1 skipped), 3319 tests passed (1 skipped).
- Goldens: one commit, `5188702` "test(21): regenerate generator goldens for stage 0", 50 files, all under `src/lib/mcpgen/__golden__/` (+2278/-258 lines). Regenerated with `UPDATE_GOLDEN=1` suite by suite (binding, openapi, openapi.formats, proposals, sql-dialects, odata, dataset, emit, flag-off); `npx vitest run src/lib/mcpgen scripts` afterwards without the variable: 73 files, 1197 tests passed.
- Golden diff review: server.py gains `_ANNOTATIONS`, `_OUT_*`, `_OUTPUT_SCHEMAS` and the longer registration line; test_server.py gains annotation and schema tests; report.json changes are gap reordering only (same entries, sorted); one description change (`See [link removed] for details` becomes `See for details`); proposal diffs and review texts follow the same lines. A grep of added lines for URLs, markup, template syntax and secrets found only existing OAuth message text.

## FastMCP runs (throwaway venvs under scratchpad, deleted afterwards; packages regenerated after 21-04)

Packages: 26 per version, generated with `scripts/generate-mcp.ts` from the Acme fixtures plus 14 proposal-assisted packages (all 8 http and 6 sql proposal scenarios over acme-openapi.yaml and acme-schema.sql). Each package's own pytest, in-process `fastmcp.Client`.

| Package | 3.4.8 | 4.1.0 |
| --- | --- | --- |
| openapi / swagger2 / oauth2 / openapi31 | 28 / 28 / 21 / 21 | 28 / 28 / 21 / 21 |
| odata-json / odata-xml | 20 / 20 | 20 / 20 |
| sql (acme-schema) / pgdump / mysqldump / sqlite / prisma | 42 / 42 / 24 / 33 / 33 | 42 / 42 / 24 / 33 / 33 |
| tabular (dataset) | 15 | 15 |
| 14 proposal-assisted (http x8, sql x6) | 7 each, all pass | 7 each, all pass |

All passed, no failures or skips. Versions confirmed by `fastmcp.__version__` (3.4.8, 4.1.0). Earlier (21-03) the http, dataset and sql packages were also run on both versions with no warnings.

## Evidence per success criterion

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Hygiene filter on spec-derived descriptions | Met | 21-01, `hygiene.test.ts`; D-600, D-601 |
| 2 | Read-only annotations on every tool | Met | 21-02, `annotations.test.ts`, generated test on both FastMCP versions; D-602 |
| 3 | outputSchema and structuredContent | Met | 21-03, `outputschema.test.ts`, generated schema tests on both versions; D-603 |
| 4 | Deterministic order across runs and input orderings | Met | 21-04, `determinism.test.ts` (147 tests); D-604 |
| 5 | Every server, goldens in a dedicated commit, pytest on both versions | Met | commit 5188702; table above |

## Not run

- OData with proposals (filter/split ops unsupported on OData, see Phase 20); OData packages ran without proposals.
- Real HTTP upstream calls and a real SQLite/CSV data file against the generated servers (tests use fakes and in-process clients).
- `mcp-test --allow-local-exec` against the new packages (human-gated).
