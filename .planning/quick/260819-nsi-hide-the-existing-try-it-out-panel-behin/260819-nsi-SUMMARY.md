---
phase: quick-260819-nsi
plan: 01
status: complete
subsystem: agent-detail-page
tags: [svelte, disclosure-ui, try-it-out]
dependency_graph:
  requires: [Phase 06 TryItOutPanel.svelte, tryItOut.ts]
  provides: [Collapsible try-it-out disclosure control on runnable agent detail page]
  affects: [src/routes/agents/[slug]/+page.svelte, src/routes/agents/try-it-out.test.ts]
tech_stack:
  added: []
  patterns: [Svelte 5 $state boolean toggle guarding conditional mount, no aria-controls since controlled element unmounts]
key_files:
  created: []
  modified:
    - src/routes/agents/[slug]/+page.svelte
    - src/routes/agents/try-it-out.test.ts
decisions:
  - "Conditional {#if} mount (not hidden/display:none) used to keep panel fully absent from DOM per QTIO-01; safe because TryItOutPanel.svelte has no onMount/$effect"
  - "No aria-controls attribute — the controlled element unmounts while collapsed, so a dangling IDREF is avoided; aria-expanded alone satisfies the disclosure pattern"
metrics:
  duration: "~15min"
  completed: "2026-08-19"
---

# Quick Task 260819-nsi: Hide Try It Out Panel Behind Disclosure Control Summary

Hid the existing runnable-mode `TryItOutPanel` behind a collapsible "Try it out ↓" disclosure button in `src/routes/agents/[slug]/+page.svelte`, using a local `$state(false)` boolean and a plain `{#if}` conditional mount — no changes to `TryItOutPanel.svelte` or `tryItOut.ts`.

## What Was Built

- Added `let tryItOutOpen = $state(false)` to the page component.
- Replaced the unconditional runnable-mode `<TryItOutPanel>` render with a `<button>` ("Try it out" + `&darr;` arrow) that toggles `tryItOutOpen`, sets `aria-expanded`, and rotates the arrow 180° via `class:rotate-180` when expanded. The panel now mounts only inside a nested `{#if tryItOutOpen}` block, directly below the button.
- Rewrote the runnable-mode test coverage in `try-it-out.test.ts`: the old single test was replaced with four tests — hidden-on-initial-render, toggle-renders-enabled-with-down-arrow, click-reveals-panel-in-document-order, second-click-collapses. Added a `tryItOutToggle` helper and imported `fireEvent`/`tick`.
- The four pre-existing external/none/null/malformed mode tests were left untouched and still pass.

## Task-by-Task

1. **Task 1 (RED):** Rewrote `try-it-out.test.ts` runnable assertions. Confirmed all 4 new tests failed against the unmodified `+page.svelte` (panel/heading present when expected absent; no toggle button found), while the other 4 mode tests kept passing. Commit `421e389`.
2. **Task 2 (GREEN):** Added the toggle button + conditional mount in `+page.svelte`. All 8 route tests plus the 20 `TryItOutPanel.test.ts` tests pass (28/28). Verified `git diff --name-only HEAD -- src/lib/components/TryItOutPanel.svelte src/lib/tryItOut.ts` prints nothing (hard constraint intact). Commit `e5e4157`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree had no installed dependencies**

- **Found during:** Pre-flight test run (Task 1 baseline check)
- **Issue:** The worktree's `node_modules/` contained only a stray `.vite` cache directory — no actual packages were installed, so `npm test` failed immediately with `Cannot find module '.../@testing-library/svelte/src/vitest.js'` before any plan-related test could even be attempted.
- **Fix:** Ran `npm install` inside the worktree (matches the main checkout's `package.json`/lockfile; installed 234 packages).
- **Files modified:** none tracked by git (`node_modules/` is gitignored)
- **Commit:** N/A (not a source change; no commit needed/possible since node_modules is ignored)

No other deviations. Plan executed exactly as written otherwise.

## Verification Results

- `npm test -- src/routes/agents/try-it-out.test.ts src/lib/components/TryItOutPanel.test.ts` → 28/28 pass.
- `npm test` (full suite) → 100 passed, 6 failed, all 6 failures confined to `scripts/ingest.test.ts` (pre-existing deferred regression logged in Phase 05, out of scope per plan instructions — unaffected by this change).
- `git diff --name-only HEAD -- src/lib/components/TryItOutPanel.svelte src/lib/tryItOut.ts` → empty (hard constraint QTIO-04 verified).
- `git diff --name-only HEAD~2` → exactly two files changed: `src/routes/agents/[slug]/+page.svelte`, `src/routes/agents/try-it-out.test.ts`.
- `grep -c "TryItOutPanel" src/routes/agents/[slug]/+page.svelte` → `2` (import + single render site, now nested inside `{#if tryItOutOpen}`).
- `grep -nE 'darr|rotate-180|aria-expanded|\$state\(false\)' src/routes/agents/[slug]/+page.svelte` → all four markers present.
- No SVG, no new dependency, no new component file introduced.

## Requirements Satisfied

- QTIO-01: Panel absent from DOM on initial render — verified by Test A (`#tryitout-task` null, no `h2` match, no `Run` button).
- QTIO-02: Single enabled "Try it out" button with down arrow (`↓`) renders for runnable agents, `aria-expanded="false"` while collapsed — verified by Test B.
- QTIO-03: Click reveals panel inline below the control, in document order after it; second click collapses — verified by Tests C and D.
- QTIO-04: `TryItOutPanel.svelte` and `tryItOut.ts` unchanged — verified by empty `git diff --name-only`.

## Self-Check: PASSED

- FOUND: `src/routes/agents/[slug]/+page.svelte` (modified, contains `tryItOutOpen`, `aria-expanded`, `&darr;`, `rotate-180`)
- FOUND: `src/routes/agents/try-it-out.test.ts` (modified, contains 8 tests, `fireEvent.click`)
- FOUND commit `421e389` (test(quick-nsi): add failing tests for collapsible try-it-out disclosure)
- FOUND commit `e5e4157` (feat(quick-nsi): hide try-it-out panel behind collapsible arrow control)
- `src/lib/components/TryItOutPanel.svelte` and `src/lib/tryItOut.ts`: confirmed byte-identical to HEAD (empty diff)
