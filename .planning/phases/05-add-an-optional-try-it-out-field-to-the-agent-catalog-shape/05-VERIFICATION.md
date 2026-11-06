---
phase: 05-add-an-optional-try-it-out-field-to-the-agent-catalog-shape
verified: 2026-08-19T14:16:51Z
status: passed
score: 11/11 must-haves verified
---

# Phase 5: Add an Optional Try It Out Field to the Agent Catalog Shape — Verification Report

**Phase Goal:** Agent records support an optional `try_it_out` field (mode: none | external | runnable, url, task_template) threaded through the Drizzle schema, ingest script, and agent detail page. External mode renders a working "Try it out" link; runnable mode renders a disabled button; none/missing renders nothing. No runtime is built. One agent (e.g. rfi-triage-assistant) is set to external with a placeholder url as a working example.
**Verified:** 2026-08-19T14:16:51Z
**Status:** passed
**Re-verification:** No — initial verification

## Important Interpretive Note

Phase 6 (`06-runnable-try-it-out-flow-mock-backed`, already complete and separately verified) deliberately **replaced** the disabled-button behavior for `runnable` mode with a fully working mock-backed `TryItOutPanel`. This is an intentional, planned roadmap evolution, not a regression introduced by or attributable to Phase 5. Per instruction, Success Criteria 3 and 5 (which concern `runnable` mode) are verified against what Phase 5's own PLAN/SUMMARY claim it built **at the time it ran** (2026-08-18/19, before Phase 6 executed), using the git history at that point. Success Criteria 1, 2, and 4 are verified against current live code, since Phase 6 did not touch `drizzle/schema.ts`, `scripts/ingest.ts`, or the `external`-mode/`rfi-triage-assistant` example.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `agents` table has `try_it_out_mode` (default `'none'`), `try_it_out_url`, `try_it_out_task_template` columns | ✓ VERIFIED | `PRAGMA table_info(agents)` on live `db/catalog.db` lists all three columns with correct types/defaults/nullability; `drizzle/schema.ts:22-24` declares them as flat text columns per D-08 |
| 2 | A user visiting `/agents/rfi-triage-assistant` sees a working "Try it out" link opening the placeholder URL in a new tab | ✓ VERIFIED | Current `+page.svelte:63-72` renders `{#if agent.tryItOutMode === 'external' && agent.tryItOutUrl}` → `<a target="_blank" rel="noopener noreferrer">`; DB row confirms `rfi-triage-assistant` = `external` / `https://example.com/try/rfi-triage-assistant`; `try-it-out.test.ts` external-mode test passes |
| 3 | `none`/`null`/malformed-external rows render nothing (no button, no link, no placeholder) | ✓ VERIFIED | `+page.svelte` conditional chain has no `{:else}` fallback; `try-it-out.test.ts` covers `none`, `null`-mode, and `external`-without-url — all 3 assert zero "Try it out"-labelled elements; full suite green |
| 4 | (At Phase 5 execution time) `runnable` mode renders a visually distinct disabled "Try it out" button that does nothing when clicked | ✓ VERIFIED (historical, at time of build) | 05-01-SUMMARY documents `<button type="button" disabled>` with `text-gray-400 bg-gray-100 cursor-not-allowed`, zero event handlers; `05-REVIEW.md` confirms this was reviewed and correctly gated; git history shows this shipped in commit `b14e7bb`. Phase 6 (`6cf9f9f`) later legitimately replaced this branch with `TryItOutPanel` — an intentional, separately-verified roadmap evolution, not a Phase 5 defect |
| 5 | (At Phase 5 execution time) No execution/runtime code exists anywhere for `runnable` mode | ✓ VERIFIED (historical, at time of build) | 05-01-SUMMARY records `grep -nE "on:click|onclick|fetch\(|use:enhance"` returning no matches at the time; this was Phase 5's own scope boundary (D-11), correctly honored during Phase 5. (Phase 6 later added real execution as its own, separately-scoped and separately-verified deliverable.) |
| 6 | `src/lib/spec/types.ts`, `oracle-agentspec.ts`, `index.ts` and `data/agents/*.yaml` are byte-identical to their pre-phase state | ✓ VERIFIED | `git diff b0cbde8~1 9350bd0 -- src/lib/spec/types.ts src/lib/spec/oracle-agentspec.ts src/lib/spec/index.ts data/agents` (full phase 05 commit range) produces zero output |
| 7 | Ingesting a brand-new agent writes `try_it_out_mode='none'`, null url, null task_template | ✓ VERIFIED | `scripts/ingest.ts:32-38` `flattenRecord()` returns literal defaults not read from `AgentRecord`; `scripts/ingest.test.ts` "fresh insert defaults..." test passes |
| 8 | Re-running ingestion over a manually-set `try_it_out` row leaves those columns untouched while every other column updates | ✓ VERIFIED | `onConflictDoUpdate` `set` block (scripts/ingest.ts:82-90) omits all three columns with a load-bearing comment; `grep -c "excluded.try_it_out"` = 0; `scripts/ingest.test.ts` "re-ingesting never clobbers..." test asserts both preservation AND `last_ingested_at` advancing |
| 9 | `npm run build` succeeds and `rfi-triage-assistant` remains `external` with its placeholder URL afterwards | ✓ VERIFIED | 05-02-SUMMARY documents a real `npm run build` run with before/after DB snapshots showing `try_it_out_mode` unchanged and `last_ingested_at` advancing ~4.5 hours; current live DB state (re-checked during this verification) still shows `rfi-triage-assistant` = `external` with the placeholder URL |
| 10 | `flattenRecord` still takes an unmodified `AgentRecord` — `try_it_out` never read from parsed YAML | ✓ VERIFIED | Current `scripts/ingest.ts` shows no `record.tryItOut` / `record.try_it_out` reference; the three fields are hardcoded literals |
| 11 | A human confirms in a browser that all three modes render correctly (adjusted for Phase 6's supersession of `runnable`) | ✓ VERIFIED | 05-02-SUMMARY documents a completed human checkpoint (`external` link works, `none` renders nothing, and `runnable` — corrected mid-flight to reflect Phase 6's shipped `TryItOutPanel` rather than stale disabled-button plan text — was approved) |

**Score:** 11/11 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `drizzle/schema.ts` | `tryItOutMode`/`tryItOutUrl`/`tryItOutTaskTemplate` flat columns | ✓ VERIFIED | Lines 22-24, exact types/defaults per D-08, no JSON blob, no enum type |
| `src/routes/agents/[slug]/+page.svelte` | Mode-conditional Try It Out affordance next to GitHub link | ✓ VERIFIED | External branch intact and unchanged since Phase 5 (lines 63-72); runnable branch now delegates to `TryItOutPanel` (Phase 6, out of Phase-5 scope) |
| `src/routes/agents/try-it-out.test.ts` | jsdom render tests covering all modes | ✓ VERIFIED | 5 `it(...)` blocks present; external/none/null/malformed-external assertions unchanged from Phase 5; the runnable-mode test was updated by Phase 6 to assert the panel instead of the disabled button (expected, documented in the test file itself: "Phase 5's disabled placeholder is gone") |
| `scripts/ingest.ts` | Safe defaults on insert + omission from `onConflictDoUpdate` | ✓ VERIFIED | Lines 32-39 (defaults), 82-90 (omission with rationale comment) |
| `scripts/ingest.test.ts` | `CREATE_TABLE_SQL` mirrors new columns + 2 regression tests | ✓ VERIFIED | Lines 26-28 (DDL), lines 101-134 (fresh-insert-default and no-clobber tests) |
| `db/catalog.db` (dev DB, gitignored) | `rfi-triage-assistant` = `external` with placeholder URL | ✓ VERIFIED | Live query during this verification confirms row state matches exactly |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `drizzle/schema.ts` | `db/catalog.db` | `drizzle-kit push --force` (ALTER TABLE) | ✓ WIRED | `PRAGMA table_info` confirms all 3 columns exist on the live DB with matching defaults |
| `+page.server.ts` `db.select()` (unchanged) | `+page.svelte` | spread of selected row into `data.agent` | ✓ WIRED | `+page.server.ts` untouched (confirmed no diff); new columns flow through automatically, exercised by the passing external-mode test |
| `+page.svelte` external branch | `agent.tryItOutUrl` | `href={agent.tryItOutUrl}` with `rel="noopener noreferrer"` | ✓ WIRED | Present verbatim in current file, lines 63-72 |
| `scripts/ingest.ts flattenRecord()` | agents table insert values | literal defaults | ✓ WIRED | Confirmed via code read + passing "fresh insert defaults" test |
| `scripts/ingest.ts onConflictDoUpdate set block` | existing manually-set `try_it_out` values | deliberate omission | ✓ WIRED | `grep -c "excluded.try_it_out" scripts/ingest.ts` = 0; no-clobber test passes |

### Requirements Coverage

No REQUIREMENTS.md IDs are assigned to Phase 5 in either plan's frontmatter (`requirements: []` in both 05-01-PLAN.md and 05-02-PLAN.md, with an explicit comment: "No REQUIREMENTS.md IDs assigned to Phase 5 — scope is defined by 05-CONTEXT.md decisions D-01..D-13"). Cross-referencing `.planning/REQUIREMENTS.md`'s traceability table confirms this is intentional and not a dropped mapping: the table maps PIPE-01..04 (Phase 1), BROW-01..03/DETL-01..03/UI-01 (Phase 2), SRCH-01..03 (Phase 3), and CUST-01 (Phase 4) — no requirement ID references "Phase 5" anywhere in the document, and the "Out of Scope" table explicitly lists "Execution sandbox / demo" as out of scope, consistent with Phase 5's "no runtime" boundary. Coverage stated as "15/15 mapped, 0 unmapped" — Phase 5 was scoped as a context-driven, non-requirements-tracked phase by design.

**No orphaned requirements found for Phase 5.**

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `drizzle/schema.ts:22` | 22 | `tryItOutMode` enum enforced only via comment, not DB CHECK or TS union type | ⚠️ Warning (pre-existing, from 05-REVIEW.md WR-01) | Non-blocking; a typo'd mode value silently degrades to "render nothing" with no error signal. Documented in code review, not fixed, does not block phase goal |
| `src/routes/agents/[slug]/+page.svelte:65` | 65 | `tryItOutUrl` rendered as `href` with no scheme validation (from 05-REVIEW.md WR-02) | ⚠️ Warning (pre-existing) | Non-blocking; column is currently only populated by trusted direct-DB writes, not user input. Documented, not fixed |

Both warnings were identified and documented in `05-REVIEW.md` (0 critical findings) at the time of the phase's code review and were judged non-blocking for phase goal achievement. No new anti-patterns (TODO/FIXME/placeholder text/empty stub returns) were found in the current live files for this phase's scope during this verification pass.

### Human Verification Required

None outstanding. The required human checkpoint (Task 3 of 05-02-PLAN.md) was already completed and approved during phase execution, per 05-02-SUMMARY.md: the human confirmed the `external` link works, `none` mode renders nothing, and (mid-flight-corrected for Phase 6's supersession) `runnable` mode's live behavior was approved as intended.

### Gaps Summary

No gaps found. All must-haves from both 05-01-PLAN.md and 05-02-PLAN.md are verified against the live codebase:
- Schema, ingest, and the `external`/`none` detail-page branches are current, live, and match Phase 5's own design exactly.
- The `runnable` disabled-button behavior, which Phase 5 built and correctly scoped (zero runtime, per D-11), was verified as correctly built and tested at the time of Phase 5's execution — its later, intentional replacement by Phase 6's `TryItOutPanel` is a deliberate roadmap evolution documented in both phases' SUMMARYs and is not a Phase 5 defect.
- No requirement IDs are dropped or unmapped for this phase — Phase 5 was intentionally scoped outside REQUIREMENTS.md tracking, confirmed against the traceability table.
- The two warnings from `05-REVIEW.md` (unenforced mode enum, unvalidated URL scheme) remain open but were assessed as non-blocking defense-in-depth improvements, not phase-goal blockers, and do not affect the truths above.

---

_Verified: 2026-08-19T14:16:51Z_
_Verifier: Claude (gsd-verifier)_
