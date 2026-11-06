---
phase: 13-multi-agent-and-multi-format-hosting-flagged
plan: 07
subsystem: catalog-ui
tags: [agent-kinds, flag, catalog, filter, a11y]
requires: [13-01, 13-06]
provides: [kind-aware catalog behind AGENT_KINDS]
key-files:
  created:
    - src/lib/server/kinds.query.test.ts
    - src/lib/catalogUrl.kinds.test.ts
    - src/routes/catalog/catalog.kinds.test.ts
    - src/lib/components/AgentCard.kinds.a11y.test.ts
    - src/lib/components/FilterBar.kinds.a11y.test.ts
  modified:
    - src/lib/server/kinds.ts
    - src/lib/catalogUrl.ts
    - src/routes/catalog/+page.server.ts
    - src/routes/catalog/+page.svelte
    - src/lib/components/AgentCard.svelte
    - src/lib/components/FilterBar.svelte
decisions: [D-080, D-081]
duration: ~1h (machine under heavy parallel load)
completed: 2026-10-12
---

# Phase 13 Plan 07: Kind-aware catalog Summary

Flag-gated kind badge on cards, optional "Type" filter and a validated `?kind=` param in the catalog; flag-off output is unchanged.

## Commits
- c75dc99: kind query helpers (`listSlugsByKind`, `listKinds`), `parseKind`, `kind` in `buildCatalogParams`
- c6bdb8c: catalog load/page, AgentCard badge (consumes KindBadge), FilterBar Type select, tests

## Behaviour
- Flag off: no extra db calls, no `kinds`/`filters.kind`/per-card `kind` keys, same markup (test asserts key set and that kinds module is untouched).
- Flag on: `kinds`, `filters.kind`, per-card `kind`/`framework`; `?kind=` composes with category/llm/maturity/q and pagination; `n/a` model hidden; invalid values ignored.

## Deviations from Plan
- Plan said append tests to `kinds.test.ts`; guardrail forbids editing existing tests, so helper tests are in new `kinds.query.test.ts` (D-081).
- `kinds.js` imported lazily in the load (static import breaks the unmodified catalog.test.ts drizzle mock) (D-080).

## Notes
- `npm run check` exits 0 (854 passed, 1 skipped). Under heavy parallel machine load (load avg 11-14) default 5s/10s test timeouts hit a11y page tests and others intermittently; those pass in isolation and the full run passed with `--maxWorkers=3 --testTimeout=30000`. No code issue.
- Known limitation: `?kind=agent` only matches agents with a sidecar row.
- Browser check appended to 13-HUMAN-UAT.md (pending human).

D-numbers used: D-080, D-081

## Self-Check: PASSED
