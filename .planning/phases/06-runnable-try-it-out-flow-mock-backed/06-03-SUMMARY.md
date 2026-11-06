---
phase: 06-runnable-try-it-out-flow-mock-backed
plan: 03
subsystem: ui
tags: [coverage-declaration, dev-db-staging, human-checkpoint]

requires:
  - phase: 06-runnable-try-it-out-flow-mock-backed
    provides: "06-01/06-02's complete TryItOutPanel.svelte (task textarea, file input, Run button, progress feed, Download results, Job failed block) and the frozen src/lib/tryItOut.ts mock client"
provides:
  - "COVERAGE.md — reasoned no-external-API declaration for the api-coverage detector false positive"
  - "Staged local dev DB: hvac-load-calculator=runnable, rfi-triage-assistant=external, all others=none"
affects: []

actuals:
  tokens: 0
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - .planning/phases/06-runnable-try-it-out-flow-mock-backed/COVERAGE.md
  modified: []

key-decisions:
  - "COVERAGE.md written with only the required no-capability-matrix declaration content, per the plan's literal template — no fabricated auth/rate-limit sections"
  - "Dev DB re-staged via the exact Task 1 Part B UPDATE commands after npm run db:push + npm run ingest (both ran clean; ingest did not fail, so the plan's contingency note about a known Phase 5 ingest.test.ts regression did not need to be invoked here since only the ingest *script* was run, not the vitest suite)"
  - "Discovered and fixed an environmental issue (Rule 3 - blocking) unrelated to any plan file: a long-running dev server from a prior session (started 2026-08-18, PID 4996) held an open file descriptor to a deleted/replaced db/catalog.db inode and was serving stale data (tryItOutMode:none, lastIngestedAt from 2026-08-18) even after this plan's staging UPDATEs landed on disk. Killed the stale server and started a fresh npm run dev, confirmed via curl that http://localhost:5173 now serves the correct staged tryItOutMode for all three demo agents before presenting the checkpoint."

requirements-completed: []

coverage:
  - id: COVERAGE-DOC
    description: "COVERAGE.md exists, declares no external API integration, grep-verified"
    verification:
      - kind: other
        ref: "test -f COVERAGE.md && grep -q 'No external API integration' COVERAGE.md; grep -nE 'fetch\\(|EventSource|XMLHttpRequest|https?://' src/lib/tryItOut.ts returns no matches"
        status: pass
    human_judgment: false
  - id: DB-STAGING
    description: "Dev DB has one runnable agent (hvac-load-calculator) and the Phase 5 external example (rfi-triage-assistant) with a non-null URL"
    verification:
      - kind: other
        ref: "node -e select slug,try_it_out_mode,try_it_out_url from agents — confirmed hvac-load-calculator=runnable, rfi-triage-assistant=external+URL, all 5 others=none"
        status: pass
    human_judgment: false
  - id: SCOPE-LOCK
    description: "No changes under drizzle/, scripts/, src/lib/spec/, data/, db/ (db/ gitignored, mutated but not committed)"
    verification:
      - kind: other
        ref: "git status --porcelain | grep -E '^.. (drizzle/|scripts/|src/lib/spec/|data/|db/)' — no output"
        status: pass
    human_judgment: false
  - id: HUMAN-CHECKPOINT
    description: "A human runs the 10-step browser verification script and confirms both outcomes, both UI-SPEC backstop items, and Phase 5 regression-free behavior"
    verification:
      - kind: manual
        ref: "Human completed all 10 steps against http://localhost:5173 and responded 'approved' — no defects reported"
        status: pass
    human_judgment: true

duration: ~16min active work (Task 1 + checkpoint setup); checkpoint itself spanned a longer wall-clock gap while the human ran the browser walkthrough
completed: 2026-08-19
status: complete
---

# Phase 06 Plan 03: Coverage Declaration, Demo DB Staging, and Human Checkpoint Summary

**COVERAGE.md written and grep-verified, local dev DB staged with one `runnable` agent (`hvac-load-calculator`) and the Phase 5 `external` example (`rfi-triage-assistant`), a stale orphaned dev server replaced with a fresh one — human completed the full 10-step browser walkthrough and approved with no defects. Phase 6 is complete.**

## Status: COMPLETE — human checkpoint approved, no defects

The human ran the full 10-step verification script against the live dev server at `http://localhost:5173` and responded **"approved"** with no defects reported. All four visually/behaviorally-verifiable ROADMAP Phase 6 success criteria (SC-2 through SC-5) and both UI-SPEC backstop items (overflow, long-text) are now human-confirmed. No code changes were required as a result of the checkpoint.

## Task 1: Write COVERAGE.md and stage a runnable agent in the dev DB — COMPLETE

### What was done
1. Ran all three prescribed greps against `src/lib/tryItOut.ts` (no `fetch`/`EventSource`/`XMLHttpRequest`/URL literal), confirming the declaration would be factually true before writing it.
2. Wrote `.planning/phases/06-runnable-try-it-out-flow-mock-backed/COVERAGE.md` verbatim per the plan's required template — verdict, why-the-detector-fired, evidence, the future-endpoints note, and the "when this changes" closing note. No capability matrix, auth section, or rate-limit table was fabricated.
3. Ran `npm run db:push` — applied the `try_it_out_*` columns (schema unchanged, confirmed via `PRAGMA table_info(agents)` before/after).
4. Ran `npm run ingest` — "Ingestion complete: 7 succeeded, 0 failed" (no ingest.test.ts regression was triggered — that pre-existing Phase 5 issue only affects the unexecuted vitest suite, not the ingest script itself, and the vitest suite was not run as part of this step).
5. Ran the exact staging UPDATE commands (see "Re-apply after DB reset" below) and confirmed via a read-only query.
6. Confirmed `git status --porcelain` shows no changes under `drizzle/`, `scripts/`, `src/lib/spec/`, or `data/` (D-15 scope lock held).

### Re-apply after DB reset

`db/` is gitignored. If `db/catalog.db` is ever reset/reingested, re-run exactly:

```bash
npm run db:push
npm run ingest
node -e "const D=require('better-sqlite3');const d=new D('db/catalog.db');d.prepare(\"UPDATE agents SET try_it_out_mode='runnable' WHERE slug='hvac-load-calculator'\").run();d.prepare(\"UPDATE agents SET try_it_out_mode='external', try_it_out_url='https://example.com/try/rfi-triage-assistant' WHERE slug='rfi-triage-assistant'\").run();d.close()"
```

Confirm with:
```bash
node -e "const D=require('better-sqlite3');const d=new D('db/catalog.db',{readonly:true});console.log(d.prepare('select slug,try_it_out_mode,try_it_out_url from agents order by slug').all())"
```

Expected: `hvac-load-calculator` -> `runnable`, `rfi-triage-assistant` -> `external` with the placeholder URL, all 5 remaining agents (`electrical-panel-scheduler`, `energy-model-data-sync`, `mep-scope-planner`, `mep-submittal-review-router`, `plumbing-fixture-unit-counter`) -> `none`.

### Task 1 Commit
- `adccc22` (docs) — `COVERAGE.md` created; dev DB staged (DB mutation not committed — `db/` is gitignored)

## Pre-checkpoint automation (Task 2 setup)

Before presenting the checkpoint, per the plan's "Automation is already complete — do NOT ask the human to do anything Claude can do":

1. **Automated baseline confirmed green:**
   - `npx vitest run src/lib/tryItOut.test.ts src/lib/components/TryItOutPanel.test.ts src/routes/agents/try-it-out.test.ts src/routes/agents/detail.test.ts` -> **4 files, 48 tests, 0 failures**.
   - `npx vite build` -> succeeded (client + server bundles built, no errors).
2. **Dev DB re-confirmed staged** (see Task 1 above) after `npm run db:push` + `npm run ingest` ran again as part of `npm run dev`'s startup script — the staged `try_it_out_mode` values survived re-ingestion (ingest's `onConflictDoUpdate` does not touch `try_it_out_*` columns, per the Phase 5 D-07 decision).
3. **Dev server started and verified.**

### Deviation: stale orphaned dev server (Rule 3 — blocking, auto-fixed)

**Found during:** Task 2 setup, verifying the dev server serves the newly staged data.

**Issue:** A `vite dev` process (PID 4996) had been running since 2026-08-18 (a prior session), bound to port 5173. `/proc/4996/fd` showed its open file handles to `db/catalog.db`, `db/catalog.db-shm`, and `db/catalog.db-wal` all marked `(deleted)` — the file had been unlinked and recreated (by an earlier `drizzle-kit push --force` or similar) since that server started, so the process held a stale, disconnected inode. `curl`-ing the runnable agent's page through this server returned `tryItOutMode:"none"` and `lastIngestedAt:"2026-08-18T10:17:32.017Z"`, even though a direct `better-sqlite3` read-only query against the actual on-disk file correctly showed `tryItOutMode:'runnable'` and today's `last_ingested_at`. This would have caused the human checkpoint to fail immediately at step 1 through no fault of any code in this phase.

**Fix:** Killed the stale process (and its parent shell), then started a fresh `npm run dev`. Confirmed via `curl` that `http://localhost:5173` now serves `tryItOutMode:"runnable"` for `hvac-load-calculator`, `tryItOutMode:"external"` + the correct URL for `rfi-triage-assistant`, and `tryItOutMode:"none"` for a third agent (`mep-scope-planner`), and that the runnable page's HTML contains the panel's "Try it out" / "Task" / "Attach a file" / "Run" markup.

**Files modified:** None — process management only, no source or config change.

**Verification:** `curl -s http://localhost:5173/agents/hvac-load-calculator` and `.../rfi-triage-assistant` and `.../mep-scope-planner`, each grepped for `tryItOutMode:"..."`, confirmed correct per-agent values.

## Task 2: Human verification — both outcomes, in a real browser — APPROVED

The human ran all 10 steps of the checkpoint script against `http://localhost:5173` and responded **"approved"** — no defects reported at any step.

### Per-step verdict

| # | Check | Verdict |
|---|-------|---------|
| 1 | Panel wired into `hvac-load-calculator` detail page (SC-5) — Task textarea, file input, indigo Run button, no disabled placeholder | Approved |
| 2 | Success path (SC-2, SC-3) — "Running…" state, PROGRESS label, timestamped lines (`read data/sample.csv` → `(12 lines)` → `count rows` → `write output/result.txt` → `agent settled (clean exit)`) reading as an authentic tool-call log, Download button appears | Approved |
| 3 | Download (SC-3) — `.txt` file downloaded, contents include task text and agent slug | Approved |
| 4 | File attachment — throwaway file attached, re-run, artifact's `attached file:` line names the file | Approved |
| 5 | Failure path (SC-4) — red "Job failed" block, verbatim error string, "Adjust your task and try again.", no Download button, error renders as plain text (no raw HTML) | Approved |
| 6 | **Overflow backstop** (UI-SPEC) — log box stays height-capped and scrolls internally; page does not grow indefinitely | Approved |
| 7 | **Long-text backstop** (UI-SPEC) — textarea and feed lines wrap on long single-line input; no horizontal scrollbar | Approved |
| 8 | Cleanup (threat T3) — starting a job then navigating "← Back to catalog" mid-run leaves a clean console, no errors/warnings | Approved |
| 9 | Phase 5 regression check (D-14) — `rfi-triage-assistant` still shows the external "Try it out →" link to the placeholder URL and no panel; a `none`-mode agent shows no affordance at all | Approved |
| 10 | Tablet viewport (~820px, UI-01) — panel and controls remain usable, no horizontal page scroll | Approved |

Steps 6 and 7 — the two UI-SPEC backstop items that only a human could confirm (bounded/scrolling log box; line-wrapping instead of horizontal overflow) — were explicitly confirmed, not silently skipped, per the plan's acceptance criteria.

### Defects found
None.

### Scope-expansion requests captured as follow-ups
None were raised during this checkpoint. (For reference, the plan pre-identified likely candidates — a dedicated standalone demo route, a "remove selected file" chip, a cancel/retry control, real execution — none of which were requested; they remain out of scope for this phase per the `assumption_delta_decision` and 06-CONTEXT.md's deferred list.)

### Closing note — future runtime swap

Per the `try-it-out-runtime-architecture` project memory, the future runtime phase (in-process `pi --mode rpc` module) replaces only the bodies of the three exported functions in `src/lib/tryItOut.ts` (`submitJob`, `subscribeProgress`, `downloadArtifact`) plus everything below its `MOCK IMPLEMENTATION — DELETE WHOLESALE` banner. No UI change is required — `TryItOutPanel.svelte` and the detail-page wiring are already written against the frozen contract shapes (`JobStatus`, `JobEvent`, `JobUpdate`, `SubmitResult`) and were exercised end-to-end by this checkpoint.

## Files Created/Modified
- `.planning/phases/06-runnable-try-it-out-flow-mock-backed/COVERAGE.md` (new) - reasoned no-external-API declaration
- No source files were modified in Task 2 — the checkpoint required no fixes.

## Issues Encountered
- Stale orphaned dev server serving a deleted DB inode — see deviation above. Resolved before presenting the checkpoint; the human was never handed a broken build.

## User Setup Required
None. The dev server started for this checkpoint (`http://localhost:5173`) and the killed stale prior-session server were both session-local process management — no durable environment change and nothing further to configure.

## Phase 6 Completion

All six ROADMAP Phase 6 success criteria are now demonstrably true (the two grep/test-verifiable ones from 06-01/06-02, plus the four human-confirmed ones from this checkpoint):
1. `src/lib/tryItOut.ts` exposes exactly the three mock-backed, contract-shaped functions — grep-verified export surface + delete-wholesale banner (06-01).
2. Mock progress events read as an authentic live tool-call log — human-confirmed (step 2).
3. The panel renders every required element and a working download — human-confirmed (steps 1-4).
4. Both outcomes (succeed/fail) are demoable with no code changes — human-confirmed (steps 2, 5).
5. The panel is wired into the runnable-mode detail page and works standalone — human-confirmed (step 1) + test-confirmed (06-01).
6. No real backend exists anywhere in the UI — grep-verified and declared in `COVERAGE.md` (this plan).

Phase 6 (runnable-try-it-out-flow-mock-backed) is complete.

---
*Phase: 06-runnable-try-it-out-flow-mock-backed*
*Completed: 2026-08-19*

## Self-Check: PASSED

- FOUND: `.planning/phases/06-runnable-try-it-out-flow-mock-backed/COVERAGE.md`
- FOUND: `.planning/phases/06-runnable-try-it-out-flow-mock-backed/06-03-SUMMARY.md` (this file)
- FOUND commits: `adccc22`, `910bb40`, `839b5b5`
