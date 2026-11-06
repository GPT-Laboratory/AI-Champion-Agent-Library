---
phase: 03-search
plan: 04
subsystem: catalog-ui
tags: [search, svelte, debounce, a11y]
requires: [03-03]
provides: [SearchBar, buildCatalogParams, live catalog search]
affects: [src/routes/catalog/+page.svelte]
key-files:
  created:
    - src/lib/components/SearchBar.svelte
    - src/lib/components/SearchBar.test.ts
    - src/lib/catalogUrl.ts
    - src/lib/catalogUrl.test.ts
  modified:
    - src/routes/catalog/+page.svelte
    - package.json
decisions: [D-012, D-013]
metrics:
  completed: 2026-10-12
---

# Phase 3 Plan 04: SearchBar Summary

Debounced (200 ms) live search box in the catalog, driving the server-ranked `?q=` load via `goto` with keepFocus/noScroll, with q preserved across filters.

## Done
- `SearchBar`: role=search, labeled `input[type=search]`, no form/submit, 200 ms debounce with timer cleanup on unmount, sr-only `aria-live="polite"` count ("N agents found"), optional "Clear search" button.
- `buildCatalogParams`: pure URL builder (omits empties, trims q, page=1).
- Catalog page: SearchBar above FilterBar, `query` state, `syncUrl` uses the builder (q no longer dropped), query-specific no-results copy; clearFilters leaves the query.
- `npm run check` now `svelte-kit sync && tsc --noEmit && vitest run` (requested; D-013). Exit 0: 56 files passed, 1 skipped, 498 tests.

## Commits
- a672f94 SearchBar and URL builder
- 3b19c79 catalog page wiring
- 8d81c84 check script

## Deviations from Plan
- Added `svelte-ignore state_referenced_locally` on SearchBar's init-once `text` state (intentional).
- check script change was requested outside the plan.

## Pending human
Browser feel of live typing, focus retention, visual pass: 03-HUMAN-UAT.md item 3. Not faked.

## Self-Check: PASSED
