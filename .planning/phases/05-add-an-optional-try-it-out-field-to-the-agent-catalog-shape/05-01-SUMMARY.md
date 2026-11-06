---
phase: 05-add-an-optional-try-it-out-field-to-the-agent-catalog-shape
plan: 01
subsystem: ui
tags: [drizzle, sqlite, sveltekit, svelte5, vitest, jsdom, testing-library]

requires:
  - phase: 02-catalog-and-detail
    provides: agent detail page (+page.svelte/+page.server.ts) and TechAccordion jsdom test pattern to extend
provides:
  - "try_it_out_mode / try_it_out_url / try_it_out_task_template flat columns on the agents table"
  - "Mode-conditional Try It Out affordance on the agent detail page (external link / disabled runnable button / nothing)"
  - "rfi-triage-assistant set to external mode with a placeholder URL as a live example"
  - "jsdom test suite (src/routes/agents/try-it-out.test.ts) covering all five mode/data combinations"
affects: [05-02-ingest-and-defaults]

actuals:
  tokens: 3200
  tasks: 2
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Flat nullable Drizzle columns (text().notNull().default()/text()) for optional catalog metadata, matching the existing llm_* convention"
    - "{#if}/{:else if}/{/if} chain with no {:else} branch to make 'render nothing' the structural default rather than an explicit case"
    - "jsdom render tests import the route's +page.svelte directly and pass a full agent fixture via props.data.agent, reusing the TechAccordion.test.ts docblock/render pattern"

key-files:
  created:
    - src/routes/agents/try-it-out.test.ts
    - .planning/phases/05-add-an-optional-try-it-out-field-to-the-agent-catalog-shape/deferred-items.md
  modified:
    - drizzle/schema.ts
    - src/routes/agents/[slug]/+page.svelte

key-decisions:
  - "Followed D-08 exactly: three flat text columns, no JSON blob, no enum/union type for mode"
  - "Wrapped GitHub link + Try It Out affordance in a single flex row div per D-12, without altering the GitHub anchor's existing attributes/classes"
  - "runnable button styled text-gray-400 bg-gray-100 cursor-not-allowed with a disabled attribute and a title tooltip; zero event handlers (D-11)"
  - "Deferred scripts/ingest.ts and scripts/ingest.test.ts changes to plan 05-02 per the file-scope lock (D-04/D-05) and this plan's own artifacts_produced section, even though the schema change causes 4 pre-existing ingest.test.ts assertions to fail until 05-02 lands"

requirements-completed: []

coverage:
  - id: D1
    description: "agents table has try_it_out_mode (default 'none'), try_it_out_url, try_it_out_task_template columns, applied to db/catalog.db"
    verification:
      - kind: other
        ref: "PRAGMA table_info(agents) via node -e / better-sqlite3 — confirmed try_it_out_mode:'none', try_it_out_url:null, try_it_out_task_template:null"
        status: pass
      - kind: other
        ref: "npx drizzle-kit push --force reports 'No changes detected'"
        status: pass
    human_judgment: false
  - id: D2
    description: "rfi-triage-assistant is set to external mode with a placeholder URL in the dev DB"
    verification:
      - kind: other
        ref: "node -e SELECT try_it_out_mode,try_it_out_url,try_it_out_task_template FROM agents WHERE slug='rfi-triage-assistant' -> {\"try_it_out_mode\":\"external\",\"try_it_out_url\":\"https://example.com/try/rfi-triage-assistant\",\"try_it_out_task_template\":null}"
        status: pass
    human_judgment: false
  - id: D3
    description: "Agent detail page renders an external Try It Out link, opening in a new tab with rel=noopener noreferrer"
    verification:
      - kind: unit
        ref: "src/routes/agents/try-it-out.test.ts#external mode with url renders a single \"Try it out\" link that opens in a new tab"
        status: pass
    human_judgment: false
  - id: D4
    description: "Agent detail page renders a disabled, non-interactive runnable-mode button with no event handlers or execution code"
    verification:
      - kind: unit
        ref: "src/routes/agents/try-it-out.test.ts#runnable mode renders a single disabled \"Try it out\" button and no link"
        status: pass
      - kind: other
        ref: "grep -nE 'on:click|onclick|fetch\\(|use:enhance' src/routes/agents/[slug]/+page.svelte — no matches (exit 1)"
        status: pass
    human_judgment: false
  - id: D5
    description: "none/null/malformed-external rows render nothing for Try It Out (no button, no link, no placeholder)"
    verification:
      - kind: unit
        ref: "src/routes/agents/try-it-out.test.ts#none mode renders nothing for Try It Out, but still renders the GitHub link"
        status: pass
      - kind: unit
        ref: "src/routes/agents/try-it-out.test.ts#null/missing mode renders nothing, without crashing"
        status: pass
      - kind: unit
        ref: "src/routes/agents/try-it-out.test.ts#external mode with a missing url renders nothing (malformed row)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Scope lock held — no changes to src/lib/spec/*, data/agents/*, or +page.server.ts"
    verification:
      - kind: other
        ref: "git diff --stat -- src/lib/spec data/agents src/routes/agents/[slug]/+page.server.ts — no output"
        status: pass
    human_judgment: false

duration: ~15min
completed: 2026-08-18
status: complete
---

# Phase 5 Plan 1: Try It Out Field — Storage, UI, and Live Example Summary

**Three flat Drizzle columns (`try_it_out_mode`/`url`/`task_template`) plus a mode-conditional Try It Out affordance on the agent detail page — external link, disabled runnable button, or nothing — with `rfi-triage-assistant` live in `external` mode.**

## Performance

- **Duration:** ~15 min (including `npm install` on a fresh worktree checkout and DB bootstrap)
- **Tasks:** 2
- **Files modified:** 2 (`drizzle/schema.ts`, `src/routes/agents/[slug]/+page.svelte`)
- **Files created:** 2 (`src/routes/agents/try-it-out.test.ts`, `.planning/.../deferred-items.md`)

## Accomplishments
- Added `tryItOutMode` (`text().notNull().default('none')`), `tryItOutUrl` (nullable), and `tryItOutTaskTemplate` (nullable) flat columns to the `agents` Drizzle table, applied to `db/catalog.db` via `drizzle-kit push --force`
- Rendered a mode-conditional Try It Out affordance in the agent detail page's executive-summary section, next to the GitHub link: `external` → working `target="_blank"` link, `runnable` → visually distinct disabled `<button>`, `none`/`null`/malformed → nothing
- Set `rfi-triage-assistant`'s dev DB row to `external` mode with a placeholder URL via a one-off `better-sqlite3` `UPDATE` (not committed to any file)
- Wrote `src/routes/agents/try-it-out.test.ts` with 5 jsdom render tests covering external, runnable, none, null-mode, and external-without-url
- Verified zero runtime execution code exists for `runnable` mode (`grep` for `on:click`/`onclick`/`fetch(`/`use:enhance` finds nothing)

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end external mode — schema columns, applied migration, live example agent, working link** - `b0cbde8` (feat)
2. **Task 2 (RED): failing tests for runnable/none/null/malformed modes** - `ec960ab` (test)
2. **Task 2 (GREEN): disabled runnable button, silent none/null/malformed** - `b14e7bb` (feat)
3. **Deferred-items log** - `aa469a7` (docs)

_Note: Task 2 used TDD (`tdd="true"`), producing a RED test commit followed by a GREEN implementation commit._

## Files Created/Modified
- `drizzle/schema.ts` - Added `tryItOutMode`/`tryItOutUrl`/`tryItOutTaskTemplate` columns after `specId`
- `src/routes/agents/[slug]/+page.svelte` - Wrapped GitHub link in a flex row alongside a new `{#if}/{:else if}` Try It Out chain (external link / disabled runnable button / nothing)
- `src/routes/agents/try-it-out.test.ts` (new) - 5 jsdom tests covering all mode/data combinations
- `.planning/phases/05-add-an-optional-try-it-out-field-to-the-agent-catalog-shape/deferred-items.md` (new) - Documents the expected `scripts/ingest.test.ts` regression, deferred to plan 05-02

## Re-apply after DB reset

`db/` is gitignored, so this command is the only durable record of the one-off example-agent update (D-13). If `db/catalog.db` is ever reset/reingested, re-run:

```bash
node -e "const D=require('better-sqlite3');const d=new D('db/catalog.db');d.prepare(\"UPDATE agents SET try_it_out_mode='external', try_it_out_url='https://example.com/try/rfi-triage-assistant' WHERE slug='rfi-triage-assistant'\").run();d.close()"
```

Prerequisite: `npm run db:push` (or `npx drizzle-kit push --force`) must have already applied the `try_it_out_*` columns from `drizzle/schema.ts`, and the row for `rfi-triage-assistant` must already exist (via `npm run ingest`).

## Decisions Made
- Flat nullable columns, no JSON blob, no enum/union type for `tryItOutMode` (D-08) — matches the existing `llm_*` convention exactly
- Single `<div class="flex flex-wrap items-center gap-4">` wraps both the GitHub link and the Try It Out affordance so they sit on one row (D-12), without touching the GitHub anchor's own attributes/classes
- `{#if}/{:else if}/{/if}` chain with **no `{:else}` branch** — `none`/`null`/malformed-`external` fall through to render nothing, structurally, rather than via an explicit conditional (D-09)
- `runnable` button: `type="button" disabled`, `text-gray-400 bg-gray-100 cursor-not-allowed`, a `title` tooltip, and zero event handlers/fetch/form/server code (D-11)
- Example agent (`rfi-triage-assistant`) set via a one-off `better-sqlite3` `UPDATE`, never via YAML edit (D-13) — verbatim command recorded above for reproducibility after any DB reset
- `try_it_out_task_template` is stored but intentionally not rendered anywhere in this phase (no decision authorizes it)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Bootstrapped a fresh worktree checkout before any task work**
- **Found during:** Pre-task setup
- **Issue:** The worktree had no `node_modules/`, no `db/` directory, and no `db/catalog.db` — `npx vitest run` failed immediately with `Cannot open database because the directory does not exist`, unrelated to any task logic
- **Fix:** Ran `npm install`, `mkdir -p db` (gitignored dir, not committed), `npm run db:push`, and `npm run ingest` to bring the worktree to the same runnable state assumed by the plan's `<interfaces>` section
- **Files modified:** None tracked (node_modules/, db/ are gitignored)
- **Verification:** `npx vitest run` reported 57/57 passing before any plan task began

### Deferred (not fixed — out of declared file scope)

**1. [Scope boundary] `scripts/ingest.test.ts` (4 tests) fails after the schema change**
- **Found during:** Task 2, running `npx vitest run` for the full-suite acceptance criterion
- **Issue:** Drizzle-orm's generated `INSERT` statement always references every column defined in `drizzle/schema.ts` (confirmed via `.toSQL()` inspection), filling in each column's declared default when absent from `.values()`. `scripts/ingest.test.ts` pre-creates its own test table via a hand-written `CREATE_TABLE_SQL` that doesn't have the three new `try_it_out_*` columns, so every insert now fails with `table agents has no column named try_it_out_mode`, dropping `succeeded` to 0 for all 4 of that file's tests
- **Why not fixed:** `scripts/ingest.ts` and `scripts/ingest.test.ts` are outside 05-01's file-scope lock (`files_modified` frontmatter; D-04/D-05). This plan's own `<artifacts_produced>` section explicitly assigns the fix — `flattenRecord()` defaults and updated `CREATE_TABLE_SQL` — to plan 05-02, confirming this is a designed two-plan split, not an oversight
- **Details:** See `.planning/phases/05-add-an-optional-try-it-out-field-to-the-agent-catalog-shape/deferred-items.md`
- **Net effect on full suite:** `npx vitest run` currently reports 58/62 passing (4 known, plan-acknowledged failures, all confined to `scripts/ingest.test.ts`); the new `src/routes/agents/try-it-out.test.ts` (5/5) and all other pre-existing files pass

---

**Total deviations:** 1 auto-fixed (environment bootstrap, Rule 3), 1 deferred (scope-locked, logged to `deferred-items.md`)
**Impact on plan:** No scope creep. The deferred item is a known consequence of the plan's own two-plan design and resolves once 05-02 executes.

## Issues Encountered
- Confirmed via direct `.toSQL()` inspection that Drizzle-orm's SQLite insert builder always includes every schema-defined column (using its declared default) regardless of what keys are present in `.values()` — this is what makes the `scripts/ingest.test.ts` regression unavoidable without touching that file, and is the reason the plan authors split the ingest-side fix into 05-02

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `drizzle/schema.ts`'s `AgentRow`/`NewAgentRow` types are widened with the three new columns and ready for 05-02 to consume in `scripts/ingest.ts`
- 05-02 must: add `tryItOutMode: 'none', tryItOutUrl: null, tryItOutTaskTemplate: null` literals to `flattenRecord()`, add the three columns to `scripts/ingest.test.ts`'s `CREATE_TABLE_SQL`, and NOT add them to the `onConflictDoUpdate` `set` clause (D-07) — see `deferred-items.md` for full detail
- Once 05-02 lands, `npx vitest run` should return to 0 failures across the whole suite

---
*Phase: 05-add-an-optional-try-it-out-field-to-the-agent-catalog-shape*
*Completed: 2026-08-18*

## Self-Check: PASSED

- FOUND: `.planning/phases/05-add-an-optional-try-it-out-field-to-the-agent-catalog-shape/05-01-SUMMARY.md`
- FOUND: `src/routes/agents/try-it-out.test.ts`
- FOUND: `.planning/phases/05-add-an-optional-try-it-out-field-to-the-agent-catalog-shape/deferred-items.md`
- FOUND commits: `b0cbde8`, `ec960ab`, `b14e7bb`, `aa469a7`, `b476724`
