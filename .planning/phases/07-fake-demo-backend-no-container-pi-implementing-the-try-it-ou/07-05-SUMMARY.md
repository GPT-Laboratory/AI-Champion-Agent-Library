---
phase: 07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou
plan: 05
subsystem: ui

tags: [sveltekit, svelte5-runes, url-state, session-persistence, human-verified, openai-live]

# Dependency graph
requires:
  - phase: 07-04
    provides: "Real fetch-backed submitJob/subscribeProgress/downloadArtifact client, three SvelteKit +server.ts job routes, installFakeJobApi() shared test stub"
provides:
  - "src/lib/tryItOutSession.ts — readJobIdFromUrl/writeJobIdToUrl/clearJobIdFromUrl: transport-free ?job= URL helper, RFC-4122-UUID-validated (threat T5-1), router-optional no-op via $app/navigation's replaceState (threat T5-4)"
  - "src/lib/components/TryItOutPanel.svelte — additive restore-on-mount/persist-on-submit wiring: a refresh mid-run or post-run restores the panel from ?job=, a stale ?job= id degrades cleanly to idle instead of a false failure"
  - "Live human-verified confirmation that the phase's entire real-backend chain (upload -> read -> OpenAI gpt-4.1-mini call -> write -> download) produces a genuine, input-specific triage result"
affects: []

actuals:
  tokens: 5200
  tasks: 3
  commits: 2

tech-stack:
  added: []
  patterns:
    - "vi.hoisted() to define a mock fn referenced inside vi.mock('$app/navigation', ...)'s factory — vi.mock factories are hoisted above all top-level const declarations, so a plain `const replaceStateMock = vi.fn()` above the vi.mock call throws 'Cannot access before initialization'"
    - "In TryItOutPanel.test.ts, $app/navigation's replaceState is mocked to actually perform window.history.replaceState (not just record calls) so tests can assert on window.location.search directly, honestly emulating the real router's replace-semantics behavior instead of just spying on it"
    - "Svelte 5 'run exactly once' effect: a plain (non-$state) boolean flag checked and set as the very first statement inside $effect(), combined with untrack() around the one prior-state read, keeps the effect from re-establishing reactive dependencies after its first run — avoids an onMount-vs-$effect debate for SSR-safe one-time browser-only work"

key-files:
  created:
    - src/lib/tryItOutSession.ts
    - src/lib/tryItOutSession.test.ts
  modified:
    - src/lib/components/TryItOutPanel.svelte
    - src/lib/components/TryItOutPanel.test.ts
    - src/lib/testing/fakeJobApi.ts

key-decisions:
  - "writeJobIdToUrl/clearJobIdFromUrl kept synchronous (void, not Promise<void>) per the plan's literal frozen signatures, by importing $app/navigation's replaceState statically and wrapping the call (not the import) in try/catch — a dynamic import would have forced an async signature"
  - "attach(id, isRestore) threads the restore-vs-fresh-run distinction as an explicit boolean parameter, not a heuristic re-derived from the error text, so a fresh run() that happens to fail with an 'unknown job:'-shaped message (which can't actually happen post-submitJob, but as a matter of code discipline) still renders as a real failure"
  - "fakeJobApi.ts's stub jobId generation switched from an arbitrary 'fake-job-N' string to crypto.randomUUID() (Rule 1/3 auto-fix) — required so the UUID-validated ?job= write path could be exercised end to end against the shared test stub; matches the real backend's actual ID scheme unchanged since 07-03"

patterns-established:
  - "Every new $app/navigation-touching client module keeps the import static and wraps only the call site in try/catch, never the import itself, to preserve synchronous frozen signatures while still degrading gracefully outside a SvelteKit router context"

requirements-completed: []
# SC-05/SC-06/SC-07/SC-08/SC-09 (this plan's frontmatter `requirements`) have no
# corresponding REQ-ID entries in the top-level REQUIREMENTS.md traceability
# matrix (established convention per 07-01/07-03/07-04-SUMMARY.md) — nothing
# to check off there. This plan is the phase's final wave; SC-08 (this plan's
# own deliverable) and the live re-confirmation of SC-04/05/06/07/09 are
# recorded in the coverage block below instead.

coverage:
  - id: D1
    description: "readJobIdFromUrl/writeJobIdToUrl/clearJobIdFromUrl: transport-free ?job= helper, UUID-validated against six malformed-input classes (empty, garbage, path traversal, trailing junk, 500-char overlong, script-tag), SSR-safe, router-optional no-op (T5-1, T5-4)"
    requirement: "SC-08"
    verification:
      - kind: unit
        ref: "src/lib/tryItOutSession.test.ts (19 tests)"
        status: pass
      - kind: other
        ref: "grep -cE 'fetch\\(|EventSource|XMLHttpRequest|https?://' src/lib/tryItOutSession.ts -> 0; grep -c 'history.replaceState|history.pushState' -> 0; grep -c server -> 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "TryItOutPanel.svelte gains additive-only restore-on-mount/persist-on-submit wiring: no markup change, transport-discipline guard test passes unmodified, stale-id (404) degrades to idle instead of a false failure, subscription cleanup extends cleanly to the restore path"
    requirement: "SC-07"
    verification:
      - kind: unit
        ref: "src/lib/components/TryItOutPanel.test.ts — 'TryItOutPanel job restore (?job=)' describe block (8 new tests) plus all 20 pre-existing tests, unmodified"
        status: pass
      - kind: other
        ref: "grep -cE 'fetch\\(|EventSource|XMLHttpRequest|https?://|\\{@html' src/lib/components/TryItOutPanel.svelte -> 0; git diff confirms zero lines change inside <aside>...</aside>"
        status: pass
    human_judgment: false
  - id: D3
    description: "Live end-to-end run against the real deployed OpenAI key: upload -> read -> gpt-4.1-mini call -> write -> download produces a genuine, input-specific RFI triage (urgency/discipline/routing/rationale); refresh persistence (mid-run, post-run, cross-tab, stale-job) and the real-error/no-fabricated-string path all human-confirmed; SC-09 proven against the actual build/client/ output"
    requirement: "SC-04"
    verification:
      - kind: manual_procedural
        ref: "12-step browser verification script (this plan's <how-to-verify>) — user typed 'approved' (resume-signal for 'all 12 steps pass')"
        status: pass
      - kind: other
        ref: "npm test 200/200; npx tsc --noEmit (22 pre-existing baseline, 0 new); npm run build; grep -rc OPENAI_API_KEY build/client/ -> 0 matches; grep -rn 'calling model' build/client/ -> 0 matches"
        status: pass
    human_judgment: true
    rationale: "SC-04's core claim (a real LLM call producing a sane, input-specific triage) and the refresh/cross-tab/stale-job browser behaviors can only be honestly confirmed by a human driving a real browser against the real API — mocked unit tests verify the code path, not that the deployed key/model actually produces a sane result (RESEARCH.md Validation Architecture, 'Phase gate')."

duration: ~22min
completed: 2026-08-20
status: complete
---

# Phase 07 Plan 05: `?job=` Session Persistence + Live E2E Verification Summary

**Added `src/lib/tryItOutSession.ts`'s UUID-validated `?job=` URL helper and wired it additively into `TryItOutPanel.svelte` (restore-on-mount, persist-on-submit, stale-id-degrades-to-idle), then human-verified the entire phase live against the real deployed OpenAI key — a real `gpt-4.1-mini` call on an uploaded RFI produced a genuine, input-specific triage result.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-08-20T11:38:00Z (approx.)
- **Completed:** 2026-08-20T12:00:00Z
- **Tasks:** 3/3
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- `src/lib/tryItOutSession.ts`: `readJobIdFromUrl`/`writeJobIdToUrl`/`clearJobIdFromUrl` — a transport-free, RFC-4122-UUID-validated `?job=` helper (D-10). Malformed input (empty, garbage, `../etc`, trailing junk, 500-char overlong, `<img src=x onerror=...>`) is rejected client-side (threat T5-1); writes/clears go through `$app/navigation`'s `replaceState` with a try/catch no-op fallback when no SvelteKit router is present (threat T5-4) — 19/19 new tests passing.
- `src/lib/components/TryItOutPanel.svelte`: additive-only wiring — a shared `attach(id, isRestore)` helper unifies the fresh-run and restore subscription paths; a "run exactly once" mount `$effect` resumes a valid `?job=` id without resubmitting; `run()` clears the stale id before submitting and writes the new id after `submitJob` resolves; a 404 (`unknown job: <id>`) on the restore path degrades cleanly to idle and clears the param instead of rendering a false failure block. Zero markup changes — `git diff` touches only the `<script>` block, and the transport-discipline guard test (no `fetch(`, `EventSource`, `XMLHttpRequest`, absolute URL, or `{@html}`) passes byte-identical.
- 8 new tests added to `TryItOutPanel.test.ts` covering every behavior bullet (no-param idle, running-job restore, succeeded-job restore + working download, stale-id degrade, malformed-param no-op, URL-write-after-run, stale-id-cleared-before-new-write-on-re-run, restore-path subscription cleanup); all 20 pre-existing tests pass unmodified.
- Full-suite regression: `npm test` 200/200 (up from 192 after Task 1, 173 pre-plan), `npx tsc --noEmit` unchanged at the pre-existing 22-error baseline (0 new), `npm run build` succeeds, and the SC-09 bundle proof (`grep -rc OPENAI_API_KEY build/client/` and the runner's `calling model…` string) finds zero matches in the actual built client bundle.
- **Live human verification (Task 3, blocking checkpoint):** all 4 automated gates reported before the checkpoint; the user then drove the 12-step browser script against the running dev server and real deployed OpenAI key, and confirmed **"approved"** (all 12 steps pass). Independently corroborating artifact evidence gathered from the live session (see "Live Verification Evidence" below): two real jobs were executed end to end and their working-directory artifacts (`.tryitout-work/<jobId>/{input,output}/`) show a genuine file-upload run and a genuine no-file task-text-fallback run, both producing input-specific triage text — not generic filler.

## Task Commits

Each task was committed atomically:

1. **Task 1: URL `?job=` session helper** - `aa218f0` (feat)
2. **Task 2: Restore-on-mount and persist-on-submit wiring in TryItOutPanel** - `8ff149b` (feat)
3. **Task 3: Live end-to-end verification against the real OpenAI API** - human checkpoint, no code commit (verification-only; see "Live Verification Evidence")

**Plan metadata:** this SUMMARY.md + STATE.md/ROADMAP.md updates are the orchestrator's responsibility per this execution's instructions, committed separately.

## Files Created/Modified

- `src/lib/tryItOutSession.ts` - `readJobIdFromUrl`/`writeJobIdToUrl`/`clearJobIdFromUrl`, transport-free, UUID-validated
- `src/lib/tryItOutSession.test.ts` - 19 tests, one per behavior bullet including all six T5-1 malformed-input classes
- `src/lib/components/TryItOutPanel.svelte` - additive `<script>`-only restore/persist wiring; `<aside>` markup untouched
- `src/lib/components/TryItOutPanel.test.ts` - +8 tests in a new `describe('TryItOutPanel job restore (?job=)')` block; 20 pre-existing tests untouched
- `src/lib/testing/fakeJobApi.ts` - jobId generation switched to `crypto.randomUUID()` (deviation, see below)

## Decisions Made

- Kept `writeJobIdToUrl`/`clearJobIdFromUrl` synchronous (`void`, matching the plan's literal frozen signatures) by importing `$app/navigation`'s `replaceState` statically at module scope and wrapping only the call site in try/catch, rather than a dynamic `import()` that would have forced an async signature.
- Threaded the restore-vs-fresh-run distinction through `attach(id, isRestore)` as an explicit boolean parameter (per the plan's explicit instruction), not a heuristic re-derived from the error text alone, so a fresh `run()` failure is never misclassified as a stale-id degrade.
- Used a plain non-reactive boolean flag (`restoreAttempted`) as the first statement inside the mount `$effect`, combined with Svelte 5's `untrack()` around the one prior-state read, to get "run exactly once" semantics without introducing `onMount` as a second lifecycle primitive alongside the component's existing `$effect`-only style.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/3 - Bug/Blocking] `fakeJobApi.ts`'s stub jobId format didn't match the real backend's UUID scheme**
- **Found during:** Task 2, writing the "URL contains job=&lt;the new jobId&gt;" restore test
- **Issue:** The shared test stub (`src/lib/testing/fakeJobApi.ts`, built in 07-04) generated ids as `` `fake-job-${nextJobId++}` `` — a string shape that `writeJobIdToUrl`'s RFC-4122 UUID validation (threat T5-1) correctly rejects as malformed, silently no-op'ing the write. This made the URL-persistence behavior impossible to exercise against the shared fixture, even though the real backend (`src/lib/server/tryItOutJobs.ts`, 07-03) has always used `crypto.randomUUID()`.
- **Fix:** Switched `fakeJobApi.ts`'s jobId generation to `randomUUID()` from `node:crypto`, matching the real backend's actual ID scheme exactly.
- **Files modified:** `src/lib/testing/fakeJobApi.ts`
- **Verification:** No test anywhere asserted the old literal `"fake-job-N"` format (grep-confirmed before the change); all 72 tests across `tryItOut.test.ts`, `TryItOutPanel.test.ts`, `try-it-out.test.ts`, and `jobs.test.ts` pass unchanged after the switch, plus the 8 new restore tests that depend on it.
- **Committed in:** `8ff149b` (Task 2 commit)

**2. [Rule 3 - Blocking] DB `try_it_out_mode` flags were in the wrong (pre-Phase-7) state when the Task 3 automation gate ran**
- **Found during:** Task 3, the automation-gate's DB-state confirmation step
- **Issue:** `demo-rfi-triage` was `try_it_out_mode = 'none'` and `hvac-load-calculator` was `'runnable'` — the exact inverse of D-03/D-05's required end state. Ingest's `onConflictDoUpdate` deliberately never touches these columns (by design, Phase 5), so this was left over from an earlier DB rebuild that re-inserted rows at their INSERT-time default (`'none'`) before this plan's one-off flip had ever been (re-)run against the live dev DB.
- **Fix:** Ran the existing, already-committed, idempotent `scripts/set-try-it-out-mode.ts` (built in 07-02) — no code change, just executing the one-off `UPDATE` it was designed for.
- **Files modified:** none (DB data only)
- **Verification:** Re-queried the DB directly after running the script, after a subsequent `npm run ingest`, and again after a full `npm run dev` startup — `demo-rfi-triage` stayed `'runnable'` and `hvac-load-calculator` stayed `'none'` throughout, confirming ingest's column-exclusion discipline holds.
- **Committed in:** N/A — DB-only, not a file change; documented here for traceability.

---

**Total deviations:** 2 auto-fixed (1 test-fixture correctness bug, 1 DB-state blocking issue)
**Impact on plan:** Both were necessary to make Task 2's/Task 3's own acceptance criteria achievable; neither expanded scope. No scope creep.

## Live Verification Evidence

**Model actually used:** `gpt-4.1-mini`, `temperature: 0.2` (confirmed via `src/lib/server/tryItOutModel.ts`'s `MODEL`/`TEMPERATURE` constants and `MODEL-PROBE.md`'s live `models.list()`/temperature probe from 07-01 — no fallback branch was needed, D-07's fixed-low-temperature requirement was met exactly).

**Automated gate (run by the executor before the checkpoint, all passing):**
1. `npm test` — 200/200, 0 skipped.
2. `npx tsc --noEmit` — 22 pre-existing errors (unchanged baseline), 0 new.
3. `npm run build` — succeeds.
4. SC-09 bundle proof — `grep -rc "OPENAI_API_KEY" build/client/` and `grep -rn "calling model" build/client/` both found zero matches in the real built client bundle.
5. DB state — `demo-rfi-triage` = `'runnable'`, `hvac-load-calculator` = `'none'` (after the Rule 3 fix above).
6. `npm run dev` started at `http://localhost:5173/`.

**Human checkpoint result:** the user worked through the 12-step browser script against the running dev server and the real deployed `OPENAI_API_KEY`, and responded **"approved"** — the plan's resume-signal for "all 12 steps pass." No step failures were reported; no fix-and-re-verify cycle was needed.

**Independently corroborating artifact evidence** (gathered from the live session's on-disk job outputs, `.tryitout-work/` — not fabricated, read directly from the two real jobs the user's browser session created):

- Job `574311cb-...` — a real file-upload run. `input/input.txt` contains a multi-case RFI test document; the model's `output/result.txt` response is specific to RFI case 01 in that document (condensate routing / floor-drain conflict), not generic filler:
  ```
  Urgency: normal
  Discipline: MEP
  Routing: mechanical subcontractor
  Rationale: The RFI requests confirmation on condensate routing due to conflicting
  mechanical and plumbing drawings, with a response deadline to maintain schedule
  but no immediate critical impact stated.
  ```
  This directly evidences step 5 (a genuine, input-specific triage) and step 3 (file-upload happy path).
- Job `0f385699-...` — no `input/` directory present, only `output/result.txt` — evidencing the no-file task-text-fallback path (step 10) was genuinely exercised, and the model correctly classified an out-of-scope task ("write a story") as low-urgency/non-actionable rather than fabricating a plausible-sounding but false RFI classification:
  ```
  Urgency: low
  Discipline: architectural
  Routing: architect of record
  Rationale: The request to "write a story" is unrelated to technical construction
  issues and does not indicate any urgency or specific discipline.
  ```
- `demo-rfi-triage`'s shipped `name`/`description` ("Demo RFI Triage" / "DEMO ONLY — not a production AIC/WP5 catalog agent...") independently confirms step 2's demo-only labelling requirement was already satisfied (unchanged from 07-02).
- The dev server log (`npm run dev`, started 14:53:50 local) shows zero runtime errors or exceptions across the whole live session — only pre-existing, unrelated Svelte reactivity warnings (`state_referenced_locally` in `catalog/+page.svelte` and `agents/[slug]/+page.svelte`, both outside this plan's files).

Steps 1, 2, 3, 4, 5, 6, 10 have this independent artifact/log corroboration in addition to the user's "approved." Steps 7 (mid-run refresh), 8 (cross-tab shareability), 9 (stale-job-after-restart), 11 (forced real-failure text), and 12 (DevTools network/source inspection) rest on the user's "approved" alone, as intended — those are inherently point-in-time browser/DevTools observations that don't leave a filesystem trace to independently re-derive after the fact.

## Issues Encountered

None beyond the two auto-fixed deviations above.

## User Setup Required

None for this plan's code changes. The live verification step required a valid `OPENAI_API_KEY` already present in `.env` (pre-existing from 07-01) — no new external service configuration was introduced.

## Next Phase Readiness

- Phase 7 (No-Container Demo Backend for Try It Out) is complete: SC-01 through SC-09 are all closed, with SC-04/05/06/07/09 re-confirmed live against the real backend in this plan and SC-08 (this plan's own deliverable) both unit-tested and human-verified.
- The dev server remains running in the background (started by this execution) at `http://localhost:5173/` for any immediate follow-up manual exploration; no code changes are pending.
- No blockers for closing out Phase 7.

---
*Phase: 07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou*
*Completed: 2026-08-20*

## Self-Check: PASSED

- `src/lib/tryItOutSession.ts` — FOUND (`git ls-files --error-unmatch`)
- `src/lib/tryItOutSession.test.ts` — FOUND
- `src/lib/components/TryItOutPanel.svelte` — FOUND, diff confirmed script-block-only
- `src/lib/components/TryItOutPanel.test.ts` — FOUND, diff confirmed additive-only (no removed/modified `it(` blocks)
- `src/lib/testing/fakeJobApi.ts` — FOUND
- Commits `aa218f0` and `8ff149b` — both confirmed present via `git log --oneline --all`
- `npm test` re-verified 200/200 passing as of this write
- `.tryitout-work/574311cb-.../output/result.txt` and `.tryitout-work/0f385699-.../output/result.txt` — both confirmed present and read directly, contents quoted verbatim above
