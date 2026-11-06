---
phase: 15-mcp-test-platform-flagged
plan: 12
subsystem: mcptest-ui
tags: [mcp, ui, a11y, flag, svelte]
requires: [15-08, 15-11]
provides:
  - src/lib/mcptest/uiModel.ts (stateLabel, caseBadge, groupByTier, flagsBlockersFirst)
  - src/lib/components/McpTestPanel.svelte (idle/running/done/error)
  - /mcp-test route (flag-gated, 404 when off)
  - CustomizeMenu testerEnabled prop, mcpTesterData load helper
affects: [15-13]
key-files:
  created:
    - src/lib/mcptest/uiModel.ts
    - src/lib/mcptest/uiModel.test.ts
    - src/lib/components/McpTestPanel.svelte
    - src/lib/components/McpTestPanel.test.ts
    - src/lib/components/McpTestPanel.a11y.test.ts
    - src/lib/components/mcpTestFixtures.ts
    - src/routes/mcp-test/+page.server.ts
    - src/routes/mcp-test/+page.svelte
    - src/routes/mcp-test/page.test.ts
    - src/routes/mcp-test/page.load.test.ts
    - src/lib/components/CustomizeMenu.mcptest.test.ts
    - src/routes/agents/customize-button.mcptest.test.ts
  modified:
    - src/lib/components/CustomizeMenu.svelte
    - src/routes/agents/[slug]/+page.server.ts
    - src/routes/agents/[slug]/+page.svelte
requirements-completed: [SC-5, SC-3]
completed: 2026-10-13
---

# Phase 15 Plan 12: /mcp-test page, panel and Customize entry Summary

A flag-gated (MCP_TESTER) /mcp-test page with an accessible run panel (POST then poll `/api/mcp-test/runs`, report download) and a Customize menu link that exists only when the flag is on; flag-off DOM and load data are unchanged.

## Commits (branch worktree-agent-a38b93e339a8dbe07)
- e211e89 ui model and McpTestPanel with axe tests
- feat(15-12) flag-gated /mcp-test page
- feat(15-12) Customize menu entry for the tester, flag-gated

## Behaviour
- Panel: cases grouped by tier with source badges (from FIDELITY where/status), subject select (non-runnable disabled, note listed), reruns 1-3, Run, polite status "Running: N of M cells, current X", results (verdict, gate, score with casesRun of casesApplicable, flags blockers first, per-case table with text state badges, report.json download link). Injectable `fetchFn` and `pollMs`; nothing stored; polling stops on unmount; fake disclaimer shown for fake subjects. Errors (400/413/429 body text, failed run, network) go to a role=alert region.
- Page: load throws 404 before reading anything when the flag is off; returns subjects and the 12 cases (from FIDELITY, no file access).
- Menu: `testerEnabled` appends `<a role="menuitem" href="/mcp-test">` after existing items; keyboard wrap covers the new count. Detail load key `mcpTesterEnabled` is absent when off (`mcpTesterData`).

## Decision drafts (not written to AUTONOMOUS-DECISIONS.md)
- **DRAFT-15-12-a** /mcp-test is a standalone page linked from the Customize menu only when the flag is on. Revert: remove the `testerEnabled` prop/branch, `mcpTesterData`, and src/routes/mcp-test.
- **DRAFT-15-12-b** Panel stores nothing and polls (default 800 ms), no websockets. Revert: n/a (replace polling transport).
- **DRAFT-15-12-c** Page subjects: fake variants and generator samples are shown as runnable (the API accepts both; generator runs score in process with server cells PENDING_HUMAN), plus one disabled "Real server" entry with a pending-human note. `listSubjects()` marks generators `runnable:false`; the page overrides that for the UI only. Revert: use `runnable` from `listSubjects()` unchanged.
- **DRAFT-15-12-d** Case titles on the page are the FIDELITY notes (no suite load), keeping the load cheap and path-free. Revert: load titles from the suite.
- **DRAFT-15-12-e** Menu link is an anchor (`role=menuitem`) rather than a button; `itemEls` type widened to HTMLElement. Flag-off markup is unchanged.

## Deviations from Plan
- Added `src/lib/components/mcpTestFixtures.ts` (shared canned data, not a test file) and `src/routes/mcp-test/page.load.test.ts`: the load and reference-scan tests need the node environment because `generatorSubject.ts` uses file URLs that fail under jsdom, so they could not live in the jsdom `page.test.ts`.
- Reference test asserts that `'/mcp-test'` appears only in CustomizeMenu.svelte (panel uses the API constant, so the route string is not in the panel).

## Pending human
- Browser checks (real focus ring, visual badges, download of report.json, menu click-through to /mcp-test with MCP_TESTER=1). No browser was available; axe covers jsdom only (colour contrast is disabled in jsdom).

## Verification
- New tests: uiModel (4), panel (9) and axe (4), page (1) and load (3), menu (4), detail page (6) all green; existing CustomizeMenu, a11y and customize-button tests pass unedited (no existing test file modified).
- `npm run check` exit 0 (174 files passed, 1 skipped, 1728 tests).
- No new dependency; no forbidden tokens in new files.

## Self-Check: PASSED
