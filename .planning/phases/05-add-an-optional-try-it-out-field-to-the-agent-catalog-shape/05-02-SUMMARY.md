---
phase: 05-add-an-optional-try-it-out-field-to-the-agent-catalog-shape
plan: 02
subsystem: database
tags: [drizzle, sqlite, better-sqlite3, vitest, ingestion, upsert]

requires:
  - phase: 05-add-an-optional-try-it-out-field-to-the-agent-catalog-shape
    provides: "try_it_out_mode/url/task_template columns on drizzle/schema.ts's agents table, plan 05-01's known-and-deferred scripts/ingest.test.ts regression"
provides:
  - "scripts/ingest.ts flattenRecord() writes safe try_it_out defaults (mode='none', url=null, task_template=null) on every inserted row"
  - "scripts/ingest.ts onConflictDoUpdate never overwrites a manually-set try_it_out value on re-ingest (D-07), with a load-bearing comment documenting why"
  - "scripts/ingest.test.ts CREATE_TABLE_SQL mirrors the full agents schema (fixes the plan-05-01-acknowledged regression) plus two new regression tests (fresh-insert defaults, no-clobber preservation)"
  - "Human-verified: external mode renders a working link, and (per Phase 6, which landed after this plan was written) runnable mode now renders a full working TryItOutPanel rather than a disabled button"
affects: []

actuals:
  tokens: 900
  tasks: 3
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Drizzle-orm fills a column's schema-declared default for any key omitted from .values() on insert — confirmed again here — so explicit literal defaults in flattenRecord() are for code clarity/acceptance-criteria conformance, not strictly required for the observed passing behavior"
    - "onConflictDoUpdate no-clobber-by-omission: columns absent from the update set block are never touched on conflict, making 'don't overwrite this column' a structural guarantee rather than a runtime check"

key-files:
  created: []
  modified:
    - scripts/ingest.ts
    - scripts/ingest.test.ts

key-decisions:
  - "Followed D-06/D-07 exactly: flattenRecord() adds three literal defaults not read from AgentRecord; onConflictDoUpdate's set block omits all three try_it_out columns, with a load-bearing comment"
  - "TDD RED phase was not literally failing: the new regression tests already passed against the pre-change scripts/ingest.ts, because drizzle-orm auto-fills schema column defaults for keys missing from .values(), and the onConflictDoUpdate set block never listed the three columns in the first place. Made the explicit ingest.ts code changes anyway per the plan's acceptance criteria (grep-verifiable literals + comments), split into a separate 'test' commit and 'feat' commit to preserve the TDD commit structure"
  - "User decision (mid-checkpoint correction): hvac-load-calculator is NOT reset to 'none' after this plan. It stays 'runnable' so Phase 6's fully-working TryItOutPanel demo remains live on the site. The plan's own Task 3 acceptance criterion ('After approval, hvac-load-calculator is reset to try_it_out_mode = none') is explicitly superseded by this user instruction and intentionally not executed"
  - "Checkpoint verification steps were corrected mid-flight: the original Task 3 <how-to-verify> text (written when this plan was authored) described runnable mode as a disabled, non-interactive button per 05-01/D-11. Phase 6 (completed after 05-01 but before this plan executed) replaced that disabled button with a fully working TryItOutPanel (submit task, progress feed, download artifact) for runnable-mode agents. The human verified the current (Phase 6) behavior — a working panel, not a disabled button — and approved that as correct, since it reflects the actual shipped UI, not the stale plan text"

requirements-completed: []

coverage:
  - id: D1
    description: "Fresh ingest of an agent writes try_it_out_mode='none', try_it_out_url=null, try_it_out_task_template=null"
    verification:
      - kind: unit
        ref: "scripts/ingest.test.ts#fresh insert defaults try_it_out columns to safe values"
        status: pass
    human_judgment: false
  - id: D2
    description: "Re-ingesting an agent with a manually-set try_it_out value preserves it while still refreshing last_ingested_at and every other column"
    verification:
      - kind: unit
        ref: "scripts/ingest.test.ts#re-ingesting never clobbers a manually-set try_it_out value, but still refreshes other columns"
        status: pass
      - kind: other
        ref: "npm run build against the real dev DB: rfi-triage-assistant stayed try_it_out_mode='external' with its placeholder URL, last_ingested_at advanced from 08:44:09.495Z to 13:19:13.631Z"
        status: pass
    human_judgment: false
  - id: D3
    description: "onConflictDoUpdate set block never references try_it_out columns (D-07 structural guarantee), with a load-bearing rationale comment"
    verification:
      - kind: other
        ref: "grep -c 'excluded.try_it_out' scripts/ingest.ts -> 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "Full suite green, scope lock held (no changes outside scripts/ingest.ts and scripts/ingest.test.ts)"
    verification:
      - kind: unit
        ref: "npx vitest run -> 103/103 passing"
        status: pass
      - kind: other
        ref: "git diff --stat -- src/lib/spec data/agents drizzle/schema.ts src/routes -> empty"
        status: pass
    human_judgment: false
  - id: D5
    description: "Human confirms all three try_it_out modes render correctly in a real browser with no layout regression"
    verification:
      - kind: manual
        ref: "Human completed the corrected 3-page browser walkthrough (external link, runnable full TryItOutPanel per Phase 6, none renders nothing) and replied 'approved'"
        status: pass
    human_judgment: true
    rationale: "Visual/interactive rendering correctness across modes and viewport widths requires human judgment; cannot be fully asserted by jsdom unit tests alone"

duration: ~10min active work (Tasks 1-2) + a longer wall-clock gap for the human checkpoint
completed: 2026-08-19
status: complete
---

# Phase 5 Plan 2: Try It Out Field — Ingestion Durability and Human Verification Summary

**`scripts/ingest.ts` now defaults new rows' `try_it_out_*` columns to safe literals and structurally never clobbers a manually-set value on re-ingest (via deliberate omission from `onConflictDoUpdate`), closing the plan-05-01-acknowledged `scripts/ingest.test.ts` regression — verified against both the test DB and a real `npm run build`, and human-approved in a live browser walkthrough that also confirmed Phase 6's working `TryItOutPanel` now renders for `runnable` mode.**

## Performance

- **Duration:** ~10 min active work (Tasks 1-2); checkpoint spanned a longer wall-clock gap for the human's browser walkthrough
- **Tasks:** 3 (2 autonomous + 1 human checkpoint)
- **Files modified:** 2 (`scripts/ingest.ts`, `scripts/ingest.test.ts`)

## Accomplishments
- Closed the plan-05-01-acknowledged regression: `scripts/ingest.test.ts`'s hand-written `CREATE_TABLE_SQL` now includes `try_it_out_mode`/`try_it_out_url`/`try_it_out_task_template`, matching `drizzle/schema.ts` exactly
- `flattenRecord()` now explicitly returns literal safe defaults for the three columns (not sourced from `AgentRecord`, per D-05/D-06), with a comment explaining why
- `onConflictDoUpdate`'s `set` block carries a load-bearing comment documenting the deliberate omission of the three columns (D-07 no-clobber guarantee)
- Added two new regression tests: fresh-insert defaults, and re-ingest preservation (proves both that the value survives AND that `last_ingested_at` still advances, so the row was genuinely re-upserted, not skipped)
- Verified the no-clobber guarantee against the real dev DB via a full `npm run build`: `rfi-triage-assistant` stayed `external` with its placeholder URL, while `last_ingested_at` advanced by ~4.5 hours of wall-clock time between the pre- and post-build snapshots
- Full suite: 103/103 tests passing, 0 regressions
- Human completed the (corrected) 3-page browser verification and approved: external mode shows a working link, runnable mode now shows Phase 6's fully working `TryItOutPanel` (not the disabled placeholder button described in this plan's original text — see Deviations), and `none` mode shows nothing

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): add try_it_out regression tests to ingest.test.ts** - `a34bb4b` (test)
2. **Task 1 (GREEN): flattenRecord defaults try_it_out columns, never clobbers on re-ingest** - `9350bd0` (feat)
3. **Task 2: End-to-end durability check (verification only, no files modified — no commit)**
4. **Task 3: Human checkpoint — approved**

_Note: Task 1 used TDD (`tdd="true"`). The RED test commit was not literally failing against the pre-change code — see Deviations for why — but the commit split was preserved for structural consistency with the plan's TDD instruction._

## Files Created/Modified
- `scripts/ingest.test.ts` - Extended `CREATE_TABLE_SQL` with the three `try_it_out_*` columns; added `fresh insert defaults try_it_out columns to safe values` and `re-ingesting never clobbers a manually-set try_it_out value, but still refreshes other columns` tests
- `scripts/ingest.ts` - `flattenRecord()` returns `tryItOutMode: 'none'`, `tryItOutUrl: null`, `tryItOutTaskTemplate: null` with a D-05/D-06 rationale comment; `onConflictDoUpdate`'s `set` block gained a D-07 rationale comment documenting the deliberate three-column omission

## Decisions Made
- D-06/D-07 followed exactly: literal defaults in `flattenRecord()`, structural no-clobber via omission from `onConflictDoUpdate`'s `set` block, both with load-bearing comments
- TDD RED/GREEN commit split preserved even though the RED-phase tests passed against unmodified code (see Deviations) — the explicit `ingest.ts` literals still matter for the plan's grep-verifiable acceptance criteria and for future-reader clarity
- **User decision (mid-checkpoint):** `hvac-load-calculator` is NOT reset to `try_it_out_mode = 'none'` after this plan, superseding the plan's own Task 3 acceptance criterion. It stays `runnable` so Phase 6's fully-working `TryItOutPanel` demo remains live on the site
- The human-verification checkpoint text was corrected mid-flight to describe Phase 6's actual current `runnable`-mode behavior (a working panel) rather than the pre-Phase-6 disabled-button behavior this plan's text was originally written against; the human verified and approved the correct (current) behavior

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, missing functionality, or blocking issues were found during Tasks 1-2 that required Rule 1/2/3 fixes.

### Plan-text vs. reality corrections (not code deviations)

**1. TDD RED phase was not literally failing**
- **Found during:** Task 1, immediately after adding the two new tests to `scripts/ingest.test.ts`
- **Issue:** The plan's TDD instruction expects a failing RED commit. Running the new tests against the unmodified `scripts/ingest.ts` produced 6/6 passing, not a failure, because (a) drizzle-orm's generated INSERT always fills in a column's schema-declared default for any key missing from `.values()` (confirmed by 05-01's `.toSQL()` inspection, reconfirmed here), and (b) the `onConflictDoUpdate` set block already never referenced the three columns (they were simply never added to it), which already satisfies the no-clobber requirement structurally.
- **Resolution:** Committed the test file as the "RED" commit anyway (documenting the coverage addition and explaining in the commit body why it passes immediately), then made the explicit `flattenRecord()` literals and `onConflictDoUpdate` comment as a separate "GREEN" commit per the plan's grep-verifiable acceptance criteria. No test or production code needed correction — the underlying behavior was already correct, only the explicit documentation/code-clarity requirement remained.
- **Files modified:** `scripts/ingest.test.ts` (test commit), `scripts/ingest.ts` (feat commit)
- **Commits:** `a34bb4b`, `9350bd0`

**2. Checkpoint verify-steps text was stale relative to Phase 6**
- **Found during:** Task 3, human checkpoint
- **Issue:** This plan's Task 3 `<how-to-verify>` (written during Phase 5 planning, before Phase 6 existed) instructed the human to expect a disabled, non-interactive `runnable`-mode button. Phase 6 (completed 2026-08-19, before this plan executed) replaced that placeholder with a fully working `TryItOutPanel` for `runnable` agents. Following the plan's stale text verbatim would have had the human "fail" the checkpoint over a passing, intentional, later-phase feature.
- **Resolution:** The coordinator corrected the verification instructions mid-flight to describe the actual current (Phase 6) `runnable`-mode behavior. The human verified the corrected behavior and approved it.
- **Net effect:** No code was affected. This is a plan-authoring artifact (Phase 5 planned before Phase 6 existed) rather than a defect in either phase's implementation.

**3. User overrode Task 3's `hvac-load-calculator` reset acceptance criterion**
- **Found during:** Task 3, human checkpoint approval
- **Issue:** The plan's Task 3 acceptance criteria include "After approval, `hvac-load-calculator` is reset to `try_it_out_mode = 'none'`," written when `runnable` mode had no real functionality to demo (05-01 era). Since Phase 6 gave `runnable` mode a real working demo, the user explicitly chose to keep `hvac-load-calculator` as `runnable` in the live dev DB rather than resetting it.
- **Resolution:** The reset command was intentionally NOT run, per direct user instruction. `hvac-load-calculator` remains `try_it_out_mode = 'runnable'` in `db/catalog.db` (gitignored, not committed).
- **Files modified:** None (DB-only, gitignored).

---

**Total deviations:** 0 code deviations (Rules 1-3 not triggered). 2 plan-authoring/stale-text corrections (RED-phase-not-failing, checkpoint-text-superseded-by-Phase-6) and 1 explicit user override (skip the hvac-load-calculator reset).
**Impact on plan:** None on code quality or scope. The ingestion durability fix landed exactly as specified (D-06/D-07); the only departures from the literal plan text are (a) an authoring artifact predating Phase 6 and (b) a direct, in-session user decision.

## Issues Encountered

None blocking. The dev server serving the checkpoint (already running from a prior session, PID 81485, started before this plan's `npm run build`) was verified via `curl` to be serving live, non-stale data for all three demo agents before handing off the checkpoint — no restart was needed (unlike the stale-server issue documented in `06-03-SUMMARY.md`).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- Phase 5 (add-an-optional-try-it-out-field-to-the-agent-catalog-shape) is now fully complete: both plans (05-01, 05-02) executed, scope lock held phase-wide (`src/lib/spec/*` and `data/agents/*` untouched across both plans), full suite green (103/103), human-verified in a real browser.
- Dev DB state going forward: `rfi-triage-assistant` = `external` (placeholder URL), `hvac-load-calculator` = `runnable` (intentionally left, per user decision, to keep Phase 6's live demo visible), all other agents = `none`. This state is gigignored/ephemeral; re-apply after any DB reset using the commands recorded in `05-01-SUMMARY.md` and `06-03-SUMMARY.md` (and simply skip the reset-to-none step for `hvac-load-calculator`).
- No further ingestion-side work is outstanding for the `try_it_out` field. Any future work (real `runnable` execution beyond Phase 6's mock backend, surfacing `try_it_out` on the catalog/search pages, rendering `task_template`) remains explicitly out of scope per 05-CONTEXT.md's `<deferred>` section.

---
*Phase: 05-add-an-optional-try-it-out-field-to-the-agent-catalog-shape*
*Completed: 2026-08-19*

## Self-Check: PASSED

- FOUND: `.planning/phases/05-add-an-optional-try-it-out-field-to-the-agent-catalog-shape/05-02-SUMMARY.md`
- FOUND commits: `a34bb4b`, `9350bd0`
