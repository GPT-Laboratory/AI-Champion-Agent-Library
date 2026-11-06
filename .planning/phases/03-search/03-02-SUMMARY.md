---
phase: 03-search
plan: 02
subsystem: search
tags: [bm25, rrf, hybrid, tokenizer]
requires: []
provides:
  - tokenize, buildBm25Index, cosine, rrf, hybridSearch, SIM_FLOOR, RRF_K
affects: [03-03, 03-05]
key-files:
  created:
    - src/lib/server/search/tokenize.ts
    - src/lib/server/search/bm25.ts
    - src/lib/server/search/hybrid.ts
    - src/lib/server/search/tokenize.test.ts
    - src/lib/server/search/bm25.test.ts
    - src/lib/server/search/hybrid.test.ts
key-decisions:
  - "SIM_FLOOR = 0.25 is an untuned starting value; plan 05 should retune with the real model"
metrics:
  tasks: 2
  completed: 2026-10-12
---

# Phase 3 Plan 02: Ranking core Summary

Pure in-TS ranking: tokenizer, Okapi BM25 (k1=1.2, b=0.75, title x3 and tag x2 weighting, last-token prefix expansion at 0.5x), cosine, weighted RRF (k=60) and `hybridSearch` with BM25-only fallback.

## Tasks

1. Tokenizer and BM25: 4325316
2. cosine, rrf, hybridSearch: 316b7a2

## Verification

- 11 (tokenize/bm25) + 9 (hybrid) tests pass; `npx tsc --noEmit` clean; `npm run check` exits 0 (51 files, 460 tests).
- Modules import nothing from db, drizzle or the embedder.

## Deviations from Plan

None - plan executed as written.
