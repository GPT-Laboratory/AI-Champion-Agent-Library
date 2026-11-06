# E12: SQL dialect folding, pg_dump key fix and the Prisma reader

Decided by Ville on 2026-10-14 (research: `.planning/phases/14-mcp-generator-generalized-from-research-flagged/14-INPUT-KINDS-RESEARCH.md` sections 3.3, 4, 5 "Adapter D", 9). Decisions D-540..D-549 in `.planning/AUTONOMOUS-DECISIONS.md`. Branch: worktree branch, never pushed.

## What was built

1. Defect fix (test first, `adapters/sql-alter.test.ts` failed 10 of 11 before the fix): the sql-ddl adapter dropped every `ALTER TABLE` as a write, so pg_dump input lost its keys. `ADD [CONSTRAINT x] PRIMARY KEY / FOREIGN KEY ... REFERENCES / UNIQUE / CHECK` are now folded into the tables; `ALTER COLUMN ... SET NOT NULL` is folded; `SET DEFAULT nextval(...)`, identity changes and `OWNER TO` are ignored quietly; every other ALTER stays a reported write (`statement-ignored`, `writeOperationsDropped` as before). A keyless table with an unreadable key-like ALTER gets `alter-may-hold-keys`.
2. pg_dump (--schema-only), SQLite `.schema` / `.dump` and mysqldump (--no-data) are read by the same adapter (`adapters/sql-ddl.ts`, helpers `sql-scan.ts`, `sql-common.ts`, `sql-dialect.ts`). Dialect is detected from structural markers only; two dialects present means `dialect-ambiguous` and generic reading.
3. COPY data blocks are removed first (`src/lib/mcpgen/sqlcopy.ts`), by the registry before the credential scan and by the adapter before parsing. Only the line count survives (`data-rows-skipped`).
4. New adapter `prisma` (`adapters/prisma.ts`).
5. `sqlite-backend-only` info gap for pg, mysql and prisma input.

## Pre-existing files edited (minimal)

| File | Change | Why |
| --- | --- | --- |
| `src/lib/mcpgen/registry.test.ts` | the adapter id list gains `prisma` | a new adapter is registered (D-546) |
| `src/lib/mcpgen/criteria.test.ts` | the registered adapter id list gains `prisma` | same |
| `src/lib/mcptest/criteria.test.ts` | both files above added to EXEMPT | the Phase 15 "no pre-existing test modified" guard |
| `src/lib/mcpgen/registry.ts` | strips COPY data before the credential scan when sql-ddl will parse the text | rows are never ingested, and a dump with data must not be rejected for its rows (D-542) |
| `src/lib/mcpgen/adapters/index.ts` | one registration line | the documented extension point |
| `scripts/generate-mcp.ts` | usage string lists `prisma` | CLI help |

`types.ts`, `emit/*` and the planner are untouched. Existing goldens (`sqlddl.*`) are byte-identical.

## Behaviour changes of the existing sql-ddl adapter (inputs that used to parse differently)

- Quote handling is shared and now understands PostgreSQL dollar-quoted strings (`$$ ... $$`), `E'...\'...'` strings and MySQL backslash escapes (only when the dialect markers say so).
- `UNIQUE KEY name (cols)`, `KEY name (cols)` and backtick-quoted index names are skipped as index lines (before, they were read as a column named UNIQUE or KEY). A column called `key` or `index` with a type length (`key VARCHAR(20)`) is still a column.
- Column constraint keywords are looked for outside quotes and parentheses (an enum value `'default'` no longer cuts the type), and words inside string defaults or comments no longer count (`DEFAULT 'primary key'` no longer makes a primary key).
- The array-type regex in `mapType` was quadratic on long runs of spaces after `[`; it is linear now.
- A single-column UNIQUE (inline, table-level, or via ALTER) adds the note `Unique.` to the field description.

## Known limits

- COPY stripping is line based: a `COPY ... FROM stdin;` line inside a multi-line string or block comment is treated as a data block. Both the scanner and the parser see the same text, so nothing is parsed that was not scanned.
- The generated server is SQLite only. The author supplies a SQLite file with the same tables and columns.
- Composite and range types, domains, views, functions and triggers are reported as unsupported; partitions (`PARTITION OF`) and `CREATE TABLE ... LIKE` are reported.
- Prisma: `@default` values and native `@db.*` types are never read; composite types (`type`) and views are reported; relation fields are not columns.
