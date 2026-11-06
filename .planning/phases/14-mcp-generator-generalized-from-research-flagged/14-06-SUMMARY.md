---
phase: 14-mcp-generator-generalized-from-research-flagged
plan: 06
subsystem: ui
tags: [svelte5, a11y, feature-flag, mcp-generator]
requires:
  - phase: 14-01
    provides: api-contract (ROUTE_PATH, MAX_INPUT_BYTES), registry listAdapters, mcpGeneratorEnabled flag
provides:
  - CustomizeMenu generatorEnabled prop (default false) adding an enabled "Generate MCP" item
  - GenerateMcpPanel (paste text, adapter select, zip download, gap display)
  - detail load key mcpGeneratorEnabled (absent when flag off) and mcpGeneratorData helper
affects: [14-07]
key-files:
  created:
    - src/lib/components/GenerateMcpPanel.svelte
    - src/lib/components/GenerateMcpPanel.test.ts
    - src/lib/components/GenerateMcpPanel.a11y.test.ts
    - src/lib/components/CustomizeMenu.mcp.test.ts
    - src/routes/agents/customize-button.mcp.test.ts
  modified:
    - src/lib/components/CustomizeMenu.svelte
    - src/routes/agents/[slug]/+page.svelte
    - src/routes/agents/[slug]/+page.server.ts
key-decisions:
  - "D-156 draft: extra menu item gated by a prop fed from the server load; key absent when off"
  - "D-157 draft: panel is a non-modal region, no storage, input cleared after download"
  - "D-158 draft: zip download via Blob + temporary anchor, no server persistence"
duration: ~25min
completed: 2026-10-12
---

# Phase 14 Plan 06: Generate MCP UI Summary

Flag-gated "Generate MCP" Customize menu item and an accessible paste-and-download panel; with MCP_GENERATOR off the menu and the detail load are unchanged.

## Accomplishments
- CustomizeMenu takes `generatorEnabled` (default false); the placeholder markup is untouched, a separate branch renders the fourth enabled item. Flag-off regression test compares open-menu DOM (no props vs `false`, generated id normalised).
- Detail load spreads `mcpGeneratorData()` so the `mcpGeneratorEnabled: true` key exists only when the flag is on.
- GenerateMcpPanel: labelled region, notice, adapter select (Auto-detect + listAdapters), textarea described by the notice, status and alert live regions, client guards (empty, over MAX_INPUT_BYTES), injectable `fetchFn`, 404 / gaps / network handling, Escape and Close call `onclose`, textarea cleared after download, no storage APIs (source-grep test).
- axe: zero violations in default, error and success states.

## Task Commits
1. Task 1 (menu item, load key, regression tests; includes the panel component so it compiles): 662a01b
2. Task 2 (panel behaviour and axe tests): see git log (`test(14-06)`)

## Decision drafts (for 14-07 to consolidate)
- D-156: The Generate MCP menu item is gated by a `generatorEnabled` prop fed from the detail load; the load key is absent (not false) when the flag is off, so flag-off output is provably unchanged.
- D-157: The panel is a non-modal region (no focus trap), stores nothing (no local/session storage or cookies), focuses the textarea on open, returns focus to the Customize trigger on close, and clears the input after a successful download. Rejected input is kept in the textarea so the author can fix it, but is never rendered elsewhere.
- D-158: The zip is delivered by Blob + temporary anchor with `download` (name from content-disposition, sanitised, default mcp-server.zip) and the object URL is revoked immediately; nothing is persisted server-side.

## Deviations from Plan
- [Rule 3] The full GenerateMcpPanel was committed with Task 1 (plan allowed a stub) because the menu imports it; Task 2 added its tests.
- Test-only: undici `Response` rejects jsdom `Blob` bodies, so panel tests use `Uint8Array` bodies.

## Issues Encountered
- `npm run check` first run had one failure in the unrelated `src/routes/api/tryitout/jobs/jobs.test.ts` ("returns 409 for a failed job", load-induced 3s timeout); it passes alone on rerun (flaky), and the full `npm run check` then exited 0 (117 files passed).

## Pending human
- Real-browser verification of the menu, panel and an actual zip download (no browser available). 14-07 should list it in 14-HUMAN-UAT.md.

## Self-Check: PASSED
