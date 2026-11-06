# Deferred Items — Phase 5

## scripts/ingest.test.ts fails after 05-01's schema change (expected — fixed by 05-02)

**Found during:** 05-01 Task 2, running the full `npx vitest run` suite.

**Symptom:** All 4 tests in `scripts/ingest.test.ts` fail with
`SqliteError: table agents has no column named try_it_out_mode`.

**Root cause:** `scripts/ingest.test.ts` pre-creates its own test table via a
hand-written `CREATE_TABLE_SQL` string that lists every `agents` column
explicitly (it does not use `drizzle-kit push`). Drizzle-orm's generated
`INSERT` statement always references every column defined in
`drizzle/schema.ts` (filling in the column's declared default for any key
missing from the `.values()` object) — confirmed by inspecting
`db.insert(agents).values({...}).toSQL()`, which includes
`try_it_out_mode`/`try_it_out_url`/`try_it_out_task_template` in the column
list even though the caller (`flattenRecord()` in `scripts/ingest.ts`)
never sets them. Because `CREATE_TABLE_SQL` in the test doesn't have these
three columns, the insert fails with a SQLite "no such column" error for
every fixture, so `succeeded` drops to 0 and all four assertions fail.

**Why not fixed here:** `scripts/ingest.ts` and `scripts/ingest.test.ts` are
outside 05-01's file-scope lock (05-CONTEXT.md D-04/D-05; 05-01-PLAN.md
`files_modified`). The 05-01-PLAN.md `<artifacts_produced>` section
explicitly assigns this exact fix to plan 05-02: *"Produced by plan 05-02
(not here): `flattenRecord()` try_it_out literal defaults and the
documented `onConflictDoUpdate` omission in `scripts/ingest.ts`;
`CREATE_TABLE_SQL` + two regression tests in `scripts/ingest.test.ts`."*
This is therefore a known, plan-acknowledged, temporary regression between
the two plans in this phase, not a new defect introduced by mistake.

**Fix (deferred to 05-02):**
- Add `tryItOutMode: 'none', tryItOutUrl: null, tryItOutTaskTemplate: null`
  literals to `flattenRecord()`'s return value in `scripts/ingest.ts` (D-06).
- Add the three `try_it_out_*` columns to `CREATE_TABLE_SQL` in
  `scripts/ingest.test.ts`.
- Per D-07, do NOT add the `try_it_out_*` columns to the
  `onConflictDoUpdate` `set` clause in `scripts/ingest.ts`.

**Verification once 05-02 lands:** `npx vitest run` should report 0
failures across all files (62+ tests, growing with 05-02's own new
regression tests).

**Status:** Deferred — not fixed in 05-01, by design.
