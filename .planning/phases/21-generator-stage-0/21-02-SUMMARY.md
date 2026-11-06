---
phase: 21-generator-stage-0
plan: 02
requirements: [CUST-02]
status: complete
---
# 21-02 Summary: read-only tool annotations

## What changed
- `emit/python.ts`: one module constant `_ANNOTATIONS = {readOnlyHint: True, destructiveHint: False, idempotentHint: True, openWorldHint: <True for http, False for dataset/sql>}` next to the configuration constants; registration is now `mcp.tool(_tool, annotations=_ANNOTATIONS)`. Proposal wrapper tools are registered by the same loop, so they carry it too (emit/proposed.ts needed no change).
- `emit/pytestProposed.ts`: new exported `annotationTests(openWorld)`; also used by the proposal-assisted test file.
- `emit/pytest.ts`: `commonTests(names, openWorld)` now includes `test_every_tool_declares_read_only_annotations` (http true, dataset/sql false; odata path included).
- The generated test lists tools via the in-memory `fastmcp.Client` (`client.list_tools()`) and reads each hint as attribute or dict key, so it is tolerant of model-vs-mapping differences between fastmcp versions.
- `emit/annotations.test.ts` (written first, committed failing): all three backends, all proposal scenarios (http and sql), and the generated-test assertions.

## Tests
`npx tsc --noEmit` clean. Full `npx vitest run`: 3120 passed, 30 failed, all of them golden byte-equality tests (annotations.test.ts, hygiene.test.ts, flag-off goldens and all non-golden tests pass). `svelte-kit sync` was not run separately.

## Golden churn pending for plan 21-05 (not regenerated)
All caused by the new `_ANNOTATIONS` constant and registration line in server.py (and the new test in test_server.py where it is golden):
- adapters/dataset.golden.test.ts: sql-ddl, tabular-catalog
- adapters/odata.golden.test.ts: odata-json, odata-xml
- adapters/openapi.formats.golden.test.ts: acme-oauth2.yaml, acme-openapi31.yaml, acme-swagger2.json, acme-swagger2.yaml
- adapters/openapi.golden.test.ts: openapi golden
- adapters/sql-dialects.golden.test.ts: mysqldump, pgdump, prisma, sqlite
- emit/golden.test.ts: acme-dataset, acme-http (also carries the 21-01 "See for details" change), acme-sql
- proposals/golden.test.ts: acme-openapi.yaml x8 (rename-describe, hide, defaults-pin, merge, merge-fanout, split, composite, composite-fanout), acme-schema.sql x6 (rename-describe, hide, defaults-pin, merge, split, composite)

## Not done
No live run of the generated pytest on fastmcp 3.4.8/4.1.0 (no venv created); left to plan 21-05 as the plan allows. Code kept conservative (Client.list_tools, tolerant attribute access).
