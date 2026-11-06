---
phase: 14-mcp-generator-generalized-from-research-flagged
plan: 04
subsystem: mcpgen
tags: [adapters, tabular-catalog, sql-ddl, goldens]
requires: [14-01, 14-02]
provides:
  - tabularCatalogAdapter (id tabular-catalog)
  - sqlDdlAdapter (id sql-ddl, CUST-02)
affects: [14-07]
tech-stack:
  added: []
  patterns: [hand-written tolerant parsers, gaps instead of guesses]
key-files:
  created:
    - src/lib/mcpgen/adapters/tabular-catalog.test.ts
    - src/lib/mcpgen/adapters/sql-ddl.test.ts
    - src/lib/mcpgen/adapters/dataset.golden.test.ts
    - src/lib/mcpgen/testing/fixtures/acme-catalog-header.csv
    - src/lib/mcpgen/testing/fixtures/acme-catalog-dictionary.csv
    - src/lib/mcpgen/testing/fixtures/acme-schema.sql
    - src/lib/mcpgen/testing/fixtures/acme-schema-bad.sql
    - src/lib/mcpgen/__golden__/tabular.model.json
    - src/lib/mcpgen/__golden__/tabular.server.py
    - src/lib/mcpgen/__golden__/sqlddl.model.json
    - src/lib/mcpgen/__golden__/sqlddl.server.py
  modified:
    - src/lib/mcpgen/adapters/tabular-catalog.ts
    - src/lib/mcpgen/adapters/sql-ddl.ts
decisions: [D-150, D-151, D-152]
metrics:
  tasks: 2
  completed: 2026-10-12
---

# Phase 14 Plan 04: tabular-catalog and sql-ddl adapters Summary

Two more InputAdapters behind the same interface (header/dictionary text and CREATE TABLE DDL), hand-parsed, with invented fixtures and byte-stable goldens through the 14-02 emitter. Registry, `adapters/index.ts`, plan and emitter are untouched.

## Commits
- 18e2452 feat(14-04): tabular-catalog adapter
- Task 2 commit (see `git log`): sql-ddl adapter and dataset goldens

## What was built
- **tabular-catalog**: format is a header line of column codes, up to 5 sample rows (type inference only, values never stored), `# dictionary` (`code,label[,type[,description]]`) and `# options` (`skip_rows`, `identifier`, `entity`, `name`). More than 5 data rows is rejected (`rows-rejected`). Gaps: `no-identifier`, `duplicate-column`, `invalid-column`, `column-collision`, `column-renamed`, `dictionary-orphan`, `missing-label`, `unknown-type`, `identifier-unknown`. Identifier columns are always typed string.
- **sql-ddl**: CREATE TABLE with PK (inline/table-level/composite), FK (inline/table-level), quoting styles, comments, IF NOT EXISTS, schema-qualified names. SELECT-only `list_<t>` and `get_<t>` operations; backend sql, `<NAME>_DB_PATH`. INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/GRANT are aggregated into `statement-ignored` gaps and recorded in `writeOperationsDropped` as `<verb>:<table>`; views, indexes, triggers become `unsupported-statement`. Other gaps: `no-identifier`, `unparsable-table`, `duplicate-column`, `duplicate-table`, `unsafe-identifier`, `unknown-type`, `unsupported-type`, `unsupported-syntax`, `limit-default`, `no-tables` (rejected).
- Goldens: `tabular.*` and `sqlddl.*`. Tests assert allow-listed identifiers, bound parameters, no write keywords, read-only open mode, and (when python3 exists) syntax-only py_compile. Generated Python was never run.

## Deviations from Plan
**1. [Rule 1 - Bug avoidance] Column and table names are kept verbatim when they are already safe identifiers.** The plan said normalise codes/ids to snake_case, but the 14-02 emitter reads CSV columns and SQL tables by `field.name` / `entity.id` exactly. Snake-casing `WG010` or `OrderItems` would break the generated server. Names are therefore kept as written when they match `[A-Za-z_][A-Za-z0-9_]*`; only unsafe tabular codes are snake-cased (gap `column-renamed`, data header must use that name), unsafe SQL names are dropped (`unsafe-identifier`). The original tabular code is always kept in the field description.

## Observations for 14-07 / core owners (not changed here)
- The sql/dataset planner ignores `operations`; it emits only `describe_*` and `query_<entity>`. The list/get operations are modelled for fidelity but produce no extra lookup tool. Lookup by FK parent works through the query tool filter.
- SQL `ORDER BY` uses only the first identifier column, so paging over composite-PK tables is not fully deterministic.
- A tabular entity without an identifier still gets the query tool (no lookup exists in the dataset backend anyway).

## Decision drafts (for 14-07 to consolidate into AUTONOMOUS-DECISIONS.md)

**D-150 Tabular input is header/dictionary text; rows over 5 rejected.** Alternatives: ingest whole files; accept xlsx. Why: real catalogs must never be ingested (synthesis 4.3, 5.4); the schema is enough to generate a server and the real file is read at run time via `<NAME>_DATA_PATH`. Answers synthesis open question 3. Revert: raise or remove `MAX_SAMPLE_ROWS` in `tabular-catalog.ts`; delete the adapter and its entry stays a stub.

**D-151 sql-ddl scope: CREATE TABLE only, SQLite-compatible generated backend.** Other statements are reported and ignored, never converted to tools; write verbs are listed in `writeOperationsDropped`. Alternatives: introspect live DBs (needs credentials, out of scope); support views. Revert: restore the 14-01 stub of `sql-ddl.ts`.

**D-152 Hand-written tolerant DDL parser instead of a SQL library.** Alternatives: node-sql-parser or similar. Why: no new dependencies, tolerant of dialect noise, reports gaps instead of throwing, tiny surface. Cost: only the constructs listed above are understood. Revert: swap the parser inside `sql-ddl.ts` behind the same adapter export.

## Verification
- `npx vitest run src/lib/mcpgen` green; `npx tsc --noEmit` clean.
- `npm run check` exit 0 (1129 passed). One earlier full run hit a load-induced 5s timeout in the unrelated `scripts/validate-submission.test.ts` smoke test; it passed when rerun alone (29/29) and the next full run was green.
- No existing test file edited; only files listed in the plan were touched.

## Self-Check: PASSED
