---
phase: 06-runnable-try-it-out-flow-mock-backed
plan: 01
subsystem: ui
tags: [svelte5, runes, mock-client, vitest-fake-timers, testing-library]

requires:
  - phase: 05-try-it-out-field-storage-and-ui-affordance
    provides: agent.tryItOutMode / agent.tryItOutUrl fields threaded to the detail page, and the Phase 5 disabled-placeholder button this plan replaces
provides:
  - "src/lib/tryItOut.ts — frozen mock client (submitJob/subscribeProgress/downloadArtifact) matching docs/job-api-contract.md, mock internals isolated below a delete-wholesale banner"
  - "src/lib/components/TryItOutPanel.svelte — first $state/$effect Svelte 5 component in the repo; Task textarea + Run button + live auto-scrolling progress feed"
  - "Runnable-mode wiring in src/routes/agents/[slug]/+page.svelte replacing Phase 5's disabled placeholder"
  - "Proven fake-timer test technique (advanceTimersByTimeAsync + tick) for future Svelte 5 rune components under vitest"
affects: [06-02-download-file-input-failed-block, 06-03-checkpoint-and-coverage]

actuals:
  tokens: 12000
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Frozen client-API pattern: UI imports only 3 named functions + 4 types from a single module; ALL mock internals (timers, in-memory Map, event script) live below a literal 'MOCK IMPLEMENTATION — DELETE WHOLESALE' banner comment for future backend swap"
    - "Svelte 5 $state/$effect rune component with unsubscribe-on-terminal-status AND unsubscribe-on-destroy cleanup to prevent leaked timers"
    - "vitest fake-timer testing for Svelte 5 components: vi.useFakeTimers() + await vi.advanceTimersByTimeAsync(ms) + await tick() (imported from 'svelte') to flush rune-driven DOM updates; do NOT mix with waitFor/findBy* (those are themselves timer-driven and hang under fake timers)"

key-files:
  created:
    - src/lib/tryItOut.ts
    - src/lib/tryItOut.test.ts
    - src/lib/components/TryItOutPanel.svelte
    - src/lib/components/TryItOutPanel.test.ts
  modified:
    - src/routes/agents/[slug]/+page.svelte
    - src/routes/agents/try-it-out.test.ts

key-decisions:
  - "advanceTimersByTimeAsync + tick worked cleanly for the Svelte 5 rune component under fake timers — no fallback to real-timer vi.waitFor polling was needed"
  - "Shipped the exact contract regex /(^|\\W)fail(\\W|$)/i as-is per D-06's own authoritative final clause, even though D-06's prose incorrectly claims 'failure'/'failing' also trigger the fail path — they do not, and this is encoded as explicit succeed-cases in the test suite"
  - "Panel heading copy 'Try it out' (h2) — UI-SPEC did not specify a panel title; chosen to match site's existing affordance vocabulary and give the route test a stable anchor"
  - "Run button disabled when task.trim() === '' in addition to in-flight — prevents submitting an empty task (UI-SPEC only specified the in-flight disable rule)"
  - "Fixed a Svelte reactivity warning by declaring feedEl with $state(null) instead of a plain let binding — behavior-neutral, silences 'non_reactive_update' compiler warning (Rule 1, trivial)"

patterns-established:
  - "Delete-wholesale mock banner: any future mock-to-real swap greps for 'MOCK IMPLEMENTATION' to find the exact boundary"
  - "Inline event handlers (oninput/onclick reading e.currentTarget.value) over bind:value, consistent with FilterBar.svelte"

requirements-completed: []

coverage:
  - id: D1
    description: "src/lib/tryItOut.ts exposes exactly submitJob/subscribeProgress/downloadArtifact + 4 contract types, mock internals isolated below a delete-wholesale banner"
    verification:
      - kind: unit
        ref: "src/lib/tryItOut.test.ts (19 tests: submit delay, running/event script, terminal succeeded/failed, fail-regex table, unsubscribe timer-clearing, download blob, unknown-job)"
        status: pass
    human_judgment: false
  - id: D2
    description: "TryItOutPanel.svelte renders Task textarea + Run button + live auto-scrolling progress feed driven only by the client functions, using Svelte 5 runes, and works standalone with zero props"
    verification:
      - kind: unit
        ref: "src/lib/components/TryItOutPanel.test.ts (5 tests: idle render, enable-on-type, fake-timer success flow, standalone no-props, transport-discipline source assertions)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Runnable-mode detail page renders TryItOutPanel instead of Phase 5's disabled placeholder; external/none/null/malformed modes unchanged"
    verification:
      - kind: unit
        ref: "src/routes/agents/try-it-out.test.ts (5 tests, runnable case rewritten, others untouched) and src/routes/agents/detail.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "No fetch/EventSource/XMLHttpRequest/http(s) URL literal/{@html} anywhere in src/lib/components or src/routes"
    verification:
      - kind: unit
        ref: "grep -rnE 'fetch\\(|EventSource|XMLHttpRequest|\\{@html' src/lib/components src/routes (no matches outside test-assertion strings)"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-08-19
status: complete
---

# Phase 06 Plan 01: Tracer Slice — Frozen Mock Client + Runnable TryItOutPanel Summary

**Frozen mock client (`src/lib/tryItOut.ts`) plus a Svelte 5 runes `TryItOutPanel.svelte` that drives a live progress feed end-to-end, wired into the runnable-mode agent detail page in place of Phase 5's disabled placeholder.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-08-19T08:26:54Z
- **Completed:** 2026-08-19T11:31:xx (local); PLAN_START_EPOCH to commit-6cf9f9f ≈ 274s wall time
- **Tasks:** 3
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments
- Built the complete frozen mock client — `submitJob`, `subscribeProgress`, `downloadArtifact` plus the four contract types, copied verbatim from `docs/job-api-contract.md`, with all mock internals (timers, in-memory job Map, event script, artifact text) isolated below a single `MOCK IMPLEMENTATION — DELETE WHOLESALE` banner for a future clean backend swap.
- Built `TryItOutPanel.svelte`, the first component in this repo to use Svelte 5 `$state`/`$derived`/`$effect` — Task textarea, Run/Running… button, and a live timestamped auto-scrolling progress feed driven entirely through the two frozen client functions. Proven the `vi.advanceTimersByTimeAsync` + `tick()` fake-timer technique works cleanly with `@testing-library/svelte` for rune components (no waitFor/real-timer fallback needed).
- Wired the panel into `src/routes/agents/[slug]/+page.svelte`'s `runnable` branch, replacing Phase 5's disabled placeholder button, while leaving `external`/`none`/`null`/malformed behavior byte-identical.

## Task Commits

Each task followed TDD (RED → GREEN):

1. **Task 1: Implement the complete frozen mock client**
   - `72114a1` (test) — failing tests for submit delay, event script, fail regex, unsubscribe, download blob, unknown-job
   - `5de3ff1` (feat) — `src/lib/tryItOut.ts` implementation, 19/19 tests passing
2. **Task 2: Build the tracer TryItOutPanel.svelte**
   - `03674fe` (test) — failing tests for idle render, enable-on-type, success flow, standalone, transport discipline
   - `2d2303f` (feat) — `TryItOutPanel.svelte` implementation, 5/5 tests passing
3. **Task 3: Wire the panel into the runnable branch of the agent detail page**
   - `6cf9f9f` (feat) — import + branch replacement in `+page.svelte`, rewritten runnable-mode assertion in `try-it-out.test.ts`, 9/9 tests passing (`try-it-out.test.ts` + `detail.test.ts`)

**Plan metadata:** this commit (docs: complete 06-01 plan)

## Files Created/Modified
- `src/lib/tryItOut.ts` - Frozen mock client: 3 exported functions + 4 types, mock internals below delete-wholesale banner
- `src/lib/tryItOut.test.ts` - 19 fake-timer unit tests covering submit, progress script, both terminal outcomes, unsubscribe, download, unknown-job
- `src/lib/components/TryItOutPanel.svelte` - Svelte 5 runes panel: Task textarea, Run button, live progress feed
- `src/lib/components/TryItOutPanel.test.ts` - 5 jsdom render tests including standalone no-props and transport-discipline source assertions
- `src/routes/agents/[slug]/+page.svelte` - Added `TryItOutPanel` import; replaced the 9-line disabled-button `runnable` branch with `<TryItOutPanel agentId={agent.slug} />`
- `src/routes/agents/try-it-out.test.ts` - Rewrote only the `runnable` mode test to assert the panel renders; all other mode tests (`external`/`none`/`null`/malformed) untouched

## Decisions Made
- Fake-timer approach for the Svelte 5 component test worked with `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(ms)` + `await tick()` (imported from `svelte`) — no fallback to the real-timer `vi.waitFor` polling variant was needed. This is the technique 06-02 should reuse.
- Shipped the fail-path regex `/(^|\W)fail(\W|$)/i` exactly as written in `docs/job-api-contract.md`, per D-06's own authoritative final clause ("use the exact regex from the contract doc"). D-06's prose claim that `'failure'`/`'failing'` also trigger the fail path is factually incorrect for this regex (after "fail" comes a letter, not `\W` or end-of-string) — this divergence is intentional and is encoded as explicit must-succeed test cases (`'failure'`, `'failing'`, `'hardfailover'`) alongside the must-fail cases (`'fail'`, `'please fail now'`, `'FAIL'`, `'do not fail.'`, `'(fail)'`).
- Panel heading copy `Try it out` (an `<h2>`) — 06-UI-SPEC.md's Copywriting Contract did not specify a panel title; chosen to match the site's existing affordance vocabulary and give the route test a stable anchor.
- Run button disabled while `task.trim() === ''` in addition to while in-flight — prevents submitting an empty task; UI-SPEC's in-flight disable rule is implemented exactly as written, this is an additive discretion decision.
- `drizzle/schema.ts`, `scripts/ingest.ts`, and `src/lib/spec/*` confirmed untouched by this plan (`git diff --name-only` shows no matches under those paths).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/code-quality] Declared `feedEl` with `$state(null)` instead of a plain `let` binding**
- **Found during:** Task 2 (TryItOutPanel.svelte implementation)
- **Issue:** The plan's action block specified `let feedEl: HTMLDivElement | null = null`, which triggered a Svelte compiler warning (`non_reactive_update` — "feedEl is updated, but is not declared with $state(...)") because it's mutated via `bind:this` and read inside an `$effect`.
- **Fix:** Changed the declaration to `let feedEl: HTMLDivElement | null = $state(null)`. Behavior-neutral — same DOM ref semantics, warning silenced.
- **Files modified:** src/lib/components/TryItOutPanel.svelte
- **Verification:** All 5 TryItOutPanel tests still pass; no compiler warning on subsequent test runs.
- **Committed in:** 2d2303f (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 trivial code-quality/Rule 1)
**Impact on plan:** No scope creep. All planned tests, acceptance criteria, and prohibitions were met exactly as specified.

## Issues Encountered
None beyond the trivial warning above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `src/lib/tryItOut.ts` is complete, frozen, and fully tested — plan 06-02 can build the file input, "Download results" button, and failed-state block directly on top of it without touching the client module.
- The fake-timer + `tick()` testing technique is proven and documented for reuse in 06-02's additional panel states.
- Known, expected, out-of-scope failure confirmed unaffected: `npx vitest run` (whole suite) shows `scripts/ingest.test.ts` failing (4 tests) with `table agents has no column named try_it_out_mode` — a pre-existing Phase 5 regression owned by the not-yet-executed plan 05-02, unrelated to and untouched by this plan. All other 10 test files (82 tests, including all of Phase 6's new/modified suites) pass.

---
*Phase: 06-runnable-try-it-out-flow-mock-backed*
*Completed: 2026-08-19*

## Self-Check: PASSED

All created files confirmed present on disk (`src/lib/tryItOut.ts`, `src/lib/tryItOut.test.ts`, `src/lib/components/TryItOutPanel.svelte`, `src/lib/components/TryItOutPanel.test.ts`, `src/routes/agents/[slug]/+page.svelte`, `src/routes/agents/try-it-out.test.ts`, this SUMMARY.md). All task commit hashes (`72114a1`, `5de3ff1`, `03674fe`, `2d2303f`, `6cf9f9f`) confirmed present in `git log`.
