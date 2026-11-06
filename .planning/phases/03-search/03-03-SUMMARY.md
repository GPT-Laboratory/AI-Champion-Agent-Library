---
phase: 03-search
plan: 03
subsystem: search
tags: [search-service, api, catalog-loader, hybrid]
requires: [03-01, 03-02]
provides:
  - createSearchService, search, warmUp
  - GET /api/search
  - /catalog?q= ranked server-side results
affects: [03-04, 03-05]
key-files:
  created:
    - src/lib/server/search/index.ts
    - src/lib/server/search/index.test.ts
    - src/routes/api/search/+server.ts
    - src/routes/api/search/search.test.ts
  modified:
    - src/routes/catalog/+page.server.ts
    - src/routes/catalog/catalog.test.ts
    - src/hooks.server.ts
key-decisions:
  - "load() handles q (SSR-correct); /api/search remains the API surface"
  - "Index refresh = fingerprint (row count + max last_ingested_at) checked at most every 30 s"
  - "Stale-model vectors ignored (model must equal embedder.id), falling back to BM25"
metrics:
  tasks: 2
  completed: 2026-10-12
---

# Phase 3 Plan 03: Search service, API and catalog q Summary

Injectable `createSearchService` (BM25 immediately, query embedding raced against a 1.5 s timeout, embedder promise cached so warm-up continues after a timeout), lazy db-backed `search()` singleton, `GET /api/search`, and `q` support in the catalog loader (rank-ordered, category/llm/maturity filters via `inArray` + conditions, JS pagination).

## Tasks

1. Search service + non-fatal hooks warm-up: 9c8d3a3
2. /api/search route and catalog loader q: 5223bd1

## Verification

- `npx vitest run src/lib/server/search/index.test.ts src/routes/api/search src/routes/catalog`: 31 tests pass; `npx tsc --noEmit` clean. No real model or DB touched in the new tests.
- `/api/search` not added to public routes (hooks 401 unauthenticated as before).

## Deviations from Plan

- Test for the 500 path throws from a getter on the mocked resolved value rather than from a throwing/rejecting mock: vitest 4.1 reported a throwing mock implementation as a test failure even though the handler returned 500 correctly. Handler behaviour is identical.
- `search()` and `warmUp()` lazy-import `../db.js` on first call (so importing the module never opens the DB).
- `SearchService` also exposes `warmUp()` (used by the hooks init).
