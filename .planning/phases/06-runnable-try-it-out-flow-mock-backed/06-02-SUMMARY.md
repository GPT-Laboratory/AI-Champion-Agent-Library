---
phase: 06-runnable-try-it-out-flow-mock-backed
plan: 02
subsystem: ui
tags: [svelte5, runes, mock-client, vitest-fake-timers, testing-library]

requires:
  - phase: 06-runnable-try-it-out-flow-mock-backed
    provides: "06-01's tracer TryItOutPanel.svelte (task textarea, Run button, live progress feed) and the frozen src/lib/tryItOut.ts mock client"
provides:
  - "src/lib/components/TryItOutPanel.svelte — complete 06-UI-SPEC.md surface: optional file input, Download results button, red Job failed block"
  - "src/lib/components/TryItOutPanel.test.ts — 20 tests covering both demo outcomes (success/fail), file hand-off, feed overflow/wrap, and timer-leak-free unmount/terminal/re-run cleanup"
affects: [06-03-checkpoint-and-coverage]

actuals:
  tokens: 0
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Guard blocks keyed off status ('succeeded' / 'failed') for mutually exclusive terminal-state UI, no third semantic color for success — a button's presence IS the success signal"
    - "Native <input type=\"file\"> with inline onchange handler (no bind:files), consistent with the FilterBar.svelte inline-handler convention"
    - "Object.defineProperty accessor-pair recorder for scrollTop/files in jsdom tests, used when vi.spyOn(el, prop, 'set') proves awkward for properties jsdom defines as plain data properties"

key-files:
  created: []
  modified:
    - src/lib/components/TryItOutPanel.svelte
    - src/lib/components/TryItOutPanel.test.ts

key-decisions:
  - "Auto-scroll observation technique: Object.defineProperty(feed, 'scrollTop', { get, set }) accessor-pair recorder — chosen directly (not as a fallback) because jsdom defines scrollTop as a plain writable data property, and defining a getter/setter pair up front is simpler and more reliable than vi.spyOn(el, 'scrollTop', 'set') for an untouched data property."
  - "Cleanup-assertion variant: vi.getTimerCount() under fake timers (vi.useFakeTimers() was already active for the whole suite via beforeEach) — no real-timer clearTimeout-spy fallback was needed; the 06-01 fake-timer + tick() technique carried through cleanly to unmount() calls."
  - "No production fix was needed for Task 3 — the unsubscribe-on-terminal and unsubscribe-on-destroy logic built in 06-01 already satisfied all four cleanup tests (T2.17-T2.20) on the first run."
  - "src/lib/tryItOut.ts, drizzle/schema.ts, scripts/ingest.ts and src/lib/spec/* confirmed untouched (git diff --stat / --name-only checks run and clean)."

patterns-established:
  - "Terminal-state UI split into two mutually exclusive {#if status === 'succeeded'}/{#if status === 'failed'} blocks rather than a single derived variant switch — keeps each block's guard independently greppable per plan acceptance criteria."

requirements-completed: []

coverage:
  - id: T1
    description: "Failed-state error string renders via escaped {error} interpolation only, never {@html}; no script element reachable inside the red block"
    verification:
      - kind: unit
        ref: "TryItOutPanel.test.ts T2.10 (XSS-shape assertion) + existing transport-discipline source grep test"
        status: pass
    human_judgment: false
  - id: T2
    description: "Unmounting mid-job clears every pending mock timer (vi.getTimerCount() === 0) and produces no console errors; terminal state releases the subscription; re-run does not stack subscriptions"
    verification:
      - kind: unit
        ref: "TryItOutPanel.test.ts T2.17-T2.20"
        status: pass
    human_judgment: false
  - id: T3
    description: "Object-URL created/revoked in matched pairs across repeated Download clicks — no leak"
    verification:
      - kind: unit
        ref: "TryItOutPanel.test.ts T2.9 (two Download clicks, revokeObjectURL count === createObjectURL count both times)"
        status: pass
    human_judgment: false
  - id: T4
    description: "Re-running after a terminal state clears the previous failed block/events/download button before the new job starts"
    verification:
      - kind: unit
        ref: "TryItOutPanel.test.ts T2.11"
        status: pass
    human_judgment: false
  - id: SC-3/SC-4
    description: "Both demo outcomes (fail via a task containing 'fail', succeed via any other task) are fully reachable with no code changes, and are visually distinct (red block vs indigo Download button, no green success badge)"
    verification:
      - kind: unit
        ref: "TryItOutPanel.test.ts T2.6, T2.7, T2.8"
        status: pass
    human_judgment: false
  - id: SC-6
    description: "No fetch/EventSource/XMLHttpRequest/{@html} anywhere in src/lib/components or src/routes"
    verification:
      - kind: unit
        ref: "grep -rnE 'fetch\\(|EventSource|XMLHttpRequest|\\{@html' src/lib/components src/routes — no matches outside test-assertion strings"
        status: pass
    human_judgment: false

duration: 4min
completed: 2026-08-19
status: complete
---

# Phase 06 Plan 02: Failed-State Block, Download Button, File Input & Cleanup Proof Summary

**Completed `TryItOutPanel.svelte` to the full 06-UI-SPEC.md surface — optional file attach, red "Job failed" block, indigo "Download results" button, bounded auto-scrolling monospace feed — and proved with 20 tests (11 from 06-01 plus 9 new suites/T2.6-T2.20) that no mock timer survives unmount, a terminal job, or a re-run.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-08-19T08:33:52Z
- **Completed:** 2026-08-19T08:37:59Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- Added the `Download results` button (guarded by `status === 'succeeded'`) and the red `Job failed` block (guarded by `status === 'failed'`) to `TryItOutPanel.svelte`, rendering `JobUpdate.error` via escaped `{error}` interpolation only — both demo outcomes (a task containing "fail" vs. any other task) are now fully reachable and visually distinct with no third success color.
- Added the optional single-file `<input type="file">` with its `Attach a file (optional)` label, wired through as the frozen third argument to `submitJob(agentId, task, file)` — proved end-to-end (no module mocking) that an attached file's name reaches the downloaded artifact.
- Confirmed the 06-01 progress feed already satisfied both 06-UI-SPEC.md backstop items (`max-h-64 overflow-y-auto` bounded scroll, `whitespace-pre-wrap break-words` wrapping) and added explicit class-assertion tests plus an auto-scroll-effect test and a feed-ordering test.
- Added four cleanup tests (T2.17-T2.20) proving unmount mid-job leaves `vi.getTimerCount() === 0` with no console errors, a terminal job releases the subscription (no further feed growth), and re-running never stacks subscriptions (exactly 5 feed lines after two runs, not 10) — all four passed against the existing 06-01 unsubscribe logic with **no production fix required**.

## Task Commits

Each task followed TDD (RED → GREEN):

1. **Task 1: Add the failed-state block and the Download results button**
   - `46f0312` (test) — failing tests T2.6-T2.11 (fail path, download visibility/interaction, XSS-shape, re-run reset)
   - `0d43527` (feat) — `TryItOutPanel.svelte`: Download button + red failed block, 11/11 tests passing
2. **Task 2: Add the optional file input and finish the bounded auto-scrolling log box**
   - `b47384c` (test) — failing tests T2.12-T2.16 (file input, end-to-end file hand-off; feed bound/wrap/scroll/order tests, which already passed against 06-01's feed markup)
   - `f189f98` (feat) — `TryItOutPanel.svelte`: file input + `submitJob(agentId, task, file)`, 16/16 tests passing
3. **Task 3: Prove subscription cleanup — no mock timer survives unmount or a terminal job**
   - `858449c` (test) — T2.17-T2.20 added and passing immediately (no production fix needed), 20/20 tests passing

**Plan metadata:** this commit (docs: complete 06-02 plan)

## Files Created/Modified
- `src/lib/components/TryItOutPanel.svelte` - Added `downloadArtifact` import, the `Download results` button block, the red `Job failed` block, the `file` `$state` variable, the file `<input>` + label, and `submitJob(agentId, task, file)`. 118 lines total.
- `src/lib/components/TryItOutPanel.test.ts` - Added 15 new tests (T2.6-T2.20) across 8 new `describe` blocks: fail path, download visibility, download interaction, XSS-shape assertion, file input, bounded feed, re-run reset, subscription cleanup. 438 lines total, 20 tests, all passing.

## Decisions Made
- **Auto-scroll observation technique (T2.15):** used `Object.defineProperty(feed, 'scrollTop', { get, set })` as an accessor-pair recorder directly, rather than attempting `vi.spyOn(el, 'scrollTop', 'set')` first — jsdom defines `scrollTop` as a plain data property, so an upfront accessor-pair definition was the more direct and reliable choice for this jsdom version.
- **Cleanup-assertion variant (Task 3):** used `vi.getTimerCount()` under fake timers (already active suite-wide via `beforeEach(() => vi.useFakeTimers())`). No real-timer `clearTimeout`-spy fallback was needed — `unmount()` from `@testing-library/svelte`'s `render()` interacts cleanly with the `$effect` teardown built in 06-01.
- **No production fix in Task 3** — the plan flagged this as the highest-severity technical risk (threat T2), but the 06-01 implementation's `$effect(() => () => { unsubscribe?.(); unsubscribe = null })` destroy-cleanup and the in-`subscribeProgress`-callback terminal-state unsubscribe already satisfied all four new tests on the first run.
- Confirmed via `git diff --stat`/`--name-only` that `src/lib/tryItOut.ts` (frozen client, D-01), `drizzle/schema.ts`, `scripts/ingest.ts`, and `src/lib/spec/*` were untouched by this plan (D-15).

## Deviations from Plan

None — plan executed exactly as written. All three tasks' behavior specs, action blocks, and prohibitions were followed as given; no Rule 1-3 auto-fixes were needed because the target code (from 06-01) already satisfied every cleanup assertion.

## Issues Encountered
None.

## User Setup Required
None — no external service configuration required.

## UI-SPEC Backstop Items — Still Need Visual Confirmation

The two 06-UI-SPEC.md backstop items (`overflow` — bounded, scrolling feed; `long-text` — wrapping event lines) are covered here by class-token assertions (`max-h-64`, `overflow-y-auto`, `whitespace-pre-wrap`, `break-words`) and a `scrollTop`-write assertion, but have **not** been visually confirmed in a real browser. That confirmation is queued for the 06-03 checkpoint.

## Next Phase Readiness
- `TryItOutPanel.svelte` now renders every element D-10 requires and both demo outcomes (fail/succeed) are reachable with zero code changes — ready for the 06-03 human-verification checkpoint and `COVERAGE.md`.
- `src/lib/tryItOut.ts` remains untouched, complete, and frozen — confirmed by `git diff --stat`.
- Known, expected, out-of-scope failure confirmed unaffected: whole-suite `npx vitest run` still shows 4 failures in `scripts/ingest.test.ts` (pre-existing Phase 5 regression owned by the not-yet-executed plan 05-02); all other 97 tests across 10 files pass, including all 20 of `TryItOutPanel.test.ts`.

---
*Phase: 06-runnable-try-it-out-flow-mock-backed*
*Completed: 2026-08-19*

## Self-Check: PASSED

Verified `src/lib/components/TryItOutPanel.svelte` (118 lines) and `src/lib/components/TryItOutPanel.test.ts` (438 lines, 20 tests) exist on disk with the expected content (Download results button, Job failed block, file input, cleanup tests). All task commit hashes (`46f0312`, `0d43527`, `b47384c`, `f189f98`, `858449c`) confirmed present in `git log`.
